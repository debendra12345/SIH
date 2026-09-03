const doctorService = require('../services/doctorService');

const isValidId = (id) => typeof id === 'string' && id.trim().length > 0;

/**
 * GET /api/doctor/patients
 * Retrieve all patients available in the OPD queue
 */
const getDoctorPatients = async (req, res) => {
  try {
    const { doctorId } = req.query;
    const queue = await doctorService.getDoctorQueue(doctorId);
    return res.status(200).json({
      success: true,
      count: queue.length,
      data: queue
    });
  } catch (error) {
    console.error('Error in getDoctorPatients:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error while retrieving doctor queue'
    });
  }
};

/**
 * GET /api/doctor/patients/:patientId
 * Search / retrieve complete aggregated clinical dossier for a patient
 */
const getPatientDossier = async (req, res) => {
  try {
    const { patientId } = req.params;
    if (!isValidId(patientId)) {
      return res.status(400).json({
        success: false,
        message: 'A valid Patient ID is required'
      });
    }

    const dossier = await doctorService.getFullPatientDossier(patientId);
    if (!dossier) {
      return res.status(404).json({
        success: false,
        message: `Patient ${patientId} not found in database`
      });
    }

    return res.status(200).json({
      success: true,
      data: dossier
    });
  } catch (error) {
    console.error('Error in getPatientDossier:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error while retrieving patient dossier'
    });
  }
};

/**
 * POST /api/doctor/patients/:patientId/review
 * Save physician review notes, sign-off status, and complete consultation
 */
const addDoctorReview = async (req, res) => {
  try {
    const { patientId } = req.params;
    const { doctorId, notes, reviewStatus } = req.body || {};

    if (!isValidId(patientId)) {
      return res.status(400).json({
        success: false,
        message: 'A valid Patient ID is required'
      });
    }

    const review = await doctorService.addDoctorReview(patientId, doctorId, { notes, reviewStatus });
    if (!review) {
      return res.status(404).json({
        success: false,
        message: `Patient ${patientId} not found`
      });
    }

    return res.status(201).json({
      success: true,
      message: 'Doctor consultation review saved and consultation marked complete',
      data: review
    });
  } catch (error) {
    console.error('Error in addDoctorReview:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error while saving doctor review'
    });
  }
};

module.exports = {
  getDoctorPatients,
  getPatientDossier,
  addDoctorReview
};
