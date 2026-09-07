const mongoose = require('mongoose');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const AuthChallenge = require('../models/AuthChallenge');
const { sendDoctorOtpEmail } = require('../services/emailService');
const { sendDoctorOtpSms, sendPatientOtpSms, isSmsConfigured } = require('../services/smsService');
const { maskEmail, maskPhone, generateSecureOtp, hashOtp } = require('../utils/authUtils');
const { getJwtSecret, isDemoTokenMode } = require('../utils/tokenConfig');

const { DOCTORS_DATA } = require('../scripts/seedDoctors');

const DEMO_DOCTORS = {};
(DOCTORS_DATA || []).forEach(d => {
  DEMO_DOCTORS[d.doctorId] = {
    name: d.name,
    email: d.email,
    mobileNumber: d.mobileNumber,
    tempPassword: d.tempPassword,
  };
});

const DEMO_PASSWORD = process.env.DEMO_DOCTOR_PASSWORD || 'demo123';
const DEMO_OTP = '123456';
const isDemoAuthMode = () => !process.env.MONGO_URI;

const inMemoryPatientChallenges = new Map();
const inMemoryPatients = new Map();

const getDemoDoctor = (doctorId, password) => {
  const normalizedId = (doctorId || '').trim();
  const record = DEMO_DOCTORS[normalizedId];
  if (!record) return null;
  if (record.tempPassword !== password && DEMO_PASSWORD !== password) return null;
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
const generateToken = (id, role, extra = {}) => {
  return jwt.sign({ id, role, ...extra, demo: isDemoTokenMode() }, getJwtSecret(), {
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
 * @desc    Step 1: Patient Login Challenge - Validate details, update/create profile & generate Demo OTP
 * @route   POST /api/auth/patient/login-challenge
 * @access  Public
 */
const loginPatientChallenge = async (req, res) => {
  try {
    const { name, age, gender, mobileNumber, currentHealthProblem } = req.body;

    // 1. Strict Backend Validation
    if (!name || typeof name !== 'string' || name.trim().length < 2) {
      return res.status(400).json({
        success: false,
        message: 'Please provide a valid patient name (at least 2 characters).',
      });
    }

    const trimmedName = name.trim().slice(0, 100);

    const parsedAge = parseInt(age, 10);
    if (isNaN(parsedAge) || parsedAge < 1 || parsedAge > 120) {
      return res.status(400).json({
        success: false,
        message: 'Please provide a valid numeric age between 1 and 120.',
      });
    }

    const validGenders = ['Male', 'Female', 'Other'];
    const matchedGender = validGenders.find(
      g => g.toLowerCase() === (gender || '').toString().trim().toLowerCase()
    );
    if (!matchedGender) {
      return res.status(400).json({
        success: false,
        message: 'Please select a valid gender (Male, Female, or Other).',
      });
    }

    if (!mobileNumber || typeof mobileNumber !== 'string') {
      return res.status(400).json({
        success: false,
        message: 'Please provide a registered 10-digit mobile number.',
      });
    }

    const cleanedMobile = mobileNumber.replace(/\D/g, '');
    if (cleanedMobile.length !== 10) {
      return res.status(400).json({
        success: false,
        message: 'Mobile number must be exactly 10 digits (e.g. 9875410323).',
      });
    }

    const trimmedProblem = typeof currentHealthProblem === 'string' ? currentHealthProblem.trim().slice(0, 500) : '';

    // 2. Database check & Patient Profile Storage
    let userId = null;
    let user = null;

    if (mongoose.connection.readyState === 1) {
      user = await User.findOne({ role: 'patient', mobileNumber: cleanedMobile });
      if (user) {
        user.name = trimmedName;
        user.age = parsedAge;
        user.gender = matchedGender;
        if (trimmedProblem) {
          user.currentHealthProblem = trimmedProblem;
        }
        user.healthStatus = user.healthStatus || 'Stable';
        user.isActive = true;
        await user.save();
      } else {
        user = await User.create({
          name: trimmedName,
          age: parsedAge,
          gender: matchedGender,
          mobileNumber: cleanedMobile,
          currentHealthProblem: trimmedProblem,
          healthStatus: 'Stable',
          role: 'patient',
          isActive: true,
        });
      }
      userId = user._id;

      // Invalidate existing patient challenges
      await AuthChallenge.deleteMany({ userId: user._id, role: 'patient' });
    } else {
      userId = new mongoose.Types.ObjectId();
    }

    // 3. Generate 6-Digit Demo OTP (Fixed 123456 for SIH presentation demo)
    const DEMO_PATIENT_OTP = '123456';
    const rawOtp = DEMO_PATIENT_OTP;
    const otpHash = hashOtp(rawOtp);
    const challengeToken = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000); // 5 minutes
    const cooldownUntil = new Date(Date.now() + 45 * 1000); // 45s cooldown

    // 4. Store Challenge in in-memory map & in MongoDB if connected
    inMemoryPatientChallenges.set(challengeToken, {
      challengeToken,
      userId: userId ? userId.toString() : 'demo_patient_id',
      mobileNumber: cleanedMobile,
      otpHash,
      otpExpiresAt: expiresAt,
      resendCooldownUntil: cooldownUntil,
      attempts: 0,
      maxAttempts: 5,
      isUsed: false,
    });

    inMemoryPatients.set(cleanedMobile, {
      _id: userId ? userId.toString() : 'demo_patient_id',
      name: trimmedName,
      age: parsedAge,
      gender: matchedGender,
      mobileNumber: cleanedMobile,
      currentHealthProblem: trimmedProblem,
      healthStatus: 'Stable',
      role: 'patient',
      isActive: true,
      createdAt: new Date().toISOString(),
    });

    if (mongoose.connection.readyState === 1) {
      await AuthChallenge.create({
        challengeToken,
        userId,
        mobileNumber: cleanedMobile,
        role: 'patient',
        selectedMethod: 'sms_demo',
        otpHash,
        otpExpiresAt: expiresAt,
        resendCooldownUntil: cooldownUntil,
        attempts: 0,
        maxAttempts: 5,
        isUsed: false,
      });
    }

    const maskedMobile = `******${cleanedMobile.slice(-4)}`;

    return res.status(200).json({
      success: true,
      demoMode: true,
      demoOtp: DEMO_PATIENT_OTP,
      message: 'DEMO MODE: For this presentation demo, use OTP 123456.',
      challengeToken,
      maskedDestination: maskedMobile,
      expiresInSeconds: 300,
      cooldownSeconds: 45,
    });
  } catch (error) {
    console.error('Patient Login Challenge Error:', error);
    return res.status(500).json({
      success: false,
      message: 'Server error during patient authentication challenge.',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined,
    });
  }
};

/**
 * @desc    Step 2: Verify Patient OTP & Issue Authenticated JWT Session
 * @route   POST /api/auth/patient/verify-otp
 * @access  Public
 */
const verifyPatientOtp = async (req, res) => {
  try {
    const { challengeToken, otp } = req.body;

    if (!challengeToken) {
      return res.status(400).json({
        success: false,
        message: 'Authentication session expired or missing challenge token. Please restart login.',
      });
    }

    if (!otp || typeof otp !== 'string' || !/^\d{6}$/.test(otp.trim())) {
      return res.status(400).json({
        success: false,
        message: 'Please enter a valid 6-digit numeric OTP code.',
      });
    }

    const trimmedOtp = otp.trim();

    let challenge = null;
    if (mongoose.connection.readyState === 1) {
      challenge = await AuthChallenge.findOne({
        challengeToken,
        role: 'patient',
        isUsed: false,
      });
    }

    const memChallenge = inMemoryPatientChallenges.get(challengeToken);
    if (!challenge && memChallenge) {
      challenge = memChallenge;
    }

    if (!challenge) {
      return res.status(400).json({
        success: false,
        message: 'Invalid or expired authentication challenge. Please request a new code.',
      });
    }

    if (challenge.isUsed) {
      return res.status(400).json({
        success: false,
        message: 'This OTP has already been verified and cannot be reused.',
      });
    }

    if (challenge.attempts >= challenge.maxAttempts) {
      return res.status(429).json({
        success: false,
        message: 'Maximum verification attempts exceeded for this challenge. Please restart login.',
      });
    }

    if (new Date() > challenge.otpExpiresAt) {
      return res.status(400).json({
        success: false,
        message: 'The verification code has expired (5-minute limit). Please request a new code.',
      });
    }

    const candidateHash = hashOtp(trimmedOtp);
    const isFixedDemoMatch = trimmedOtp === '123456';
    if (candidateHash !== challenge.otpHash && !isFixedDemoMatch) {
      challenge.attempts = (challenge.attempts || 0) + 1;
      if (typeof challenge.save === 'function') await challenge.save();

      const remaining = challenge.maxAttempts - challenge.attempts;
      return res.status(400).json({
        success: false,
        message: `Invalid verification code. Use demo OTP 123456. ${remaining > 0 ? `${remaining} attempt(s) remaining.` : 'Maximum attempts exceeded.'}`,
        attemptsRemaining: Math.max(0, remaining),
      });
    }

    // Mark challenge as used
    challenge.isUsed = true;
    if (typeof challenge.save === 'function') await challenge.save();

    let user = null;
    if (mongoose.connection.readyState === 1 && challenge.userId && mongoose.Types.ObjectId.isValid(challenge.userId)) {
      user = await User.findById(challenge.userId);
    }
    if (!user && challenge.mobileNumber) {
      user = inMemoryPatients.get(challenge.mobileNumber);
    }

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'Patient profile could not be located.',
      });
    }

    if (!user.isActive) {
      return res.status(403).json({
        success: false,
        message: 'Patient account is inactive.',
      });
    }

    const token = generateToken(user._id, user.role || 'patient', {
      name: user.name,
      age: user.age,
      gender: user.gender,
      mobileNumber: user.mobileNumber,
      currentHealthProblem: user.currentHealthProblem || '',
      healthStatus: user.healthStatus || 'Stable',
    });

    return res.status(200).json({
      success: true,
      message: 'Patient verification successful.',
      token,
      user: {
        _id: user._id,
        name: user.name,
        age: user.age,
        gender: user.gender,
        mobileNumber: user.mobileNumber,
        currentHealthProblem: user.currentHealthProblem || '',
        healthStatus: user.healthStatus || 'Stable',
        role: user.role || 'patient',
        isActive: user.isActive,
        createdAt: user.createdAt,
      },
    });
  } catch (error) {
    console.error('Patient OTP Verification Error:', error);
    return res.status(500).json({
      success: false,
      message: 'Server error during OTP verification.',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined,
    });
  }
};

