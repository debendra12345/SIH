const mongoose = require('mongoose');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const AuthChallenge = require('../models/AuthChallenge');
const { sendDoctorOtpEmail } = require('../services/emailService');
const { sendDoctorOtpSms } = require('../services/smsService');
const { maskEmail, maskPhone, generateSecureOtp, hashOtp } = require('../utils/authUtils');
const { getJwtSecret, isDemoTokenMode } = require('../utils/tokenConfig');

const DEMO_DOCTORS = {
  'DOC-1001': {
   name: 'Demo Doctor 1',
  },
  'DOC-1002': {
   name: 'Demo Doctor 2',
  },
  'DOC-1003': {
   name: 'Demo Doctor 3',
  },
  'DOC-1004': {
   name: 'Demo Doctor 4',
  },
  'DOC-1005': {
   name: 'Demo Doctor 5',
  },
};

const DEMO_PASSWORD = process.env.DEMO_DOCTOR_PASSWORD || 'demo123';
const DEMO_OTP = '123456';
const isDemoAuthMode = () => !process.env.MONGO_URI || mongoose.connection.readyState !== 1;

const getDemoDoctor = (doctorId, password) => {
  const normalizedId = (doctorId || '').trim();
  const record = DEMO_DOCTORS[normalizedId];
  if (!record || DEMO_PASSWORD !== password) return null;
  return { ...record, doctorId: normalizedId, role: 'doctor' };
};

const buildDemoToken = (payload = {}) => {
  return jwt.sign({ ...payload, demo: true }, getJwtSecret(), {
   expiresIn: process.env.JWT_EXPIRES_IN || '7d',
  });
};

/**
 * Generate JSON Web Token
 * @param {string} id - User ObjectId
 * @param {string} role - User role
 */
const generateToken = (id, role) => {
  return jwt.sign({ id, role, demo: isDemoTokenMode() }, getJwtSecret(), {
    expiresIn: process.env.JWT_EXPIRES_IN || '7d',
  });
};

/**
 * @desc    Register a new user (Doctor, Patient, or Admin)
 * @route   POST /api/auth/register
 * @access  Public
 */
const registerUser = async (req, res) => {
  try {
    const { name, email, password, role, doctorId, mobileNumber, abhaId } = req.body;

    // Validate required fields
    if (!name || !name.trim()) {
      return res.status(400).json({
        success: false,
        message: 'Name is required.',
      });
    }

    if (!password || password.length < 6) {
      return res.status(400).json({
        success: false,
        message: 'Password is required and must be at least 6 characters.',
      });
    }

    const assignedRole = role ? role.toLowerCase().trim() : 'patient';
    const allowedRoles = ['doctor', 'patient', 'admin'];

    if (!allowedRoles.includes(assignedRole)) {
      return res.status(400).json({
        success: false,
        message: `Invalid role specified. Allowed roles: ${allowedRoles.join(', ')}`,
      });
    }

    // Role-specific validation
    if (assignedRole === 'doctor') {
      if (!doctorId || !doctorId.trim()) {
        return res.status(400).json({
          success: false,
          message: 'Doctor ID is required for doctor accounts (e.g. DOC-1042).',
        });
      }

      const existingDoctor = await User.findOne({ doctorId: doctorId.trim() });
      if (existingDoctor) {
        return res.status(400).json({
          success: false,
          message: 'A doctor account with this Doctor ID already exists.',
        });
      }
    }

    // Check if email is already taken if provided
    if (email && email.trim()) {
      const existingEmail = await User.findOne({ email: email.trim().toLowerCase() });
      if (existingEmail) {
        return res.status(400).json({
          success: false,
          message: 'Email address is already in use.',
        });
      }
    }

    // Create user in database (pre-save hook in User model handles bcrypt hashing)
    const user = await User.create({
      name: name.trim(),
      email: email ? email.trim().toLowerCase() : undefined,
      password,
      role: assignedRole,
      doctorId: assignedRole === 'doctor' && doctorId ? doctorId.trim() : undefined,
      mobileNumber: mobileNumber ? mobileNumber.trim() : undefined,
      abhaId: abhaId ? abhaId.trim() : undefined,
    });

    const token = generateToken(user._id, user.role);

    return res.status(201).json({
      success: true,
      message: 'User registered successfully.',
      token,
      user: {
        _id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
        doctorId: user.doctorId,
        mobileNumber: user.mobileNumber,
        abhaId: user.abhaId,
        isActive: user.isActive,
        createdAt: user.createdAt,
      },
    });
  } catch (error) {
    console.error('Registration Error:', error);
    if (error.code === 11000) {
      const duplicateField = Object.keys(error.keyPattern || {})[0] || 'field';
      return res.status(400).json({
        success: false,
        message: `An account with this ${duplicateField} already exists.`,
      });
    }
    return res.status(500).json({
      success: false,
      message: 'Server error during registration.',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined,
    });
  }
};

