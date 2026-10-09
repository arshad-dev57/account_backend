const prisma = require('../prisma/client');
const { getOrCreateCashAccount, ensureCashBankAccount } = require('../utils/cashAccountHelper');
const { fiscalYearGuard } = require('../middleware/fiscalYearMiddleware');
const { resolveFiscalYearId } = require('../utils/fiscalYearHelper');
const {
  deriveAccountType,
  ensureEquityAccountForChart,
  syncCompanyEquityAccounts,
  findLinkedChartAccount,
} = require('../utils/equityAccountHelper');

function cleanId(value) {
  if (value === null || value === undefined) return null;
  const raw = String(value).trim();
  if (!raw || raw === 'null' || raw === 'NULL' || raw === 'undefined') return null;
  return raw;
}

function parseAmount(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) {
    const err = new Error('Amount must be greater than zero');
    err.statusCode = 400;
    throw err;
  }
  return n;
}

function parseTxnDate(value) {
  if (!value) return new Date();
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) {
    const err = new Error('Invalid transaction date');
    err.statusCode = 400;
    throw err;
  }
  return d;
}

async function assertOpenFiscalYear(userId, date) {
  try {
    await fiscalYearGuard(userId, date);
  } catch (err) {
    if (err.code === 'FISCAL_YEAR_CLOSED') {
      err.statusCode = 400;
    }
    throw err;
  }
}

/**
 * Cash → Cash in Hand. Bank Transfer/Cheque/etc → selected bank COA.
 */
async function resolveFundingAccount(userId, companyId, paymentMethod, bankAccountId, tx = prisma) {
  const method = paymentMethod || 'Cash';
  const bankId = cleanId(bankAccountId);
  const useBank = method !== 'Cash' && !!bankId;

  if (useBank) {
    const bankAccount = await tx.bankAccount.findFirst({
      where: { id: bankId, companyId },
      include: { chartOfAccount: true },
    });
    if (!bankAccount || !bankAccount.chartOfAccount) {
      const err = new Error('Bank account not found or does not belong to this company');
      err.statusCode = 400;
      throw err;
    }
    return { fundingAccount: bankAccount.chartOfAccount, bankAccount };
  }

  // Cash posts to COA Cash in Hand AND the Cash ledger row on Cash & Bank page
  const cashLedger = await ensureCashBankAccount(userId, companyId, tx);
  const fundingAccount =
    cashLedger.chartOfAccount ||
    (await getOrCreateCashAccount(userId, companyId, tx));
  return { fundingAccount, bankAccount: cashLedger };
}

/** direction 'in' = capital injection, 'out' = drawings/dividend */
async function applyFundingBalance(fundingAccount, bankAccount, amount, direction, tx = prisma) {
  const delta = direction === 'in' ? amount : -amount;
  await tx.chartOfAccount.update({
    where: { id: fundingAccount.id },
    data: { currentBalance: { increment: delta } },
  });
  if (bankAccount) {
    await tx.bankAccount.update({
      where: { id: bankAccount.id },
      data: { currentBalance: { increment: delta } },
    });
  }
}

function isEquityReserveLike(account) {
  if (!account || account.type !== 'Equity') return false;
  const t = deriveAccountType(account.name);
  return ['Reserves', 'Retained Earnings', 'Capital', 'Share Capital'].includes(t);
}

function isContraEquityType(type) {
  return type === 'Drawings' || type === 'Dividends' || type === 'Dividend' || type === 'Distribution';
}

async function createEquityTransaction(
  accountId,
  type,
  amount,
  description,
  reference,
  userId,
  companyId,
  {
    journalEntryId = null,
    date = null,
    client = prisma,
    /** 'in' increases equity shadow, 'out' decreases, 'none' history only */
    balanceEffect = null,
  } = {}
) {
  const chartAccount = await client.chartOfAccount.findUnique({ where: { id: accountId } });
  if (!chartAccount) return null;

  const equityAccount = await ensureEquityAccountForChart(
    chartAccount,
    userId,
    companyId,
    client
  );
  if (!equityAccount) return null;

  const txn = await client.equityTransaction.create({
    data: {
      accountId: equityAccount.id,
      type,
      amount,
      description,
      reference: reference || '',
      status: 'Posted',
      date: date || new Date(),
      journalEntryId: journalEntryId || null,
      createdBy: userId,
      updatedBy: userId,
      companyId,
    },
  });

  let effect = balanceEffect;
  if (!effect) {
    if (isContraEquityType(type)) effect = 'out';
    else if (type === 'Reserve Transfer') effect = 'none';
    else effect = 'in';
  }

  if (effect === 'out') {
    await client.equityAccount.update({
      where: { id: equityAccount.id },
      data: {
        currentBalance: { decrement: amount },
        withdrawals: { increment: amount },
        lastUpdated: new Date(),
      },
    });
  } else if (effect === 'in') {
    await client.equityAccount.update({
      where: { id: equityAccount.id },
      data: {
        currentBalance: { increment: amount },
        additions: { increment: amount },
        lastUpdated: new Date(),
      },
    });
  } else {
    await client.equityAccount.update({
      where: { id: equityAccount.id },
      data: { lastUpdated: new Date() },
    });
  }

  return txn;
}

