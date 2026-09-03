const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const DB_PATH = path.join(__dirname, '..', '..', 'data', 'medikiosk.db');

// Ensure data directory exists
const dataDir = path.dirname(DB_PATH);
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const db = new Database(DB_PATH);

// Enable foreign key constraints and WAL mode for high concurrency
db.pragma('foreign_keys = ON');
db.pragma('journal_mode = WAL');

/**
 * Initialize all 10 Relational Database Tables
 */
const initDb = () => {
  db.exec(`
    -- 1. Patients Table
    CREATE TABLE IF NOT EXISTS patients (
      patientId TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      dateOfBirth TEXT,
      gender TEXT,
      phone TEXT,
      email TEXT,
      address TEXT,
      bloodGroup TEXT DEFAULT 'O+',
      age INTEGER,
      createdAt TEXT NOT NULL,
      updatedAt TEXT NOT NULL
    );

    -- 2. Doctors Table
    CREATE TABLE IF NOT EXISTS doctors (
      doctorId TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT UNIQUE,
      passwordHash TEXT NOT NULL,
      salt TEXT NOT NULL,
      department TEXT DEFAULT 'General Medicine',
      room TEXT DEFAULT 'Room 4',
      createdAt TEXT NOT NULL
    );

    -- 3. Patient Sessions / OPD Sessions
    CREATE TABLE IF NOT EXISTS patient_sessions (
      sessionId TEXT PRIMARY KEY,
      patientId TEXT NOT NULL,
      doctorId TEXT,
      opdToken TEXT NOT NULL,
      department TEXT NOT NULL,
      room TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'In preparation',
      createdAt TEXT NOT NULL,
      updatedAt TEXT NOT NULL,
      FOREIGN KEY (patientId) REFERENCES patients(patientId) ON DELETE CASCADE,
      FOREIGN KEY (doctorId) REFERENCES doctors(doctorId) ON DELETE SET NULL
    );

    -- 4. Consent Table
    CREATE TABLE IF NOT EXISTS consent (
      consentId TEXT PRIMARY KEY,
      patientId TEXT NOT NULL,
      consentGiven INTEGER NOT NULL DEFAULT 1,
      consentDate TEXT NOT NULL,
      withdrawnAt TEXT,
      FOREIGN KEY (patientId) REFERENCES patients(patientId) ON DELETE CASCADE
    );

    -- 5. Health History Table
    CREATE TABLE IF NOT EXISTS health_history (
      healthHistoryId TEXT PRIMARY KEY,
      patientId TEXT NOT NULL UNIQUE,
      chiefComplaint TEXT,
      symptoms TEXT, -- JSON Array
      duration TEXT,
      severity TEXT DEFAULT 'Moderate',
      severityNum INTEGER DEFAULT 5,
      medicalHistory TEXT, -- JSON Array
      currentMedications TEXT, -- JSON Array or text
      allergies TEXT, -- JSON Array or text
      familyHistory TEXT, -- JSON Array
      additionalNotes TEXT,
      createdAt TEXT NOT NULL,
      updatedAt TEXT NOT NULL,
      FOREIGN KEY (patientId) REFERENCES patients(patientId) ON DELETE CASCADE
    );

    -- 6. AYUSH History Table
    CREATE TABLE IF NOT EXISTS ayush_history (
      ayushHistoryId TEXT PRIMARY KEY,
      patientId TEXT NOT NULL UNIQUE,
      ayushTreatment TEXT,
      prakriti TEXT,
      agni TEXT,
      diet TEXT,
      sleep TEXT,
      stress TEXT,
      medicines TEXT, -- JSON Array / text
      practitioner TEXT,
      duration TEXT,
      otherInfo TEXT,
      createdAt TEXT NOT NULL,
      updatedAt TEXT NOT NULL,
      FOREIGN KEY (patientId) REFERENCES patients(patientId) ON DELETE CASCADE
    );

    -- 7. Previous Medical Records Table
    CREATE TABLE IF NOT EXISTS previous_medical_records (
      recordId TEXT PRIMARY KEY,
      patientId TEXT NOT NULL,
      recordType TEXT NOT NULL, -- prescription, lab, discharge, xray, other
      fileName TEXT NOT NULL,
      filePath TEXT,
      uploadDate TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'ready',
      FOREIGN KEY (patientId) REFERENCES patients(patientId) ON DELETE CASCADE
    );

    -- 8. OCR / Extracted Record Data Table
    CREATE TABLE IF NOT EXISTS ocr_extracted_data (
      extractionId TEXT PRIMARY KEY,
      recordId TEXT,
      patientId TEXT NOT NULL,
      extractedText TEXT,
      structuredData TEXT, -- JSON String
      confidence REAL DEFAULT 0.98,
      createdAt TEXT NOT NULL,
      FOREIGN KEY (recordId) REFERENCES previous_medical_records(recordId) ON DELETE CASCADE,
      FOREIGN KEY (patientId) REFERENCES patients(patientId) ON DELETE CASCADE
    );

    -- 9. Clinical Summary Table
    CREATE TABLE IF NOT EXISTS clinical_summaries (
      summaryId TEXT PRIMARY KEY,
      patientId TEXT NOT NULL UNIQUE,
      summary TEXT NOT NULL,
      generatedAt TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'generated',
      FOREIGN KEY (patientId) REFERENCES patients(patientId) ON DELETE CASCADE
    );

    -- 10. Doctor Review Table
    CREATE TABLE IF NOT EXISTS doctor_reviews (
      reviewId TEXT PRIMARY KEY,
      patientId TEXT NOT NULL,
      doctorId TEXT NOT NULL,
      notes TEXT NOT NULL,
      reviewStatus TEXT NOT NULL DEFAULT 'reviewed',
      reviewedAt TEXT NOT NULL,
      FOREIGN KEY (patientId) REFERENCES patients(patientId) ON DELETE CASCADE,
      FOREIGN KEY (doctorId) REFERENCES doctors(doctorId) ON DELETE CASCADE
    );

    -- Indexes for high performance
    CREATE INDEX IF NOT EXISTS idx_patients_phone ON patients(phone);
    CREATE INDEX IF NOT EXISTS idx_sessions_patient ON patient_sessions(patientId);
    CREATE INDEX IF NOT EXISTS idx_sessions_status ON patient_sessions(status);
    CREATE INDEX IF NOT EXISTS idx_records_patient ON previous_medical_records(patientId);
    CREATE INDEX IF NOT EXISTS idx_reviews_patient ON doctor_reviews(patientId);
  `);

  seedInitialData();
};