/**
/**
 * @desc    Step 1: Authenticate Doctor Credentials & Create OTP Challenge
 * @route   POST /api/auth/doctor/login
 * @access  Public
 */
const loginDoctor = async (req, res) => {
  try {
    const { doctorId, password } = req.body;

    if (!doctorId || !password) {
      return res.status(400).json({
        success: false,
        message: 'Please provide both Doctor ID and password.',
      });
    }

    if (isDemoAuthMode()) {
      const demoUser = getDemoDoctor(doctorId, password);
      if (!demoUser) {
        return res.status(401).json({
          success: false,
          message: 'Invalid Doctor ID or password.',
        });
      }

      const challengeToken = `demo:${demoUser.doctorId}:${crypto.randomBytes(16).toString('hex')}`;
      const methods = [
        {
          id: 'email',
          label: 'Email',
          destination: 'Demo delivery (not sent)',
          available: true,
          provider: 'demo',
        },
        {
          id: 'sms',
          label: 'Mobile/SMS',
          destination: 'Demo delivery (not sent)',
          available: true,
          provider: 'demo',
        },
      ];

      return res.status(200).json({
        success: true,
        requiresOtp: true,
        message: 'Credentials verified. Please choose an OTP delivery method.',
        challengeToken,
        doctorName: demoUser.name,
        doctorId: demoUser.doctorId,
        methods,
        demoMode: true,
      });
    }

    if (mongoose.connection.readyState !== 1) {
      return res.status(503).json({
        success: false,
        message: 'Database connection unavailable. Please ensure MongoDB Atlas whitelist allows your IP address.',
      });
    }

    // Search for doctor by doctorId, explicitly select password for verification
    const user = await User.findOne({
      doctorId: doctorId.trim(),
      role: 'doctor',
    }).select('+password');

    if (!user) {
      return res.status(401).json({
        success: false,
        message: 'Invalid Doctor ID or password.',
      });
    }

    if (!user.isActive) {
      return res.status(403).json({
        success: false,
        message: 'Account is deactivated. Please contact hospital administrator.',
      });
    }

    // Verify password with bcrypt
    const isMatch = await user.matchPassword(password);
    if (!isMatch) {
      return res.status(401).json({
        success: false,
        message: 'Invalid Doctor ID or password.',
      });
    }

    // Invalidate existing unused challenges for this doctor to prevent stale attempts
    await AuthChallenge.deleteMany({ userId: user._id, isUsed: false });

    // Generate cryptographically secure challenge token
    const challengeToken = crypto.randomBytes(32).toString('hex');

    await AuthChallenge.create({
      challengeToken,
      userId: user._id,
      doctorId: user.doctorId,
    });

    // Build available delivery channels with masked destinations
    const methods = [];
    if (user.email) {
      methods.push({
        id: 'email',
        label: 'Email',
        destination: maskEmail(user.email),
        available: true,
      });
    }
    const isTwilioConfigured = !!(
      process.env.TWILIO_ACCOUNT_SID &&
      process.env.TWILIO_AUTH_TOKEN &&
      process.env.TWILIO_PHONE_NUMBER
    );
    if (user.mobileNumber && isTwilioConfigured) {
      methods.push({
        id: 'sms',
        label: 'Mobile/SMS',
        destination: maskPhone(user.mobileNumber),
        available: true,
      });
    }

    return res.status(200).json({
      success: true,
      requiresOtp: true,
      message: 'Credentials verified. Please choose an OTP delivery method.',
      challengeToken,
      doctorName: user.name,
      doctorId: user.doctorId,
      methods,
    });
  } catch (error) {
    console.error('Doctor Login Challenge Error:', error);
    if (error.name === 'MongooseServerSelectionError' || error.name === 'MongoNetworkError') {
      return res.status(503).json({
        success: false,
        message: 'Database connection unavailable. Please ensure MongoDB Atlas whitelist allows your IP address.',
      });
    }
    return res.status(500).json({
      success: false,
      message: 'Server error during login verification.',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined,
    });
  }
};

