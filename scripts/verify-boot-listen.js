/**
 * Smoke-test that the HTTP server binds 0.0.0.0:$PORT and answers GET /
 * without waiting on database connectivity. Used to catch Railway 502
 * "connection dial timeout" regressions locally.
 */
const http = require('http');
const { spawn } = require('child_process');
const path = require('path');

const PORT = String(19098 + Math.floor(Math.random() * 200));
const root = path.join(__dirname, '..');
const child = spawn(process.execPath, ['server.js'], {
  cwd: root,
  env: {
    ...process.env,
    PORT,
    NODE_ENV: 'production',
    RAILWAY_ENVIRONMENT: 'production',
    // Keep boot independent of a live DB for this smoke check.
    DATABASE_URL:
      process.env.DATABASE_URL ||
      'postgresql://user:pass@127.0.0.1:5432/neondb?schema=public',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});

let stdout = '';
let stderr = '';
child.stdout.on('data', (chunk) => {
  stdout += chunk.toString();
  process.stdout.write(chunk);
});
child.stderr.on('data', (chunk) => {
  stderr += chunk.toString();
  process.stderr.write(chunk);
});

function shutdown(code) {
  if (!child.killed) child.kill('SIGTERM');
  setTimeout(() => {
    if (!child.killed) child.kill('SIGKILL');
    process.exit(code);
  }, 500).unref();
}

const deadline = setTimeout(() => {
  console.error('FAIL: timed out waiting for server listen');
  console.error('stdout:', stdout);
  console.error('stderr:', stderr);
  shutdown(1);
}, 20000);

function waitForListen() {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const tick = () => {
      if (/Server running on http:\/\/0\.0\.0\.0:/.test(stdout)) {
        resolve();
        return;
      }
      if (child.exitCode !== null) {
        reject(new Error(`server exited early with code ${child.exitCode}`));
        return;
      }
      if (Date.now() - started > 15000) {
        reject(new Error('listen log not seen'));
        return;
      }
      setTimeout(tick, 100);
    };
    tick();
  });
}

function getRoot() {
  return new Promise((resolve, reject) => {
    const req = http.get(
      { host: '127.0.0.1', port: Number(PORT), path: '/', timeout: 5000 },
      (res) => {
        let body = '';
        res.on('data', (c) => (body += c));
        res.on('end', () => resolve({ status: res.statusCode, body }));
      }
    );
    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('GET / timed out'));
    });
  });
}

(async () => {
  try {
    await waitForListen();
    const { status, body } = await getRoot();
    if (status !== 200 || !/API is running/i.test(body)) {
      throw new Error(`unexpected response ${status} ${body}`);
    }
    if (!/HOST=0\.0\.0\.0/.test(stdout) || !/cloud=true/.test(stdout)) {
      throw new Error('expected cloud boot to force HOST=0.0.0.0');
    }
    clearTimeout(deadline);
    console.log('PASS: bound 0.0.0.0 and answered GET / before relying on DB');
    shutdown(0);
  } catch (err) {
    clearTimeout(deadline);
    console.error('FAIL:', err.message);
    console.error('stdout:', stdout);
    console.error('stderr:', stderr);
    shutdown(1);
  }
})();
