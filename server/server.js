const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const multer = require('multer');
const { PDFParse } = require('pdf-parse');
const fs = require('fs');
const path = require('path');
const { getProviderStatus } = require('./utils/providerStatus');
const connectDB = require('./config/db');
const authRoutes = require('./routes/authRoutes');

// Load environment variables
dotenv.config();

const app = express();
const documentUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }
});

async function extractDocumentText(file) {
  if (file.mimetype === 'application/pdf') {
    try {
      const parser = new PDFParse({ data: file.buffer });
      const parsed = await parser.getText();
      await parser.destroy();
      const text = (parsed.text || '').trim();
      return text.length >= 10
        ? { text: text.slice(0, 50000), status: 'text_extracted', confidence: 1 }
        : { text: '', status: 'PDF_TEXT_EMPTY', confidence: 0 };
    } catch (error) {
      console.warn('PDF text extraction failed:', error.message);
      return { text: '', status: 'PDF_TEXT_EXTRACTION_FAILED' };
    }
  }

  if (file.mimetype === 'image/jpeg' || file.mimetype === 'image/png') {
    let worker;
    try {
      let imageBuffer = file.buffer;
      try {
        const { createCanvas, loadImage } = require('@napi-rs/canvas');
        const image = await loadImage(file.buffer);
        const scale = Math.min(2, Math.max(1, 1800 / Math.max(image.width, image.height)));
        const canvas = createCanvas(Math.round(image.width * scale), Math.round(image.height * scale));
        const context = canvas.getContext('2d');
        context.drawImage(image, 0, 0, canvas.width, canvas.height);
        const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
        for (let i = 0; i < pixels.data.length; i += 4) {
          const luminance = (pixels.data[i] * 0.299) + (pixels.data[i + 1] * 0.587) + (pixels.data[i + 2] * 0.114);
          const enhanced = Math.max(0, Math.min(255, ((luminance - 128) * 1.35) + 128));
          pixels.data[i] = enhanced;
          pixels.data[i + 1] = enhanced;
          pixels.data[i + 2] = enhanced;
        }
        context.putImageData(pixels, 0, 0);
        imageBuffer = canvas.toBuffer('image/png');
      } catch (preprocessError) {
        console.warn('OCR preprocessing unavailable; using original image:', preprocessError.message);
      }
      const { createWorker } = require('tesseract.js');
      worker = await createWorker('eng');
      worker.on('error', error => {
        console.warn('OCR worker error:', error.message || error);
      });
      const result = await worker.recognize(imageBuffer);
      const text = (result?.data?.text || '').trim();
      const confidence = Number(result?.data?.confidence || 0);
      if (!text || text.length < 10) return { text: '', status: 'OCR_UNREADABLE', confidence };
      return {
        text: text.slice(0, 50000),
        status: confidence >= 65 ? 'ocr_extracted' : 'ocr_extracted_low_confidence',
        confidence
      };
    } catch (error) {
      console.warn('OCR provider unavailable:', error.message);
      return { text: '', status: 'OCR_PROVIDER_NOT_CONFIGURED' };
    } finally {
      if (worker) await worker.terminate().catch(() => {});
    }
  }

  return { text: '', status: 'UNSUPPORTED_DOCUMENT_TYPE' };
}

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Connect to MongoDB
if (process.env.MONGO_URI) {
  connectDB().catch((err) => {
    console.error('Initial MongoDB connection failed:', err.message);
  });
} else {
  console.warn('âš ï¸  MONGO_URI not set. Set MONGO_URI in .env to connect to MongoDB.');
}

