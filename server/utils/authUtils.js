const crypto = require('crypto');

/**
 * Mask an email address (e.g. aryanvines32@gmail.com -> a***@gmail.com)
 */
function maskEmail(email) {
  if (!email || typeof email !== 'string' || !email.includes('@')) {
    return '***@***.***';
  }
  const [localPart, domain] = email.split('@');
  if (localPart.length <= 1) {
    return `${localPart}***@${domain}`;
  }
  return `${localPart[0]}***@${domain}`;
}

/**
 * Mask a phone number (e.g. 7665778969 -> ******8969)
 */
function maskPhone(phone) {
  if (!phone || typeof phone !== 'string') {
    return '******';
  }
  const cleaned = phone.replace(/\D/g, '');
  if (cleaned.length <= 4) {
    return '******' + cleaned;
  }
  const last4 = cleaned.slice(-4);
  return '*'.repeat(Math.max(cleaned.length - 4, 6)) + last4;
}

/**
 * Generate a cryptographically secure 6-digit OTP
 */
function generateSecureOtp() {
  return crypto.randomInt(100000, 1000000).toString();
}

/**
 * Hash an OTP using SHA-256 with a salt derived from JWT_SECRET
 */
function hashOtp(otp) {
  const salt = process.env.JWT_SECRET || 'medikiosk_auth_salt_2026';
  return crypto.createHash('sha256').update(`${otp}:${salt}`).digest('hex');
}

module.exports = {
  maskEmail,
  maskPhone,
  generateSecureOtp,
  hashOtp,
};
