const nodemailer = require('nodemailer');
const { buildSmtpTransportOptions, getEmailFrom } = require('./emailConfig');

let transporter = null;

const getTransporter = () => {
  if (transporter) {
    return transporter;
  }

  transporter = nodemailer.createTransport(
    buildSmtpTransportOptions({
      pool: true,
      maxConnections: 5,
      maxMessages: 100
    })
  );

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