/**
 * @desc    Step 2: Generate and dispatch OTP to selected channel (Email or SMS)
 * @route   POST /api/auth/doctor/send-otp
 * @access  Public
 */
const sendDoctorOtp = async (req, res) => {
  try {
    const { challengeToken, method } = req.body;

    if (!challengeToken || !method) {
      return res.status(400).json({
        success: false,
        message: 'Challenge token and delivery method are required.',
      });
    }

    const normalizedMethod = method.toLowerCase().trim();
    if (!['email', 'sms'].includes(normalizedMethod)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid delivery method. Allowed methods: email, sms.',
      });
    }

    if (isDemoAuthMode()) {
      const demoId = challengeToken.startsWith('demo:') ? challengeToken.split(':')[1] : null;
      const demoUser = demoId ? DEMO_DOCTORS[demoId] : null;
      if (!demoUser) {
        return res.status(400).json({
          success: false,
          message: 'Invalid or expired login challenge. Please sign in again.',
        });
      }

      const maskedDestination = 'Demo delivery (not sent)';
      return res.status(200).json({
        success: true,
        message: `A 6-digit verification code has been sent to ${maskedDestination}. Valid for 5 minutes.`,
        method: normalizedMethod,
        maskedDestination,
        expiresInSeconds: 300,
        cooldownSeconds: 45,
        demoOtp: DEMO_OTP,
        demoMode: true,
        delivery: {
          provider: 'demo',
          status: 'demo_only',
          delivered: false,
          message: 'No email or SMS was sent. Enter the documented demo OTP.'
        },
      });
    }

    const challenge = await AuthChallenge.findOne({ challengeToken, isUsed: false });
    if (!challenge) {
      return res.status(400).json({
        success: false,
        message: 'Invalid or expired login challenge. Please sign in again.',
      });
    }

    const user = await User.findById(challenge.userId);
    if (!user || !user.isActive) {
      return res.status(403).json({
        success: false,
        message: 'Doctor account is inactive or not found.',
      });
    }

    // Enforce cooldown if resending via the same challenge
    if (challenge.resendCooldownUntil && challenge.resendCooldownUntil > new Date()) {
      const remainingSeconds = Math.ceil((challenge.resendCooldownUntil.getTime() - Date.now()) / 1000);
      return res.status(429).json({
        success: false,
        message: `Please wait ${remainingSeconds} second(s) before requesting a new OTP.`,
        cooldownRemaining: remainingSeconds,
      });
    }

    if (normalizedMethod === 'email' && !user.email) {
      return res.status(400).json({
        success: false,
        message: 'No registered email address found for this doctor account.',
      });
    }

    if (normalizedMethod === 'sms' && !user.mobileNumber) {
      return res.status(400).json({
        success: false,
        message: 'No registered mobile number found for this doctor account.',
      });
    }

    // Generate fresh cryptographically secure random 6-digit OTP
    const otp = generateSecureOtp();
    const otpHash = hashOtp(otp);

    // Update challenge with new OTP hash, 5-min expiry, reset attempts, set 45s cooldown
    challenge.selectedMethod = normalizedMethod;
    challenge.otpHash = otpHash;
    challenge.otpExpiresAt = new Date(Date.now() + 5 * 60 * 1000); // 5 minutes
    challenge.attempts = 0;
    challenge.resendCooldownUntil = new Date(Date.now() + 45 * 1000); // 45s cooldown
    challenge.isUsed = false;
    await challenge.save();

    // Dispatch OTP through the selected channel
    let deliveryResult;
    if (normalizedMethod === 'email') {
      deliveryResult = await sendDoctorOtpEmail({
        to: user.email,
        doctorName: user.name,
        otp,
      });

      if (!deliveryResult.providerConfigured) {
        return res.status(503).json({
          success: false,
          message: 'Email OTP provider is not configured.',
          error: 'Email OTP provider is not configured.',
        });
      }

      if (!deliveryResult.delivered) {
        return res.status(500).json({
          success: false,
          message: 'Unable to send verification code. Please try again.',
          error: process.env.NODE_ENV === 'development' ? deliveryResult.error : undefined,
        });
      }
    } else {
      deliveryResult = await sendDoctorOtpSms({
        to: user.mobileNumber,
        doctorName: user.name,
        otp,
      });

      if (!deliveryResult.providerConfigured) {
        return res.status(503).json({
          success: false,
          message: 'SMS OTP service is not configured.',
          error: 'SMS OTP service is not configured.',
        });
      }

      if (!deliveryResult.delivered) {
        return res.status(500).json({
          success: false,
          message: 'Unable to send verification code. Please try again.',
          error: process.env.NODE_ENV === 'development' ? deliveryResult.error : undefined,
        });
      }
    }

    const maskedDestination = normalizedMethod === 'email' ? maskEmail(user.email) : maskPhone(user.mobileNumber);

    return res.status(200).json({
      success: true,
      message: `A 6-digit verification code has been sent to ${maskedDestination}. Valid for 5 minutes.`,
      method: normalizedMethod,
      maskedDestination,
      expiresInSeconds: 300,
      cooldownSeconds: 45,
    });
  } catch (error) {
    console.error('Send Doctor OTP Error:', error);
    return res.status(500).json({
      success: false,
      message: 'Server error generating or dispatching OTP.',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined,
    });
  }
};

