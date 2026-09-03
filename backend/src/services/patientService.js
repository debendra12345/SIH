const { db } = require('../config/db');
const crypto = require('crypto');

/**
 * Format string or array into array safely
 */
const toArray = (val) => {
  if (Array.isArray(val)) return val;
  if (typeof val === 'string' && val.trim()) {
    try {
      const parsed = JSON.parse(val);
      if (Array.isArray(parsed)) return parsed;
    } catch {
      return val.split(',').map(s => s.trim()).filter(Boolean);
    }
  }
  return [];
};

/**
 * Format array or object into JSON string safely
 */
const toJsonString = (val) => {
  if (typeof val === 'string') {
    try {
      JSON.parse(val);
      return val;
    } catch {
      return JSON.stringify(val.split(',').map(s => s.trim()).filter(Boolean));
    }
  }
  return JSON.stringify(val || []);
};

/**
 * Generate Next Unique Patient ID (e.g. P-1043)
 */
const generatePatientId = () => {
  const rows = db.prepare("SELECT patientId FROM patients WHERE patientId LIKE 'P-%'").all();
  let maxNum = 1000;
  for (const row of rows) {
    const match = row.patientId.match(/^P-(\d+)$/i);
    if (match) {
      const num = parseInt(match[1], 10);
      if (num > maxNum) maxNum = num;
    }
  }
  return `P-${maxNum + 1}`;
};

/**
 * Generate Next Unique OPD Token (e.g. A-105)
 */
const generateOpdToken = () => {
  const count = db.prepare('SELECT COUNT(*) as count FROM patient_sessions').get().count;
  const tokenNum = 100 + count + 1;
  return `A-${tokenNum}`;
};

/**
 * 1. Register Patient
 */
