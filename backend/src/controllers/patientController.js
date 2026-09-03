const patientService = require('../services/patientService');

const isValidPatientId = (id) => typeof id === 'string' && id.trim().length > 0;

/**
 * POST /api/patients/register
 */
const registerPatient = async (req, res) => {
  try {
    const { name, phone, dateOfBirth, gender, email, address, department, room, age, bloodGroup, patientId } = req.body || {};

    if (!name && !phone && !patientId) {
      return res.status(400).json({
        success: false,
        message: 'Patient name, phone number, or existing Patient ID is required'
      });
    }

    const result = await patientService.registerPatient(req.body);

    return res.status(201).json({
      success: true,
      patientId: result.patientId,
      session: result.session,
      patient: result.patient,
      message: result.isExisting ? 'Existing patient record loaded' : 'Patient registered successfully'
    });
  } catch (error) {
    console.error('Error in registerPatient:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error while registering patient'
    });
  }
};

/**
 * GET /api/patients/:patientId
 */
const getPatientById = async (req, res) => {
  try {
    const { patientId } = req.params;
    if (!isValidPatientId(patientId)) {
      return res.status(400).json({ success: false, message: 'Valid Patient ID required' });
    }

    const patient = await patientService.getPatientById(patientId);
    if (!patient) {
      return res.status(404).json({ success: false, message: `Patient ${patientId} not found` });
    }

    return res.status(200).json({ success: true, data: patient });
  } catch (error) {
    console.error('Error in getPatientById:', error);
    return res.status(500).json({ success: false, message: 'Error retrieving patient' });
  }
};

/**
 * POST /api/patients/:patientId/health-history
 */
const saveHealthHistory = async (req, res) => {
  try {
    const { patientId } = req.params;
    if (!isValidPatientId(patientId)) {
      return res.status(400).json({ success: false, message: 'Valid Patient ID required' });
    }

    if (!req.body || typeof req.body !== 'object') {
      return res.status(400).json({ success: false, message: 'Request body must be an object' });
    }

    if (!req.body.chiefComplaint && (!req.body.symptoms || req.body.symptoms.length === 0)) {
      return res.status(400).json({ success: false, message: 'At least chiefComplaint or symptoms must be provided' });
    }

    const saved = await patientService.saveHealthHistory(patientId, req.body);
    if (!saved) {
      return res.status(404).json({ success: false, message: `Patient ${patientId} not found in database` });
    }

    return res.status(201).json({
      success: true,
      message: 'Health history saved successfully',
      data: saved
    });
  } catch (error) {
    console.error('Error in saveHealthHistory:', error);
    return res.status(500).json({ success: false, message: 'Error saving health history' });
  }
};

/**
 * GET /api/patients/:patientId/health-history
 */
const getHealthHistory = async (req, res) => {
  try {
    const { patientId } = req.params;
    if (!isValidPatientId(patientId)) {
      return res.status(400).json({ success: false, message: 'Valid Patient ID required' });
    }

    const history = await patientService.getHealthHistory(patientId);
    if (!history) {
      return res.status(404).json({ success: false, message: `Health history not found for patient ${patientId}` });
    }

    return res.status(200).json({ success: true, data: history });
  } catch (error) {
    console.error('Error in getHealthHistory:', error);
    return res.status(500).json({ success: false, message: 'Error retrieving health history' });
  }
};

/**
 * POST /api/patients/:patientId/ayush-history
 */
const saveAyushHistory = async (req, res) => {
  try {
    const { patientId } = req.params;
    if (!isValidPatientId(patientId)) {
      return res.status(400).json({ success: false, message: 'Valid Patient ID required' });
    }

    const saved = await patientService.saveAyushHistory(patientId, req.body || {});
    if (!saved) {
      return res.status(404).json({ success: false, message: `Patient ${patientId} not found in database` });
    }

    return res.status(201).json({
      success: true,
      message: 'AYUSH history saved successfully',
      data: saved
    });
  } catch (error) {
    console.error('Error in saveAyushHistory:', error);
    return res.status(500).json({ success: false, message: 'Error saving AYUSH history' });
  }
};

/**
 * GET /api/patients/:patientId/ayush-history
 */
