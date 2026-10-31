require('dotenv').config();

const dns = require('dns');
if (typeof dns.setDefaultResultOrder === 'function') {
  dns.setDefaultResultOrder('ipv4first');
}

process.on('uncaughtException', (err) => {
  console.error('[boot] uncaughtException:', err);
  process.exit(1);
});
process.on('unhandledRejection', (reason) => {
  console.error('[boot] unhandledRejection:', reason);
});

// Railway injects PORT. Never hardcode a public target port in code.
const PORT = Number(process.env.PORT) || 5000;

// Railway's edge proxy dials the container on all interfaces.
// Binding to localhost / a hostname makes the proxy time out (502 dial timeout).
// Always use 0.0.0.0 in cloud; allow HOST only for local/on-prem LAN binds.
const isCloud =
  Boolean(process.env.RAILWAY_ENVIRONMENT) ||
  Boolean(process.env.RAILWAY_PROJECT_ID) ||
  Boolean(process.env.RAILWAY_SERVICE_ID) ||
  process.env.NODE_ENV === 'production';

const HOST = isCloud ? '0.0.0.0' : (process.env.HOST || '0.0.0.0');

console.log(
  `[boot] node=${process.version} PORT=${PORT} HOST=${HOST} cloud=${isCloud}`
);

let app;
try {
  app = require('./app');
} catch (err) {
  console.error('[boot] failed to load app:', err);
  process.exit(1);
}

// Bring up HTTP first so Railway health/proxy can connect even if Neon is cold
// or mail verification is slow/blocked.
const server = app.listen(PORT, HOST, () => {
  const addr = server.address();
  console.log(
    `🚀 Server running on http://${HOST}:${PORT}` +
      (addr && typeof addr === 'object' ? ` (bound ${addr.address}:${addr.port})` : '')
  );

  try {
    const connectDB = require('./config/db');
    connectDB();
  } catch (err) {
    console.error('[boot] connectDB failed to start:', err);
  }

  try {
    const { verifyMailTransport } = require('./utils/mailTransport');
    void verifyMailTransport();
  } catch (err) {
    console.error('[boot] verifyMailTransport failed to start:', err);
  }
});

server.on('error', (err) => {
  console.error('[boot] listen error:', err);
  process.exit(1);
});
