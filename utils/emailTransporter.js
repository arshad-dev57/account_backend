const nodemailer = require('nodemailer');
const { buildSmtpTransportOptions, getEmailFrom } = require('./emailConfig');

let transporterPromise = null;

const getTransporter = async () => {
  if (!transporterPromise) {
    transporterPromise = (async () => {
      const options = await buildSmtpTransportOptions({
        pool: true,
        maxConnections: 5,
        maxMessages: 100
      });
      return nodemailer.createTransport(options);
    })();
  }
  return transporterPromise;
};

const verifyTransporter = async () => {
  try {
    const trans = await getTransporter();
    await trans.verify();
    const from = getEmailFrom();
    console.log('✅ Email transporter verified and ready');
    console.log(`📧 From identity: ${from.fromHeader || from.address}`);
  } catch (error) {
    console.error('❌ Email transporter verification failed:', error);
  }
};

module.exports = { getTransporter, verifyTransporter };
