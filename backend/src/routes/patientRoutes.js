const express = require('express');
const router = express.Router();
const patientController = require('../controllers/patientController');

// 1. Patient Registration
// POST /api/patients/register
router.post('/register', patientController.registerPatient);

// 2. Patient Basic Profile & Session
// GET /api/patients/:patientId
router.get('/:patientId', patientController.getPatientById);

// 3. Health History
// POST /api/patients/:patientId/health-history
router.post('/:patientId/health-history', patientController.saveHealthHistory);
// GET /api/patients/:patientId/health-history
router.get('/:patientId/health-history', patientController.getHealthHistory);

// 4. AYUSH History
// POST /api/patients/:patientId/ayush-history
router.post('/:patientId/ayush-history', patientController.saveAyushHistory);
// GET /api/patients/:patientId/ayush-history
router.get('/:patientId/ayush-history', patientController.getAyushHistory);

// 5. Medical Records & OCR
// POST /api/patients/:patientId/records
router.post('/:patientId/records', patientController.addRecord);
// GET /api/patients/:patientId/records
router.get('/:patientId/records', patientController.getRecords);

// 6. Clinical Summary
// POST /api/patients/:patientId/summary
router.post('/:patientId/summary', patientController.saveClinicalSummary);
// GET /api/patients/:patientId/summary
router.get('/:patientId/summary', patientController.getClinicalSummary);

// 7. Consent
// POST /api/patients/:patientId/consent
router.post('/:patientId/consent', patientController.saveConsent);
// GET /api/patients/:patientId/consent
router.get('/:patientId/consent', patientController.getConsent);

module.exports = router;
