// utils/cashAccountHelper.js
// Single source of truth for Cash in Hand (default COA code 1001).
// Prevents duplicate Cash accounts (1001 from seed + 1010 from modules).

const prisma = require('../prisma/client');

const DEFAULT_CASH_CODE = '1001';
const LEGACY_CASH_CODES = ['1010']; // old helpers — never 1100 (that is AR)

function db(client) {
  return client || prisma;
}

function preferCashAccount(accounts = []) {
  if (!accounts.length) return null;
  const byCode = (code) =>
    accounts.find((a) => String(a.code) === code && a.isActive !== false);
  return (
    byCode(DEFAULT_CASH_CODE) ||
    byCode('1010') ||
    accounts.find((a) => /cash in hand/i.test(a.name || '')) ||
    accounts.find((a) => /^cash$/i.test(String(a.name || '').trim())) ||
    accounts[0]
  );
}

/**
 * Find existing company cash account (never creates).
 * Prefers default seeded 1001 over legacy 1010/1100 duplicates.
 */
async function findCashAccount(companyId, client) {
  if (!companyId) return null;
  const rows = await db(client).chartOfAccount.findMany({
    where: {
      companyId,
      isActive: true,
      OR: [
        { code: DEFAULT_CASH_CODE },
        { code: { in: LEGACY_CASH_CODES } },
        { name: { equals: 'Cash in Hand', mode: 'insensitive' } },
        { name: { equals: 'Cash', mode: 'insensitive' } },
      ],
    },
    orderBy: { code: 'asc' },
  });
  return preferCashAccount(rows);
}

/**
 * Get or create the company's Cash in Hand account.
 * Always reuses 1001 / existing cash — never invents a second "Cash in Hand".
 *
 * @param {string} userId
 * @param {string} companyId
 * @param {object} [client] optional Prisma tx
 */
async function getOrCreateCashAccount(userId, companyId, client) {
  if (!companyId) {
    throw new Error('companyId is required to resolve Cash account');
  }

  const existing = await findCashAccount(companyId, client);
  if (existing) return existing;

  // Race-safe: unique (companyId, code) may already exist
  try {
    return await db(client).chartOfAccount.create({
      data: {
        code: DEFAULT_CASH_CODE,
        name: 'Cash in Hand',
        type: 'Asset',
        parentAccount: 'Current Assets',
        openingBalance: 0,
        currentBalance: 0,
        description: 'Physical cash on hand',
        taxCode: 'N/A',
        balanceType: 'Debit',
        isActive: true,
        createdBy: userId || 'SYSTEM',
        companyId,
      },
    });
  } catch (err) {
    if (err.code === 'P2002') {
      const again = await findCashAccount(companyId, client);
      if (again) return again;
    }
    throw err;
  }
}

const CASH_LEDGER_ACCOUNT_NUMBER = 'CASH-IN-HAND';

/**
 * Ensure a BankAccount ledger row for Cash in Hand so it appears on
 * Cash & Bank Ledgers. Linked to COA 1001; balance mirrors COA.
 */
async function ensureCashBankAccount(userId, companyId, client) {
  if (!companyId) {
    throw new Error('companyId is required to resolve Cash ledger');
  }

  const prismaClient = db(client);
  const cashCoa = await getOrCreateCashAccount(userId, companyId, client);

  // Prefer existing row linked to this COA, then by reserved account number
  let cashLedger = await prismaClient.bankAccount.findFirst({
    where: {
      companyId,
      OR: [
        { chartOfAccountId: cashCoa.id },
        { accountNumber: CASH_LEDGER_ACCOUNT_NUMBER },
        {
          AND: [
            { bankName: { equals: 'Cash', mode: 'insensitive' } },
            {
              OR: [
                { accountName: { contains: 'Cash in Hand', mode: 'insensitive' } },
                { accountName: { equals: 'Cash', mode: 'insensitive' } },
              ],
            },
          ],
        },
      ],
    },
    include: { chartOfAccount: true },
  });

  if (cashLedger) {
    // Keep COA link + displayed balance in sync
    const coaBalance = Number(cashCoa.currentBalance || 0);
    const needsPatch =
      cashLedger.chartOfAccountId !== cashCoa.id ||
      Number(cashLedger.currentBalance || 0) !== coaBalance ||
      cashLedger.status !== 'Active';

    if (needsPatch) {
      cashLedger = await prismaClient.bankAccount.update({
        where: { id: cashLedger.id },
        data: {
          chartOfAccountId: cashCoa.id,
          currentBalance: coaBalance,
          accountCode: cashCoa.code || DEFAULT_CASH_CODE,
          status: 'Active',
          accountName: cashLedger.accountName || 'Cash in Hand',
          bankName: cashLedger.bankName || 'Cash',
        },
        include: { chartOfAccount: true },
      });
    }
    return cashLedger;
  }

  try {
    return await prismaClient.bankAccount.create({
      data: {
        accountName: 'Cash in Hand',
        accountNumber: CASH_LEDGER_ACCOUNT_NUMBER,
        bankName: 'Cash',
        branchCode: '',
        accountCode: cashCoa.code || DEFAULT_CASH_CODE,
        accountType: 'Cash',
        currency: 'PKR',
        openingBalance: Number(cashCoa.openingBalance || 0),
        currentBalance: Number(cashCoa.currentBalance || 0),
        status: 'Active',
        chartOfAccountId: cashCoa.id,
        createdBy: userId || 'SYSTEM',
        companyId,
      },
      include: { chartOfAccount: true },
    });
  } catch (err) {
    if (err.code === 'P2002') {
      const again = await prismaClient.bankAccount.findFirst({
        where: {
          companyId,
          OR: [
            { chartOfAccountId: cashCoa.id },
            { accountNumber: CASH_LEDGER_ACCOUNT_NUMBER },
          ],
        },
        include: { chartOfAccount: true },
      });
      if (again) return again;
    }
    throw err;
  }
}

module.exports = {
  DEFAULT_CASH_CODE,
  CASH_LEDGER_ACCOUNT_NUMBER,
  findCashAccount,
  getOrCreateCashAccount,
  ensureCashBankAccount,
};
