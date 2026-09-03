const express = require('express');
const router = express.Router();
const authController = require('../controllers/authController');

// POST /api/auth/doctor/login
router.post('/doctor/login', authController.loginDoctor);

module.exports = router;
