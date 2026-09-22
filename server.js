require('dotenv').config();

const dns = require('dns');
if (typeof dns.setDefaultResultOrder === 'function') {
  dns.setDefaultResultOrder('ipv4first');
}

const app = require('./app');
const connectDB = require('./config/db');
const { verifyMailTransport } = require('./utils/mailTransport');

connectDB();
void verifyMailTransport();

const PORT = process.env.PORT || 5000;
const HOST = process.env.HOST || '0.0.0.0';

app.listen(PORT, HOST, () => {
  console.log(`🚀 Server running on http://${HOST}:${PORT}`);
});