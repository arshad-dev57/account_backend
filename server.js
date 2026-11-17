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
const PORT = Number(process.env.PORT) || 5000;
const isCloud =
  Boolean(process.env.RAILWAY_ENVIRONMENT) ||
  Boolean(process.env.RAILWAY_PROJECT_ID) ||
  Boolean(process.env.RAILWAY_SERVICE_ID) ||
  process.env.NODE_ENV === 'production';

const isRailway =
  Boolean(process.env.RAILWAY_ENVIRONMENT) ||
  Boolean(process.env.RAILWAY_PROJECT_ID) ||
  Boolean(process.env.RAILWAY_SERVICE_ID);

const HOST = isCloud ? '0.0.0.0' : (process.env.HOST || '0.0.0.0');

console.log(
  `[boot] node=${process.version} PORT=${PORT} HOST=${HOST} cloud=${isCloud}`
);

/**
 * Apply pending Prisma migrations at boot on Railway. The pre-deploy step in
 * railway.json can be skipped when dashboard settings override config-as-code,
 * which leaves the live DB behind the schema (e.g. missing companies.is_sandbox).
 * Fail-open: a migration problem logs loudly but never blocks the HTTP server.
 */
function runPendingMigrations() {
  if (!isRailway) return Promise.resolve();
  if (
    process.env.RUN_MIGRATE_ON_BOOT === '0' ||
    process.env.RUN_MIGRATE_ON_BOOT === 'false'
  ) {
    return Promise.resolve();
  }
  const { execFile } = require('child_process');
  return new Promise((resolve) => {
    execFile(
      'npx',
      ['prisma', 'migrate', 'deploy', '--schema', 'prisma/schema.prisma'],
      { timeout: 180000, maxBuffer: 1024 * 1024 },
      (err, stdout, stderr) => {
        if (err) {
          console.error(
            '[boot] prisma migrate deploy FAILED — starting server anyway:',
            (stderr || err.message || '').slice(0, 2000)
          );
        } else {
          console.log(
            '[boot] prisma migrate deploy OK:',
            (stdout || '').trim().slice(0, 2000)
          );
        }
        resolve();
      }
    );
  });
}

let app;
try {
  app = require('./app');
} catch (err) {
  console.error('[boot] failed to load app:', err);
  process.exit(1);
}

runPendingMigrations().then(() => {
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
});
