const axios = require('axios');
const { getEmailFrom } = require('./emailConfig');
const { getTransporter } = require('./emailTransporter');

function getEmailProvider() {
  const explicit = (process.env.EMAIL_PROVIDER || '').trim().toLowerCase();
  if (explicit === 'resend' || explicit === 'smtp') return explicit;
  if ((process.env.RESEND_API_KEY || '').trim()) return 'resend';
  return 'smtp';
}

function isEmailConfigured() {
  const provider = getEmailProvider();
  if (provider === 'resend') {
    return Boolean((process.env.RESEND_API_KEY || '').trim());
  }
  const user = (process.env.EMAIL_USER || '').trim();
  const pass = process.env.EMAIL_PASS || '';
  return Boolean(user && pass);
}

function formatResendFrom(fromValue) {
  if (!fromValue) {
    const identity = getEmailFrom();
    return identity.fromHeader || identity.address;
  }
  return fromValue;
}

async function sendViaResend(mailOptions) {
  const apiKey = (process.env.RESEND_API_KEY || '').trim();
  if (!apiKey) {
    throw new Error('RESEND_API_KEY not configured');
  }

  const payload = {
    from: formatResendFrom(mailOptions.from),
    to: Array.isArray(mailOptions.to) ? mailOptions.to : [mailOptions.to],
    subject: mailOptions.subject
  };

  if (mailOptions.html) payload.html = mailOptions.html;
  if (mailOptions.text) payload.text = mailOptions.text;
  if (mailOptions.replyTo) payload.reply_to = mailOptions.replyTo;

  if (mailOptions.attachments?.length) {
    payload.attachments = mailOptions.attachments.map((attachment) => ({
      filename: attachment.filename,
      content: Buffer.isBuffer(attachment.content)
        ? attachment.content.toString('base64')
        : attachment.content
    }));
  }

  const { data } = await axios.post('https://api.resend.com/emails', payload, {
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    timeout: 30_000
  });

  return {
    messageId: data.id,
    accepted: payload.to,
    rejected: []
  };
}

async function sendMail(mailOptions) {
  const provider = getEmailProvider();
  if (provider === 'resend') {
    return sendViaResend(mailOptions);
  }

  const transporter = await getTransporter();
  if (!transporter) {
    throw new Error('Email service not configured properly');
  }
  return transporter.sendMail(mailOptions);
}

async function verifyMailTransport() {
  const provider = getEmailProvider();
  console.log(`📧 [Email] Provider: ${provider}`);

  if (provider === 'resend') {
    if (!(process.env.RESEND_API_KEY || '').trim()) {
      console.error('❌ RESEND_API_KEY not configured');
      return false;
    }
    const from = getEmailFrom();
    console.log('✅ Resend API ready (HTTPS — works on Railway Hobby/Free)');
    console.log(`📧 From identity: ${from.fromHeader || from.address}`);
    return true;
  }

  try {
    const transporter = await getTransporter();
    await transporter.verify();
    const from = getEmailFrom();
    console.log('✅ SMTP connection verified');
    console.log(`📧 From identity: ${from.fromHeader || from.address}`);
    return true;
  } catch (error) {
    console.error('❌ SMTP connection error:', error.message || error);
    console.warn(
      '💡 Railway Free/Hobby blocks SMTP (port 587). Set RESEND_API_KEY and redeploy.'
    );
    return false;
  }
}

module.exports = {
  sendMail,
  verifyMailTransport,
  getEmailProvider,
  isEmailConfigured
};