async function ensureDividendEquityAccount(userId, companyId, preferredId, tx = prisma) {
  if (preferredId) {
    const linked = await findLinkedChartAccount(preferredId, companyId);
    if (linked && linked.type === 'Equity') return linked;
  }

  let account = await tx.chartOfAccount.findFirst({
    where: {
      companyId,
      type: 'Equity',
      isActive: true,
      OR: [
        { code: '3400' },
        { name: { contains: 'dividend', mode: 'insensitive' } },
        { name: { contains: 'distribution', mode: 'insensitive' } },
      ],
    },
    orderBy: { code: 'asc' },
  });

  if (!account) {
    account = await tx.chartOfAccount.create({
      data: {
        code: '3400',
        name: 'Dividends / Distributions',
        type: 'Equity',
        parentAccount: 'Equity',
        openingBalance: 0,
        currentBalance: 0,
        description: 'Owner/shareholder distributions (contra-equity)',
        taxCode: 'N/A',
        balanceType: 'Debit',
        isActive: true,
        createdBy: userId,
        companyId,
      },
    });
  }

  await ensureEquityAccountForChart(account, userId, companyId, tx);
  return account;
}

async function ensureDividendPayableLiability(userId, companyId, tx = prisma) {
  let account = await tx.chartOfAccount.findFirst({
    where: {
      companyId,
      type: 'Liability',
      isActive: true,
      OR: [
        { code: '2150' },
        { name: { contains: 'dividend payable', mode: 'insensitive' } },
      ],
    },
    orderBy: { code: 'asc' },
  });

  if (!account) {
    account = await tx.chartOfAccount.create({
      data: {
        code: '2150',
        name: 'Dividend Payable',
        type: 'Liability',
        parentAccount: 'Current Liabilities',
        openingBalance: 0,
        currentBalance: 0,
        description: 'Declared dividends awaiting payment',
        taxCode: 'N/A',
        balanceType: 'Credit',
        isActive: true,
        createdBy: userId,
        companyId,
      },
    });
  }
  return account;
}

