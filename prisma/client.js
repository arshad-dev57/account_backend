// prisma/client.js — singleton (safe for Vercel serverless)
const { PrismaClient } = require('@prisma/client');

const globalForPrisma = globalThis;

const prisma =
  globalForPrisma.__accountPrisma ||
  new PrismaClient({
    log:
      process.env.NODE_ENV === 'development'
        ? ['error', 'warn']
        : ['error'],
  });

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.__accountPrisma = prisma;
} else {
  // Keep one client across warm serverless invocations
  globalForPrisma.__accountPrisma = prisma;
}

module.exports = prisma;
