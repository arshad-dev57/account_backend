// prisma/client.js — singleton (safe for Vercel serverless + Neon)
const { PrismaClient } = require('@prisma/client');
const { getPrismaHealth } = require('../utils/prismaHealth');
const { resolveDatabaseUrl } = require('../utils/databaseUrl');
const { patchPrismaTransactions } = require('../utils/withTransaction');

const globalForPrisma = globalThis;

function createClient() {
  const url = resolveDatabaseUrl();

  const client = new PrismaClient({
    datasources: url
      ? {
          db: { url },
        }
      : undefined,
    log:
      process.env.NODE_ENV === 'development'
        ? ['error', 'warn']
        : ['error'],
  });

  // Every $transaction call site gets longer timeouts + transient retries
  patchPrismaTransactions(client);
  return client;
}

const prisma = globalForPrisma.__accountPrisma || createClient();
globalForPrisma.__accountPrisma = prisma;

try {
  const health = getPrismaHealth(prisma);
  if (!health.ok) {
    console.error(
      '❌ [Prisma] STALE CLIENT — missing models:',
      health.missing.join(', ')
    );
    console.error('❌ [Prisma]', health.hint);
  } else if (!globalForPrisma.__accountPrismaHealthLogged) {
    console.log('✅ [Prisma] Client OK — required models present');
    globalForPrisma.__accountPrismaHealthLogged = true;
  }
} catch (e) {
  console.error('❌ [Prisma] Health check failed:', e.message);
}

module.exports = prisma;
