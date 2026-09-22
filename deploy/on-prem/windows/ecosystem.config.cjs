/**
 * PM2 ecosystem — Bisonstechs backend (Windows on-prem).
 *
 * Reads PORT, HOST, DATABASE_URL, JWT_SECRET, etc. from the backend root `.env`
 * (loaded by dotenv in server.js). Do not put secrets in this file.
 *
 * Usage (from backend root, after `npm ci` and `.env` is configured):
 *   pm2 start deploy/on-prem/windows/ecosystem.config.cjs
 */
const path = require('path');

const backendRoot = path.resolve(__dirname, '../../..');
const logsDir = path.join(__dirname, 'logs');

module.exports = {
  apps: [
    {
      name: 'bisonstechs-backend',
      script: path.join(backendRoot, 'server.js'),
      cwd: backendRoot,
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      watch: false,
      max_restarts: 50,
      min_uptime: '10s',
      restart_delay: 3000,
      max_memory_restart: '1500M',
      time: true,
      merge_logs: true,
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      out_file: path.join(logsDir, 'out.log'),
      error_file: path.join(logsDir, 'error.log'),
      env: {
        NODE_ENV: 'production',
      },
    },
  ],
};
