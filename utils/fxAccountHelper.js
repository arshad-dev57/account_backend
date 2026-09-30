/**
 * Foreign Exchange Gain / Loss COA accounts (configurable, not hard-coded IDs).
 * Codes: 4201 FX Gain (Revenue), 7100 FX Loss (Expense)
 */

const prisma = require('../prisma/client');

const FX_GAIN_CODE = '4201';
const FX_LOSS_CODE = '7100';

function db(client) {
  return client || prisma;
}

async function resolveCreatedBy(userId, companyId, client) {
  if (userId) return userId;
  const anyUser = await db(client).user.findFirst({
    where: companyId ? { companyId } : undefined,
    select: { id: true },
  });
  if (!anyUser?.id) {
    throw new Error('A user id is required to create FX accounts');
  }
  return anyUser.id;
}

async function findByCodeOrName(companyId, code, namePattern, client) {
  if (!companyId) return null;
  const byCode = await db(client).chartOfAccount.findFirst({
    where: { companyId, code, isActive: true },
  });
  if (byCode) return byCode;

  return db(client).chartOfAccount.findFirst({
    where: {
      companyId,
      isActive: true,
      name: { contains: namePattern, mode: 'insensitive' },
    },
    orderBy: { code: 'asc' },
  });
}

async function getOrCreateFxGainAccount(userId, companyId, client) {
  if (!companyId) throw new Error('companyId is required for FX Gain account');

  const existing = await findByCodeOrName(
    companyId,
    FX_GAIN_CODE,
    'Foreign Exchange Gain',
    client
  );
  if (existing) return existing;

  const alt = await findByCodeOrName(companyId, FX_GAIN_CODE, 'Exchange Gain', client);
  if (alt) return alt;

  const createdBy = await resolveCreatedBy(userId, companyId, client);

  try {
    return await db(client).chartOfAccount.create({
      data: {
        code: FX_GAIN_CODE,
        name: 'Foreign Exchange Gain',
        type: 'Revenue',
        parentAccount: 'Revenue',
        openingBalance: 0,
        currentBalance: 0,
        description: 'Realized foreign exchange gains on settlement',
        taxCode: 'N/A',
        balanceType: 'Credit',
        isActive: true,
        createdBy,
        companyId,
      },
    });
  } catch (err) {
    if (err.code === 'P2002') {
      const again = await findByCodeOrName(companyId, FX_GAIN_CODE, 'Exchange Gain', client);
      if (again) return again;
    }
    throw err;
  }
}

async function getOrCreateFxLossAccount(userId, companyId, client) {
  if (!companyId) throw new Error('companyId is required for FX Loss account');

  const existing = await findByCodeOrName(
    companyId,
    FX_LOSS_CODE,
    'Foreign Exchange Loss',
    client
  );
  if (existing) return existing;

  const alt = await findByCodeOrName(companyId, FX_LOSS_CODE, 'Exchange Loss', client);
  if (alt) return alt;

  const createdBy = await resolveCreatedBy(userId, companyId, client);

  try {
    return await db(client).chartOfAccount.create({
      data: {
        code: FX_LOSS_CODE,
        name: 'Foreign Exchange Loss',
        type: 'Expense',
        parentAccount: 'Operating Expenses',
        openingBalance: 0,
        currentBalance: 0,
        description: 'Realized foreign exchange losses on settlement',
        taxCode: 'N/A',
        balanceType: 'Debit',
        isActive: true,
        createdBy,
        companyId,
      },
    });
  } catch (err) {
    if (err.code === 'P2002') {
      const again = await findByCodeOrName(companyId, FX_LOSS_CODE, 'Exchange Loss', client);
      if (again) return again;
    }
    throw err;
  }
}

async function ensureFxAccounts(userId, companyId, client) {
  const [gain, loss] = await Promise.all([
    getOrCreateFxGainAccount(userId, companyId, client),
    getOrCreateFxLossAccount(userId, companyId, client),
  ]);
  return { gain, loss };
}

module.exports = {
  FX_GAIN_CODE,
  FX_LOSS_CODE,
  getOrCreateFxGainAccount,
  getOrCreateFxLossAccount,
  ensureFxAccounts,
};
