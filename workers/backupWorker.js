'use strict';

/**
 * Dedicated backup worker for Railway (or local).
 *
 * Deploy as a separate Railway service with start command:
 *   node workers/backupWorker.js
 *
 * Shares the same env vars as the API (DATABASE_URL, DIRECT_URL, R2_*, etc.).
 * Do NOT rely on in-memory timers inside the HTTP process for scheduled backups —
 * use Railway Cron to hit POST /api/admin/backups/run-scheduled with X-Cron-Secret.
 */

require('dotenv').config();

const { pollOnce, expireOldBackups } = require('../services/backup/backupJobProcessor');

const POLL_MS = Number(process.env.BACKUP_WORKER_POLL_MS || 5000);
const EXPIRE_EVERY = Number(process.env.BACKUP_EXPIRE_EVERY_N_POLLS || 60);

let ticks = 0;
let stopping = false;

async function tick() {
  if (stopping) return;
  try {
    await pollOnce(1);
    ticks += 1;
    if (ticks % EXPIRE_EVERY === 0) {
      await expireOldBackups();
    }
  } catch (err) {
    console.error('[backupWorker] tick error', err);
  }
}

console.log(`[backupWorker] starting (poll=${POLL_MS}ms)`);
const timer = setInterval(tick, POLL_MS);
tick();

function shutdown(signal) {
  console.log(`[backupWorker] ${signal} received, shutting down`);
  stopping = true;
  clearInterval(timer);
  setTimeout(() => process.exit(0), 500);
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