/**
 * @desc    Step 3: Verify 6-digit OTP and issue JWT
 * @route   POST /api/auth/doctor/verify-otp
 * @access  Public
 */
const verifyDoctorOtp = async (req, res) => {
  try {
    const { challengeToken, otp } = req.body;

    if (!challengeToken || !otp) {
      return res.status(400).json({
        success: false,
        message: 'Please provide both the challenge token and the 6-digit verification code.',
      });
    }

    if (isDemoAuthMode()) {
      const demoId = challengeToken.startsWith('demo:') ? challengeToken.split(':')[1] : null;
      const demoUser = demoId ? DEMO_DOCTORS[demoId] : null;
      if (!demoUser) {
        return res.status(400).json({
          success: false,
          message: 'Session expired or invalid login challenge. Please sign in again.',
        });
      }

      if (otp.trim() !== DEMO_OTP) {
        return res.status(400).json({
          success: false,
          message: 'Invalid verification code. Use the documented demo OTP.',
        });
      }

      const token = buildDemoToken({ id: demoId, role: 'doctor', name: demoUser.name });
      return res.status(200).json({
        success: true,
        message: 'Doctor authenticated successfully.',
        token,
        user: {
          _id: demoId,
          name: demoUser.name,
          email: demoUser.email,
          role: 'doctor',
          doctorId: demoId,
          mobileNumber: '',
          isActive: true,
          createdAt: new Date().toISOString(),
          demoMode: true,
        },
      });
    }

    const challenge = await AuthChallenge.findOne({ challengeToken });
    if (!challenge) {
      return res.status(400).json({
        success: false,
        message: 'Session expired or invalid login challenge. Please sign in again.',
      });
    }

    if (challenge.isUsed) {
      return res.status(400).json({
        success: false,
        message: 'This OTP has already been used. Please request a new OTP.',
        alreadyUsed: true,
      });
    }

    if (!challenge.otpHash || !challenge.otpExpiresAt) {
      return res.status(400).json({
        success: false,
        message: 'No OTP has been requested for this session. Please request an OTP first.',
      });
    }

    // Check expiration (5 minutes)
    if (Date.now() > challenge.otpExpiresAt.getTime()) {
      return res.status(400).json({
        success: false,
        message: 'OTP expired. Please request a new OTP.',
        isExpired: true,
      });
    }

    // Check maximum failed attempts
    if (challenge.attempts >= challenge.maxAttempts) {
      return res.status(400).json({
        success: false,
        message: 'Maximum verification attempts exceeded. Please restart login.',
        locked: true,
      });
    }

    // Verify hash
    const enteredHash = hashOtp(otp.trim());
    if (enteredHash !== challenge.otpHash) {
      challenge.attempts += 1;
      await challenge.save();
      const remainingAttempts = challenge.maxAttempts - challenge.attempts;

      return res.status(400).json({
        success: false,
        message: remainingAttempts > 0
          ? `Invalid verification code. ${remainingAttempts} attempt(s) remaining.`
          : 'Maximum verification attempts exceeded. Please restart login.',
        remainingAttempts,
        attemptsRemaining: remainingAttempts,
      });
    }

    // Mark challenge as used to guarantee one-time use
    challenge.isUsed = true;
    await challenge.save();

    const user = await User.findById(challenge.userId);
    if (!user || !user.isActive) {
      return res.status(403).json({
        success: false,
        message: 'Doctor account is inactive.',
      });
    }

    // Issue existing JWT
    const token = generateToken(user._id, user.role);

    return res.status(200).json({
      success: true,
      message: 'Doctor authenticated successfully.',
      token,
      user: {
        _id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
        doctorId: user.doctorId,
        mobileNumber: user.mobileNumber,
        isActive: user.isActive,
        createdAt: user.createdAt,
      },
    });
  } catch (error) {
    console.error('Verify Doctor OTP Error:', error);
    return res.status(500).json({
      success: false,
      message: 'Server error verifying OTP.',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined,
    });
  }
};