function buildFallbackClinicalResponse(payload = {}) {
  const complaint = payload.chiefComplaint || payload.complaint || 'Patient reported a health concern';
  const medications = Array.isArray(payload.medications) && payload.medications.length ? payload.medications : ['No current medication list provided'];
  const allergies = Array.isArray(payload.allergies) && payload.allergies.length ? payload.allergies : ['No known drug allergies reported'];
  const timeline = Array.isArray(payload.timeline) && payload.timeline.length ? payload.timeline : ['Clinical intake in progress'];

  return {
    success: true,
    source: 'server-side fallback',
    status: 'patient_reported_fallback · physician review required',
    aiStatus: 'unavailable',
    provider: 'none',
    chiefComplaint: complaint,
    historyOfPresentIllness: payload.historyOfPresentIllness || 'Interview responses were captured and structured for physician review.',
    symptoms: Array.isArray(payload.symptoms) ? payload.symptoms : [],
    medications,
    allergies,
    pastMedicalHistory: Array.isArray(payload.pastMedicalHistory) ? payload.pastMedicalHistory : ['No prior conditions reported'],
    investigations: Array.isArray(payload.investigations) ? payload.investigations : [],
    importantInformation: Array.isArray(payload.importantInformation) ? payload.importantInformation : ['Clinical review recommended for context confirmation.'],
    sourceReferences: Array.isArray(payload.sourceReferences) ? payload.sourceReferences : ['Patient interview', 'Consent-based intake'],
    timeline,
    disclaimer: 'AI assists with information collection and organization. It does not replace professional medical judgment.'
  };
}

