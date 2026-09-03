const healthHistoryService = require('../services/healthHistoryService');

/**
 * Helper to validate patientId
 */
const isValidPatientId = (patientId) => {
  return typeof patientId === 'string' && patientId.trim().length > 0;
};

/**
 * GET /api/patients/:patientId/health-history
 * Fetch the patient's saved health history
 */
const getHealthHistory = async (req, res) => {
  try {
    const { patientId } = req.params;

    if (!isValidPatientId(patientId)) {
      return res.status(400).json({
        success: false,
        message: 'A valid patient ID is required'
      });
    }

    const healthHistory = await healthHistoryService.getHealthHistoryByPatientId(patientId);

    if (!healthHistory) {
      return res.status(404).json({
        success: false,
        message: `Health history not found for patient ${patientId}`
      });
    }

    return res.status(200).json({
      success: true,
      message: 'Health history retrieved successfully',
      data: healthHistory
    });
  } catch (error) {
    console.error('Error fetching health history:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error while retrieving health history'
    });
  }
};

/**
 * POST /api/patients/:patientId/health-history
 * Create/save the patient's health history
 */
const createHealthHistory = async (req, res) => {
  try {
    const { patientId } = req.params;
    const historyData = req.body;

    if (!isValidPatientId(patientId)) {
      return res.status(400).json({
        success: false,
        message: 'A valid patient ID is required'
      });
    }

    if (!historyData || typeof historyData !== 'object' || Array.isArray(historyData)) {
      return res.status(400).json({
        success: false,
        message: 'Request body must be a JSON object'
      });
    }

    // Require chiefComplaint or symptoms for meaningful clinical intake
    if (!historyData.chiefComplaint && (!historyData.symptoms || historyData.symptoms.length === 0)) {
      return res.status(400).json({
        success: false,
        message: 'At least chiefComplaint or symptoms must be provided'
      });
    }

    const savedRecord = await healthHistoryService.createHealthHistory(patientId, historyData);

    return res.status(201).json({
      success: true,
      message: 'Health history saved successfully',
      data: savedRecord
    });
  } catch (error) {
    console.error('Error saving health history:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error while saving health history'
    });
  }
};

/**
 * PUT /api/patients/:patientId/health-history
 * Update an existing health history
 */
const updateHealthHistory = async (req, res) => {
  try {
    const { patientId } = req.params;
    const updateData = req.body;

    if (!isValidPatientId(patientId)) {
      return res.status(400).json({
        success: false,
        message: 'A valid patient ID is required'
      });
    }

    if (!updateData || typeof updateData !== 'object' || Array.isArray(updateData)) {
      return res.status(400).json({
        success: false,
        message: 'Request body must be a JSON object'
      });
    }

    const updatedRecord = await healthHistoryService.updateHealthHistory(patientId, updateData);

    if (!updatedRecord) {
      return res.status(404).json({
        success: false,
        message: `Health history not found for patient ${patientId}. Use POST to create a new record.`
      });
    }

    return res.status(200).json({
      success: true,
      message: 'Health history updated successfully',
      data: updatedRecord
    });
  } catch (error) {
    console.error('Error updating health history:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error while updating health history'
    });
  }
};

module.exports = {
  getHealthHistory,
  createHealthHistory,
  updateHealthHistory
};