/**
 * @desc    Step 4: Resend fresh OTP to the currently selected channel
 * @route   POST /api/auth/doctor/resend-otp
 * @access  Public
 */
const resendDoctorOtp = async (req, res) => {
  try {
    const { challengeToken } = req.body;

    if (!challengeToken) {
      return res.status(400).json({
        success: false,
        message: 'Challenge token is required.',
      });
    }

    if (isDemoAuthMode()) {
      const demoId = challengeToken.startsWith('demo:') ? challengeToken.split(':')[1] : null;
      const demoUser = demoId ? DEMO_DOCTORS[demoId] : null;
      if (!demoUser) {
        return res.status(400).json({
          success: false,
          message: 'Session expired or invalid login challenge. Please sign in again.',
        });
      }

      const method = req.body.method || 'email';
      const normalizedMethod = method.toLowerCase().trim();
      const maskedDestination = 'Demo delivery (not sent)';
      return res.status(200).json({
        success: true,
        message: `A fresh 6-digit verification code has been sent to ${maskedDestination}. Valid for 5 minutes.`,
        method: normalizedMethod,
        maskedDestination,
        expiresInSeconds: 300,
        cooldownSeconds: 45,
        demoOtp: DEMO_OTP,
        demoMode: true,
        delivery: {
          provider: 'demo',
          status: 'demo_only',
          delivered: false,
          message: 'No email or SMS was sent. Enter the documented demo OTP.'
        },
      });
    }

    const challenge = await AuthChallenge.findOne({ challengeToken, isUsed: false });
    if (!challenge) {
      return res.status(400).json({
        success: false,
        message: 'Session expired or invalid login challenge. Please sign in again.',
      });
    }

    if (!challenge.selectedMethod) {
      return res.status(400).json({
        success: false,
        message: 'Please choose an OTP delivery method first.',
      });
    }

    // Enforce cooldown
    if (challenge.resendCooldownUntil && challenge.resendCooldownUntil > new Date()) {
      const remainingSeconds = Math.ceil((challenge.resendCooldownUntil.getTime() - Date.now()) / 1000);
      return res.status(429).json({
        success: false,
        message: `Please wait ${remainingSeconds} second(s) before requesting a new code.`,
        cooldownRemaining: remainingSeconds,
      });
    }

    const user = await User.findById(challenge.userId);
    if (!user || !user.isActive) {
      return res.status(403).json({
        success: false,
        message: 'Doctor account is inactive.',
      });
    }

    // Generate fresh OTP and new hash
    const otp = generateSecureOtp();
    const otpHash = hashOtp(otp);

    challenge.otpHash = otpHash;
    challenge.otpExpiresAt = new Date(Date.now() + 5 * 60 * 1000);
    challenge.attempts = 0;
    challenge.resendCooldownUntil = new Date(Date.now() + 45 * 1000);
    challenge.isUsed = false;
    await challenge.save();

    let deliveryResult;
    if (challenge.selectedMethod === 'email') {
      deliveryResult = await sendDoctorOtpEmail({
        to: user.email,
        doctorName: user.name,
        otp,
      });

      if (!deliveryResult.providerConfigured) {
        return res.status(503).json({
          success: false,
          message: 'Email OTP provider is not configured.',
          error: 'Email OTP provider is not configured.',
        });
      }

      if (!deliveryResult.delivered) {
        return res.status(500).json({
          success: false,
          message: 'Unable to send verification code. Please try again.',
          error: process.env.NODE_ENV === 'development' ? deliveryResult.error : undefined,
        });
      }
    } else {
      deliveryResult = await sendDoctorOtpSms({
        to: user.mobileNumber,
        doctorName: user.name,
        otp,
      });

      if (!deliveryResult.providerConfigured) {
        return res.status(503).json({
          success: false,
          message: 'SMS OTP service is not configured.',
          error: 'SMS OTP service is not configured.',
        });
      }

      if (!deliveryResult.delivered) {
        return res.status(500).json({
          success: false,
          message: 'Unable to send verification code. Please try again.',
          error: process.env.NODE_ENV === 'development' ? deliveryResult.error : undefined,
        });
      }
    }

    const maskedDestination = challenge.selectedMethod === 'email'
      ? maskEmail(user.email)
      : maskPhone(user.mobileNumber);

    return res.status(200).json({
      success: true,
      message: `A fresh 6-digit verification code has been sent to ${maskedDestination}. Valid for 5 minutes.`,
      method: challenge.selectedMethod,
      maskedDestination,
      expiresInSeconds: 300,
      cooldownSeconds: 45,
    });
  } catch (error) {
    console.error('Resend Doctor OTP Error:', error);
    return res.status(500).json({
      success: false,
      message: 'Server error resending OTP.',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined,
    });
  }
};


