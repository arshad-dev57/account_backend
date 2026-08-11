// utils/prismaHealth.js
// Detect stale Prisma Client on Vercel (cached node_modules missing models).

const REQUIRED_MODELS = [
  'user',
  'userPermission',
  'pdfReportSetting',
  'company',
  'chartOfAccount',
  'bankAccount',
  'journalEntry',
  'journalLine',
  'fiscalYear',
  'creditNote',
  'notification',
  'supportTicket',
];

function getPrismaHealth(prisma) {
  const present = [];
  const missing = [];

  for (const name of REQUIRED_MODELS) {
    const delegate = prisma?.[name];
    if (delegate && typeof delegate.findMany === 'function') {
      present.push(name);
    } else if (delegate && typeof delegate.findUnique === 'function') {
      // Some models may only expose findUnique in edge cases — still OK
      present.push(name);
    } else {
      missing.push(name);
    }
  }

  return {
    ok: missing.length === 0,
    present,
    missing,
    hint:
      missing.length > 0
        ? 'Stale Prisma Client on deploy. Redeploy Vercel with "Clear cache", ensure postinstall runs prisma generate.'
        : null,
  };
}

function assertPrismaModels(prisma, modelNames = REQUIRED_MODELS) {
  const health = getPrismaHealth(prisma);
  const needed = modelNames.filter((m) => health.missing.includes(m));
  if (needed.length > 0) {
    const err = new Error(
      `Prisma models missing: ${needed.join(', ')}. ${health.hint}`
    );
    err.code = 'PRISMA_CLIENT_STALE';
    err.statusCode = 503;
    throw err;
  }
}

module.exports = {
  REQUIRED_MODELS,
  getPrismaHealth,
  assertPrismaModels,
};