// ==================== GET ALL EQUITY ACCOUNTS ====================
exports.getEquityAccounts = async (req, res) => {
  try {
    const { accountType, search } = req.query;
    const userId = req.user.id;
    const companyId = req.user.companyId;

    await syncCompanyEquityAccounts(companyId, userId);

    const filter = {
      companyId,
      type: 'Equity',
      isActive: true,
    };
    if (search) {
      filter.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { code: { contains: search, mode: 'insensitive' } },
      ];
    }

    const charts = await prisma.chartOfAccount.findMany({
      where: filter,
      orderBy: { code: 'asc' },
    });

    let accounts = charts.map((chart) => ({
      id: chart.id,
      accountName: chart.name,
      accountCode: chart.code,
      accountType: deriveAccountType(chart.name),
      openingBalance: chart.openingBalance || 0,
      currentBalance: chart.currentBalance || 0,
      lastUpdated: chart.updatedAt,
      notes: chart.description || '',
      additions: 0,
      withdrawals: 0,
    }));

    const shadows = await prisma.equityAccount.findMany({
      where: { companyId },
      select: {
        accountCode: true,
        additions: true,
        withdrawals: true,
      },
    });
    const byCode = new Map(shadows.map((s) => [s.accountCode, s]));
    accounts = accounts.map((a) => {
      const sh = byCode.get(a.accountCode);
      if (!sh) return a;
      return {
        ...a,
        additions: Number(sh.additions) || 0,
        withdrawals: Number(sh.withdrawals) || 0,
      };
    });

    const {
      isCurrentYearEarningsAccount,
      liveCurrentYearEarnings,
      earningsWindowForCompany
    } = require('../utils/profitLossHelper');
    const window = await earningsWindowForCompany(companyId, req.query.fiscalYearId);
    const currentYearEarnings = await liveCurrentYearEarnings(
      companyId,
      window.start,
      window.end
    );
    accounts = accounts.map((account) => {
      if (!isCurrentYearEarningsAccount(account)) return account;
      return { ...account, currentBalance: currentYearEarnings };
    });

    if (accountType && accountType !== 'All') {
      accounts = accounts.filter((a) => a.accountType === accountType);
    }

    res.status(200).json({ success: true, count: accounts.length, data: accounts });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.createEquityAccount = async (req, res) => {
  try {
    const { accountName, accountCode, accountType, openingBalance, notes } = req.body;
    const companyId = req.user.companyId;
    const userId = req.user.id;
    const type = deriveAccountType(accountName, accountType);

    let chartAccount = await prisma.chartOfAccount.findFirst({
      where: { code: accountCode, companyId },
    });

    if (chartAccount && chartAccount.type === 'Equity') {
      const equityAccount = await ensureEquityAccountForChart(
        chartAccount,
        userId,
        companyId
      );
      return res.status(200).json({
        success: true,
        data: equityAccount,
        message: 'Linked to existing Chart of Accounts equity account',
      });
    }

    if (type === 'Capital' || type === 'Share Capital') {
      const existingCapital = await prisma.chartOfAccount.findFirst({
        where: {
          companyId,
          type: 'Equity',
          isActive: true,
          OR: [
            { code: '3001' },
            { name: { contains: 'capital', mode: 'insensitive' } },
          ],
        },
        orderBy: { code: 'asc' },
      });
      if (existingCapital) {
        const equityAccount = await ensureEquityAccountForChart(
          existingCapital,
          userId,
          companyId
        );
        return res.status(200).json({
          success: true,
          data: equityAccount,
          message: "Owner's Capital already exists in Chart of Accounts — using that account",
        });
      }
    }

    if (chartAccount && chartAccount.type !== 'Equity') {
      return res.status(400).json({
        success: false,
        message: `Account code ${accountCode} already exists as ${chartAccount.type}`,
      });
    }

    if (!chartAccount) {
      chartAccount = await prisma.chartOfAccount.create({
        data: {
          code: accountCode,
          name: accountName,
          type: 'Equity',
          parentAccount: 'Equity',
          openingBalance: openingBalance || 0,
          currentBalance: openingBalance || 0,
          description: notes || accountName,
          taxCode: 'N/A',
          balanceType: 'Credit',
          isActive: true,
          createdBy: userId,
          companyId,
        },
      });
    }

    const equityAccount = await ensureEquityAccountForChart(
      chartAccount,
      userId,
      companyId
    );

    if (openingBalance > 0) {
      const cashAccount = await getOrCreateCashAccount(userId, companyId);
      const postingDate = new Date();
      await assertOpenFiscalYear(userId, postingDate);
      const fiscalYearId = await resolveFiscalYearId(userId, postingDate);

      await prisma.journalEntry.create({
        data: {
          entryNumber: `JE-${Date.now()}`,
          date: postingDate,
          description: `Opening balance for ${accountName}`,
          reference: accountCode,
          status: 'Posted',
          createdBy: userId,
          postedBy: userId,
          postedAt: new Date(),
          companyId,
          fiscalYearId,
          lines: {
            create: [
              {
                accountId: cashAccount.id,
                accountName: cashAccount.name,
                accountCode: cashAccount.code,
                debit: openingBalance,
                credit: 0
              },
              {
                accountId: chartAccount.id,
                accountName: chartAccount.name,
                accountCode: chartAccount.code,
                debit: 0,
                credit: openingBalance
              },
            ]
          }
        }
      });
    }

    res.status(201).json({
      success: true,
      data: equityAccount,
      message: 'Equity account created successfully'
    });
  } catch (error) {
    console.error(error);
    res.status(error.statusCode || 500).json({ success: false, message: error.message });
  }
};

exports.getEquityAccount = async (req, res) => {
  try {
    const { id } = req.params;
    const companyId = req.user.companyId;

    const account = await prisma.equityAccount.findFirst({
      where: { id, companyId },
      include: {
        transactions: {
          orderBy: { date: 'desc' },
          include: { journalEntry: { select: { id: true, entryNumber: true, date: true } } },
        },
      },
    });

    if (!account) {
      return res.status(404).json({ success: false, message: 'Equity account not found' });
    }

    res.status(200).json({ success: true, data: account });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.updateEquityAccount = async (req, res) => {
  try {
    const { notes, accountName } = req.body;
    const companyId = req.user.companyId;

    const account = await prisma.equityAccount.findFirst({
      where: { id: req.params.id, companyId }
    });

    if (!account) {
      return res.status(404).json({ success: false, message: 'Equity account not found' });
    }

    const updateData = {};
    if (accountName) updateData.accountName = accountName;
    if (notes !== undefined) updateData.notes = notes;

    const updated = await prisma.equityAccount.update({
      where: { id: req.params.id },
      data: updateData
    });

    res.status(200).json({ success: true, data: updated, message: 'Updated successfully' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.deleteEquityAccount = async (req, res) => {
  try {
    const companyId = req.user.companyId;

    const account = await prisma.equityAccount.findFirst({
      where: { id: req.params.id, companyId },
      include: { transactions: true }
    });

    if (!account) {
      return res.status(404).json({ success: false, message: 'Equity account not found' });
    }

    if (account.transactions.length > 0) {
      return res.status(400).json({
        success: false,
        message: 'Cannot delete account with transactions'
      });
    }

    await prisma.equityAccount.delete({ where: { id: req.params.id } });

    res.status(200).json({ success: true, message: 'Equity account deleted successfully' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.addCapital = async (req, res) => {
  try {
    const {
      accountId,
      amount: rawAmount,
      description,
      reference,
      paymentMethod,
      bankAccountId,
      date,
    } = req.body;
    const companyId = req.user.companyId;
    const userId = req.user.id;
    const amount = parseAmount(rawAmount);
    const postingDate = parseTxnDate(date);

    if (!cleanId(accountId)) {
      return res.status(400).json({ success: false, message: 'Equity account is required' });
    }

    const account = await findLinkedChartAccount(accountId, companyId);
    if (!account) {
      return res.status(404).json({ success: false, message: 'Equity account not found in Chart of Accounts' });
    }

    const method = paymentMethod || 'Cash';
    if (method !== 'Cash' && !cleanId(bankAccountId)) {
      return res.status(400).json({
        success: false,
        message: 'Please select a bank account for this payment method',
      });
    }

    await assertOpenFiscalYear(userId, postingDate);
    const fiscalYearId = await resolveFiscalYearId(userId, postingDate);

    const result = await prisma.$transaction(async (tx) => {
      const { fundingAccount, bankAccount } = await resolveFundingAccount(
        userId,
        companyId,
        method,
        bankAccountId,
        tx
      );

      const journal = await tx.journalEntry.create({
        data: {
          entryNumber: `JE-CAP-${Date.now()}`,
          date: postingDate,
          description: description || `Additional capital to ${account.name}`,
          reference: reference || `CAP-${Date.now()}`,
          status: 'Posted',
          type: 'EquityCapital',
          createdBy: userId,
          postedBy: userId,
          postedAt: new Date(),
          companyId,
          fiscalYearId,
          lines: {
            create: [
              {
                accountId: fundingAccount.id,
                accountName: fundingAccount.name,
                accountCode: fundingAccount.code,
                debit: amount,
                credit: 0,
              },
              {
                accountId: account.id,
                accountName: account.name,
                accountCode: account.code,
                debit: 0,
                credit: amount,
              },
            ],
          },
        },
      });

      await tx.chartOfAccount.update({
        where: { id: account.id },
        data: { currentBalance: { increment: amount } },
      });
      await applyFundingBalance(fundingAccount, bankAccount, amount, 'in', tx);

      const txn = await createEquityTransaction(
        account.id,
        'Additional Capital',
        amount,
        description || `Additional capital to ${account.name}`,
        reference || '',
        userId,
        companyId,
        { journalEntryId: journal.id, date: postingDate, client: tx }
      );

      return { account, amount, journalEntryId: journal.id, entryNumber: journal.entryNumber, transaction: txn };
    });

    res.status(200).json({
      success: true,
      data: result,
      message: 'Capital added successfully',
    });
  } catch (error) {
    console.error('addCapital error:', error);
    res.status(error.statusCode || 500).json({ success: false, message: error.message });
  }
};

exports.recordDrawings = async (req, res) => {
  try {
    const {
      accountId,
      amount: rawAmount,
      description,
      reference,
      paymentMethod,
      bankAccountId,
      date,
    } = req.body;
    const companyId = req.user.companyId;
    const userId = req.user.id;
    const amount = parseAmount(rawAmount);
    const postingDate = parseTxnDate(date);

    if (!cleanId(accountId)) {
      return res.status(400).json({ success: false, message: 'Drawings account is required' });
    }

    const account = await findLinkedChartAccount(accountId, companyId);
    if (!account) {
      return res.status(404).json({ success: false, message: 'Equity account not found in Chart of Accounts' });
    }

    const method = paymentMethod || 'Cash';
    if (method !== 'Cash' && !cleanId(bankAccountId)) {
      return res.status(400).json({
        success: false,
        message: 'Please select a bank account for this payment method',
      });
    }

    await assertOpenFiscalYear(userId, postingDate);
    const fiscalYearId = await resolveFiscalYearId(userId, postingDate);

    const result = await prisma.$transaction(async (tx) => {
      const { fundingAccount, bankAccount } = await resolveFundingAccount(
        userId,
        companyId,
        method,
        bankAccountId,
        tx
      );

      const journal = await tx.journalEntry.create({
        data: {
          entryNumber: `JE-DRW-${Date.now()}`,
          date: postingDate,
          description: description || `Owner drawings from ${account.name}`,
          reference: reference || `DRW-${Date.now()}`,
          status: 'Posted',
          type: 'EquityDrawings',
          createdBy: userId,
          postedBy: userId,
          postedAt: new Date(),
          companyId,
          fiscalYearId,
          lines: {
            create: [
              {
                accountId: account.id,
                accountName: account.name,
                accountCode: account.code,
                debit: amount,
                credit: 0,
              },
              {
                accountId: fundingAccount.id,
                accountName: fundingAccount.name,
                accountCode: fundingAccount.code,
                debit: 0,
                credit: amount,
              },
            ],
          },
        },
      });

      await tx.chartOfAccount.update({
        where: { id: account.id },
        data: { currentBalance: { decrement: amount } },
      });
      await applyFundingBalance(fundingAccount, bankAccount, amount, 'out', tx);

      const txn = await createEquityTransaction(
        account.id,
        'Drawings',
        amount,
        description || `Owner drawings from ${account.name}`,
        reference || '',
        userId,
        companyId,
        { journalEntryId: journal.id, date: postingDate, client: tx }
      );

      return { account, amount, journalEntryId: journal.id, entryNumber: journal.entryNumber, transaction: txn };
    });

    res.status(200).json({
      success: true,
      data: result,
      message: `Drawings of ${amount} recorded successfully`,
    });
  } catch (error) {
    console.error('recordDrawings error:', error);
    res.status(error.statusCode || 500).json({ success: false, message: error.message });
  }
};

/**
 * True reserve transfer: Dr Source Reserve / Cr Destination Reserve
 * (keeps legacy /transfer-retained-earnings for CYE → RE)
 */
exports.transferReserve = async (req, res) => {
  try {
    const {
      fromAccountId,
      toAccountId,
      amount: rawAmount,
      description,
      reference,
      date,
    } = req.body;
    const companyId = req.user.companyId;
    const userId = req.user.id;
    const amount = parseAmount(rawAmount);
    const postingDate = parseTxnDate(date);

    if (!cleanId(fromAccountId) || !cleanId(toAccountId)) {
      return res.status(400).json({
        success: false,
        message: 'Source and destination reserve accounts are required',
      });
    }
    if (String(fromAccountId) === String(toAccountId)) {
      return res.status(400).json({
        success: false,
        message: 'Source and destination accounts must be different',
      });
    }

    const fromAccount = await findLinkedChartAccount(fromAccountId, companyId);
    const toAccount = await findLinkedChartAccount(toAccountId, companyId);

    if (!fromAccount || !toAccount) {
      return res.status(404).json({
        success: false,
        message: 'One or both reserve accounts were not found in Chart of Accounts',
      });
    }
    if (!isEquityReserveLike(fromAccount) || !isEquityReserveLike(toAccount)) {
      return res.status(400).json({
        success: false,
        message: 'Reserve transfer is only allowed between equity/reserve accounts',
      });
    }

    await assertOpenFiscalYear(userId, postingDate);
    const fiscalYearId = await resolveFiscalYearId(userId, postingDate);

    const result = await prisma.$transaction(async (tx) => {
      const journal = await tx.journalEntry.create({
        data: {
          entryNumber: `JE-RSV-${Date.now()}`,
          date: postingDate,
          description: description || `Reserve transfer ${fromAccount.name} → ${toAccount.name}`,
          reference: reference || `RSV-${Date.now()}`,
          status: 'Posted',
          type: 'EquityReserveTransfer',
          createdBy: userId,
          postedBy: userId,
          postedAt: new Date(),
          companyId,
          fiscalYearId,
          lines: {
            create: [
              {
                accountId: fromAccount.id,
                accountName: fromAccount.name,
                accountCode: fromAccount.code,
                debit: amount,
                credit: 0,
              },
              {
                accountId: toAccount.id,
                accountName: toAccount.name,
                accountCode: toAccount.code,
                debit: 0,
                credit: amount,
              },
            ],
          },
        },
      });

      await tx.chartOfAccount.update({
        where: { id: fromAccount.id },
        data: { currentBalance: { decrement: amount } },
      });
      await tx.chartOfAccount.update({
        where: { id: toAccount.id },
        data: { currentBalance: { increment: amount } },
      });

      await createEquityTransaction(
        fromAccount.id,
        'Reserve Transfer',
        amount,
        description || `Transfer out to ${toAccount.name}`,
        reference || '',
        userId,
        companyId,
        { journalEntryId: journal.id, date: postingDate, client: tx, balanceEffect: 'out' }
      );
      // Second history row without duplicate JE link (unique journalEntryId)
      await createEquityTransaction(
        toAccount.id,
        'Reserve Transfer',
        amount,
        description || `Transfer in from ${fromAccount.name}`,
        reference || journal.entryNumber,
        userId,
        companyId,
        { journalEntryId: null, date: postingDate, client: tx, balanceEffect: 'in' }
      );

      return {
        fromAccount,
        toAccount,
        amount,
        journalEntryId: journal.id,
        entryNumber: journal.entryNumber,
      };
    });

    res.status(200).json({
      success: true,
      data: result,
      message: 'Reserve transfer posted successfully',
    });
  } catch (error) {
    console.error('transferReserve error:', error);
    res.status(error.statusCode || 500).json({ success: false, message: error.message });
  }
};

/**
 * Dividend / Distribution payment (or declare+pay).
 * mode: 'paid' (default) | 'declared' | 'settled'
 */
exports.recordDividend = async (req, res) => {
  try {
    const {
      accountId,
      amount: rawAmount,
      description,
      reference,
      paymentMethod,
      bankAccountId,
      date,
      mode: rawMode,
    } = req.body;
    const companyId = req.user.companyId;
    const userId = req.user.id;
    const amount = parseAmount(rawAmount);
    const postingDate = parseTxnDate(date);
    const mode = String(rawMode || 'paid').toLowerCase();

    await assertOpenFiscalYear(userId, postingDate);
    const fiscalYearId = await resolveFiscalYearId(userId, postingDate);

    const result = await prisma.$transaction(async (tx) => {
      const dividendAccount = await ensureDividendEquityAccount(
        userId,
        companyId,
        accountId,
        tx
      );

      if (mode === 'declared') {
        const payable = await ensureDividendPayableLiability(userId, companyId, tx);
        const journal = await tx.journalEntry.create({
          data: {
            entryNumber: `JE-DIV-DEC-${Date.now()}`,
            date: postingDate,
            description: description || `Dividend declared — ${dividendAccount.name}`,
            reference: reference || `DIV-DEC-${Date.now()}`,
            status: 'Posted',
            type: 'EquityDividendDeclared',
            createdBy: userId,
            postedBy: userId,
            postedAt: new Date(),
            companyId,
            fiscalYearId,
            lines: {
              create: [
                {
                  accountId: dividendAccount.id,
                  accountName: dividendAccount.name,
                  accountCode: dividendAccount.code,
                  debit: amount,
                  credit: 0,
                },
                {
                  accountId: payable.id,
                  accountName: payable.name,
                  accountCode: payable.code,
                  debit: 0,
                  credit: amount,
                },
              ],
            },
          },
        });

        await tx.chartOfAccount.update({
          where: { id: dividendAccount.id },
          data: { currentBalance: { decrement: amount } },
        });
        await tx.chartOfAccount.update({
          where: { id: payable.id },
          data: { currentBalance: { increment: amount } },
        });

        const txn = await createEquityTransaction(
          dividendAccount.id,
          'Dividend Declared',
          amount,
          description || `Dividend declared`,
          reference || '',
          userId,
          companyId,
          { journalEntryId: journal.id, date: postingDate, client: tx }
        );

        return {
          mode: 'declared',
          account: dividendAccount,
          amount,
          journalEntryId: journal.id,
          entryNumber: journal.entryNumber,
          transaction: txn,
        };
      }

      const method = paymentMethod || 'Cash';
      if (mode !== 'declared' && method !== 'Cash' && !cleanId(bankAccountId)) {
        const err = new Error('Please select a bank account for this payment method');
        err.statusCode = 400;
        throw err;
      }

      const { fundingAccount, bankAccount } = await resolveFundingAccount(
        userId,
        companyId,
        method,
        bankAccountId,
        tx
      );

      if (mode === 'settled') {
        const payable = await ensureDividendPayableLiability(userId, companyId, tx);
        const journal = await tx.journalEntry.create({
          data: {
            entryNumber: `JE-DIV-PAY-${Date.now()}`,
            date: postingDate,
            description: description || `Dividend paid`,
            reference: reference || `DIV-PAY-${Date.now()}`,
            status: 'Posted',
            type: 'EquityDividendPaid',
            createdBy: userId,
            postedBy: userId,
            postedAt: new Date(),
            companyId,
            fiscalYearId,
            lines: {
              create: [
                {
                  accountId: payable.id,
                  accountName: payable.name,
                  accountCode: payable.code,
                  debit: amount,
                  credit: 0,
                },
                {
                  accountId: fundingAccount.id,
                  accountName: fundingAccount.name,
                  accountCode: fundingAccount.code,
                  debit: 0,
                  credit: amount,
                },
              ],
            },
          },
        });

        await tx.chartOfAccount.update({
          where: { id: payable.id },
          data: { currentBalance: { decrement: amount } },
        });
        await applyFundingBalance(fundingAccount, bankAccount, amount, 'out', tx);

        return {
          mode: 'settled',
          amount,
          journalEntryId: journal.id,
          entryNumber: journal.entryNumber,
        };
      }

      // Default: paid distribution (Dr Dividends / Cr Cash|Bank)
      const journal = await tx.journalEntry.create({
        data: {
          entryNumber: `JE-DIV-${Date.now()}`,
          date: postingDate,
          description: description || `Dividend / distribution — ${dividendAccount.name}`,
          reference: reference || `DIV-${Date.now()}`,
          status: 'Posted',
          type: 'EquityDividend',
          createdBy: userId,
          postedBy: userId,
          postedAt: new Date(),
          companyId,
          fiscalYearId,
          lines: {
            create: [
              {
                accountId: dividendAccount.id,
                accountName: dividendAccount.name,
                accountCode: dividendAccount.code,
                debit: amount,
                credit: 0,
              },
              {
                accountId: fundingAccount.id,
                accountName: fundingAccount.name,
                accountCode: fundingAccount.code,
                debit: 0,
                credit: amount,
              },
            ],
          },
        },
      });

      await tx.chartOfAccount.update({
        where: { id: dividendAccount.id },
        data: { currentBalance: { decrement: amount } },
      });
      await applyFundingBalance(fundingAccount, bankAccount, amount, 'out', tx);

      const txn = await createEquityTransaction(
        dividendAccount.id,
        'Dividend',
        amount,
        description || `Dividend / distribution`,
        reference || '',
        userId,
        companyId,
        { journalEntryId: journal.id, date: postingDate, client: tx }
      );

      return {
        mode: 'paid',
        account: dividendAccount,
        amount,
        journalEntryId: journal.id,
        entryNumber: journal.entryNumber,
        transaction: txn,
      };
    });

    res.status(200).json({
      success: true,
      data: result,
      message: 'Dividend / distribution recorded successfully',
    });
  } catch (error) {
    console.error('recordDividend error:', error);
    res.status(error.statusCode || 500).json({ success: false, message: error.message });
  }
};

// Legacy: Current Year Earnings → Retained Earnings (manual)
exports.transferToRetainedEarnings = async (req, res) => {
  try {
    const { amount: rawAmount, description, reference, date } = req.body;
    const companyId = req.user.companyId;
    const userId = req.user.id;
    const amount = parseAmount(rawAmount);
    const postingDate = parseTxnDate(date);

    await assertOpenFiscalYear(userId, postingDate);
    const fiscalYearId = await resolveFiscalYearId(userId, postingDate);

    let retainedChartAccount = await prisma.chartOfAccount.findFirst({
      where: {
        companyId,
        type: 'Equity',
        OR: [
          { code: '3100' },
          { name: { contains: 'retained', mode: 'insensitive' } },
        ],
      },
    });

    if (!retainedChartAccount) {
      retainedChartAccount = await prisma.chartOfAccount.create({
        data: {
          code: '3100',
          name: 'Retained Earnings',
          type: 'Equity',
          parentAccount: 'Shareholders Equity',
          openingBalance: 0,
          currentBalance: 0,
          description: 'Accumulated retained earnings',
          taxCode: 'N/A',
          balanceType: 'Credit',
          isActive: true,
          createdBy: userId,
          companyId,
        },
      });
    }

    let pnlAccount = await prisma.chartOfAccount.findFirst({
      where: {
        companyId,
        type: 'Equity',
        OR: [
          { code: '3200' },
          { name: { contains: 'current year', mode: 'insensitive' } },
          { name: { contains: 'profit', mode: 'insensitive' } },
        ],
      },
    });

    if (!pnlAccount) {
      pnlAccount = await prisma.chartOfAccount.create({
        data: {
          code: '3200',
          name: 'Current Year Earnings',
          type: 'Equity',
          parentAccount: 'Shareholders Equity',
          openingBalance: 0,
          currentBalance: 0,
          description: 'Profit & Loss Account',
          taxCode: 'N/A',
          balanceType: 'Credit',
          isActive: true,
          createdBy: userId,
          companyId,
        },
      });
    }

    const result = await prisma.$transaction(async (tx) => {
      const journal = await tx.journalEntry.create({
        data: {
          entryNumber: `JE-RE-${Date.now()}`,
          date: postingDate,
          description: description || 'Transfer to retained earnings',
          reference: reference || `RE-${Date.now()}`,
          status: 'Posted',
          type: 'EquityRetainedTransfer',
          createdBy: userId,
          postedBy: userId,
          postedAt: new Date(),
          companyId,
          fiscalYearId,
          lines: {
            create: [
              {
                accountId: pnlAccount.id,
                accountName: pnlAccount.name,
                accountCode: pnlAccount.code,
                debit: amount,
                credit: 0,
              },
              {
                accountId: retainedChartAccount.id,
                accountName: retainedChartAccount.name,
                accountCode: retainedChartAccount.code,
                debit: 0,
                credit: amount,
              },
            ],
          },
        },
      });

      await tx.chartOfAccount.update({
        where: { id: retainedChartAccount.id },
        data: { currentBalance: { increment: amount } },
      });
      await tx.chartOfAccount.update({
        where: { id: pnlAccount.id },
        data: { currentBalance: { decrement: amount } },
      });

      const txn = await createEquityTransaction(
        retainedChartAccount.id,
        'Retained Earnings',
        amount,
        description || 'Transfer to retained earnings',
        reference || '',
        userId,
        companyId,
        { journalEntryId: journal.id, date: postingDate, client: tx }
      );

      return { retainedChartAccount, amount, journalEntryId: journal.id, transaction: txn };
    });

    res.status(200).json({
      success: true,
      data: result,
      message: `${amount} transferred to retained earnings successfully`,
    });
  } catch (error) {
    console.error('transferToRetainedEarnings error:', error);
    res.status(error.statusCode || 500).json({ success: false, message: error.message });
  }
};

exports.getSummary = async (req, res) => {
  try {
    const companyId = req.user.companyId;
    const userId = req.user.id;

    await syncCompanyEquityAccounts(companyId, userId);

    const accounts = await prisma.chartOfAccount.findMany({
      where: { type: 'Equity', companyId, isActive: true },
    });

    const {
      isCurrentYearEarningsAccount,
      liveCurrentYearEarnings,
      earningsWindowForCompany,
    } = require('../utils/profitLossHelper');
    const { buildBalanceSheetFromLedger } = require('../utils/balanceSheetHelper');
    const window = await earningsWindowForCompany(companyId, req.query.fiscalYearId);
    const [currentYearEarnings, bs] = await Promise.all([
      liveCurrentYearEarnings(companyId, window.start, window.end),
      buildBalanceSheetFromLedger(
        userId,
        companyId,
        'All Time',
        window.end,
        req.query.fiscalYearId
      ),
    ]);

    let totalCapital = 0;
    let totalRetainedEarnings = 0;
    let totalReserves = 0;
    let totalDrawings = 0;
    let totalDividends = 0;
    let signedEquityFromCoa = 0;

    for (const account of accounts) {
      const isCye = isCurrentYearEarningsAccount(account);
      const balance = isCye ? currentYearEarnings : Number(account.currentBalance || 0);
      const type = deriveAccountType(account.name);
      if (type === 'Capital' || type === 'Share Capital') totalCapital += balance;
      else if (type === 'Retained Earnings') totalRetainedEarnings += balance;
      else if (type === 'Reserves') totalReserves += balance;
      else if (type === 'Drawings') totalDrawings += Math.abs(balance);
      else if (type === 'Dividends') totalDividends += Math.abs(balance);
      if (!isCye) signedEquityFromCoa += balance;
    }
    signedEquityFromCoa += currentYearEarnings;

    const owners = bs.equity?.owners || [];
    const ownerCapital = owners
      .filter((item) => {
        const name = String(item.name || '').toLowerCase();
        if (/current year earnings/i.test(item.name || '')) return false;
        if (name.includes('retained')) return false;
        if (name.includes('drawing')) return false;
        if (name.includes('dividend') || name.includes('distribution')) return false;
        return true;
      })
      .reduce((sum, item) => sum + Number(item.balance || 0), 0);
    const equityNow = Number(bs.totals?.totalEquity || 0);
    const periodEarnings = currentYearEarnings;
    const changeOnCapital = equityNow - ownerCapital;

    const totalEquity =
      equityNow ||
      signedEquityFromCoa ||
      totalCapital + totalRetainedEarnings + totalReserves - totalDrawings - totalDividends;

    res.status(200).json({
      success: true,
      data: {
        totalCapital: ownerCapital || totalCapital,
        totalRetainedEarnings,
        totalReserves,
        totalDrawings,
        totalDividends,
        totalEquity,
        currentYearEarnings,
        ownerCapital,
        periodEarnings,
        equityNow: totalEquity,
        changeOnCapital,
        isIncrease: periodEarnings >= 0,
        formula:
          "Owner's capital + reserves + retained earnings + current year earnings − drawings − dividends (IAS 1)",
      },
    });
  } catch (error) {
    console.error('getSummary error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.getAllTransactions = async (req, res) => {
  try {
    const companyId = req.user.companyId;
    const { from, to, type, fiscalYearId } = req.query;

    const where = { companyId };
    if (type) where.type = String(type);
    if (from || to) {
      where.date = {};
      if (from) where.date.gte = new Date(from);
      if (to) where.date.lte = new Date(to);
    }
    if (fiscalYearId) {
      const fy = await prisma.fiscalYear.findFirst({
        where: { id: String(fiscalYearId), companyId },
      });
      if (fy) {
        where.date = {
          ...(where.date || {}),
          gte: fy.startDate,
          lte: fy.endDate,
        };
      }
    }

    const transactions = await prisma.equityTransaction.findMany({
      where,
      include: {
        account: true,
        journalEntry: { select: { id: true, entryNumber: true, date: true, status: true } },
      },
      orderBy: { date: 'desc' },
      take: 200,
    });

    const data = transactions.map((txn) => ({
      id: txn.id,
      accountId: txn.accountId,
      accountName: txn.account?.accountName || '',
      type: txn.type,
      date: txn.date,
      amount: txn.amount,
      description: txn.description,
      reference: txn.reference,
      status: txn.status,
      journalEntryId: txn.journalEntryId,
      journalEntryNumber: txn.journalEntry?.entryNumber || null,
      createdBy: txn.createdBy,
      createdAt: txn.createdAt,
      updatedAt: txn.updatedAt,
    }));

    res.status(200).json({ success: true, count: data.length, data });
  } catch (error) {
    console.error('getAllTransactions error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};
