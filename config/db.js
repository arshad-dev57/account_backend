// Reuse the singleton Prisma client. A second PrismaClient here used to open
// another Neon pool and fight the real client for connections.
const prisma = require('../prisma/client');

const STARTUP_RETRY_DELAYS_MS = [0, 2000, 5000, 10000, 15000];

async function connectWithRetry() {
  let lastError;
  for (let attempt = 0; attempt < STARTUP_RETRY_DELAYS_MS.length; attempt += 1) {
    const waitMs = STARTUP_RETRY_DELAYS_MS[attempt];
    if (waitMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, waitMs));
    }
    try {
      await prisma.$connect();
      console.log(
        attempt > 0
          ? `PostgreSQL Connected ✅ (after ${attempt + 1} attempt(s))`
          : 'PostgreSQL Connected ✅'
      );
      return prisma;
    } catch (error) {
      lastError = error;
      const msg = String(error?.message || error);
      const transient =
        error?.code === 'P1001' ||
        /can't reach database server/i.test(msg) ||
        /connection/i.test(msg);
      if (!transient || attempt >= STARTUP_RETRY_DELAYS_MS.length - 1) {
        console.error('PostgreSQL connection error:', msg);
        throw error;
      }
      console.warn(
        `[PostgreSQL] Connect retry ${attempt + 1}/${STARTUP_RETRY_DELAYS_MS.length - 1} (Neon may be waking up)...`
      );
    }
  }
  throw lastError;
}

const connectDB = () => {
  void connectWithRetry().catch(() => {
    // Keep the API process alive; Prisma middleware will retry individual queries.
  });
  return prisma;
};

module.exports = connectDB;
