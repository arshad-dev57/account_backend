const nodemailer = require('nodemailer');
const { getSmtpAuth, getEmailFrom } = require('./emailConfig');

let transporter = null;

const getTransporter = () => {
  if (transporter) {
    return transporter;
  }

  const smtp = getSmtpAuth();
  transporter = nodemailer.createTransport({
    host: smtp.host,
    port: smtp.port,
    secure: smtp.secure,
    auth: {
      user: smtp.user,
      pass: smtp.pass,
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
    const from = getEmailFrom();
    console.log('✅ Email transporter verified and ready');
    console.log(`📧 From identity: ${from.fromHeader || from.address}`);
  } catch (error) {
    console.error('❌ Email transporter verification failed:', error);
  }
};

module.exports = { getTransporter, verifyTransporter };
