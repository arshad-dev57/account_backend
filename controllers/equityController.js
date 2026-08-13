const prisma = require('../prisma/client');
// ── HELPER: get or create cash account ───────────────────────
async function getCashAccount(userId, companyId) {
  let cash = await prisma.chartOfAccount.findFirst({
    where: { code: '1010', companyId }
  });
  if (!cash) {
    cash = await prisma.chartOfAccount.create({
      data: {
        code: '1010',
        name: 'Cash in Hand',
        type: 'Assets',
        parentAccount: 'Current Assets',
        openingBalance: 0,
        currentBalance: 0,
        description: 'Physical cash',
        taxCode: 'N/A',
        balanceType: 'Debit',
        isActive: true,
        createdBy: userId,
        companyId
      }
    });
  }
  return cash;
}

// ── HELPER: derive accountType from account name ──────────────
function deriveAccountType(name) {
  const n = (name || '').toLowerCase();
  if (n.includes('drawing')) return 'Drawings';
  if (n.includes('retained') || n.includes('retention')) return 'Retained Earnings';
  if (n.includes('reserve')) return 'Reserves';
  if (n.includes('share')) return 'Share Capital';
  return 'Capital';
}

// ── HELPER: create EquityTransaction record ───────────────────
async function createEquityTransaction(accountId, type, amount, description, reference, userId, companyId) {
  // Find EquityAccount by accountCode matching ChartOfAccount
  const chartAccount = await prisma.chartOfAccount.findUnique({ where: { id: accountId } });
  if (!chartAccount) return;

  let equityAccount = await prisma.equityAccount.findFirst({
    where: { accountCode: chartAccount.code, companyId }
  });

  if (!equityAccount) {
    equityAccount = await prisma.equityAccount.create({
      data: {
        accountName: chartAccount.name,
        accountCode: chartAccount.code,
        accountType: deriveAccountType(chartAccount.name),
        openingBalance: chartAccount.openingBalance,
        currentBalance: chartAccount.currentBalance,
        additions: 0,
        withdrawals: 0,
        notes: '',
        createdBy: userId,
        companyId
      }
    });
  }

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


    let where = { companyId };
    if (accountType && accountType !== 'All') where.accountType = accountType;
    if (search) {
      where.OR = [
        { accountName: { contains: search, mode: 'insensitive' } },
        { accountCode: { contains: search, mode: 'insensitive' } },
      ];
    }

    const accounts = await prisma.equityAccount.findMany({
      where,
      include: { transactions: { orderBy: { date: 'desc' }, take: 50 } },
      orderBy: { createdAt: 'desc' }
    });

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

    const existing = await prisma.equityAccount.findFirst({
      where: { accountCode, companyId }
    });
    if (existing) {
      return res.status(400).json({
        success: false,
        message: 'Equity account with this code already exists'
      });
    }

    const equityAccount = await prisma.equityAccount.create({
      data: {
        accountName,
        accountCode,
        accountType,
        openingBalance: openingBalance || 0,
        currentBalance: openingBalance || 0,
        additions: 0,
        withdrawals: 0,
        notes: notes || '',
        createdBy: userId,
        companyId
      }
    });

    // Also create/update corresponding ChartOfAccount
    let chartAccount = await prisma.chartOfAccount.findFirst({
      where: { code: accountCode, companyId }
    });

    if (!chartAccount) {
      await prisma.chartOfAccount.create({
        data: {
          code: accountCode,
          name: accountName,
          type: 'Equity',
          parentAccount: 'Shareholders Equity',
          openingBalance: openingBalance || 0,
          currentBalance: openingBalance || 0,
          description: accountName,
          taxCode: 'N/A',
          balanceType: 'Credit',
          isActive: true,
          createdBy: userId,
          companyId
        }
      });
    }

    // Journal entry for opening balance
    if (openingBalance > 0) {
      const cashAccount = await getCashAccount(userId, companyId);
      chartAccount = chartAccount || await prisma.chartOfAccount.findFirst({
        where: { code: accountCode, companyId }
      });

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
    const { accountId, amount, description, reference } = req.body;
    const companyId = req.user.companyId;
    const userId = req.user.id;

    const account = await prisma.chartOfAccount.findFirst({
      where: { id: accountId, companyId }
    });

    if (!account) {
      return res.status(404).json({ success: false, message: 'Account not found' });
    }

    const cashAccount = await getCashAccount(userId, companyId);

    // Journal Entry: Cash Dr / Equity Cr
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
              accountId: cashAccount.id,
              accountName: cashAccount.name,
              accountCode: cashAccount.code,
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

    // Update ChartOfAccount balance — THIS is what Flutter reads
    await prisma.chartOfAccount.update({
      where: { id: accountId },
      data: { currentBalance: { increment: amount } }
    });

    // Create EquityTransaction for history
    await createEquityTransaction(
      accountId, 'Additional Capital', amount,
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
    res.status(500).json({ success: false, message: error.message });
  }
};

// ==================== RECORD DRAWINGS ====================
exports.recordDrawings = async (req, res) => {
  try {
    const { accountId, amount, description, reference } = req.body;
    const companyId = req.user.companyId;
    const userId = req.user.id;

    // accountId = ChartOfAccount.id (sent from Flutter)
    const account = await prisma.chartOfAccount.findFirst({
      where: { id: accountId, companyId }
    });

    if (!account) {
      return res.status(404).json({ success: false, message: 'Account not found' });
    }

    const cashAccount = await getCashAccount(userId, companyId);

    // Journal Entry: Drawings Dr / Cash Cr
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
              accountId: cashAccount.id,
              accountName: cashAccount.name,
              accountCode: cashAccount.code,
              debit: 0,
              credit: amount
            },
          ]
        }
      }
    });

    // Update ChartOfAccount balance — Drawings account increases with debit
    await prisma.chartOfAccount.update({
      where: { id: accountId },
      data: { currentBalance: { increment: amount } }
    });

    // Create EquityTransaction for history
    await createEquityTransaction(
      accountId, 'Drawings', amount,
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
    res.status(500).json({ success: false, message: error.message });
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
        OR: [
          { name: { contains: 'retained', mode: 'insensitive' } },
          { code: '3020' }
        ]
      }
    });

    if (!retainedChartAccount) {
      retainedChartAccount = await prisma.chartOfAccount.create({
        data: {
          code: '3020',
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
      where: { code: '3000', companyId }
    });

    if (!pnlAccount) {
      pnlAccount = await prisma.chartOfAccount.create({
        data: {
          code: '3000',
          name: 'Profit & Loss',
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


    const accounts = await prisma.chartOfAccount.findMany({
      where: { type: 'Equity', companyId }
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