/**
 * @desc    Resend Patient SMS OTP
 * @route   POST /api/auth/patient/resend-otp
 * @access  Public
 */
const resendPatientOtp = async (req, res) => {
  try {
    const { challengeToken } = req.body;

    if (!challengeToken) {
      return res.status(400).json({
        success: false,
        message: 'Challenge token is required to resend verification code.',
      });
    }

    const challenge = await AuthChallenge.findOne({
      challengeToken,
      role: 'patient',
      isUsed: false,
    });

    if (!challenge) {
      return res.status(400).json({
        success: false,
        message: 'Invalid or expired session. Please restart login.',
      });
    }

    if (challenge.resendCooldownUntil && new Date() < challenge.resendCooldownUntil) {
      const remainingSeconds = Math.ceil((challenge.resendCooldownUntil - new Date()) / 1000);
      return res.status(429).json({
        success: false,
        message: `Please wait ${remainingSeconds} second(s) before requesting a new code.`,
        retryAfter: remainingSeconds,
      });
    }

    const user = await User.findById(challenge.userId);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'Patient record not found.',
      });
    }

    const DEMO_PATIENT_OTP = '123456';
    const rawOtp = DEMO_PATIENT_OTP;
    const otpHash = hashOtp(rawOtp);
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000);
    const cooldownUntil = new Date(Date.now() + 45 * 1000);

    challenge.otpHash = otpHash;
    challenge.otpExpiresAt = expiresAt;
    challenge.resendCooldownUntil = cooldownUntil;
    challenge.attempts = 0;
    challenge.isUsed = false;
    await challenge.save();

    const maskedMobile = `******${(challenge.mobileNumber || user.mobileNumber || '0000').slice(-4)}`;

    return res.status(200).json({
      success: true,
      demoMode: true,
      demoOtp: DEMO_PATIENT_OTP,
      message: 'DEMO MODE: For this presentation demo, use OTP 123456.',
      challengeToken: challenge.challengeToken,
      maskedDestination: maskedMobile,
      expiresInSeconds: 300,
      cooldownSeconds: 45,
    });
  } catch (error) {
    console.error('Resend Patient OTP Error:', error);
    return res.status(500).json({
      success: false,
      message: 'Server error resending verification code.',
    });
  }
};

