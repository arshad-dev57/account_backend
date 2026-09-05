const DEMO_OTP_TTL_MS = 365 * 24 * 60 * 60 * 1000;

function parseEmailList(value) {
  return String(value || '')
    .split(',')
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);
}

function isDemoLoginEmail(email) {
  const configured = parseEmailList(process.env.DEMO_LOGIN_EMAILS);
  return configured.includes(String(email || '').trim().toLowerCase());
}

function getDemoLoginOtp() {
  const otp = String(process.env.DEMO_LOGIN_OTP || '').trim();
  return /^\d{6}$/.test(otp) ? otp : '';
}

function getDemoOtpExpiry() {
  return new Date(Date.now() + DEMO_OTP_TTL_MS);
}

module.exports = {
  isDemoLoginEmail,
  getDemoLoginOtp,
  getDemoOtpExpiry,
};
