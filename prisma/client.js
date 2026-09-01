// prisma/client.js — singleton (safe for Vercel serverless + Neon)
const { PrismaClient } = require('@prisma/client');
const { getPrismaHealth } = require('../utils/prismaHealth');
const { resolveDatabaseUrl } = require('../utils/databaseUrl');
const { patchPrismaTransactions } = require('../utils/withTransaction');

const globalForPrisma = globalThis;

function userModelHasAssignedTerminal(client) {
  try {
    const fields = client?.user?.fields;
    return Boolean(fields && Object.prototype.hasOwnProperty.call(fields, 'assignedTerminalId'));
  } catch {
    return false;
  }
}

function companyModelHasPosMode(client) {
  try {
    const fields = client?.company?.fields;
    return Boolean(fields && Object.prototype.hasOwnProperty.call(fields, 'posMode'));
  } catch {
    return false;
  }
}

function companyModelHasPosModeConfigured(client) {
  try {
    const fields = client?.company?.fields;
    return Boolean(fields && Object.prototype.hasOwnProperty.call(fields, 'posModeConfigured'));
  } catch {
    return false;
  }
}

function clientSchemaIsCurrent(client) {
  return (
    userModelHasAssignedTerminal(client) &&
    companyModelHasPosMode(client) &&
    companyModelHasPosModeConfigured(client)
  );
}

function createClient() {
  const url = resolveDatabaseUrl();

  const client = new PrismaClient({
    datasources: url
      ? {
          db: { url }
        }
      : undefined,
    log:
      process.env.NODE_ENV === 'development'
        ? ['error', 'warn']
        : ['error']
  });

  // Every $transaction call site gets longer timeouts + transient retries
  patchPrismaTransactions(client);
  return client;
}

let prisma = globalForPrisma.__accountPrisma;
if (prisma && !clientSchemaIsCurrent(prisma)) {
  console.warn('[Prisma] Cached client out of date — recreating after prisma generate');
  try {
    prisma.$disconnect().catch(() => {});
  } catch {
    /* ignore */
  }
  delete globalForPrisma.__accountPrisma;
  prisma = null;
}

if (!prisma) {
  prisma = createClient();
  globalForPrisma.__accountPrisma = prisma;
}

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
