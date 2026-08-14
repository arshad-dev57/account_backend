const prisma = require('../prisma/client');
const { getOrCreateCashAccount } = require('../utils/cashAccountHelper');
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

/**
 * Cash → Cash in Hand (1001). Bank Transfer/Cheque/etc → selected bank COA.
 */
async function resolveFundingAccount(userId, companyId, paymentMethod, bankAccountId) {
  const method = paymentMethod || 'Cash';
  const bankId = cleanId(bankAccountId);
  const useBank = method !== 'Cash' && !!bankId;

  if (useBank) {
    const bankAccount = await prisma.bankAccount.findFirst({
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

  const cash = await getOrCreateCashAccount(userId, companyId);
  return { fundingAccount: cash, bankAccount: null };
}

/** direction 'in' = owner injects (capital), 'out' = owner withdraws (drawings) */
async function applyFundingBalance(fundingAccount, bankAccount, amount, direction) {
  const delta = direction === 'in' ? amount : -amount;
  await prisma.chartOfAccount.update({
    where: { id: fundingAccount.id },
    data: { currentBalance: { increment: delta } },
  });
  if (bankAccount) {
    await prisma.bankAccount.update({
      where: { id: bankAccount.id },
      data: { currentBalance: { increment: delta } },
    });
  }
}

// ── HELPER: create EquityTransaction record ───────────────────
async function createEquityTransaction(accountId, type, amount, description, reference, userId, companyId) {
  const chartAccount = await prisma.chartOfAccount.findUnique({ where: { id: accountId } });
  if (!chartAccount) return;

  const equityAccount = await ensureEquityAccountForChart(
    chartAccount,
    userId,
    companyId
  );
  if (!equityAccount) return;

  await prisma.equityTransaction.create({
    data: {
      accountId: equityAccount.id,
      type,
      amount,
      description,
      reference: reference || '',
      status: 'Posted',
      createdBy: userId,
      companyId
    }
  });

  // Update EquityAccount additions/withdrawals
  const isWithdrawal = type === 'Drawings';
  await prisma.equityAccount.update({
    where: { id: equityAccount.id },
    data: {
      currentBalance: isWithdrawal
        ? { decrement: amount }
        : { increment: amount },
      additions: isWithdrawal ? undefined : { increment: amount },
      withdrawals: isWithdrawal ? { increment: amount } : undefined,
      lastUpdated: new Date()
    }
  });
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
    }));

    if (accountType && accountType !== 'All') {
      accounts = accounts.filter((a) => a.accountType === accountType);
    }

    const responseData = { count: accounts.length, data: accounts };
    res.status(200).json({ success: true, ...responseData });
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

    // Journal entry for opening balance
    if (openingBalance > 0) {
      const cashAccount = await getOrCreateCashAccount(userId, companyId);

      await prisma.journalEntry.create({
        data: {
          entryNumber: `JE-${Date.now()}`,
          date: new Date(),
          description: `Opening balance for ${accountName}`,
          reference: accountCode,
          status: 'Posted',
          createdBy: userId,
          postedBy: userId,
          postedAt: new Date(),
          companyId,
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
    res.status(500).json({ success: false, message: error.message });
  }
};

// ==================== GET SINGLE EQUITY ACCOUNT ====================
exports.getEquityAccount = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;
    const companyId = req.user.companyId;


    const account = await prisma.equityAccount.findFirst({
      where: { id, companyId },
      include: { transactions: { orderBy: { date: 'desc' } } }
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

// ==================== UPDATE EQUITY ACCOUNT ====================
exports.updateEquityAccount = async (req, res) => {
  try {
    const { notes, accountName } = req.body;
    const companyId = req.user.companyId;
    const userId = req.user.id;

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
    const userId = req.user.id;

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
    const { accountId, amount, description, reference, paymentMethod, bankAccountId } = req.body;
    const companyId = req.user.companyId;
    const userId = req.user.id;

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

    const { fundingAccount, bankAccount } = await resolveFundingAccount(
      userId,
      companyId,
      method,
      bankAccountId
    );

    // Journal: Cash/Bank Dr / Equity Cr
    await prisma.journalEntry.create({
      data: {
        entryNumber: `JE-${Date.now()}`,
        date: new Date(),
        description: description || `Additional capital to ${account.name}`,
        reference: reference || `CAP-${Date.now()}`,
        status: 'Posted',
        createdBy: userId,
        postedBy: userId,
        postedAt: new Date(),
        companyId,
        lines: {
          create: [
            {
              accountId: fundingAccount.id,
              accountName: fundingAccount.name,
              accountCode: fundingAccount.code,
              debit: amount,
              credit: 0
            },
            {
              accountId: account.id,
              accountName: account.name,
              accountCode: account.code,
              debit: 0,
              credit: amount
            },
          ]
        }
      }
    });

    await prisma.chartOfAccount.update({
      where: { id: account.id },
      data: { currentBalance: { increment: amount } }
    });
    await applyFundingBalance(fundingAccount, bankAccount, amount, 'in');

    await createEquityTransaction(
      account.id, 'Additional Capital', amount,
      description || `Additional capital to ${account.name}`,
      reference || '', userId, companyId
    );

    res.status(200).json({
      success: true,
      data: { account, amount },
      message: 'Capital added successfully'
    });

  } catch (error) {
    console.error('addCapital error:', error);
    res.status(error.statusCode || 500).json({ success: false, message: error.message });
  }
};

// ==================== RECORD DRAWINGS ====================
exports.recordDrawings = async (req, res) => {
  try {
    const { accountId, amount, description, reference, paymentMethod, bankAccountId } = req.body;
    const companyId = req.user.companyId;
    const userId = req.user.id;

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

    const { fundingAccount, bankAccount } = await resolveFundingAccount(
      userId,
      companyId,
      method,
      bankAccountId
    );

    // Journal: Drawings Dr / Cash or Bank Cr
    await prisma.journalEntry.create({
      data: {
        entryNumber: `JE-${Date.now()}`,
        date: new Date(),
        description: description || `Owner drawings from ${account.name}`,
        reference: reference || `DRW-${Date.now()}`,
        status: 'Posted',
        createdBy: userId,
        postedBy: userId,
        postedAt: new Date(),
        companyId,
        lines: {
          create: [
            {
              accountId: account.id,
              accountName: account.name,
              accountCode: account.code,
              debit: amount,
              credit: 0
            },
            {
              accountId: fundingAccount.id,
              accountName: fundingAccount.name,
              accountCode: fundingAccount.code,
              debit: 0,
              credit: amount
            },
          ]
        }
      }
    });

    await prisma.chartOfAccount.update({
      where: { id: account.id },
      data: { currentBalance: { increment: amount } }
    });
    await applyFundingBalance(fundingAccount, bankAccount, amount, 'out');

    await createEquityTransaction(
      account.id, 'Drawings', amount,
      description || `Owner drawings from ${account.name}`,
      reference || '', userId, companyId
    );

    res.status(200).json({
      success: true,
      data: { account, amount },
      message: `Drawings of ${amount} recorded successfully`
    });

  } catch (error) {
    console.error('recordDrawings error:', error);
    res.status(error.statusCode || 500).json({ success: false, message: error.message });
  }
};

// ==================== TRANSFER TO RETAINED EARNINGS ====================
exports.transferToRetainedEarnings = async (req, res) => {
  try {
    const { amount, description, reference } = req.body;
    const companyId = req.user.companyId;
    const userId = req.user.id;

    // Find or create Retained Earnings in ChartOfAccount
    let retainedChartAccount = await prisma.chartOfAccount.findFirst({
      where: {
        companyId,
        type: 'Equity',
        OR: [
          { code: '3100' },
          { name: { contains: 'retained', mode: 'insensitive' } },
        ]
      }
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
          companyId
        }
      });
    }

    // Find or create P&L account
    let pnlAccount = await prisma.chartOfAccount.findFirst({
      where: {
        companyId,
        type: 'Equity',
        OR: [
          { code: '3200' },
          { name: { contains: 'current year', mode: 'insensitive' } },
          { name: { contains: 'profit', mode: 'insensitive' } },
        ]
      }
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
          companyId
        }
      });
    }

    // Journal Entry: P&L Dr / Retained Earnings Cr
    await prisma.journalEntry.create({
      data: {
        entryNumber: `JE-${Date.now()}`,
        date: new Date(),
        description: description || 'Transfer to retained earnings',
        reference: reference || `RE-${Date.now()}`,
        status: 'Posted',
        createdBy: userId,
        postedBy: userId,
        postedAt: new Date(),
        companyId,
        lines: {
          create: [
            {
              accountId: pnlAccount.id,
              accountName: pnlAccount.name,
              accountCode: pnlAccount.code,
              debit: amount,
              credit: 0
            },
            {
              accountId: retainedChartAccount.id,
              accountName: retainedChartAccount.name,
              accountCode: retainedChartAccount.code,
              debit: 0,
              credit: amount
            },
          ]
        }
      }
    });

    // Update ChartOfAccount balance — THIS makes it appear on Flutter screen
    await prisma.chartOfAccount.update({
      where: { id: retainedChartAccount.id },
      data: { currentBalance: { increment: amount } }
    });

    // Create EquityTransaction for history
    await createEquityTransaction(
      retainedChartAccount.id, 'Retained Earnings', amount,
      description || 'Transfer to retained earnings',
      reference || '', userId, companyId
    );

    res.status(200).json({
      success: true,
      data: { retainedChartAccount, amount },
      message: `${amount} transferred to retained earnings successfully`
    });

  } catch (error) {
    console.error('transferToRetainedEarnings error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// ==================== GET SUMMARY ====================
exports.getSummary = async (req, res) => {
  try {
    const companyId = req.user.companyId;
    const userId = req.user.id;


    await syncCompanyEquityAccounts(companyId, userId);

    const accounts = await prisma.chartOfAccount.findMany({
      where: { type: 'Equity', companyId, isActive: true }
    });

    let totalCapital = 0;
    let totalRetainedEarnings = 0;
    let totalReserves = 0;
    let totalDrawings = 0;

    for (const account of accounts) {
      const balance = account.currentBalance || 0;
      const type = deriveAccountType(account.name);
      if (type === 'Capital' || type === 'Share Capital') totalCapital += balance;
      else if (type === 'Retained Earnings') totalRetainedEarnings += balance;
      else if (type === 'Reserves') totalReserves += balance;
      else if (type === 'Drawings') totalDrawings += balance;
    }

    const totalEquity = totalCapital + totalRetainedEarnings + totalReserves - totalDrawings;

    const summaryData = {
      totalCapital,
      totalRetainedEarnings,
      totalReserves,
      totalDrawings,
      totalEquity
    };

    res.status(200).json({ success: true, data: summaryData });
  } catch (error) {
    console.error('getSummary error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// ==================== GET ALL TRANSACTIONS ====================
exports.getAllTransactions = async (req, res) => {
  try {
    const companyId = req.user.companyId;
    const userId = req.user.id;


    const transactions = await prisma.equityTransaction.findMany({
      where: { companyId },
      include: { account: true },
      orderBy: { date: 'desc' },
      take: 100
    });

    const data = transactions.map(txn => ({
      id: txn.id,
      accountName: txn.account?.accountName || '',
      type: txn.type,
      date: txn.date,
      amount: txn.amount,
      description: txn.description,
      reference: txn.reference
    }));

    const responseData = { count: data.length, data };
    res.status(200).json({ success: true, ...responseData });
  } catch (error) {
    console.error('getAllTransactions error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

