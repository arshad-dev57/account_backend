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

function restaurantLineHasKitchenStation(client) {
  try {
    const fields = client?.restaurantOrderLine?.fields;
    return Boolean(fields && Object.prototype.hasOwnProperty.call(fields, 'kitchenStationId'));
  } catch {
    return false;
  }
}

function hasHrModels(client) {
  return Boolean(
    client?.hrOffice &&
      client?.hrEmployee &&
      client?.hrAttendance &&
      client?.hrLeave
  );
}

function clientSchemaIsCurrent(client) {
  return (
    userModelHasAssignedTerminal(client) &&
    companyModelHasPosMode(client) &&
    companyModelHasPosModeConfigured(client) &&
    restaurantLineHasKitchenStation(client) &&
    hasHrModels(client)
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
    log: [
      {
        emit: 'event',
        level: 'error',
      },
      ...(process.env.NODE_ENV === 'development' ? [{ emit: 'event', level: 'warn' }] : []),
    ],
  });

  // Suppress noisy "connection closed" events from Railway idle timeout —
  // these are not application errors; Prisma reconnects automatically.
  client.$on('error', (e) => {
    const msg = e?.message ?? '';
    if (msg.includes('Error { kind: Closed') || msg.includes('kind: Closed')) return;
    console.error('[Prisma error]', msg);
  });
  if (process.env.NODE_ENV === 'development') {
    client.$on('warn', (e) => console.warn('[Prisma warn]', e?.message ?? e));
  }

  // Every $transaction call site gets longer timeouts + transient retries
  patchPrismaTransactions(client);
  patchTransientDbRetries(client);
  return client;
}

function patchTransientDbRetries(client) {
  if (typeof client.$use !== 'function') return;
  client.$use(async (params, next) => {
    let lastError;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        return await next(params);
      } catch (error) {
        lastError = error;
        const code = error && error.code;
        if (code !== 'P1001' && code !== 'P2024') throw error;
        if (attempt >= 2) throw error;
        const waitMs = 1500 * (attempt + 1);
        console.warn(
          `[Prisma] ${code} retry ${attempt + 1}/2 in ${waitMs}ms (${params.model}.${params.action})`
        );
        await new Promise((resolve) => setTimeout(resolve, waitMs));
      }
    }
    throw lastError;
  });
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