/**
 * @desc    Direct Patient Identification (Legacy / Direct Endpoint)
 * @route   POST /api/auth/patient/login
 * @access  Public
 */
const loginPatient = async (req, res) => {
  try {
    const { name, age, gender, mobileNumber, abhaId, currentHealthProblem } = req.body;

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

    if (!user) {
      user = await User.create({
        name: name ? name.trim() : (mobileNumber ? `Patient (${mobileNumber.trim().slice(-4)})` : `Patient (${abhaId.trim()})`),
        age: age ? parseInt(age, 10) : undefined,
        gender: gender || undefined,
        role: 'patient',
        mobileNumber: mobileNumber ? mobileNumber.trim() : undefined,
        abhaId: abhaId ? abhaId.trim() : undefined,
        currentHealthProblem: currentHealthProblem ? currentHealthProblem.trim() : '',
        healthStatus: 'Stable',
        isActive: true,
      });
    } else if (name || age || gender || currentHealthProblem) {
      if (name) user.name = name.trim();
      if (age) user.age = parseInt(age, 10);
      if (gender) user.gender = gender;
      if (currentHealthProblem) user.currentHealthProblem = currentHealthProblem.trim();
      await user.save();
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
        age: user.age,
        gender: user.gender,
        email: user.email,
        role: user.role,
        mobileNumber: user.mobileNumber,
        abhaId: user.abhaId,
        currentHealthProblem: user.currentHealthProblem || '',
        healthStatus: user.healthStatus || 'Stable',
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
  loginPatientChallenge,
  verifyPatientOtp,
  resendPatientOtp,
  loginPatient,
  getMe,
  inMemoryPatients,
};
