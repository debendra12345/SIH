const fs = require('fs').promises;
const path = require('path');

const DATA_FILE = path.join(__dirname, '..', '..', 'data', 'healthHistories.json');

/**
 * Helper: Ensure data directory and JSON file exist
 */
const ensureStorage = async () => {
  try {
    await fs.mkdir(path.dirname(DATA_FILE), { recursive: true });
    try {
      await fs.access(DATA_FILE);
    } catch {
      await fs.writeFile(DATA_FILE, JSON.stringify([], null, 2), 'utf8');
    }
  } catch (error) {
    console.error('Error ensuring health history storage:', error);
  }
};

/**
 * Helper: Read all records from storage
 */
const readAll = async () => {
  await ensureStorage();
  try {
    const data = await fs.readFile(DATA_FILE, 'utf8');
    return JSON.parse(data || '[]');
  } catch (error) {
    console.error('Error reading health history file:', error);
    return [];
  }
};

/**
 * Helper: Write all records to storage
 */
const writeAll = async (records) => {
  await ensureStorage();
  await fs.writeFile(DATA_FILE, JSON.stringify(records, null, 2), 'utf8');
};

/**
 * Helper: Format array or keep string format cleanly
 */
const formatList = (val) => {
  if (Array.isArray(val)) return val;
  if (typeof val === 'string' && val.trim()) {
    return val.split(',').map(s => s.trim()).filter(Boolean);
  }
  return [];
};

/**
 * Get Health History for a patient
 * @param {string} patientId
 * @returns {Promise<object|null>}
 */
const getHealthHistoryByPatientId = async (patientId) => {
  const records = await readAll();
  const normalizedId = String(patientId).trim().toUpperCase();
  const record = records.find(r => String(r.patientId).trim().toUpperCase() === normalizedId);
  return record || null;
};

/**
 * Create new Health History for a patient
 * @param {string} patientId
 * @param {object} historyData
 * @returns {Promise<object>}
 */
const createHealthHistory = async (patientId, historyData) => {
  const records = await readAll();
  const normalizedId = String(patientId).trim().toUpperCase();

  const existingIndex = records.findIndex(
    r => String(r.patientId).trim().toUpperCase() === normalizedId
  );

  const now = new Date().toISOString();

  const newRecord = {
    patientId: String(patientId).trim(),
    chiefComplaint: historyData.chiefComplaint ? String(historyData.chiefComplaint).trim() : '',
    symptoms: formatList(historyData.symptoms),
    symptomDuration: historyData.symptomDuration ? String(historyData.symptomDuration).trim() : '',
    severity: historyData.severity ? String(historyData.severity).trim() : 'Moderate',
    allergies: formatList(historyData.allergies),
    currentMedications: formatList(historyData.currentMedications),
    pastMedicalHistory: formatList(historyData.pastMedicalHistory),
    familyHistory: formatList(historyData.familyHistory),
    lifestyle: typeof historyData.lifestyle === 'object' && historyData.lifestyle !== null
      ? historyData.lifestyle
      : { notes: historyData.lifestyle ? String(historyData.lifestyle).trim() : '' },
    additionalNotes: historyData.additionalNotes ? String(historyData.additionalNotes).trim() : '',
    createdAt: now,
    updatedAt: now
  };

  if (existingIndex >= 0) {
    // If already exists, update and preserve original createdAt
    newRecord.createdAt = records[existingIndex].createdAt || now;
    records[existingIndex] = newRecord;
  } else {
    records.push(newRecord);
  }

  await writeAll(records);
  return newRecord;
};

/**
 * Update existing Health History for a patient
 * @param {string} patientId
 * @param {object} updateData
 * @returns {Promise<object|null>}
 */
const updateHealthHistory = async (patientId, updateData) => {
  const records = await readAll();
  const normalizedId = String(patientId).trim().toUpperCase();

  const existingIndex = records.findIndex(
    r => String(r.patientId).trim().toUpperCase() === normalizedId
  );

  if (existingIndex === -1) {
    return null;
  }

  const existing = records[existingIndex];
  const now = new Date().toISOString();

  const updatedRecord = {
    ...existing,
    chiefComplaint: updateData.chiefComplaint !== undefined ? String(updateData.chiefComplaint).trim() : existing.chiefComplaint,
    symptoms: updateData.symptoms !== undefined ? formatList(updateData.symptoms) : existing.symptoms,
    symptomDuration: updateData.symptomDuration !== undefined ? String(updateData.symptomDuration).trim() : existing.symptomDuration,
    severity: updateData.severity !== undefined ? String(updateData.severity).trim() : existing.severity,
    allergies: updateData.allergies !== undefined ? formatList(updateData.allergies) : existing.allergies,
    currentMedications: updateData.currentMedications !== undefined ? formatList(updateData.currentMedications) : existing.currentMedications,
    pastMedicalHistory: updateData.pastMedicalHistory !== undefined ? formatList(updateData.pastMedicalHistory) : existing.pastMedicalHistory,
    familyHistory: updateData.familyHistory !== undefined ? formatList(updateData.familyHistory) : existing.familyHistory,
    lifestyle: updateData.lifestyle !== undefined
      ? (typeof updateData.lifestyle === 'object' && updateData.lifestyle !== null ? updateData.lifestyle : { notes: String(updateData.lifestyle).trim() })
      : existing.lifestyle,
    additionalNotes: updateData.additionalNotes !== undefined ? String(updateData.additionalNotes).trim() : existing.additionalNotes,
    updatedAt: now
  };

  records[existingIndex] = updatedRecord;
  await writeAll(records);
  return updatedRecord;
};

module.exports = {
  getHealthHistoryByPatientId,
  createHealthHistory,
  updateHealthHistory
};
