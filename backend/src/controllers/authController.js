const authService = require('../services/authService');

/**
 * Controller for Doctor Login
 * POST /api/auth/doctor/login
 */
const loginDoctor = async (req, res) => {
  try {
    const { doctorId, password } = req.body;

    // Requirement 1 & 2: Validate doctorId and password, return 400 if missing
    if (!doctorId || typeof doctorId !== 'string' || doctorId.trim() === '' ||
        !password || typeof password !== 'string' || password.trim() === '') {
      return res.status(400).json({
        success: false,
        message: 'Doctor ID and password are required'
      });
    }

    // Call service to authenticate
    const doctor = await authService.authenticateDoctor(doctorId, password);

    // Requirement 3: Return 401 for invalid credentials
    if (!doctor) {
      return res.status(401).json({
        success: false,
        message: 'Invalid Doctor ID or password'
      });
    }

    // Requirement 4 & 5: Return 200 with doctor details, never expose password
    return res.status(200).json({
      success: true,
      message: 'Doctor login successful',
      doctor: {
        doctorId: doctor.doctorId,
        name: doctor.name
      }
    });
  } catch (error) {
    console.error('Error during doctor login:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error during authentication'
    });
  }
};

module.exports = {
  loginDoctor
};
