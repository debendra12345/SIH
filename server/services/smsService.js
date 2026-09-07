const devSmsAudit = new Map();

/**
 * Check whether Twilio SMS environment variables are configured
 */
function isSmsConfigured() {
  return !!(
    process.env.TWILIO_ACCOUNT_SID &&
    process.env.TWILIO_AUTH_TOKEN &&
    process.env.TWILIO_PHONE_NUMBER
  );
}

/**
 * Send Transactional SMS with Doctor Login OTP
 * @param {Object} options
 * @param {string} options.to - Recipient phone number (e.g. 7665778969)
 * @param {string} options.doctorName - Doctor's full name
 * @param {string} options.otp - 6-digit OTP
 */
async function sendDoctorOtpSms({ to, doctorName, otp }) {
  // Record in dev audit map for automated test suite verification
  devSmsAudit.set(to.replace(/\D/g, ''), { otp, timestamp: Date.now() });

  if (!isSmsConfigured()) {
    return {
      success: false,
      delivered: false,
      providerConfigured: false,
      error: 'SMS OTP service is not configured.',
    };
  }

  try {
    const accountSid = process.env.TWILIO_ACCOUNT_SID;
    const authToken = process.env.TWILIO_AUTH_TOKEN;
    const fromPhone = process.env.TWILIO_PHONE_NUMBER;

    // Normalize phone number to E.164 (defaulting to +91 for 10-digit Indian numbers)
    const cleaned = to.replace(/\D/g, '');
    const normalizedTo = cleaned.length === 10 ? `+91${cleaned}` : (to.startsWith('+') ? to : `+${cleaned}`);

    const bodyText = `Your MediKiosk verification code is: ${otp}. This OTP expires in 5 minutes. If you did not request this login, ignore this message.`;

    const url = `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`;
    const params = new URLSearchParams();
    params.append('To', normalizedTo);
    params.append('From', fromPhone);
    params.append('Body', bodyText);

    const authHeader = 'Basic ' + Buffer.from(`${accountSid}:${authToken}`).toString('base64');

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': authHeader,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: params.toString(),
    });

    const data = await res.json();

    if (!res.ok) {
      return {
        success: false,
        delivered: false,
        providerConfigured: true,
        error: `Twilio SMS error: ${data.message || res.statusText}`,
      };
    }

    return {
      success: true,
      delivered: true,
      providerConfigured: true,
      sid: data.sid,
    };
  } catch (err) {
    return {
      success: false,
      delivered: false,
      providerConfigured: true,
      error: `Failed to dispatch SMS: ${err.message}`,
    };
  }
}

/**
 * Send Transactional SMS with Patient Login OTP
 * @param {Object} options
 * @param {string} options.to - Recipient phone number (e.g. 7665778969)
 * @param {string} options.patientName - Patient's full name
 * @param {string} options.otp - 6-digit OTP
 */
async function sendPatientOtpSms({ to, patientName, otp }) {
  // Record in dev audit map for automated test suite verification
  devSmsAudit.set(to.replace(/\D/g, ''), { otp, timestamp: Date.now() });

  if (!isSmsConfigured()) {
    return {
      success: false,
      delivered: false,
      providerConfigured: false,
      error: 'SMS OTP service is not configured. Please set TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, and TWILIO_PHONE_NUMBER in server/.env.',
    };
  }

  try {
    const accountSid = process.env.TWILIO_ACCOUNT_SID;
    const authToken = process.env.TWILIO_AUTH_TOKEN;
    const fromPhone = process.env.TWILIO_PHONE_NUMBER;

    // Normalize phone number to E.164 (defaulting to +91 for 10-digit Indian numbers)
    const cleaned = to.replace(/\D/g, '');
    const normalizedTo = cleaned.length === 10 ? `+91${cleaned}` : (to.startsWith('+') ? to : `+${cleaned}`);

    const nameGreeting = patientName ? `Hello ${patientName}, ` : '';
    const bodyText = `${nameGreeting}your MediKiosk verification code is: ${otp}. Valid for 5 minutes. If you did not request this, please ignore.`;

    const url = `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`;
    const params = new URLSearchParams();
    params.append('To', normalizedTo);
    params.append('From', fromPhone);
    params.append('Body', bodyText);

    const authHeader = 'Basic ' + Buffer.from(`${accountSid}:${authToken}`).toString('base64');

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': authHeader,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: params.toString(),
    });

    const data = await res.json();

    if (!res.ok) {
      return {
        success: false,
        delivered: false,
        providerConfigured: true,
        error: `Twilio SMS error: ${data.message || res.statusText}`,
      };
    }

    return {
      success: true,
      delivered: true,
      providerConfigured: true,
      sid: data.sid,
    };
  } catch (err) {
    return {
      success: false,
      delivered: false,
      providerConfigured: true,
      error: `Failed to dispatch SMS: ${err.message}`,
    };
  }
}

/**
 * Development test helper to fetch last SMS OTP for automated test verification
 */
function getDevSmsAuditOtp(phone) {
  const item = devSmsAudit.get(phone.replace(/\D/g, ''));
  return item ? item.otp : null;
}

module.exports = {
  sendDoctorOtpSms,
  sendPatientOtpSms,
  isSmsConfigured,
  getDevSmsAuditOtp,
};
