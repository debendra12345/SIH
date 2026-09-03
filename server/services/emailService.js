const nodemailer = require('nodemailer');

// In-memory registry for development testing verification (never exposed to API clients or logs)
const devOtpAudit = new Map();

let cachedTransporter = null;

/**
 * Check whether SMTP environment variables are configured
 */
function isSmtpConfigured() {
  return !!(
    process.env.SMTP_HOST &&
    process.env.SMTP_USER &&
    process.env.SMTP_PASS
  );
}

/**
 * Get or initialize reusable SMTP transporter
 */
function getTransporter() {
  if (!isSmtpConfigured()) return null;
  if (!cachedTransporter) {
    cachedTransporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST || 'smtp.gmail.com',
      port: parseInt(process.env.SMTP_PORT || '587', 10),
      secure: process.env.SMTP_SECURE === 'true',
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
      },
    });
  }
  return cachedTransporter;
}

/**
 * Verify SMTP connection during startup
 */
async function verifySmtpConnection() {
  if (!isSmtpConfigured()) {
    console.log('⚠️  SMTP credentials not detected in server/.env (Email OTP requires SMTP configuration).');
    return false;
  }
  try {
    const transporter = getTransporter();
    await transporter.verify();
    console.log('✔ SMTP connection verified successfully. Ready to deliver real OTP emails.');
    return true;
  } catch (err) {
    console.error('❌ SMTP connection verification error:', err.message);
    return false;
  }
}

/**
 * Send Transactional Email with Doctor Login OTP
 * @param {Object} options
 * @param {string} options.to - Recipient email address
 * @param {string} options.doctorName - Doctor's full name
 * @param {string} options.otp - 6-digit OTP
 */
async function sendDoctorOtpEmail({ to, doctorName, otp }) {
  // Record in dev audit map for automated test verification
  devOtpAudit.set(to.toLowerCase(), { otp, timestamp: Date.now() });

  if (!isSmtpConfigured()) {
    return {
      success: false,
      delivered: false,
      providerConfigured: false,
      error: 'Email OTP provider is not configured.',
    };
  }

  try {
    const transporter = getTransporter();
    const fromAddress = process.env.SMTP_FROM || process.env.EMAIL_FROM || `"MediKiosk Auth" <${process.env.SMTP_USER}>`;

    const subject = 'MediKiosk Doctor Login OTP';
    const textContent = `Dear ${doctorName || 'Doctor'},\n\nYour MediKiosk verification code is: ${otp}\n\nThis OTP expires in 5 minutes.\nIf you did not request this login, ignore this email.\n\nBest regards,\nMediKiosk Clinical Platform`;

    const htmlContent = `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; max-width: 520px; margin: 0 auto; padding: 28px; background: #ffffff; border: 1px solid #e2e8f0; border-radius: 12px;">
        <div style="display: flex; align-items: center; margin-bottom: 20px;">
          <div style="width: 36px; height: 36px; border-radius: 9px; background: #0D9488; color: #ffffff; display: flex; align-items: center; justify-content: center; font-weight: 900; font-size: 18px; text-align: center; line-height: 36px;">M</div>
          <span style="font-size: 18px; font-weight: 800; color: #0B1F33; margin-left: 10px;">MediKiosk</span>
        </div>
        <h2 style="color: #0B1F33; font-size: 20px; margin-bottom: 8px;">Doctor Authentication</h2>
        <p style="color: #4A5568; font-size: 14px; line-height: 1.5; margin-bottom: 24px;">Hello <b>${doctorName || 'Doctor'}</b>, please use the following one-time code to complete your login to the MediKiosk physician portal:</p>
        <div style="background: #E6F7F4; border: 1px solid #B2E8E4; border-radius: 10px; padding: 18px; text-align: center; margin-bottom: 24px;">
          <span style="font-size: 32px; font-weight: 900; letter-spacing: 8px; color: #087B72; font-family: monospace;">${otp}</span>
        </div>
        <p style="color: #718096; font-size: 12px; line-height: 1.5; margin-bottom: 8px;">⏱️ This OTP expires in <b>5 minutes</b>.</p>
        <p style="color: #718096; font-size: 12px; line-height: 1.5;">🔒 If you did not request this login attempt, please ignore this email or contact your hospital IT administrator immediately.</p>
        <hr style="border: none; border-top: 1px solid #edf2f7; margin: 24px 0 16px;">
        <p style="color: #a0aec0; font-size: 11px; text-align: center;">MediKiosk Smart Hospital Clinical Intake &amp; Pre-Consultation EMR Platform</p>
      </div>
    `;

    const info = await transporter.sendMail({
      from: fromAddress,
      to,
      subject,
      text: textContent,
      html: htmlContent,
    });

    return {
      success: true,
      delivered: true,
      providerConfigured: true,
      messageId: info.messageId,
    };
  } catch (err) {
    return {
      success: false,
      delivered: false,
      providerConfigured: true,
      error: `Failed to deliver email: ${err.message}`,
    };
  }
}

/**
 * Development test helper to fetch last OTP for automated test verification
 */
function getDevAuditOtp(email) {
  const item = devOtpAudit.get(email.toLowerCase());
  return item ? item.otp : null;
}

module.exports = {
  sendDoctorOtpEmail,
  isSmtpConfigured,
  verifySmtpConnection,
  getDevAuditOtp,
};
