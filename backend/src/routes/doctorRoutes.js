const express = require('express');
const router = express.Router();
const doctorController = require('../controllers/doctorController');

// 1. Get Doctor's OPD Queue
// GET /api/doctor/patients
router.get('/patients', doctorController.getDoctorPatients);

// 2. Search / Get Complete Patient Dossier by Patient ID
// GET /api/doctor/patients/:patientId
router.get('/patients/:patientId', doctorController.getPatientDossier);

// 3. Add Doctor Review & Complete Consultation
// POST /api/doctor/patients/:patientId/review
router.post('/patients/:patientId/review', doctorController.addDoctorReview);

module.exports = router;
