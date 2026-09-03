const express = require('express');
const router = express.Router();
const healthHistoryController = require('../controllers/healthHistoryController');

// GET /api/patients/:patientId/health-history
router.get('/:patientId/health-history', healthHistoryController.getHealthHistory);

// POST /api/patients/:patientId/health-history
router.post('/:patientId/health-history', healthHistoryController.createHealthHistory);

// PUT /api/patients/:patientId/health-history
router.put('/:patientId/health-history', healthHistoryController.updateHealthHistory);

module.exports = router;
