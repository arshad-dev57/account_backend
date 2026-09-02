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
const net = require('net');
const { promisify } = require('util');

const resolve4 = promisify(dns.resolve4);
const lookup4 = promisify((hostname, cb) =>
  dns.lookup(hostname, { family: 4 }, cb)
);

let cachedSmtpEndpoint = null;

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

/**
 * Nodemailer 8 uses dns.resolve6() and may pick IPv6 randomly.
 * Railway has no IPv6 outbound — resolve IPv4 once and connect by IP + TLS servername.
 */
async function resolveSmtpEndpoint() {
  if (cachedSmtpEndpoint) return cachedSmtpEndpoint;

  const smtp = getSmtpAuth();
  const hostname = smtp.host;

  if (net.isIP(hostname)) {
    cachedSmtpEndpoint = {
      host: hostname,
      servername: process.env.EMAIL_TLS_SERVERNAME || 'smtp.gmail.com'
    };
    return cachedSmtpEndpoint;
  }

  if (process.env.EMAIL_SMTP_IPV4) {
    cachedSmtpEndpoint = {
      host: process.env.EMAIL_SMTP_IPV4.trim(),
      servername: hostname
    };
    console.log(`📧 [SMTP] Using EMAIL_SMTP_IPV4=${cachedSmtpEndpoint.host} (TLS: ${hostname})`);
    return cachedSmtpEndpoint;
  }

  let ipv4;
  try {
    const addresses = await resolve4(hostname);
    ipv4 = addresses[0];
  } catch {
    const result = await lookup4(hostname);
    ipv4 = result.address;
  }

  cachedSmtpEndpoint = { host: ipv4, servername: hostname };
  console.log(`📧 [SMTP] Resolved ${hostname} → ${ipv4} (IPv4 only)`);
  return cachedSmtpEndpoint;
}

/** Shared nodemailer transport options (IPv4-only for cloud deploys). */
async function buildSmtpTransportOptions(overrides = {}) {
  const smtp = getSmtpAuth();
  const endpoint = await resolveSmtpEndpoint();

  return {
    host: endpoint.host,
    port: smtp.port,
    secure: smtp.secure,
    auth: {
      user: smtp.user,
      pass: smtp.pass
    },
    tls: {
      servername: endpoint.servername,
      minVersion: 'TLSv1.2'
    },
    connectionTimeout: 30_000,
    greetingTimeout: 30_000,
    socketTimeout: 60_000,
    ...overrides
  };
}

module.exports = {
  getEmailFrom,
  getSmtpAuth,
  resolveSmtpEndpoint,
  buildSmtpTransportOptions
};
