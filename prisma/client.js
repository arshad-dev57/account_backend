// prisma/client.js — singleton (safe for Vercel serverless)
const { PrismaClient } = require('@prisma/client');
const { getPrismaHealth } = require('../utils/prismaHealth');

const globalForPrisma = globalThis;

const prisma =
  globalForPrisma.__accountPrisma ||
  new PrismaClient({
    log:
      process.env.NODE_ENV === 'development'
        ? ['error', 'warn']
        : ['error'],
  });

globalForPrisma.__accountPrisma = prisma;

// Fail loud in logs if Vercel shipped a stale generated client
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
