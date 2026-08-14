// Single source of truth for Accounts Receivable (default COA code 1100).
// Never use 1200 — that is Inventory in the seeded chart.

const prisma = require('../prisma/client');

const DEFAULT_AR_CODE = '1100';
const LEGACY_AR_CODES = ['1110'];

function db(client) {
  return client || prisma;
}

function isInventory(account) {
  if (!account) return true;
  if (String(account.code) === '1200') return true;
  return /^inventory$/i.test(String(account.name || '').trim());
}

function preferArAccount(accounts = []) {
  const usable = accounts.filter((a) => a && a.isActive !== false && !isInventory(a));
  if (!usable.length) return null;
  const byCode = (code) => usable.find((a) => String(a.code) === code);
  return (
    byCode(DEFAULT_AR_CODE) ||
    byCode('1110') ||
    usable.find((a) => /accounts\s*receivable/i.test(a.name || '')) ||
    usable[0]
  );
}

async function findArAccount(companyId, client) {
  if (!companyId) return null;
  const rows = await db(client).chartOfAccount.findMany({
    where: {
      companyId,
      isActive: true,
      OR: [
        { code: DEFAULT_AR_CODE },
        { code: { in: LEGACY_AR_CODES } },
        { name: { contains: 'Accounts Receivable', mode: 'insensitive' } },
      ],
    },
    orderBy: { code: 'asc' },
  });
  return preferArAccount(rows);
}

async function getOrCreateArAccount(userId, companyId, client) {
  if (!companyId) {
    throw new Error('companyId is required to resolve Accounts Receivable');
  }

  const existing = await findArAccount(companyId, client);
  if (existing) return existing;

  try {
    return await db(client).chartOfAccount.create({
      data: {
        code: DEFAULT_AR_CODE,
        name: 'Accounts Receivable',
        type: 'Asset',
        parentAccount: 'Current Assets',
        openingBalance: 0,
        currentBalance: 0,
        description: 'Amount due from customers',
        taxCode: 'N/A',
        balanceType: 'Debit',
        isActive: true,
        createdBy: userId || 'SYSTEM',
        companyId,
      },
    });
  } catch (err) {
    if (err.code === 'P2002') {
      const again = await findArAccount(companyId, client);
      if (again) return again;
    }
    throw err;
  }
}

const DEFAULT_REVENUE_CODE = '4001';

async function getOrCreateSalesRevenueAccount(userId, companyId, client) {
  if (!companyId) {
    throw new Error('companyId is required to resolve Sales Revenue');
  }

  const rows = await db(client).chartOfAccount.findMany({
    where: {
      companyId,
      isActive: true,
      OR: [
        { code: DEFAULT_REVENUE_CODE },
        { code: '4000' },
        { name: { contains: 'Sales Revenue', mode: 'insensitive' } },
      ],
    },
    orderBy: { code: 'asc' },
  });

  const byCode = (code) => rows.find((a) => String(a.code) === code);
  const existing =
    byCode(DEFAULT_REVENUE_CODE) ||
    rows.find((a) => /sales\s*revenue/i.test(a.name || '')) ||
    byCode('4000') ||
    null;

  if (existing) return existing;

  try {
    return await db(client).chartOfAccount.create({
      data: {
        code: DEFAULT_REVENUE_CODE,
        name: 'Sales Revenue',
        type: 'Revenue',
        parentAccount: 'Revenue',
        openingBalance: 0,
        currentBalance: 0,
        description: 'Revenue from sales',
        taxCode: 'N/A',
        balanceType: 'Credit',
        isActive: true,
        createdBy: userId || 'SYSTEM',
        companyId,
      },
    });
  } catch (err) {
    if (err.code === 'P2002') {
      const again = await db(client).chartOfAccount.findFirst({
        where: { companyId, code: DEFAULT_REVENUE_CODE },
      });
      if (again) return again;
    }
    throw err;
  }
}

module.exports = {
  DEFAULT_AR_CODE,
  DEFAULT_REVENUE_CODE,
  findArAccount,
  getOrCreateArAccount,
  getOrCreateSalesRevenueAccount,
};