const getAyushHistory = async (req, res) => {
  try {
    const { patientId } = req.params;
    if (!isValidPatientId(patientId)) {
      return res.status(400).json({ success: false, message: 'Valid Patient ID required' });
    }

    const ayush = await patientService.getAyushHistory(patientId);
    if (!ayush) {
      return res.status(404).json({ success: false, message: `AYUSH history not found for patient ${patientId}` });
    }

    return res.status(200).json({ success: true, data: ayush });
  } catch (error) {
    console.error('Error in getAyushHistory:', error);
    return res.status(500).json({ success: false, message: 'Error retrieving AYUSH history' });
  }
};

/**
 * POST /api/patients/:patientId/records
 */
const addRecord = async (req, res) => {
  try {
    const { patientId } = req.params;
    if (!isValidPatientId(patientId)) {
      return res.status(400).json({ success: false, message: 'Valid Patient ID required' });
    }

    const saved = await patientService.addRecord(patientId, req.body || {});
    if (!saved) {
      return res.status(404).json({ success: false, message: `Patient ${patientId} not found in database` });
    }

    return res.status(201).json({
      success: true,
      message: 'Medical record and OCR data saved successfully',
      data: saved
    });
  } catch (error) {
    console.error('Error in addRecord:', error);
    return res.status(500).json({ success: false, message: 'Error saving medical record' });
  }
};

/**
 * GET /api/patients/:patientId/records
 */
const getRecords = async (req, res) => {
  try {
    const { patientId } = req.params;
    if (!isValidPatientId(patientId)) {
      return res.status(400).json({ success: false, message: 'Valid Patient ID required' });
    }

    const records = await patientService.getRecords(patientId);
    return res.status(200).json({ success: true, count: records.length, data: records });
  } catch (error) {
    console.error('Error in getRecords:', error);
    return res.status(500).json({ success: false, message: 'Error retrieving records' });
  }
};

/**
 * POST /api/patients/:patientId/summary
 */
const saveClinicalSummary = async (req, res) => {
  try {
    const { patientId } = req.params;
    if (!isValidPatientId(patientId)) {
      return res.status(400).json({ success: false, message: 'Valid Patient ID required' });
    }

    const summary = await patientService.saveClinicalSummary(patientId, req.body || {});
    if (!summary) {
      return res.status(404).json({ success: false, message: `Patient ${patientId} not found in database` });
    }

    return res.status(201).json({
      success: true,
      message: 'Clinical summary saved and synchronized with doctor queue',
      data: summary
    });
  } catch (error) {
    console.error('Error in saveClinicalSummary:', error);
    return res.status(500).json({ success: false, message: 'Error saving clinical summary' });
  }
};

/**
 * GET /api/patients/:patientId/summary
 */
const getClinicalSummary = async (req, res) => {
  try {
    const { patientId } = req.params;
    if (!isValidPatientId(patientId)) {
      return res.status(400).json({ success: false, message: 'Valid Patient ID required' });
    }

    const summary = await patientService.getClinicalSummary(patientId);
    if (!summary) {
      return res.status(404).json({ success: false, message: `Clinical summary not found for patient ${patientId}` });
    }

    return res.status(200).json({ success: true, data: summary });
  } catch (error) {
    console.error('Error in getClinicalSummary:', error);
    return res.status(500).json({ success: false, message: 'Error retrieving summary' });
  }
};

/**
 * POST /api/patients/:patientId/consent
 */
const saveConsent = async (req, res) => {
  try {
    const { patientId } = req.params;
    if (!isValidPatientId(patientId)) {
      return res.status(400).json({ success: false, message: 'Valid Patient ID required' });
    }

    const consent = await patientService.saveConsent(patientId, req.body || {});
    if (!consent) {
      return res.status(404).json({ success: false, message: `Patient ${patientId} not found in database` });
    }

    return res.status(200).json({
      success: true,
      message: 'Consent preferences updated successfully',
      data: consent
    });
  } catch (error) {
    console.error('Error in saveConsent:', error);
    return res.status(500).json({ success: false, message: 'Error saving consent' });
  }
};

/**
 * GET /api/patients/:patientId/consent
 */
const getConsent = async (req, res) => {
  try {
    const { patientId } = req.params;
    if (!isValidPatientId(patientId)) {
      return res.status(400).json({ success: false, message: 'Valid Patient ID required' });
    }

    const consent = await patientService.getConsent(patientId);
    if (!consent) {
      return res.status(404).json({ success: false, message: `Consent record not found for patient ${patientId}` });
    }

    return res.status(200).json({ success: true, data: consent });
  } catch (error) {
    console.error('Error in getConsent:', error);
    return res.status(500).json({ success: false, message: 'Error retrieving consent' });
  }
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
