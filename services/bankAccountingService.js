/**
 * services/bankAccountingService.js
 *
 * Single source of truth for bank-related double-entry posting:
 *  - Opening Balance  (Dr Bank / Cr Opening Balance Equity)
 *  - Deposit / Add Money (Dr Bank / Cr selected source COA)
 *  - Bank-to-Bank Transfer (Dr Destination / Cr Source)
 *
 * Reuses the same balance-change rules as journalEntryController.
 * JournalEntry + JournalLine remain the GL source of truth.
 */

const prisma = require('../prisma/client');
const { fiscalYearGuard } = require('../middleware/fiscalYearMiddleware');
const { resolveFiscalYearId } = require('../utils/fiscalYearHelper');

const DEBIT_INCREASE_TYPES = ['Asset', 'Expense'];

function toNum(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function calculateBalanceChange(accountType, debit, credit) {
  const d = toNum(debit);
  const c = toNum(credit);
  if (d > 0) {
    return DEBIT_INCREASE_TYPES.includes(accountType) ? d : -d;
  }
  if (c > 0) {
    return DEBIT_INCREASE_TYPES.includes(accountType) ? -c : c;
  }
  return 0;
}

async function generateEntryNumber(tx = prisma) {
  const count = await tx.journalEntry.count();
  const year = new Date().getFullYear();
  return `JE-${year}-${String(count + 1).padStart(4, '0')}`;
}

async function assertFiscalYearOpen(userId, postingDate, existingDate) {
  await fiscalYearGuard(userId, postingDate, existingDate);
}

async function resolveFyId(userId, companyId, postingDate) {
  try {
    const date = new Date(postingDate);
    if (companyId) {
      const fy = await prisma.fiscalYear.findFirst({
        where: {
          companyId,
          startDate: { lte: date },
          endDate: { gte: date },
        },
      });
      if (fy) return fy.id;
    }
  } catch (_) {
    /* fall through */
  }
  return resolveFiscalYearId(userId, postingDate);
}

function openingBalanceReference(bankAccountId) {
  return `OB-BANK-${bankAccountId}`;
}

function depositReference(bankAccountId, clientRef) {
  if (clientRef && String(clientRef).trim()) {
    return String(clientRef).trim();
  }
  return `DEP-${bankAccountId}-${Date.now()}`;
}

function transferReference(fromId, toId, clientRef) {
  if (clientRef && String(clientRef).trim()) {
    return String(clientRef).trim();
  }
  return `XFER-${fromId.slice(0, 8)}-${toId.slice(0, 8)}-${Date.now()}`;
}

async function getOrCreateOpeningBalanceEquity(userId, companyId, tx = prisma) {
  let equity = await tx.chartOfAccount.findFirst({
    where: {
      companyId,
      OR: [{ code: '3010' }, { name: 'Opening Balance Equity' }],
      isActive: true,
    },
  });

  if (equity) return equity;

  const taken = await tx.chartOfAccount.findFirst({
    where: { companyId, code: '3010' },
  });
  let code = '3010';
  if (taken) {
    const maxCode = await tx.chartOfAccount.aggregate({
      where: { companyId },
      _max: { code: true },
    });
    const num = parseInt(maxCode._max.code, 10);
    code = Number.isFinite(num) ? String(num + 1) : `3010-${Date.now()}`;
  }

  equity = await tx.chartOfAccount.create({
    data: {
      code,
      name: 'Opening Balance Equity',
      type: 'Equity',
      parentAccount: 'Equity',
      openingBalance: 0,
      currentBalance: 0,
      description: 'Opening balance equity — offsets bank/asset opening balances',
      taxCode: 'N/A',
      balanceType: 'Credit',
      isActive: true,
      createdBy: userId,
      companyId,
    },
  });

  return equity;
}

async function applyLineBalanceChanges(tx, lines, companyId, invert = false) {
  for (const line of lines) {
    const account = await tx.chartOfAccount.findFirst({
      where: { id: line.accountId, companyId },
    });
    if (!account) {
      throw new Error(`Chart of account not found: ${line.accountId}`);
    }
    let change = calculateBalanceChange(account.type, line.debit, line.credit);
    if (invert) change = -change;
    if (change !== 0) {
      await tx.chartOfAccount.update({
        where: { id: account.id },
        data: { currentBalance: { increment: change } },
      });
    }
  }
}

async function syncBankBalancesFromCoa(tx, accountIds, companyId) {
  const unique = [...new Set(accountIds.filter(Boolean))];
  for (const accountId of unique) {
    const coa = await tx.chartOfAccount.findFirst({
      where: { id: accountId, companyId },
    });
    if (!coa) continue;
    await tx.bankAccount.updateMany({
      where: { chartOfAccountId: accountId, companyId },
      data: { currentBalance: coa.currentBalance },
    });
  }
}

async function findBankOwned(bankAccountId, companyId, tx = prisma) {
  const bank = await tx.bankAccount.findFirst({
    where: { id: bankAccountId, companyId },
    include: { chartOfAccount: true },
  });
  if (!bank) {
    const err = new Error('Bank account not found');
    err.statusCode = 404;
    throw err;
  }
  if (!bank.chartOfAccount) {
    const err = new Error('Bank account is not linked to a Chart of Account');
    err.statusCode = 400;
    throw err;
  }
  return bank;
}

async function findCoaOwned(accountId, companyId, tx = prisma) {
  const account = await tx.chartOfAccount.findFirst({
    where: { id: accountId, companyId, isActive: true },
  });
  if (!account) {
    const err = new Error('Chart of account not found or inactive');
    err.statusCode = 404;
    throw err;
  }
  return account;
}

/**
 * Post or update opening balance for a bank account.
 * balancesAlreadySet=true → JE only (no second COA increment) for repair/seeded creates.
 */
async function upsertBankOpeningBalance({
  userId,
  companyId,
  bankAccountId,
  amount,
  postingDate = new Date(),
  balancesAlreadySet = false,
}) {
  const amt = toNum(amount);
  if (amt < 0) {
    const err = new Error('Opening balance cannot be negative');
    err.statusCode = 400;
    throw err;
  }

  await assertFiscalYearOpen(userId, postingDate);
  const fiscalYearId = await resolveFyId(userId, companyId, postingDate);
  const reference = openingBalanceReference(bankAccountId);

  return prisma.$transaction(async (tx) => {
    const bank = await findBankOwned(bankAccountId, companyId, tx);
    const bankCoa = bank.chartOfAccount;
    const equity = await getOrCreateOpeningBalanceEquity(userId, companyId, tx);

    let existing = await tx.journalEntry.findFirst({
      where: { companyId, reference },
      include: { lines: true },
    });

    if (!existing) {
      const legacyLine = await tx.journalLine.findFirst({
        where: {
          accountId: bankCoa.id,
          journal: {
            companyId,
            description: { contains: 'Opening Balance', mode: 'insensitive' },
            status: 'Posted',
          },
        },
      });
      if (legacyLine) {
        existing = await tx.journalEntry.findFirst({
          where: { id: legacyLine.journalId },
          include: { lines: true },
        });
      }
    }

    if (existing && !balancesAlreadySet) {
      await applyLineBalanceChanges(tx, existing.lines, companyId, true);
    }

    if (amt === 0) {
      if (existing) {
        await tx.journalLine.deleteMany({ where: { journalId: existing.id } });
        await tx.journalEntry.delete({ where: { id: existing.id } });
      }
      await tx.chartOfAccount.update({
        where: { id: bankCoa.id },
        data: { openingBalance: 0 },
      });
      await tx.bankAccount.update({
        where: { id: bank.id },
        data: { openingBalance: 0 },
      });
      if (!balancesAlreadySet) {
        await syncBankBalancesFromCoa(tx, [bankCoa.id, equity.id], companyId);
      }
      return { journalEntry: null, amount: 0 };
    }

    const description = `Opening Balance - ${bank.accountName}`;
    const lines = [
      {
        accountId: bankCoa.id,
        accountName: bankCoa.name,
        accountCode: bankCoa.code,
        debit: amt,
        credit: 0,
        isReconciled: false,
      },
      {
        accountId: equity.id,
        accountName: equity.name,
        accountCode: equity.code,
        debit: 0,
        credit: amt,
        isReconciled: false,
      },
    ];

    let journalEntry;
    if (existing) {
      await tx.journalLine.deleteMany({ where: { journalId: existing.id } });
      journalEntry = await tx.journalEntry.update({
        where: { id: existing.id },
        data: {
          date: new Date(postingDate),
          description,
          reference,
          status: 'Posted',
          type: 'OpeningBalance',
          postedBy: userId,
          postedAt: new Date(),
          companyId,
          fiscalYearId,
          lines: { create: lines },
        },
        include: { lines: true },
      });
    } else {
      const entryNumber = await generateEntryNumber(tx);
      journalEntry = await tx.journalEntry.create({
        data: {
          entryNumber,
          date: new Date(postingDate),
          description,
          reference,
          status: 'Posted',
          type: 'OpeningBalance',
          createdBy: userId,
          postedBy: userId,
          postedAt: new Date(),
          companyId,
          fiscalYearId,
          lines: { create: lines },
        },
        include: { lines: true },
      });
    }

    await tx.chartOfAccount.update({
      where: { id: bankCoa.id },
      data: { openingBalance: amt },
    });
    await tx.bankAccount.update({
      where: { id: bank.id },
      data: { openingBalance: amt },
    });

    if (!balancesAlreadySet) {
      await applyLineBalanceChanges(tx, lines, companyId, false);
      await syncBankBalancesFromCoa(tx, [bankCoa.id, equity.id], companyId);
    } else {
      const equityLines = await tx.journalLine.findMany({
        where: {
          accountId: equity.id,
          journal: { companyId, status: 'Posted' },
        },
      });
      const equityBal = equityLines.reduce(
        (s, l) => s + toNum(l.credit) - toNum(l.debit),
        0
      );
      await tx.chartOfAccount.update({
        where: { id: equity.id },
        data: { currentBalance: equityBal },
      });
    }

    return { journalEntry, amount: amt };
  });
}

async function createBankDeposit({
  userId,
  companyId,
  bankAccountId,
  sourceAccountId,
  amount,
  postingDate = new Date(),
  description,
  reference,
  notes,
}) {
  const amt = toNum(amount);
  if (amt <= 0) {
    const err = new Error('Amount must be greater than 0');
    err.statusCode = 400;
    throw err;
  }
  if (!sourceAccountId) {
    const err = new Error('Source account is required');
    err.statusCode = 400;
    throw err;
  }

  await assertFiscalYearOpen(userId, postingDate);
  const fiscalYearId = await resolveFyId(userId, companyId, postingDate);
  const ref = depositReference(bankAccountId, reference);

  const existing = await prisma.journalEntry.findFirst({
    where: { companyId, reference: ref },
    include: { lines: true },
  });
  if (existing) {
    return { journalEntry: existing, duplicate: true };
  }

  return prisma.$transaction(async (tx) => {
    const bank = await findBankOwned(bankAccountId, companyId, tx);
    const bankCoa = bank.chartOfAccount;
    const source = await findCoaOwned(sourceAccountId, companyId, tx);

    if (source.id === bankCoa.id) {
      const err = new Error('Source account cannot be the same as the bank account');
      err.statusCode = 400;
      throw err;
    }

    const desc =
      description ||
      notes ||
      `Deposit to ${bank.accountName} from ${source.name}`;

    const lines = [
      {
        accountId: bankCoa.id,
        accountName: bankCoa.name,
        accountCode: bankCoa.code,
        debit: amt,
        credit: 0,
        isReconciled: false,
      },
      {
        accountId: source.id,
        accountName: source.name,
        accountCode: source.code,
        debit: 0,
        credit: amt,
        isReconciled: false,
      },
    ];

    const entryNumber = await generateEntryNumber(tx);
    const journalEntry = await tx.journalEntry.create({
      data: {
        entryNumber,
        date: new Date(postingDate),
        description: desc,
        reference: ref,
        status: 'Posted',
        type: 'BankDeposit',
        createdBy: userId,
        postedBy: userId,
        postedAt: new Date(),
        companyId,
        fiscalYearId,
        lines: { create: lines },
      },
      include: { lines: true },
    });

    await applyLineBalanceChanges(tx, lines, companyId, false);
    await syncBankBalancesFromCoa(tx, [bankCoa.id, source.id], companyId);

    const updatedBank = await tx.bankAccount.findFirst({
      where: { id: bank.id },
      include: { chartOfAccount: true },
    });

    return { journalEntry, bankAccount: updatedBank, duplicate: false };
  });
}

async function createBankTransfer({
  userId,
  companyId,
  fromBankAccountId,
  toBankAccountId,
  amount,
  postingDate = new Date(),
  description,
  reference,
}) {
  const amt = toNum(amount);
  if (amt <= 0) {
    const err = new Error('Amount must be greater than 0');
    err.statusCode = 400;
    throw err;
  }
  if (!fromBankAccountId || !toBankAccountId) {
    const err = new Error('From and To bank accounts are required');
    err.statusCode = 400;
    throw err;
  }
  if (fromBankAccountId === toBankAccountId) {
    const err = new Error('Cannot transfer to the same account');
    err.statusCode = 400;
    throw err;
  }

  await assertFiscalYearOpen(userId, postingDate);
  const fiscalYearId = await resolveFyId(userId, companyId, postingDate);
  const ref = transferReference(fromBankAccountId, toBankAccountId, reference);

  const existing = await prisma.journalEntry.findFirst({
    where: { companyId, reference: ref },
    include: { lines: true },
  });
  if (existing) {
    return { journalEntry: existing, duplicate: true };
  }

  return prisma.$transaction(async (tx) => {
    const fromBank = await findBankOwned(fromBankAccountId, companyId, tx);
    const toBank = await findBankOwned(toBankAccountId, companyId, tx);
    const fromCoa = fromBank.chartOfAccount;
    const toCoa = toBank.chartOfAccount;

    if (toNum(fromBank.currentBalance) < amt) {
      const err = new Error(
        `Insufficient balance. Available: ${fromBank.currentBalance}`
      );
      err.statusCode = 400;
      throw err;
    }

    const desc =
      description ||
      `Transfer from ${fromBank.accountName} to ${toBank.accountName}`;

    const lines = [
      {
        accountId: toCoa.id,
        accountName: toCoa.name,
        accountCode: toCoa.code,
        debit: amt,
        credit: 0,
        isReconciled: false,
      },
      {
        accountId: fromCoa.id,
        accountName: fromCoa.name,
        accountCode: fromCoa.code,
        debit: 0,
        credit: amt,
        isReconciled: false,
      },
    ];

    const entryNumber = await generateEntryNumber(tx);
    const journalEntry = await tx.journalEntry.create({
      data: {
        entryNumber,
        date: new Date(postingDate),
        description: desc,
        reference: ref,
        status: 'Posted',
        type: 'BankTransfer',
        createdBy: userId,
        postedBy: userId,
        postedAt: new Date(),
        companyId,
        fiscalYearId,
        lines: { create: lines },
      },
      include: { lines: true },
    });

    await applyLineBalanceChanges(tx, lines, companyId, false);
    await syncBankBalancesFromCoa(tx, [fromCoa.id, toCoa.id], companyId);

    const [fromUpdated, toUpdated] = await Promise.all([
      tx.bankAccount.findFirst({ where: { id: fromBank.id } }),
      tx.bankAccount.findFirst({ where: { id: toBank.id } }),
    ]);

    return {
      journalEntry,
      fromAccount: fromUpdated,
      toAccount: toUpdated,
      duplicate: false,
    };
  });
}

/**
 * Repair orphan/missing opening-balance JEs without double-counting balances.
 */
async function repairCompanyBankOpeningBalances(userId, companyId) {
  const banks = await prisma.bankAccount.findMany({
    where: { companyId, openingBalance: { gt: 0 } },
    include: { chartOfAccount: true },
  });

  const results = [];
  for (const bank of banks) {
    const ref = openingBalanceReference(bank.id);
    const proper = await prisma.journalEntry.findFirst({
      where: { companyId, reference: ref, status: 'Posted' },
    });
    if (proper) {
      results.push({ bankId: bank.id, status: 'ok' });
      continue;
    }

    const orphanLine = await prisma.journalLine.findFirst({
      where: {
        accountId: bank.chartOfAccountId,
        debit: { gt: 0 },
        journal: {
          description: { contains: 'Opening Balance', mode: 'insensitive' },
          status: 'Posted',
        },
      },
      include: { journal: true },
    });

    if (orphanLine?.journal && !orphanLine.journal.companyId) {
      await prisma.journalEntry.update({
        where: { id: orphanLine.journalId },
        data: {
          companyId,
          reference: ref,
          type: 'OpeningBalance',
          description: `Opening Balance - ${bank.accountName}`,
        },
      });

      const equity = await getOrCreateOpeningBalanceEquity(userId, companyId);
      const lines = await prisma.journalLine.findMany({
        where: { journalId: orphanLine.journalId },
      });
      const totalDebit = lines.reduce((s, l) => s + toNum(l.debit), 0);
      const totalCredit = lines.reduce((s, l) => s + toNum(l.credit), 0);
      let equityLine = lines.find((l) => l.accountId === equity.id);
      const diff = totalDebit - totalCredit;
      if (!equityLine) {
        await prisma.journalLine.create({
          data: {
            journalId: orphanLine.journalId,
            accountId: equity.id,
            accountName: equity.name,
            accountCode: equity.code,
            debit: diff < 0 ? Math.abs(diff) : 0,
            credit: diff > 0 ? diff : 0,
          },
        });
      } else if (Math.abs(diff) > 0.01) {
        await prisma.journalLine.update({
          where: { id: equityLine.id },
          data: {
            debit: diff < 0 ? Math.abs(diff) : 0,
            credit: diff > 0 ? diff : 0,
          },
        });
      }
      results.push({ bankId: bank.id, status: 'repaired-orphan' });
      continue;
    }

    await upsertBankOpeningBalance({
      userId,
      companyId,
      bankAccountId: bank.id,
      amount: bank.openingBalance,
      postingDate: bank.createdAt || new Date(),
      balancesAlreadySet: true,
    });
    results.push({ bankId: bank.id, status: 'created' });
  }

  return results;
}

module.exports = {
  getOrCreateOpeningBalanceEquity,
  upsertBankOpeningBalance,
  createBankDeposit,
  createBankTransfer,
  repairCompanyBankOpeningBalances,
  openingBalanceReference,
  calculateBalanceChange,
};