/**
 * @desc    Authenticate or identify Patient by Mobile Number or ABHA ID
 * @route   POST /api/auth/patient/login
 * @access  Public
 */
const loginPatient = async (req, res) => {
  try {
    const { mobileNumber, abhaId } = req.body;

    if (!mobileNumber && !abhaId) {
      return res.status(400).json({
        success: false,
        message: 'Please provide either a registered mobile number or ABHA ID.',
      });
    }

    const query = { role: 'patient' };
    if (mobileNumber && mobileNumber.trim()) {
      query.mobileNumber = mobileNumber.trim();
    } else if (abhaId && abhaId.trim()) {
      query.abhaId = abhaId.trim();
    }

    let user = await User.findOne(query);

    // If patient not found, create a pre-consultation intake user record
    if (!user) {
      const defaultName = mobileNumber
        ? `Patient (${mobileNumber.trim().slice(-4)})`
        : `Patient (${abhaId.trim()})`;
      const defaultPassword = `Patient@${Date.now()}`;

      user = await User.create({
        name: defaultName,
        role: 'patient',
        mobileNumber: mobileNumber ? mobileNumber.trim() : undefined,
        abhaId: abhaId ? abhaId.trim() : undefined,
        password: defaultPassword,
        isActive: true,
      });
    }

    if (!user.isActive) {
      return res.status(403).json({
        success: false,
        message: 'Patient account is inactive. Please contact hospital helpdesk.',
      });
    }

    const token = generateToken(user._id, user.role);

    return res.status(200).json({
      success: true,
      message: 'Patient authenticated successfully.',
      token,
      user: {
        _id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
        mobileNumber: user.mobileNumber,
        abhaId: user.abhaId,
        isActive: user.isActive,
        createdAt: user.createdAt,
      },
    });
  } catch (error) {
    console.error('Patient Login Error:', error);
    return res.status(500).json({
      success: false,
      message: 'Server error during patient login.',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined,
    });
  }
};

/**
 * @desc    Get current authenticated user profile
 * @route   GET /api/auth/me
 * @access  Private (Protected by JWT)
 */
const getMe = async (req, res) => {
  try {
    return res.status(200).json({
      success: true,
      user: req.user,
    });
  } catch (error) {
    console.error('Get Profile Error:', error);
    return res.status(500).json({
      success: false,
      message: 'Server error retrieving profile.',
    });
  }
};

module.exports = {
  registerUser,
  loginDoctor,
  sendDoctorOtp,
  verifyDoctorOtp,
  resendDoctorOtp,
  loginPatient,
  getMe,
};
