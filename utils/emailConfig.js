/**
 * Central email "From" identity for OTP / transactional mail.
 *
 * Auth (SMTP login) uses EMAIL_USER + EMAIL_PASS.
 * Visible From address uses EMAIL_FROM (e.g. noreply@bisonstechs.com).
 *
 * Gmail note: EMAIL_FROM must be allowed as "Send mail as" on EMAIL_USER,
 * OR EMAIL_FROM must equal EMAIL_USER.
 */

const dns = require('dns');

/** Railway/cloud hosts often lack IPv6 — Gmail resolves to IPv6 first and fails with ENETUNREACH. */
function ipv4Lookup(hostname, options, callback) {
  if (typeof options === 'function') {
    callback = options;
    options = {};
  }
  dns.lookup(hostname, { ...options, family: 4 }, callback);
}

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

/** Shared nodemailer transport options (IPv4-only for cloud deploys). */
function buildSmtpTransportOptions(overrides = {}) {
  const smtp = getSmtpAuth();
  return {
    host: smtp.host,
    port: smtp.port,
    secure: smtp.secure,
    auth: {
      user: smtp.user,
      pass: smtp.pass
    },
    lookup: ipv4Lookup,
    connectionTimeout: 30_000,
    greetingTimeout: 30_000,
    socketTimeout: 60_000,
    ...overrides
  };
}

module.exports = { getEmailFrom, getSmtpAuth, buildSmtpTransportOptions };
