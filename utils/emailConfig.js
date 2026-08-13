/**
 * Central email "From" identity for OTP / transactional mail.
 *
 * Auth (SMTP login) uses EMAIL_USER + EMAIL_PASS.
 * Visible From address uses EMAIL_FROM (e.g. noreply@bisonstechs.com).
 *
 * Gmail note: EMAIL_FROM must be allowed as "Send mail as" on EMAIL_USER,
 * OR EMAIL_FROM must equal EMAIL_USER.
 */

function getEmailFrom() {
  const address = (
    process.env.EMAIL_FROM ||
    process.env.EMAIL_USER ||
    ''
  ).trim();

  const name = (process.env.EMAIL_FROM_NAME || 'BisonsTechs').trim();
  const replyTo = (
    process.env.EMAIL_REPLY_TO ||
    process.env.EMAIL_FROM ||
    process.env.EMAIL_USER ||
    ''
  ).trim();

  return {
    address,
    name,
    replyTo,
    /** Nodemailer `from` value: "BisonsTechs <noreply@…>" */
    fromHeader: address ? `"${name}" <${address}>` : undefined
  };
}

function getSmtpAuth() {
  return {
    user: (process.env.EMAIL_USER || '').trim(),
    pass: process.env.EMAIL_PASS || '',
    host: process.env.EMAIL_HOST || 'smtp.gmail.com',
    port: parseInt(process.env.EMAIL_PORT || '587', 10),
    secure: process.env.EMAIL_SECURE === 'true'
  };
}

module.exports = { getEmailFrom, getSmtpAuth };
