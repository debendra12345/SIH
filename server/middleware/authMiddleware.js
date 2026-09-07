const jwt = require('jsonwebtoken');
const User = require('../models/User');
const { getJwtSecret } = require('../utils/tokenConfig');

/**
 * Protect routes - Authenticate JWT token from Authorization header
 */
const protect = async (req, res, next) => {
  let token;

  if (
    req.headers.authorization &&
    req.headers.authorization.startsWith('Bearer')
  ) {
    token = req.headers.authorization.split(' ')[1];
  }

  if (!token) {
    return res.status(401).json({
      success: false,
      message: 'Not authorized to access this route. No token provided.',
    });
  }

  try {
    const decoded = jwt.verify(token, getJwtSecret());

    if (decoded.demo) {
      req.user = {
        _id: decoded.id,
        name: decoded.name || (decoded.role === 'patient' ? 'Rahul Sharma' : 'Demo Doctor'),
        role: decoded.role || 'doctor',
        doctorId: decoded.role === 'doctor' ? decoded.id : undefined,
        currentHealthProblem: decoded.currentHealthProblem || '',
        healthStatus: decoded.healthStatus || 'Stable',
        isActive: true,
        demoMode: true
      };
      return next();
    }

    const mongoose = require('mongoose');
    let user = null;
    if (mongoose.connection.readyState === 1 && decoded.id && mongoose.Types.ObjectId.isValid(decoded.id)) {
      try {
        user = await User.findById(decoded.id).select('-password');
      } catch (e) {}
    }

    if (!user) {
      try {
        const { inMemoryPatients } = require('../controllers/authController');
        const inMem = inMemoryPatients ? [...inMemoryPatients.values()].find(p => p._id === decoded.id || p._id?.toString() === decoded.id?.toString()) : null;
        if (inMem) {
          user = inMem;
        }
      } catch (e) {}
    }

    if (!user && decoded.role === 'patient') {
      user = {
        _id: decoded.id,
        name: decoded.name || 'Rahul Sharma',
        age: decoded.age || 25,
        gender: decoded.gender || 'Male',
        mobileNumber: decoded.mobileNumber || '',
        currentHealthProblem: decoded.currentHealthProblem || '',
        healthStatus: decoded.healthStatus || 'Stable',
        role: 'patient',
        isActive: true,
      };
    }

    if (!user) {
      return res.status(401).json({
        success: false,
        message: 'The user belonging to this token no longer exists.',
      });
    }

    if (!user.isActive) {
      return res.status(401).json({
        success: false,
        message: 'User account is inactive. Please contact your administrator.',
      });
    }

    req.user = user;
    next();
  } catch (error) {
    if (error.name === 'JsonWebTokenError') {
      return res.status(401).json({
        success: false,
        message: 'Invalid authorization token.',
      });
    }
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({
        success: false,
        message: 'Authorization token has expired. Please log in again.',
      });
    }
    return res.status(401).json({
      success: false,
      message: 'Not authorized to access this route.',
    });
  }
};

/**
 * Authorize specific roles
 * @param  {...string} roles - Permitted user roles e.g. 'doctor', 'admin'
 */
const authorize = (...roles) => {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({
        success: false,
        message: `User role '${req.user ? req.user.role : 'unknown'}' is not authorized to access this route.`,
      });
    }
    next();
  };
};

module.exports = {
  protect,
  authorize,
};
