/**
 * POS operational accounts → ERP accounting sync.
 * Idempotent by reference POS-ACC:{clientId}. Sales/returns already post via POSSale.
 */
const prisma = require('../../prisma/client');
const {
  getOrCreateCashAccount,
  ensureCashBankAccount,
} = require('../../utils/cashAccountHelper');
const { createBankTransfer } = require('../../services/bankAccountingService');
const BalanceCalculator = require('../../utils/balanceCalculator');

const REF_PREFIX = 'POS-ACC:';
const CASH_MOVE_TYPES = new Set([
  'deposit',
  'cash_deposit',
  'withdrawal',
  'cash_withdrawal',
  'transfer',
]);

function clientRef(clientId) {
  return `${REF_PREFIX}${String(clientId || '').trim()}`;
}

function money(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return 0;
  return Math.round(v * 100) / 100;
}

function generateJENumber() {
  return `JE-POSACC-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
}

async function findOrCreateBankCoa(tx, companyId, userId) {
  let acc = await tx.chartOfAccount.findFirst({
    where: {
      companyId,
      isActive: true,
      OR: [{ code: '1110' }, { name: { contains: 'Bank', mode: 'insensitive' } }],
    },
  });
  if (!acc) {
    acc = await tx.chartOfAccount.create({
      data: {
        code: '1110',
        name: 'Bank Account',
        type: 'Asset',
        parentAccount: 'Current Assets',
        openingBalance: 0,
        currentBalance: 0,
        balanceType: 'Debit',
        description: 'Bank account',
        isActive: true,
        createdBy: userId,
        companyId,
      },
    });
  }
  return acc;
}

/** Resolve Cash-in-Hand + primary bank BankAccount rows (ERP transfer ledger). */
async function resolveCashAndBankLedgers(userId, companyId) {
  const cashLedger = await ensureCashBankAccount(userId, companyId);
  let bankLedger = await prisma.bankAccount.findFirst({
    where: {
      companyId,
      status: 'Active',
      id: { not: cashLedger.id },
      NOT: { accountNumber: cashLedger.accountNumber },
    },
    orderBy: { createdAt: 'asc' },
    include: { chartOfAccount: true },
  });
  if (!bankLedger) {
    const bankCoa = await prisma.$transaction((tx) => findOrCreateBankCoa(tx, companyId, userId));
    bankLedger = await prisma.bankAccount.create({
      data: {
        accountName: 'Primary Bank',
        accountNumber: `BANK-${String(companyId).slice(0, 8)}`,
        bankName: 'Bank',
        accountType: 'Checking',
        currency: 'PKR',
        openingBalance: 0,
        currentBalance: Number(bankCoa.currentBalance || 0),
        accountCode: bankCoa.code || '1110',
        chartOfAccountId: bankCoa.id,
        status: 'Active',
        createdBy: userId,
        companyId,
      },
      include: { chartOfAccount: true },
    });
  }
  return { cashLedger, bankLedger };
}

async function findOrCreateAr(tx, companyId, userId) {
  let acc = await tx.chartOfAccount.findFirst({
    where: {
      companyId,
      isActive: true,
      OR: [{ code: '1200' }, { name: { contains: 'Receivable', mode: 'insensitive' } }],
    },
  });
  if (!acc) {
    acc = await tx.chartOfAccount.create({
      data: {
        code: '1200',
        name: 'Accounts Receivable',
        type: 'Asset',
        parentAccount: 'Current Assets',
        openingBalance: 0,
        currentBalance: 0,
        balanceType: 'Debit',
        description: 'Customer receivables',
        isActive: true,
        createdBy: userId,
        companyId,
      },
    });
  }
  return acc;
}

async function findOrCreateAp(tx, companyId, userId) {
  let acc = await tx.chartOfAccount.findFirst({
    where: {
      companyId,
      isActive: true,
      OR: [{ code: '2100' }, { name: { contains: 'Payable', mode: 'insensitive' } }],
    },
  });
  if (!acc) {
    acc = await tx.chartOfAccount.create({
      data: {
        code: '2100',
        name: 'Accounts Payable',
        type: 'Liability',
        parentAccount: 'Current Liabilities',
        openingBalance: 0,
        currentBalance: 0,
        balanceType: 'Credit',
        description: 'Supplier payables',
        isActive: true,
        createdBy: userId,
        companyId,
      },
    });
  }
  return acc;
}

async function findOrCreateExpenseAccount(tx, companyId, userId, category) {
  const nameHint = String(category || 'POS Expense').trim() || 'POS Expense';
  let acc = await tx.chartOfAccount.findFirst({
    where: {
      companyId,
      isActive: true,
      type: 'Expense',
      OR: [
        { name: { equals: nameHint, mode: 'insensitive' } },
        { name: { contains: 'Operating Expense', mode: 'insensitive' } },
        { code: '5000' },
      ],
    },
  });
  if (!acc) {
    acc = await tx.chartOfAccount.create({
      data: {
        code: `5${String(Date.now()).slice(-3)}`,
        name: nameHint.slice(0, 80),
        type: 'Expense',
        parentAccount: 'Operating Expenses',
        openingBalance: 0,
        currentBalance: 0,
        balanceType: 'Debit',
        description: `POS expense category: ${nameHint}`,
        isActive: true,
        createdBy: userId,
        companyId,
      },
    });
  }
  return acc;
}

async function findOrCreateIncomeAccount(tx, companyId, userId, category) {
  const nameHint = String(category || 'Other Income').trim() || 'Other Income';
  let acc = await tx.chartOfAccount.findFirst({
    where: {
      companyId,
      isActive: true,
      type: { in: ['Revenue', 'Income'] },
      OR: [
        { name: { equals: nameHint, mode: 'insensitive' } },
        { name: { contains: 'Other Income', mode: 'insensitive' } },
        { code: '4100' },
      ],
    },
  });
  if (!acc) {
    acc = await tx.chartOfAccount.create({
      data: {
        code: `4${String(Date.now()).slice(-3)}`,
        name: nameHint.slice(0, 80),
        type: 'Revenue',
        parentAccount: 'Other Income',
        openingBalance: 0,
        currentBalance: 0,
        balanceType: 'Credit',
        description: `POS income category: ${nameHint}`,
        isActive: true,
        createdBy: userId,
        companyId,
      },
    });
  }
  return acc;
}

function paymentSideAccount(method, cashAcc, bankAcc) {
  const m = String(method || 'Cash').toLowerCase();
  if (['card', 'bank', 'bank transfer', 'cheque', 'mobile wallet', 'online'].includes(m)) {
    return bankAcc;
  }
  return cashAcc;
}

async function findExistingByRef(tx, companyId, reference) {
  const je = await tx.journalEntry.findFirst({
    where: { companyId, reference },
    select: { id: true, entryNumber: true, updatedAt: true },
  });
  if (je) return { kind: 'journal', id: je.id, number: je.entryNumber, updatedAt: je.updatedAt };
  const exp = await tx.expense.findFirst({
    where: { companyId, reference },
    select: { id: true, expenseNumber: true, updatedAt: true },
  });
  if (exp) return { kind: 'expense', id: exp.id, number: exp.expenseNumber, updatedAt: exp.updatedAt };
  const inc = await tx.income.findFirst({
    where: { companyId, reference },
    select: { id: true, incomeNumber: true, updatedAt: true },
  });
  if (inc) return { kind: 'income', id: inc.id, number: inc.incomeNumber, updatedAt: inc.updatedAt };
  return null;
}

async function createPostedJe(tx, {
  companyId,
  userId,
  locationId,
  date,
  description,
  reference,
  lines,
}) {
  const resolved = [];
  for (const l of lines) {
    let accountName = l.accountName;
    let accountCode = l.accountCode;
    if (!accountName || !accountCode) {
      const acc = await tx.chartOfAccount.findUnique({ where: { id: l.accountId } });
      accountName = accountName || acc?.name || 'Account';
      accountCode = accountCode || acc?.code || '';
    }
    resolved.push({
      accountId: l.accountId,
      accountName,
      accountCode,
      debit: money(l.debit),
      credit: money(l.credit),
    });
  }
  const entry = await tx.journalEntry.create({
    data: {
      entryNumber: generateJENumber(),
      date: date ? new Date(date) : new Date(),
      description: String(description || 'POS accounts').slice(0, 500),
      reference,
      status: 'Posted',
      type: 'POS',
      createdBy: userId,
      postedBy: userId,
      postedAt: new Date(),
      companyId,
      locationId: locationId || null,
      lines: { create: resolved },
    },
    include: { lines: true },
  });
  await BalanceCalculator.applyJournalLines(tx, entry.lines || []);
  return entry;
}

async function syncOneRecord(tx, companyId, userId, rec) {
  const clientId = String(rec.clientId || rec.id || '').trim();
  if (!clientId) {
    return { clientId: '', status: 'failed', message: 'Missing clientId' };
  }
  const reference = clientRef(clientId);
  const amount = money(rec.amount);
  if (!(amount > 0) && String(rec.type) !== 'daily_closing') {
    return { clientId, status: 'failed', message: 'Amount must be > 0' };
  }

  const existing = await findExistingByRef(tx, companyId, reference);
  if (existing) {
    const localUpdated = rec.updatedAt ? new Date(rec.updatedAt).getTime() : 0;
    const cloudUpdated = existing.updatedAt ? new Date(existing.updatedAt).getTime() : 0;
    if (localUpdated && cloudUpdated && localUpdated > cloudUpdated + 1000) {
      return {
        clientId,
        status: 'failed',
        message: 'Conflict: local record is newer than cloud; resolve manually',
        cloudId: existing.id,
        conflict: true,
      };
    }
    return {
      clientId,
      status: 'skipped',
      message: 'Already synced',
      cloudId: existing.id,
      cloudNumber: existing.number,
    };
  }

  const type = String(rec.type || '').toLowerCase();
  const method = rec.paymentMethod || 'Cash';
  const locationId = rec.locationId || null;
  const date = rec.date || rec.transactionDate || new Date().toISOString();
  const description = rec.description || rec.notes || `POS ${type}`;
  const category = rec.category || '';

  const cash = await getOrCreateCashAccount(userId, companyId, tx);
  const bank = await findOrCreateBankCoa(tx, companyId, userId);
  const payAcc = paymentSideAccount(method, cash, bank);

  if (type === 'expense') {
    const expAcc = await findOrCreateExpenseAccount(tx, companyId, userId, category);
    const entry = await createPostedJe(tx, {
      companyId,
      userId,
      locationId,
      date,
      description: `Expense: ${description}`,
      reference,
      lines: [
        { accountId: expAcc.id, debit: amount, credit: 0, description },
        { accountId: payAcc.id, debit: 0, credit: amount, description },
      ],
    });
    return { clientId, status: 'success', cloudId: entry.id, cloudNumber: entry.entryNumber };
  }

  if (type === 'income') {
    const incAcc = await findOrCreateIncomeAccount(tx, companyId, userId, category);
    const entry = await createPostedJe(tx, {
      companyId,
      userId,
      locationId,
      date,
      description: `Income: ${description}`,
      reference,
      lines: [
        { accountId: payAcc.id, debit: amount, credit: 0, description },
        { accountId: incAcc.id, debit: 0, credit: amount, description },
      ],
    });
    return { clientId, status: 'success', cloudId: entry.id, cloudNumber: entry.entryNumber };
  }

  // deposit / withdrawal / transfer are handled by syncCashMovementRecord (ERP bank transfer service)
  if (CASH_MOVE_TYPES.has(type)) {
    return { clientId, status: 'failed', message: 'Cash movement must use transfer service path' };
  }

  if (type === 'customer_payment') {
    const ar = await findOrCreateAr(tx, companyId, userId);
    const entry = await createPostedJe(tx, {
      companyId,
      userId,
      locationId,
      date,
      description: description || `Customer payment ${rec.partyName || ''}`.trim(),
      reference,
      lines: [
        { accountId: payAcc.id, debit: amount, credit: 0, description },
        { accountId: ar.id, debit: 0, credit: amount, description },
      ],
    });
    return { clientId, status: 'success', cloudId: entry.id, cloudNumber: entry.entryNumber };
  }

  if (type === 'supplier_payment') {
    const ap = await findOrCreateAp(tx, companyId, userId);
    const entry = await createPostedJe(tx, {
      companyId,
      userId,
      locationId,
      date,
      description: description || `Supplier payment ${rec.partyName || ''}`.trim(),
      reference,
      lines: [
        { accountId: ap.id, debit: amount, credit: 0, description },
        { accountId: payAcc.id, debit: 0, credit: amount, description },
      ],
    });
    return { clientId, status: 'success', cloudId: entry.id, cloudNumber: entry.entryNumber };
  }

  if (type === 'daily_closing') {
    // Operational snapshot only — acknowledged without posting a GL entry.
    return {
      clientId,
      status: 'success',
      cloudId: `closing:${clientId}`,
      cloudNumber: null,
      message: 'Daily closing acknowledged (local operational record)',
    };
  }

  // sale / refund are handled by POSSale sync — mark skipped so desktop clears queue duplicates
  if (type === 'sale' || type === 'refund' || type === 'sale_link') {
    return { clientId, status: 'skipped', message: 'Sales/refunds sync via POS sales endpoint' };
  }

  return { clientId, status: 'failed', message: `Unsupported type: ${type}` };
}

/**
 * Cash ↔ bank via ERP createBankTransfer (reference-deduped, updates BankAccount balances).
 * Falls back to COA JE when ledger balance check blocks an operational POS row.
 */
async function syncCashMovementRecord(companyId, userId, rec) {
  const clientId = String(rec.clientId || rec.id || '').trim();
  if (!clientId) return { clientId: '', status: 'failed', message: 'Missing clientId' };
  const reference = clientRef(clientId);
  const amount = money(rec.amount);
  if (!(amount > 0)) return { clientId, status: 'failed', message: 'Amount must be > 0' };

  const existing = await findExistingByRef(prisma, companyId, reference);
  if (existing) {
    return {
      clientId,
      status: 'skipped',
      message: 'Already synced',
      cloudId: existing.id,
      cloudNumber: existing.number,
    };
  }

  const type = String(rec.type || '').toLowerCase();
  const date = rec.date || rec.transactionDate || new Date().toISOString();
  const description = rec.description || rec.notes || `POS ${type}`;
  const { cashLedger, bankLedger } = await resolveCashAndBankLedgers(userId, companyId);

  let fromId = cashLedger.id;
  let toId = bankLedger.id;
  if (type === 'withdrawal' || type === 'cash_withdrawal') {
    fromId = bankLedger.id;
    toId = cashLedger.id;
  } else if (type === 'transfer' && String(rec.direction || '').toLowerCase() === 'bank_to_cash') {
    fromId = bankLedger.id;
    toId = cashLedger.id;
  }

  try {
    const result = await createBankTransfer({
      userId,
      companyId,
      fromBankAccountId: fromId,
      toBankAccountId: toId,
      amount,
      postingDate: new Date(date),
      description,
      reference,
    });
    const je = result.journalEntry;
    return {
      clientId,
      status: result.duplicate ? 'skipped' : 'success',
      message: result.duplicate ? 'Already synced' : 'Transfer posted',
      cloudId: je?.id,
      cloudNumber: je?.entryNumber,
    };
  } catch (err) {
    // Insufficient ERP bank balance / other ledger issues — still post GL so POS ops are not lost
    const soft = /insufficient|balance/i.test(String(err.message || ''));
    if (!soft) throw err;
    return prisma.$transaction(async (tx) => {
      const cash = await getOrCreateCashAccount(userId, companyId, tx);
      const bank = await findOrCreateBankCoa(tx, companyId, userId);
      const cashToBank = fromId === cashLedger.id;
      const entry = await createPostedJe(tx, {
        companyId,
        userId,
        locationId: rec.locationId || null,
        date,
        description: `${description} (POS fallback JE)`,
        reference,
        lines: cashToBank
          ? [
              { accountId: bank.id, debit: amount, credit: 0 },
              { accountId: cash.id, debit: 0, credit: amount },
            ]
          : [
              { accountId: cash.id, debit: amount, credit: 0 },
              { accountId: bank.id, debit: 0, credit: amount },
            ],
      });
      return {
        clientId,
        status: 'success',
        cloudId: entry.id,
        cloudNumber: entry.entryNumber,
        message: 'Posted via COA fallback (bank ledger balance insufficient)',
      };
    });
  }
}

/**
 * POST /api/pos/accounts/sync
 * Body: { records: [...] }
 */
async function syncAccounts(req, res) {
  try {
    const companyId = req.user.companyId || req.headers['x-company-id'];
    const userId = req.user.id;
    if (!companyId) {
      return res.status(400).json({ success: false, message: 'Company ID required' });
    }
    const records = Array.isArray(req.body?.records) ? req.body.records : [];
    if (!records.length) {
      return res.json({ success: true, data: { results: [], pushed: 0, skipped: 0, failed: 0 } });
    }

    const results = [];
    for (const rec of records) {
      try {
        const type = String(rec.type || '').toLowerCase();
        const result = CASH_MOVE_TYPES.has(type)
          ? await syncCashMovementRecord(companyId, userId, rec)
          : await prisma.$transaction(async (tx) => syncOneRecord(tx, companyId, userId, rec));
        results.push(result);
      } catch (err) {
        results.push({
          clientId: String(rec.clientId || rec.id || ''),
          status: 'failed',
          message: err.message || 'Sync failed',
        });
      }
    }

    const pushed = results.filter((r) => r.status === 'success').length;
    const skipped = results.filter((r) => r.status === 'skipped').length;
    const failed = results.filter((r) => r.status === 'failed').length;

    return res.json({
      success: true,
      data: { results, pushed, skipped, failed },
      message: `Accounts sync: ${pushed} posted, ${skipped} skipped, ${failed} failed`,
    });
  } catch (err) {
    console.error('[pos accounts sync]', err);
    return res.status(500).json({ success: false, message: err.message || 'Accounts sync failed' });
  }
}

/**
 * GET /api/pos/accounts/mappings — cash/bank/AR/AP account ids for Settings display
 */
async function getAccountMappings(req, res) {
  try {
    const companyId = req.user.companyId || req.headers['x-company-id'];
    const userId = req.user.id;
    if (!companyId) {
      return res.status(400).json({ success: false, message: 'Company ID required' });
    }
    const cash = await getOrCreateCashAccount(userId, companyId);
    const bank = await prisma.$transaction((tx) => findOrCreateBankCoa(tx, companyId, userId));
    const ar = await prisma.$transaction((tx) => findOrCreateAr(tx, companyId, userId));
    const ap = await prisma.$transaction((tx) => findOrCreateAp(tx, companyId, userId));
    const { cashLedger, bankLedger } = await resolveCashAndBankLedgers(userId, companyId);
    return res.json({
      success: true,
      data: {
        cashAccount: { id: cash.id, code: cash.code, name: cash.name },
        bankAccount: { id: bank.id, code: bank.code, name: bank.name },
        cashBankLedger: { id: cashLedger.id, accountName: cashLedger.accountName, accountNumber: cashLedger.accountNumber },
        primaryBankLedger: { id: bankLedger.id, accountName: bankLedger.accountName, accountNumber: bankLedger.accountNumber },
        receivablesAccount: { id: ar.id, code: ar.code, name: ar.name },
        payablesAccount: { id: ap.id, code: ap.code, name: ap.name },
      },
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message || 'Failed to load mappings' });
  }
}

/**
 * GET /api/pos/accounts/synced?since=ISO
 * Returns recently synced POS-ACC references (for Get-from-cloud awareness; does not delete local).
 */
async function listSyncedRefs(req, res) {
  try {
    const companyId = req.user.companyId || req.headers['x-company-id'];
    if (!companyId) {
      return res.status(400).json({ success: false, message: 'Company ID required' });
    }
    const since = req.query.since ? new Date(String(req.query.since)) : new Date(Date.now() - 30 * 86400000);
    const jes = await prisma.journalEntry.findMany({
      where: {
        companyId,
        reference: { startsWith: REF_PREFIX },
        updatedAt: { gte: since },
      },
      select: {
        id: true,
        reference: true,
        description: true,
        date: true,
        entryNumber: true,
        updatedAt: true,
        status: true,
      },
      orderBy: { updatedAt: 'desc' },
      take: 500,
    });
    const rows = jes.map((j) => ({
      clientId: String(j.reference || '').replace(REF_PREFIX, ''),
      cloudId: j.id,
      cloudNumber: j.entryNumber,
      description: j.description,
      date: j.date,
      updatedAt: j.updatedAt,
      status: j.status,
    }));
    return res.json({ success: true, data: rows });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message || 'Failed to list synced refs' });
  }
}

module.exports = {
  syncAccounts,
  getAccountMappings,
  listSyncedRefs,
};