const registerPatient = async (data) => {
  const now = new Date().toISOString();
  const patientId = data.patientId && data.patientId.trim() ? data.patientId.trim().toUpperCase() : generatePatientId();
  
  // Check if patientId already exists
  const existing = db.prepare('SELECT * FROM patients WHERE patientId = ?').get(patientId);
  if (existing) {
    // Return existing patient info
    const session = db.prepare('SELECT * FROM patient_sessions WHERE patientId = ? ORDER BY createdAt DESC LIMIT 1').get(patientId);
    return {
      patientId: existing.patientId,
      patient: existing,
      session: session || null,
      isExisting: true
    };
  }

  const name = data.name ? data.name.trim() : 'Anonymous Patient';
  const phone = data.phone ? data.phone.trim() : '';
  const email = data.email ? data.email.trim() : '';
  const gender = data.gender || 'Unknown';
  const dateOfBirth = data.dateOfBirth || '';
  const address = data.address || '';
  const bloodGroup = data.bloodGroup || 'O+';
  const age = data.age ? parseInt(data.age, 10) : null;
  const department = data.department || 'General Medicine';
  const room = data.room || 'Room 4';
  const doctorId = data.doctorId || 'DOC-1042';
  const opdToken = generateOpdToken();
  const sessionId = `SESS-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`;
  const consentId = `CONS-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`;

  // Execute in transaction
  const registerTx = db.transaction(() => {
    // Insert patient
    db.prepare(`
      INSERT INTO patients (patientId, name, dateOfBirth, gender, phone, email, address, bloodGroup, age, createdAt, updatedAt)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(patientId, name, dateOfBirth, gender, phone, email, address, bloodGroup, age, now, now);

    // Insert session
    db.prepare(`
      INSERT INTO patient_sessions (sessionId, patientId, doctorId, opdToken, department, room, status, createdAt, updatedAt)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(sessionId, patientId, doctorId, opdToken, department, room, 'In preparation', now, now);

    // Insert default consent
    db.prepare(`
      INSERT INTO consent (consentId, patientId, consentGiven, consentDate)
      VALUES (?, ?, 1, ?)
    `).run(consentId, patientId, now);
  });

  registerTx();

  const savedPatient = db.prepare('SELECT * FROM patients WHERE patientId = ?').get(patientId);
  const savedSession = db.prepare('SELECT * FROM patient_sessions WHERE sessionId = ?').get(sessionId);

  return {
    patientId,
    patient: savedPatient,
    session: savedSession,
    isExisting: false
  };
};

/**
 * 2. Get Patient By ID
 */
const getPatientById = async (patientId) => {
  const normalizedId = String(patientId).trim().toUpperCase();
  const patient = db.prepare('SELECT * FROM patients WHERE patientId = ?').get(normalizedId);
  if (!patient) return null;

  const session = db.prepare('SELECT * FROM patient_sessions WHERE patientId = ? ORDER BY createdAt DESC LIMIT 1').get(normalizedId);
  const consentRecord = db.prepare('SELECT * FROM consent WHERE patientId = ? ORDER BY consentDate DESC LIMIT 1').get(normalizedId);

  return {
    ...patient,
    session: session || null,
    consent: consentRecord || null
  };
};

/**
 * 3. Save / Update Health History
 */
const saveHealthHistory = async (patientId, historyData) => {
  const normalizedId = String(patientId).trim().toUpperCase();
  const patient = db.prepare('SELECT patientId FROM patients WHERE patientId = ?').get(normalizedId);
  if (!patient) return null;

  const now = new Date().toISOString();
  const chiefComplaint = historyData.chiefComplaint ? String(historyData.chiefComplaint).trim() : '';
  const symptoms = toJsonString(historyData.symptoms || (chiefComplaint ? [chiefComplaint] : []));
  const duration = historyData.duration || historyData.symptomDuration || '';
  const severity = historyData.severity || 'Moderate';
  const severityNum = historyData.severityNum ? parseInt(historyData.severityNum, 10) : 5;
  const medicalHistory = toJsonString(historyData.medicalHistory || historyData.pastMedicalHistory || []);
  const currentMedications = toJsonString(historyData.currentMedications || []);
  const allergies = toJsonString(historyData.allergies || []);
  const familyHistory = toJsonString(historyData.familyHistory || []);
  const additionalNotes = historyData.additionalNotes || historyData.notes || '';

  const existing = db.prepare('SELECT healthHistoryId FROM health_history WHERE patientId = ?').get(normalizedId);

  if (existing) {
    db.prepare(`
      UPDATE health_history
      SET chiefComplaint = ?, symptoms = ?, duration = ?, severity = ?, severityNum = ?,
          medicalHistory = ?, currentMedications = ?, allergies = ?, familyHistory = ?,
          additionalNotes = ?, updatedAt = ?
      WHERE patientId = ?
    `).run(
      chiefComplaint, symptoms, duration, severity, severityNum,
      medicalHistory, currentMedications, allergies, familyHistory,
      additionalNotes, now, normalizedId
    );
  } else {
    const healthHistoryId = `HH-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`;
    db.prepare(`
      INSERT INTO health_history (
        healthHistoryId, patientId, chiefComplaint, symptoms, duration, severity, severityNum,
        medicalHistory, currentMedications, allergies, familyHistory, additionalNotes, createdAt, updatedAt
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      healthHistoryId, normalizedId, chiefComplaint, symptoms, duration, severity, severityNum,
      medicalHistory, currentMedications, allergies, familyHistory, additionalNotes, now, now
    );
  }

  return getHealthHistory(normalizedId);
};

/**
 * 4. Get Health History
 */
const getHealthHistory = async (patientId) => {
  const normalizedId = String(patientId).trim().toUpperCase();
  const row = db.prepare('SELECT * FROM health_history WHERE patientId = ?').get(normalizedId);
  if (!row) return null;

  return {
    ...row,
    symptoms: toArray(row.symptoms),
    medicalHistory: toArray(row.medicalHistory),
    currentMedications: toArray(row.currentMedications),
    allergies: toArray(row.allergies),
    familyHistory: toArray(row.familyHistory)
  };
};

/**
 * 5. Save / Update AYUSH History
 */
const saveAyushHistory = async (patientId, ayushData) => {
  const normalizedId = String(patientId).trim().toUpperCase();
  const patient = db.prepare('SELECT patientId FROM patients WHERE patientId = ?').get(normalizedId);
  if (!patient) return null;

  const now = new Date().toISOString();
  const ayushTreatment = ayushData.ayushTreatment || ayushData.systemPref || 'Ayurveda';
  const prakriti = ayushData.prakriti || '';
  const agni = ayushData.agni || '';
  const diet = ayushData.diet || '';
  const sleep = ayushData.sleep || '';
  const stress = ayushData.stress || '';
  const medicines = toJsonString(ayushData.medicines || ayushData.remedies || []);
  const practitioner = ayushData.practitioner || '';
  const duration = ayushData.duration || '';
  const otherInfo = ayushData.otherInfo || ayushData.notes || '';

  const existing = db.prepare('SELECT ayushHistoryId FROM ayush_history WHERE patientId = ?').get(normalizedId);

  if (existing) {
    db.prepare(`
      UPDATE ayush_history
      SET ayushTreatment = ?, prakriti = ?, agni = ?, diet = ?, sleep = ?, stress = ?,
          medicines = ?, practitioner = ?, duration = ?, otherInfo = ?, updatedAt = ?
      WHERE patientId = ?
    `).run(
      ayushTreatment, prakriti, agni, diet, sleep, stress,
      medicines, practitioner, duration, otherInfo, now, normalizedId
    );
  } else {
    const ayushHistoryId = `AY-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`;
    db.prepare(`
      INSERT INTO ayush_history (
        ayushHistoryId, patientId, ayushTreatment, prakriti, agni, diet, sleep, stress,
        medicines, practitioner, duration, otherInfo, createdAt, updatedAt
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      ayushHistoryId, normalizedId, ayushTreatment, prakriti, agni, diet, sleep, stress,
      medicines, practitioner, duration, otherInfo, now, now
    );
  }

  return getAyushHistory(normalizedId);
};

/**
 * 6. Get AYUSH History
 */
const getAyushHistory = async (patientId) => {
  const normalizedId = String(patientId).trim().toUpperCase();
  const row = db.prepare('SELECT * FROM ayush_history WHERE patientId = ?').get(normalizedId);
  if (!row) return null;

  return {
    ...row,
    medicines: toArray(row.medicines)
  };
};

/**
 * 7. Add Previous Medical Record & OCR Data
 */
const addRecord = async (patientId, recordData) => {
  const normalizedId = String(patientId).trim().toUpperCase();
  const patient = db.prepare('SELECT patientId FROM patients WHERE patientId = ?').get(normalizedId);
  if (!patient) return null;

  const now = new Date().toISOString();
  const recordId = recordData.recordId || `REC-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`;
  const recordType = recordData.recordType || recordData.type || 'prescription';
  const fileName = recordData.fileName || recordData.name || 'Medical Document';
  const filePath = recordData.filePath || '';
  const status = recordData.status || 'ready';

  db.prepare(`
    INSERT INTO previous_medical_records (recordId, patientId, recordType, fileName, filePath, uploadDate, status)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(recordId, normalizedId, recordType, fileName, filePath, now, status);

  // If OCR data provided, save to ocr_extracted_data
  if (recordData.extractedText || recordData.structuredData || recordData.extracted) {
    const extractionId = `OCR-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`;
    const extractedText = recordData.extractedText || (typeof recordData.extracted === 'string' ? recordData.extracted : '');
    const structuredData = typeof recordData.structuredData === 'object' 
      ? JSON.stringify(recordData.structuredData) 
      : (typeof recordData.extracted === 'object' ? JSON.stringify(recordData.extracted) : JSON.stringify({ summary: extractedText }));
    const confidence = recordData.confidence || 0.98;

    db.prepare(`
      INSERT INTO ocr_extracted_data (extractionId, recordId, patientId, extractedText, structuredData, confidence, createdAt)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(extractionId, recordId, normalizedId, extractedText, structuredData, confidence, now);
  }

  return {
    recordId,
    patientId: normalizedId,
    recordType,
    fileName,
    filePath,
    uploadDate: now,
    status
  };
};

/**
 * 8. Get Previous Medical Records & OCR
 */
const getRecords = async (patientId) => {
  const normalizedId = String(patientId).trim().toUpperCase();
  const records = db.prepare('SELECT * FROM previous_medical_records WHERE patientId = ? ORDER BY uploadDate DESC').all(normalizedId);
  
  const ocrRows = db.prepare('SELECT * FROM ocr_extracted_data WHERE patientId = ? ORDER BY createdAt DESC').all(normalizedId);

  return records.map(r => {
    const ocr = ocrRows.find(o => o.recordId === r.recordId);
    let parsedStructured = null;
    if (ocr && ocr.structuredData) {
      try { parsedStructured = JSON.parse(ocr.structuredData); } catch { parsedStructured = ocr.structuredData; }
    }
    return {
      ...r,
      ocr: ocr ? {
        extractionId: ocr.extractionId,
        extractedText: ocr.extractedText,
        structuredData: parsedStructured,
        confidence: ocr.confidence,
        createdAt: ocr.createdAt
      } : null
    };
  });
};

/**
 * 9. Save Clinical Summary
 */
const saveClinicalSummary = async (patientId, summaryData) => {
  const normalizedId = String(patientId).trim().toUpperCase();
  const patient = db.prepare('SELECT patientId FROM patients WHERE patientId = ?').get(normalizedId);
  if (!patient) return null;

  const now = new Date().toISOString();
  const summaryText = summaryData.summary || summaryData.text || 'Clinical intake completed.';
  const status = summaryData.status || 'generated';

  const existing = db.prepare('SELECT summaryId FROM clinical_summaries WHERE patientId = ?').get(normalizedId);

  if (existing) {
    db.prepare(`
      UPDATE clinical_summaries
      SET summary = ?, generatedAt = ?, status = ?
      WHERE patientId = ?
    `).run(summaryText, now, status, normalizedId);
  } else {
    const summaryId = `SUMM-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`;
    db.prepare(`
      INSERT INTO clinical_summaries (summaryId, patientId, summary, generatedAt, status)
      VALUES (?, ?, ?, ?, ?)
    `).run(summaryId, normalizedId, summaryText, now, status);
  }

  // Update session status to 'Summary Ready'
  db.prepare(`
    UPDATE patient_sessions
    SET status = 'Summary Ready', updatedAt = ?
    WHERE patientId = ?
  `).run(now, normalizedId);

  return getClinicalSummary(normalizedId);
};

/**
 * 10. Get Clinical Summary
 */
const getClinicalSummary = async (patientId) => {
  const normalizedId = String(patientId).trim().toUpperCase();
  const row = db.prepare('SELECT * FROM clinical_summaries WHERE patientId = ?').get(normalizedId);
  return row || null;
};

/**
 * 11. Save / Update Consent
 */
const saveConsent = async (patientId, consentData) => {
  const normalizedId = String(patientId).trim().toUpperCase();
  const patient = db.prepare('SELECT patientId FROM patients WHERE patientId = ?').get(normalizedId);
  if (!patient) return null;

  const now = new Date().toISOString();
  const consentGiven = consentData.consentGiven !== undefined ? (consentData.consentGiven ? 1 : 0) : 1;
  const withdrawnAt = consentGiven ? null : now;

  const existing = db.prepare('SELECT consentId FROM consent WHERE patientId = ?').get(normalizedId);

  if (existing) {
    db.prepare(`
      UPDATE consent
      SET consentGiven = ?, consentDate = ?, withdrawnAt = ?
      WHERE patientId = ?
    `).run(consentGiven, now, withdrawnAt, normalizedId);
  } else {
    const consentId = `CONS-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`;
    db.prepare(`
      INSERT INTO consent (consentId, patientId, consentGiven, consentDate, withdrawnAt)
      VALUES (?, ?, ?, ?, ?)
    `).run(consentId, normalizedId, consentGiven, now, withdrawnAt);
  }

  return getConsent(normalizedId);
};

/**
 * 12. Get Consent
 */
const getConsent = async (patientId) => {
  const normalizedId = String(patientId).trim().toUpperCase();
  const row = db.prepare('SELECT * FROM consent WHERE patientId = ? ORDER BY consentDate DESC LIMIT 1').get(normalizedId);
  return row || null;
};

module.exports = {
  registerPatient,
  getPatientById,
  saveHealthHistory,
  getHealthHistory,
  saveAyushHistory,
  getAyushHistory,
  addRecord,
  getRecords,
  saveClinicalSummary,
  getClinicalSummary,
  saveConsent,
  getConsent
};