async function callGroq(prompt, systemPrompt = 'You are a careful clinical intake assistant. Extract structured medical data without diagnosing.') {
  if (!process.env.GROQ_API_KEY) {
    return null;
  }

  const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${process.env.GROQ_API_KEY}`,
    },
    body: JSON.stringify({
      model: process.env.GROQ_MODEL || 'openai/gpt-oss-20b',
      temperature: 0.2,
      messages: [
        { role: 'system', content: `${systemPrompt} Return only valid JSON with no markdown, no explanations, and no extra text.` },
        { role: 'user', content: prompt },
      ],
    })
  });

  if (!response.ok) {
    throw new Error(`Groq request failed with status ${response.status}`);
  }

  const data = await response.json();
  const text = data?.choices?.[0]?.message?.content;
  if (!text) return null;

  try {
    return JSON.parse(text);
  } catch (error) {
    const cleaned = text.replace(/```json|```/g, '').trim();
    return JSON.parse(cleaned);
  }
}

async function callGemini(prompt, systemPrompt = 'You are a careful clinical intake assistant. Extract structured medical data without diagnosing.') {
  if (!process.env.GEMINI_API_KEY) {
    return null;
  }

  const response = await fetch('https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=' + process.env.GEMINI_API_KEY, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: `${systemPrompt}\n\n${prompt}` }] }],
      generationConfig: { responseMimeType: 'application/json' }
    })
  });

  if (!response.ok) {
    throw new Error(`Gemini request failed with status ${response.status}`);
  }

  const data = await response.json();
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) return null;

  try {
    return JSON.parse(text);
  } catch (error) {
    const cleaned = text.replace(/```json|```/g, '').trim();
    return JSON.parse(cleaned);
  }
}

async function callAI(prompt, systemPrompt = 'You are a careful clinical intake assistant. Extract structured medical data without diagnosing.') {
  const providers = process.env.GROQ_API_KEY
    ? [{ name: 'groq', call: callGroq }]
    : process.env.GEMINI_API_KEY
      ? [{ name: 'gemini', call: callGemini }]
      : [];
  if (!providers.length) return { result: null, provider: 'none', status: 'unavailable' };

  for (const provider of providers) {
    try {
      const result = await provider.call(prompt, systemPrompt);
      if (result && typeof result === 'object' && !Array.isArray(result)) {
        return { result, provider: provider.name, status: 'available' };
      }
    } catch (error) {
      console.warn(`${provider.name} provider unavailable:`, error.message);
    }
  }
  return { result: null, provider: providers[0].name, status: 'error_fallback' };
}

// Local demo state keeps the patient-to-doctor flow connected when MongoDB is not configured.
// It is persisted in the project data directory so a demo restart does not erase the workflow.
const demoStorePath = path.join(__dirname, 'data', 'demo-patients.json');
const demoPatientStore = new Map();
try {
  if (fs.existsSync(demoStorePath)) {
    const saved = JSON.parse(fs.readFileSync(demoStorePath, 'utf8'));
    Object.entries(saved).forEach(([id, value]) => demoPatientStore.set(id, value));
  }
} catch (error) {
  console.warn('Demo persistence could not be loaded:', error.message);
}

function persistDemoStore() {
  try {
    fs.mkdirSync(path.dirname(demoStorePath), { recursive: true });
    fs.writeFileSync(demoStorePath, JSON.stringify(Object.fromEntries(demoPatientStore), null, 2), 'utf8');
  } catch (error) {
    console.warn('Demo persistence could not be saved:', error.message);
  }
}

function getDemoPatient(id) {
  if (!demoPatientStore.has(id)) {
    demoPatientStore.set(id, {
      patient: { patientId: id, name: 'Aarav Sharma', age: 46, gender: 'Male', bloodGroup: 'O+', phone: '' },
      session: { opdToken: 'A-104', status: 'In preparation' },
      healthHistory: null,
      ayushHistory: null,
      summary: null,
      consent: { consentGiven: true, mode: 'demo' },
      previousRecords: [],
      doctorReviews: []
    });
    persistDemoStore();
  }
  return demoPatientStore.get(id);
}

app.post('/api/patients/register', (req, res) => {
  const payload = req.body || {};
  const record = getDemoPatient(payload.patientId || 'P-1024');
  record.patient = { ...record.patient, ...payload, patientId: payload.patientId || record.patient.patientId };
  persistDemoStore();
  res.status(200).json({ success: true, data: record.patient, session: record.session });
});

app.get('/api/patients/:id/health-history', (req, res) => {
  const record = getDemoPatient(req.params.id);
  res.status(200).json({ success: true, data: record.healthHistory || {} });
});

app.post('/api/patients/:id/health-history', (req, res) => {
  const record = getDemoPatient(req.params.id);
  record.healthHistory = { ...(record.healthHistory || {}), ...(req.body || {}) };
  record.session.status = 'Ready for Doctor';
  persistDemoStore();
  res.status(200).json({ success: true, data: record.healthHistory });
});

app.get('/api/patients/:id/ayush-history', (req, res) => {
  const record = getDemoPatient(req.params.id);
  res.status(200).json({ success: true, data: record.ayushHistory || {} });
});

app.post('/api/patients/:id/ayush-history', (req, res) => {
  const record = getDemoPatient(req.params.id);
  record.ayushHistory = { ...(record.ayushHistory || {}), ...(req.body || {}) };
  persistDemoStore();
  res.status(200).json({ success: true, data: record.ayushHistory });
});

app.post('/api/patients/:id/records', (req, res) => {
  const record = getDemoPatient(req.params.id);
  const payload = req.body || {};
  const item = {
    id: `demo-record-${Date.now()}`,
    fileName: payload.fileName || 'Medical document',
    recordType: payload.recordType || 'other',
    uploadDate: new Date().toISOString(),
    ocr: { extractedText: payload.extractedText || payload.extracted || '' },
    structuredData: payload.structuredData || {}
  };
  record.previousRecords.unshift(item);
  persistDemoStore();
  res.status(200).json({ success: true, data: item });
});

app.post('/api/patients/:id/summary', (req, res) => {
  const record = getDemoPatient(req.params.id);
  record.summary = {
    ...(record.summary || {}),
    ...(req.body || {}),
    status: (req.body || {}).status || 'generated',
    updatedAt: new Date().toISOString()
  };
  record.session.status = 'Summary Ready';
  persistDemoStore();
  res.status(200).json({ success: true, data: record.summary, integration: 'demo_persistence_only' });
});

app.get('/api/patients/:id/summary', (req, res) => {
  const record = getDemoPatient(req.params.id);
  if (!record.summary) return res.status(404).json({ success: false, message: 'Summary not found' });
  res.status(200).json({ success: true, data: record.summary });
});

app.post('/api/patients/:id/consent', (req, res) => {
  const record = getDemoPatient(req.params.id);
  record.consent = {
    ...(record.consent || {}),
    ...(req.body || {}),
    mode: 'demo',
    updatedAt: new Date().toISOString()
  };
  persistDemoStore();
  res.status(200).json({ success: true, data: record.consent, integration: 'not_connected' });
});

app.get('/api/patients/:id/consent', (req, res) => {
  const record = getDemoPatient(req.params.id);
  res.status(200).json({ success: true, data: record.consent || { consentGiven: false, mode: 'demo' } });
});

app.get('/api/doctor/patients', (req, res) => {
  const data = Array.from(demoPatientStore.values()).map(record => ({
    id: record.patient.patientId,
    token: record.session.opdToken,
    name: record.patient.name,
    age: record.patient.age,
    gender: record.patient.gender,
    blood: record.patient.bloodGroup,
    phone: record.patient.phone,
    status: record.session.status,
    complaint: record.healthHistory?.chiefComplaint || 'Consultation Intake',
    duration: record.healthHistory?.symptomDuration || 'Not reported',
    severity: record.healthHistory?.severity || 'Not reported',
    allergy: record.healthHistory?.allergies || 'No known allergies',
    conditions: record.healthHistory?.pastMedicalHistory || [],
    medicines: record.healthHistory?.currentMedications || [],
    recordsCount: record.previousRecords.length,
    summaryStatus: record.healthHistory ? 'ready' : 'in-progress'
  }));
  res.status(200).json({ success: true, data });
});

app.get('/api/doctor/patients/:id', (req, res) => {
  const record = getDemoPatient(req.params.id);
  res.status(200).json({ success: true, data: record });
});

// Health check route
app.get('/api/health', (req, res) => {
  res.status(200).json({
    success: true,
    status: 'healthy',
    timestamp: new Date().toISOString(),
    service: 'MediKiosk Backend API',
    environment: process.env.NODE_ENV || 'development',
    providers: getProviderStatus(),
  });
});

app.get('/api/status', (req, res) => {
  res.status(200).json({
    success: true,
    mode: process.env.MONGO_URI ? 'hybrid_demo' : 'demo',
    providers: getProviderStatus(),
    disclaimer: 'ABDM, FHIR exchange, and HIS delivery are not connected in this prototype.'
  });
});

app.post('/api/clinical-intake', async (req, res) => {
  try {
    const payload = req.body || {};
    const ai = await callAI(
      `Convert this patient intake into JSON with keys: chiefComplaint, historyOfPresentIllness, symptoms, medications, allergies, pastMedicalHistory, investigations, importantInformation, sourceReferences, timeline. Input: ${JSON.stringify(payload)}`,
      'You are a careful clinical intake assistant. Return only valid JSON. Use empty arrays for missing values. No markdown, no explanations, no diagnosis or treatment advice.'
    );

    const fallback = buildFallbackClinicalResponse(payload);
    res.status(200).json(ai.result
      ? { ...ai.result, success: true, provider: ai.provider, aiStatus: ai.status, requiresVerification: true }
      : { ...fallback, provider: ai.provider, aiStatus: ai.status });
  } catch (error) {
    res.status(200).json({ ...buildFallbackClinicalResponse(req.body || {}), aiStatus: 'error_fallback' });
  }
});

app.post('/api/summarize-record', async (req, res) => {
  const payload = req.body || {};
  try {
    const ai = await callAI(
      `Summarize this medical record content into JSON with keys: documentType, date, diagnosis, medicines, dosage, labs, importantInformation, verificationStatus. Input: ${JSON.stringify(payload)}`,
      'You are a clinical document summarizer. Return only valid JSON. Use empty arrays for missing values. No markdown or explanations.'
    );

    res.status(200).json(ai.result ? {
      ...ai.result,
      success: true,
      provider: ai.provider,
      aiStatus: ai.status,
      verificationStatus: 'AI extracted · not yet verified'
    } : {
      success: true,
      provider: ai.provider,
      aiStatus: ai.status,
      documentType: payload.documentType || 'medical document',
      date: payload.date || new Date().toISOString().slice(0, 10),
      diagnosis: payload.diagnosis || 'Review required',
      medicines: Array.isArray(payload.medicines) ? payload.medicines : [],
      dosage: payload.dosage || 'Not specified',
      labs: Array.isArray(payload.labs) ? payload.labs : [],
      importantInformation: ['AI extraction completed; physician verification recommended.'],
      verificationStatus: 'AI extracted Â· not yet verified'
    });
  } catch (error) {
    res.status(200).json({
      success: true,
      documentType: payload.documentType || 'medical document',
      diagnosis: 'Review required',
      importantInformation: ['AI extraction temporarily unavailable; manual review recommended.'],
      verificationStatus: 'AI extracted Â· not yet verified'
    });
  }
});

app.post('/api/extract-document', documentUpload.single('document'), async (req, res) => {
  const payload = req.body || {};
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: 'Please upload a PDF, JPG, or PNG medical document.'
      });
    }

    const supportedTypes = ['application/pdf', 'image/jpeg', 'image/png'];
    if (!supportedTypes.includes(req.file.mimetype)) {
      return res.status(415).json({
        success: false,
        message: 'Unsupported document type. Upload PDF, JPG, or PNG.'
      });
    }

    const extraction = await extractDocumentText(req.file);
    const extractedText = extraction.text;
    const documentMetadata = {
      fileName: req.file.originalname,
      mimeType: req.file.mimetype,
      fileSize: req.file.size
    };
    const fallback = {
      success: true,
      patientName: '',
      documentDate: '',
      documentType: payload.documentType || 'Medical report',
      diagnoses: [],
      medications: [],
      allergies: [],
      investigations: [],
      procedures: [],
      symptoms: [],
      importantInformation: extraction.status === 'text_extracted' || extraction.status === 'ocr_extracted' ? [] : ['Document received. OCR is unavailable or low confidence; manual review is required.'],
      sourceReferences: [`Uploaded document: ${req.file.originalname}`],
      sourceText: extractedText,
      extractionStatus: extraction.status,
      processingStatus: extraction.status,
      requiresVerification: true,
      provider: 'none',
      aiStatus: 'not_attempted',
      verificationStatus: 'Not verified · manual review required',
      ocrConfidence: extraction.confidence,
      documentMetadata
    };
    if (!extractedText) {
      return res.status(200).json(fallback);
    }

    const ai = await callAI(
      `Extract medical information from this actual document text into JSON with keys: patientName, documentDate, documentType, diagnoses, medications, allergies, investigations, procedures, symptoms, importantInformation, sourceText, extractionStatus, requiresVerification. The uploaded file metadata is ${JSON.stringify(documentMetadata)}. Extracted source text is: ${JSON.stringify(extractedText)}. Do not invent information. Use empty arrays or unknown values when missing.`,
      'You are a document extraction assistant for hospital intake. Return only valid JSON. Use empty arrays for missing values. No markdown or explanations.'
    );

    return res.status(200).json({
      ...fallback,
      ...(ai.result || {}),
      provider: ai.provider,
      aiStatus: ai.status,
      sourceText: extractedText,
      extractionStatus: extraction.status,
      ocrConfidence: extraction.confidence,
      processingStatus: extraction.status,
      requiresVerification: true,
      verificationStatus: 'Not verified · manual review required',
      documentMetadata
    });
  } catch (error) {
    res.status(200).json({
      success: true,
      documentType: payload.documentType || 'Medical report',
      diagnoses: [],
      medications: [],
      importantInformation: ['Document received, but automated extraction is temporarily unavailable. Manual review recommended.'],
      extractionStatus: 'DOCUMENT_PROCESSING_FAILED',
      processingStatus: 'DOCUMENT_PROCESSING_FAILED',
      provider: 'none',
      aiStatus: 'unavailable',
      requiresVerification: true,
      verificationStatus: 'Not verified · manual review required'
    });
  }
});

app.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    return res.status(err.code === 'LIMIT_FILE_SIZE' ? 413 : 400).json({
      success: false,
      message: err.code === 'LIMIT_FILE_SIZE'
        ? 'Document is too large. Maximum size is 10 MB.'
        : err.message
    });
  }
  next(err);
});

// Mount Routes
app.use('/api/auth', authRoutes);

// 404 Handler for undefined routes
app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: `API endpoint not found: ${req.method} ${req.originalUrl}`,
  });
});

// Central Error Handling Middleware
app.use((err, req, res, next) => {
  console.error('Unhandled Server Error:', err.stack || err);
  res.status(err.status || 500).json({
    success: false,
    message: err.message || 'Internal Server Error',
    error: process.env.NODE_ENV === 'development' ? err.stack : undefined,
  });
});

const PORT = process.env.PORT || 5000;

const { verifySmtpConnection } = require('./services/emailService');

let server = null;
if (require.main === module) {
  server = app.listen(PORT, () => {
    console.log(`MediKiosk Server running on port ${PORT}`);
    verifySmtpConnection().catch(err => {
      console.error('SMTP Startup Check Error:', err.message);
    });
  });
}

// Handle unhandled promise rejections
process.on('unhandledRejection', (err) => {
  console.error(`Unhandled Rejection: ${err.message}`);
});

module.exports = { app, server, extractDocumentText, getProviderStatus, buildFallbackClinicalResponse };
