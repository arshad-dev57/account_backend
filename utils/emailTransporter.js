/**
 * Email Transporter Singleton
 * Creates a single reusable transporter instance for all emails
 * Prevents creating new connections on every email send
 */
const nodemailer = require('nodemailer');

let transporter = null;

const getTransporter = () => {
  if (transporter) {
    return transporter;
  }

  transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
      user: process.env.EMAIL_USER,
      pass: process.env.EMAIL_PASS,
    },
    pool: true,
    maxConnections: 5,
    maxMessages: 100,
  });

  return transporter;
};

const verifyTransporter = async () => {
  try {
    const trans = getTransporter();
    await trans.verify();
    console.log('✅ Email transporter verified and ready');
  } catch (error) {
    console.error('❌ Email transporter verification failed:', error);
  }
};

module.exports = { getTransporter, verifyTransporter };