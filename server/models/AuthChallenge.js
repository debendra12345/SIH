const mongoose = require('mongoose');

const authChallengeSchema = new mongoose.Schema({
  challengeToken: {
    type: String,
    required: true,
    unique: true,
    index: true,
  },
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
  doctorId: {
    type: String,
    required: false,
  },
  mobileNumber: {
    type: String,
    required: false,
  },
  role: {
    type: String,
    enum: ['doctor', 'patient'],
    default: 'doctor',
  },
  selectedMethod: {
    type: String,
    enum: ['email', 'sms', 'sms_demo', 'demo', null],
    default: null,
  },
  otpHash: {
    type: String,
    default: null,
  },
  otpExpiresAt: {
    type: Date,
    default: null,
  },
  attempts: {
    type: Number,
    default: 0,
  },
  maxAttempts: {
    type: Number,
    default: 5,
  },
  resendCooldownUntil: {
    type: Date,
    default: null,
  },
  isUsed: {
    type: Boolean,
    default: false,
  },
  createdAt: {
    type: Date,
    default: Date.now,
    expires: 900, // Automatically deletes documents 15 minutes after creation
  },
});

const AuthChallenge = mongoose.model('AuthChallenge', authChallengeSchema);

module.exports = AuthChallenge;
