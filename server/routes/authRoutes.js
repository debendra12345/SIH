const express = require('express');
const router = express.Router();
const {
  registerUser,
  loginDoctor,
  sendDoctorOtp,
  verifyDoctorOtp,
  resendDoctorOtp,
  loginPatient,
  getMe,
} = require('../controllers/authController');
const { protect } = require('../middleware/authMiddleware');

// Public authentication routes
router.post('/register', registerUser);
router.post('/doctor/login', loginDoctor);
router.post('/doctor/send-otp', sendDoctorOtp);
router.post('/doctor/verify-otp', verifyDoctorOtp);
router.post('/doctor/resend-otp', resendDoctorOtp);
router.post('/patient/login', loginPatient);

// Private routes (JWT required)
router.get('/me', protect, getMe);

module.exports = router;

