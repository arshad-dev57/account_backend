// Single source of truth for Accounts Payable (canonical code 2010).
// Default COA used to seed 2001 with the same name; bill/payment helpers
// then created 2010 — that left two AP accounts. Always reuse one.

const prisma = require('../prisma/client');

const DEFAULT_AP_CODE = '2010';
const LEGACY_AP_CODES = ['2001', '2000'];

function db(client) {
  return client || prisma;
}

function isTaxesPayable(account) {
  if (!account) return true;
  if (String(account.code) === '2100') return true;
  return /tax(es)?\s*payable/i.test(String(account.name || '').trim());
}

function preferApAccount(accounts = []) {
  const usable = accounts.filter((a) => a && a.isActive !== false && !isTaxesPayable(a));
  if (!usable.length) return null;
  const byCode = (code) => usable.find((a) => String(a.code) === code);
  return (
    byCode(DEFAULT_AP_CODE) ||
    byCode('2001') ||
    byCode('2000') ||
    usable.find((a) => /accounts\s*payable/i.test(a.name || '')) ||
    usable.find((a) => /trade\s*payables|creditors/i.test(a.name || '')) ||
    usable[0]
  );
}

async function findApCandidates(companyId, client, { includeInactive = false } = {}) {
  if (!companyId) return [];
  return db(client).chartOfAccount.findMany({
    where: {
      companyId,
      ...(includeInactive ? {} : { isActive: true }),
      OR: [
        { code: DEFAULT_AP_CODE },
        { code: { in: LEGACY_AP_CODES } },
        { name: { contains: 'Accounts Payable', mode: 'insensitive' } },
        { name: { contains: 'Trade Payables', mode: 'insensitive' } },
        { name: { contains: 'Creditors', mode: 'insensitive' } },
      ],
    },
    orderBy: { code: 'asc' },
  });
}

async function findApAccount(companyId, client) {
  const rows = await findApCandidates(companyId, client);
  return preferApAccount(rows);
}

async function hideUnusedDuplicateApAccounts(companyId, client) {
  if (!companyId) return;
  const rows = await findApCandidates(companyId, client);
  const canonical = preferApAccount(rows);
  if (!canonical) return;

  for (const account of rows) {
    if (account.id === canonical.id) continue;
    if (!/accounts\s*payable/i.test(account.name || '')) continue;

    const [lineCount] = await Promise.all([
      db(client).journalLine.count({ where: { accountId: account.id } }),
    ]);
    const unused =
      lineCount === 0 && Math.abs(Number(account.currentBalance) || 0) < 0.005;

    if (!unused) continue;

    await db(client).chartOfAccount.update({
      where: { id: account.id },
      data: {
        isActive: false,
        name: account.name.includes('(unused)')
          ? account.name
          : `${account.name} (unused)`,
      },
    });
  }
}

async function getOrCreateApAccount(userId, companyId, client) {
  if (!companyId) {
    throw new Error('companyId is required to resolve Accounts Payable');
  }

  await hideUnusedDuplicateApAccounts(companyId, client);

  const existing = await findApAccount(companyId, client);
  if (existing) return existing;

  try {
    return await db(client).chartOfAccount.create({
      data: {
        code: DEFAULT_AP_CODE,
        name: 'Accounts Payable',
        type: 'Liability',
        parentAccount: 'Current Liabilities',
        openingBalance: 0,
        currentBalance: 0,
        description: 'Amount due to suppliers',
        taxCode: 'N/A',
        balanceType: 'Credit',
        isActive: true,
        createdBy: userId || 'SYSTEM',
        companyId,
      },
    });
  } catch (err) {
    if (err.code === 'P2002') {
      const again = await findApAccount(companyId, client);
      if (again) return again;
    }
    throw err;
  }
}

module.exports = {
  DEFAULT_AP_CODE,
  findApAccount,
  getOrCreateApAccount,
  hideUnusedDuplicateApAccounts,
};