/**
 * Hash password securely with salt using crypto pbkdf2
 */
const hashPassword = (password, salt = null) => {
  const currentSalt = salt || crypto.randomBytes(16).toString('hex');
  const hash = crypto.pbkdf2Sync(password, currentSalt, 1000, 64, 'sha512').toString('hex');
  return { hash, salt: currentSalt };
};

/**
 * Verify password against salt and hash
 */
const verifyPassword = (password, salt, hash) => {
  const computedHash = crypto.pbkdf2Sync(password, salt, 1000, 64, 'sha512').toString('hex');
  return computedHash === hash;
};

/**
 * Seed initial Demo Doctor and baseline patient records if DB is empty
 */
const seedInitialData = () => {
  // 1. Seed Doctor
  const doctorCount = db.prepare('SELECT COUNT(*) as count FROM doctors').get().count;
  if (doctorCount === 0) {
    const { hash, salt } = hashPassword('demo123');
    const now = new Date().toISOString();
    db.prepare(`
      INSERT INTO doctors (doctorId, name, email, passwordHash, salt, department, room, createdAt)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run('DOC-1042', 'Dr. Riya Mehta', 'dr.mehta@hospital.org', hash, salt, 'General Medicine', 'Room 4', now);
    console.log('Seeded demo doctor: DOC-1042 / Dr. Riya Mehta');
  }

  // 2. Seed initial baseline patients if table is empty
  const patientCount = db.prepare('SELECT COUNT(*) as count FROM patients').get().count;
  if (patientCount === 0) {
    const now = new Date().toISOString();

    // Baseline Patient 1: Priya Sharma (P-1042, A-104)
    db.prepare(`
      INSERT INTO patients (patientId, name, dateOfBirth, gender, phone, email, address, bloodGroup, age, createdAt, updatedAt)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run('P-1042', 'Priya Sharma', '1994-05-12', 'Female', '7665778969', 'priya.sharma@example.com', 'Sector 4, Main Road, Jaipur', 'O+', 32, now, now);

    db.prepare(`
      INSERT INTO patient_sessions (sessionId, patientId, doctorId, opdToken, department, room, status, createdAt, updatedAt)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run('SESS-1042', 'P-1042', 'DOC-1042', 'A-104', 'General Medicine', 'Room 4', 'In preparation', now, now);

    db.prepare(`
      INSERT INTO consent (consentId, patientId, consentGiven, consentDate)
      VALUES (?, ?, 1, ?)
    `).run('CONS-1042', 'P-1042', now);

    db.prepare(`
      INSERT INTO health_history (healthHistoryId, patientId, chiefComplaint, symptoms, duration, severity, severityNum, medicalHistory, currentMedications, allergies, familyHistory, additionalNotes, createdAt, updatedAt)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      'HH-1042',
      'P-1042',
      'Intermittent chest tightness and mild fatigue on climbing stairs',
      JSON.stringify(['Chest Discomfort / Tightness', 'Fatigue / Weakness']),
      '2 - 3 Days',
      'Moderate',
      5,
      JSON.stringify(['Hypertension (High BP)']),
      JSON.stringify(['Telmisartan 40mg (morning)']),
      JSON.stringify(['No Known Drug Allergies']),
      JSON.stringify(['Mother: Hypertension']),
      'No radiating pain to left arm or jaw. Symptoms worsen after heavy meals.',
      now,
      now
    );

    db.prepare(`
      INSERT INTO ayush_history (ayushHistoryId, patientId, ayushTreatment, prakriti, agni, diet, sleep, stress, medicines, practitioner, duration, otherInfo, createdAt, updatedAt)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      'AY-1042',
      'P-1042',
      'Ayurveda + Modern Medicine',
      'Pitta-Vata',
      'Vishamagni (Irregular / Bloating)',
      'Lacto-Vegetarian',
      'Disturbed / Frequent waking',
      'Moderate routine stress',
      JSON.stringify(['Turmeric Milk (Haldi Doodh)', 'Ashwagandha']),
      'Self-administered traditional remedies',
      '3 months',
      'Prefers integrated holistic care alongside modern cardiology consultation',
      now,
      now
    );

    db.prepare(`
      INSERT INTO previous_medical_records (recordId, patientId, recordType, fileName, filePath, uploadDate, status)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run('REC-1042-1', 'P-1042', 'prescription', 'Prescription - Cardiology OPD.pdf', '/uploads/rec-1.pdf', now, 'ready');

    db.prepare(`
      INSERT INTO ocr_extracted_data (extractionId, recordId, patientId, extractedText, structuredData, confidence, createdAt)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      'OCR-1042-1',
      'REC-1042-1',
      'P-1042',
      'Rx Telmisartan 40mg OD, Atorvastatin 10mg HS. Dr. Nair.',
      JSON.stringify({ medication: 'Telmisartan 40mg + Atorvastatin 10mg', doctor: 'Dr. Ajay Nair', date: '14 Jun 2026' }),
      0.99,
      now
    );

    db.prepare(`
      INSERT INTO previous_medical_records (recordId, patientId, recordType, fileName, filePath, uploadDate, status)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run('REC-1042-2', 'P-1042', 'lab', 'Lipid Profile Report.pdf', '/uploads/rec-2.pdf', now, 'ready');

    db.prepare(`
      INSERT INTO ocr_extracted_data (extractionId, recordId, patientId, extractedText, structuredData, confidence, createdAt)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      'OCR-1042-2',
      'REC-1042-2',
      'P-1042',
      'Total Cholesterol: 212 mg/dL, Triglycerides: 178 mg/dL, LDL: 138 mg/dL',
      JSON.stringify({ totalCholesterol: '212 mg/dL', triglycerides: '178 mg/dL', ldl: '138 mg/dL' }),
      0.98,
      now
    );

    db.prepare(`
      INSERT INTO clinical_summaries (summaryId, patientId, summary, generatedAt, status)
      VALUES (?, ?, ?, ?, ?)
    `).run(
      'SUMM-1042',
      'P-1042',
      'Patient reports 2-3 day history of exertional chest discomfort with mild fatigue. Known history of hypertension on Telmisartan 40mg. Mild dyslipidaemia noted on previous lab OCR. AYUSH profile indicates Pitta-Vata with irregular agni. Vitals stable.',
      now,
      'generated'
    );

    // Baseline Patient 2: Rahul Sharma (P-1001, A-101)
    db.prepare(`
      INSERT INTO patients (patientId, name, dateOfBirth, gender, phone, email, address, bloodGroup, age, createdAt, updatedAt)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run('P-1001', 'Rahul Sharma', '1984-03-20', 'Male', '9876543210', 'rahul.sharma@example.com', 'Civil Lines, Delhi', 'B+', 42, now, now);

    db.prepare(`
      INSERT INTO patient_sessions (sessionId, patientId, doctorId, opdToken, department, room, status, createdAt, updatedAt)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run('SESS-1001', 'P-1001', 'DOC-1042', 'A-101', 'General Medicine', 'Room 4', 'Summary Ready', now, now);

    db.prepare(`
      INSERT INTO consent (consentId, patientId, consentGiven, consentDate)
      VALUES (?, ?, 1, ?)
    `).run('CONS-1001', 'P-1001', now);

    db.prepare(`
      INSERT INTO health_history (healthHistoryId, patientId, chiefComplaint, symptoms, duration, severity, severityNum, medicalHistory, currentMedications, allergies, familyHistory, additionalNotes, createdAt, updatedAt)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      'HH-1001',
      'P-1001',
      'Chest discomfort and heaviness since 3 days',
      JSON.stringify(['Chest Discomfort', 'Heaviness']),
      '3 days',
      'High',
      8,
      JSON.stringify(['Dyslipidaemia', 'Family H/O cardiac disease']),
      JSON.stringify(['Atorvastatin 20mg (evening)', 'Aspirin 75mg (morning)']),
      JSON.stringify(['No known drug allergies']),
      JSON.stringify(['Father: MI at age 58', 'Brother: Hypertension']),
      'Progressive heaviness on exertion.',
      now,
      now
    );

    db.prepare(`
      INSERT INTO ayush_history (ayushHistoryId, patientId, ayushTreatment, prakriti, agni, diet, sleep, stress, medicines, practitioner, duration, otherInfo, createdAt, updatedAt)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      'AY-1001',
      'P-1001',
      'Ayurveda',
      'Pitta-Vata',
      'Vishamagni',
      'Non-Vegetarian',
      'Disturbed',
      'High stress',
      JSON.stringify(['Arjuna bark decoction']),
      'None',
      '1 month',
      '',
      now,
      now
    );

    db.prepare(`
      INSERT INTO clinical_summaries (summaryId, patientId, summary, generatedAt, status)
      VALUES (?, ?, ?, ?, ?)
    `).run(
      'SUMM-1001',
      'P-1001',
      'High-priority cardiac concern: Chest heaviness for 3 days in 42yo male with dyslipidaemia and strong family cardiac history.',
      now,
      'generated'
    );

    console.log('Seeded initial baseline patients (P-1042, P-1001)');
  }
};

module.exports = {
  db,
  initDb,
  hashPassword,
  verifyPassword
};
