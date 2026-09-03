const { db } = require('../config/db');
const patientService = require('./patientService');
const crypto = require('crypto');

/**
 * Get OPD Queue of Patients for Doctor Workspace
 */
const getDoctorQueue = async (doctorId = null) => {
  const query = `
    SELECT 
      p.patientId, p.name, p.age, p.gender, p.bloodGroup, p.phone, p.email,
      s.sessionId, s.opdToken, s.department, s.room, s.status, s.createdAt as sessionCreatedAt,
      hh.chiefComplaint, hh.duration as complaintDuration, hh.severity, hh.symptoms, hh.medicalHistory, hh.currentMedications, hh.allergies,
      ay.prakriti, ay.agni, ay.diet,
      cs.summary as clinicalSummary, cs.status as summaryStatus,
      (SELECT COUNT(*) FROM previous_medical_records r WHERE r.patientId = p.patientId) as recordsCount,
      (SELECT COUNT(*) FROM doctor_reviews dr WHERE dr.patientId = p.patientId) as reviewsCount
    FROM patients p
    JOIN patient_sessions s ON p.patientId = s.patientId
    LEFT JOIN health_history hh ON p.patientId = hh.patientId
    LEFT JOIN ayush_history ay ON p.patientId = ay.patientId
    LEFT JOIN clinical_summaries cs ON p.patientId = cs.patientId
    ORDER BY s.createdAt DESC
  `;

  const rows = db.prepare(query).all();

  return rows.map(r => {
    let symptomsArr = [];
    let medHistoryArr = [];
    let medicationsArr = [];
    let allergiesArr = [];

    try { symptomsArr = JSON.parse(r.symptoms || '[]'); } catch { symptomsArr = r.symptoms ? [r.symptoms] : []; }
    try { medHistoryArr = JSON.parse(r.medicalHistory || '[]'); } catch { medHistoryArr = r.medicalHistory ? [r.medicalHistory] : []; }
    try { medicationsArr = JSON.parse(r.currentMedications || '[]'); } catch { medicationsArr = r.currentMedications ? [r.currentMedications] : []; }
    try { allergiesArr = JSON.parse(r.allergies || '[]'); } catch { allergiesArr = r.allergies ? [r.allergies] : []; }

    const priority = r.severity === 'High' || r.severity === 'Severe' ? 'critical' : (r.severity === 'Moderate' ? 'normal' : 'low');

    return {
      id: r.patientId,
      token: r.opdToken,
      name: r.name,
      age: r.age,
      gender: r.gender,
      blood: r.bloodGroup || 'O+',
      phone: r.phone,
      department: r.department,
      room: r.room,
      status: r.status,
      priority: priority,
      complaint: r.chiefComplaint || 'Consultation Intake',
      duration: r.complaintDuration || '',
      severity: r.severity || 'Moderate',
      symptoms: symptomsArr,
      conditions: medHistoryArr,
      medicines: medicationsArr,
      allergy: allergiesArr.join(', ') || 'No known allergies',
      prakriti: r.prakriti || 'Not assessed',
      summary: r.clinicalSummary || '',
      summaryStatus: r.summaryStatus || (r.clinicalSummary ? 'ready' : 'pending'),
      recordsCount: r.recordsCount || 0,
      isReviewed: r.reviewsCount > 0,
      time: new Date(r.sessionCreatedAt).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })
    };
  });
};

/**
 * Get Full Comprehensive Patient Dossier
 */
const getFullPatientDossier = async (patientId) => {
  const normalizedId = String(patientId).trim().toUpperCase();

  // 1. Patient
  const patient = db.prepare('SELECT patientId, name, dateOfBirth, gender, phone, email, address, bloodGroup, age, createdAt, updatedAt FROM patients WHERE patientId = ?').get(normalizedId);
  if (!patient) return null;

  // 2. Session
  const session = db.prepare('SELECT * FROM patient_sessions WHERE patientId = ? ORDER BY createdAt DESC LIMIT 1').get(normalizedId);

  // 3. Consent
  const consent = await patientService.getConsent(normalizedId);

  // 4. Health History
  const healthHistory = await patientService.getHealthHistory(normalizedId);

  // 5. AYUSH History
  const ayushHistory = await patientService.getAyushHistory(normalizedId);

  // 6. Previous Records
  const previousRecords = await patientService.getRecords(normalizedId);

  // 7. OCR Data
  const ocrData = db.prepare('SELECT * FROM ocr_extracted_data WHERE patientId = ? ORDER BY createdAt DESC').all(normalizedId).map(o => {
    let parsed = null;
    try { parsed = JSON.parse(o.structuredData); } catch { parsed = o.structuredData; }
    return {
      ...o,
      structuredData: parsed
    };
  });

  // 8. Clinical Summary
  const clinicalSummary = await patientService.getClinicalSummary(normalizedId);

  // 9. Doctor Reviews
  const doctorReviews = db.prepare(`
    SELECT dr.*, d.name as doctorName, d.department as doctorDept
    FROM doctor_reviews dr
    JOIN doctors d ON dr.doctorId = d.doctorId
    WHERE dr.patientId = ?
    ORDER BY dr.reviewedAt DESC
  `).all(normalizedId);

  return {
    patient,
    session: session || null,
    consent: consent || null,
    healthHistory: healthHistory || null,
    ayushHistory: ayushHistory || null,
    previousRecords: previousRecords || [],
    ocrData: ocrData || [],
    clinicalSummary: clinicalSummary || null,
    doctorReviews: doctorReviews || []
  };
};

/**
 * Add Doctor Review / Consultation Sign-Off
 */
const addDoctorReview = async (patientId, doctorId, reviewData) => {
  const normalizedPatientId = String(patientId).trim().toUpperCase();
  const normalizedDoctorId = String(doctorId || 'DOC-1042').trim().toUpperCase();

  const patient = db.prepare('SELECT patientId FROM patients WHERE patientId = ?').get(normalizedPatientId);
  if (!patient) return null;

  const doctor = db.prepare('SELECT doctorId, name FROM doctors WHERE doctorId = ?').get(normalizedDoctorId);
  if (!doctor) {
    // If doctor not found, fallback to DOC-1042
    const defaultDoc = db.prepare('SELECT doctorId FROM doctors LIMIT 1').get();
    if (!defaultDoc) throw new Error('No doctor found in database');
  }

  const now = new Date().toISOString();
  const reviewId = `REV-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`;
  const notes = reviewData.notes ? String(reviewData.notes).trim() : 'Consultation review completed and signed.';
  const reviewStatus = reviewData.reviewStatus || 'reviewed';

  const reviewTx = db.transaction(() => {
    // Insert review
    db.prepare(`
      INSERT INTO doctor_reviews (reviewId, patientId, doctorId, notes, reviewStatus, reviewedAt)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(reviewId, normalizedPatientId, doctor ? doctor.doctorId : 'DOC-1042', notes, reviewStatus, now);

    // Update patient session status
    db.prepare(`
      UPDATE patient_sessions
      SET status = 'Completed', updatedAt = ?
      WHERE patientId = ?
    `).run(now, normalizedPatientId);

    // Update clinical summary status if exists
    db.prepare(`
      UPDATE clinical_summaries
      SET status = 'signed'
      WHERE patientId = ?
    `).run(normalizedPatientId);
  });

  reviewTx();

  return db.prepare('SELECT * FROM doctor_reviews WHERE reviewId = ?').get(reviewId);
};

module.exports = {
  getDoctorQueue,
  getFullPatientDossier,
  addDoctorReview
};
