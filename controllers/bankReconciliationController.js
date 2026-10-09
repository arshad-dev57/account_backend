/**
 * Bank Reconciliation API — Prisma rewrite.
 * Company scoping via req.user.companyId / req.companyIdFilter.
 */

const multer = require('multer');
const prisma = require('../prisma/client');
const {
  previewStatementImport,
  confirmStatementImportWithRows,
  getBookTransactions,
  getStatementTransactions,
  autoMatch,
  applyMatch,
  unmatch,
  ignoreStatementTxn,
  refreshReconciliationTotals,
  createReconciliation,
  completeReconciliation,
  reopenReconciliation,
  resolveCompanyBank,
} = require('../services/bankReconciliationService');
const { createBankAdjustment } = require('../services/bankAccountingService');

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const name = String(file.originalname || '').toLowerCase();
    const ok =
      name.endsWith('.xlsx') ||
      name.endsWith('.xls') ||
      name.endsWith('.csv') ||
      [
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'application/vnd.ms-excel',
        'text/csv',
        'application/csv',
      ].includes(file.mimetype);
    if (!ok) return cb(new Error('Only .xlsx, .xls, or .csv files are allowed'));
    cb(null, true);
  },
});

function companyIdOf(req) {
  return req.user?.companyId;
}

function companyFilterOf(req) {
  return req.companyIdFilter ?? req.user?.companyId;
}

function isAdminUser(req) {
  const role = String(req.user?.role || '').toLowerCase();
  return ['admin', 'owner', 'superadmin', 'company_admin'].includes(role);
}

function sendError(res, error, fallback = 'Server error') {
  const status = error.statusCode || 500;
  return res.status(status).json({
    success: false,
    message: error.message || fallback,
    data: error.data || undefined,
  });
}

// ─── List reconciliations / history ─────────────────────────────
exports.listReconciliations = async (req, res) => {
  try {
    const companyId = companyFilterOf(req);
    const { bankAccountId, status, page = 1, limit = 20 } = req.query;
    const where = { companyId };
    if (bankAccountId) where.bankAccountId = String(bankAccountId);
    if (status && status !== 'all') where.status = String(status);

    const take = Math.min(100, Math.max(1, Number(limit) || 20));
    const skip = (Math.max(1, Number(page) || 1) - 1) * take;

    const [total, items] = await Promise.all([
      prisma.bankReconciliation.count({ where }),
      prisma.bankReconciliation.findMany({
        where,
        orderBy: [{ statementEndDate: 'desc' }, { createdAt: 'desc' }],
        skip,
        take,
        include: {
          bankAccount: {
            select: { id: true, accountName: true, accountNumber: true, bankName: true },
          },
          completer: { select: { id: true, firstName: true, lastName: true, email: true } },
          creator: { select: { id: true, firstName: true, lastName: true, email: true } },
        },
      }),
    ]);

    res.json({
      success: true,
      data: items,
      meta: { total, page: Number(page) || 1, limit: take, pages: Math.ceil(total / take) || 1 },
    });
  } catch (error) {
    console.error('listReconciliations', error);
    sendError(res, error);
  }
};

exports.getReconciliation = async (req, res) => {
  try {
    const companyId = companyIdOf(req);
    const { id } = req.params;
    let recon = await prisma.bankReconciliation.findFirst({
      where: { id, companyId },
      include: {
        bankAccount: {
          select: {
            id: true,
            accountName: true,
            accountNumber: true,
            bankName: true,
            currentBalance: true,
            chartOfAccountId: true,
            statementColumnMapping: true,
          },
        },
        import: true,
        completer: { select: { id: true, firstName: true, lastName: true, email: true } },
        creator: { select: { id: true, firstName: true, lastName: true, email: true } },
      },
    });
    if (!recon) {
      return res.status(404).json({ success: false, message: 'Reconciliation not found' });
    }
    if (recon.status !== 'Completed') {
      recon = await refreshReconciliationTotals(recon.id);
      recon = await prisma.bankReconciliation.findFirst({
        where: { id: recon.id },
        include: {
          bankAccount: {
            select: {
              id: true,
              accountName: true,
              accountNumber: true,
              bankName: true,
              currentBalance: true,
              chartOfAccountId: true,
              statementColumnMapping: true,
            },
          },
          import: true,
          completer: { select: { id: true, firstName: true, lastName: true, email: true } },
          creator: { select: { id: true, firstName: true, lastName: true, email: true } },
        },
      });
    }

    const statementTransactionCount = await prisma.bankStatementTransaction.count({
      where: { reconciliationId: recon.id, companyId },
    });
    const statementImported = statementTransactionCount > 0;

    const adjustedBankBalance = statementImported
      ? Number(recon.statementClosingBalance || 0) +
        Number(recon.outstandingDeposits || 0) -
        Number(recon.outstandingPayments || 0)
      : Number(recon.statementClosingBalance || 0);

    res.json({
      success: true,
      data: {
        ...recon,
        statementImported,
        statementTransactionCount,
        adjustedBankBalance,
        summary: {
          bankBalance: recon.statementClosingBalance,
          bookBalance: recon.bookClosingBalance,
          outstandingDeposits: statementImported ? recon.outstandingDeposits : 0,
          outstandingPayments: statementImported ? recon.outstandingPayments : 0,
          bankCharges: recon.bankChargesTotal,
          bankInterest: recon.bankInterestTotal,
          otherAdjustments: recon.otherAdjustments,
          difference: recon.difference,
          matchedCount: statementImported ? recon.matchedCount : 0,
          unmatchedBankCount: statementImported ? recon.unmatchedBankCount : 0,
          unmatchedBookCount: statementImported ? recon.unmatchedBookCount : 0,
          reconciledAmount: statementImported ? recon.reconciledAmount : 0,
          unreconciledAmount: statementImported ? recon.unreconciledAmount : 0,
          statementImported,
        },
      },
    });
  } catch (error) {
    console.error('getReconciliation', error);
    sendError(res, error);
  }
};

exports.createReconciliation = async (req, res) => {
  try {
    const companyId = companyIdOf(req);
    if (!companyId) {
      return res.status(400).json({ success: false, message: 'Company context required' });
    }
    const {
      bankAccountId,
      statementStartDate,
      statementEndDate,
      statementOpeningBalance,
      statementClosingBalance,
      importId,
    } = req.body || {};

    const recon = await createReconciliation({
      companyId,
      userId: req.user.id,
      bankAccountId,
      statementStartDate,
      statementEndDate,
      statementOpeningBalance,
      statementClosingBalance,
      importId,
    });

    res.status(201).json({ success: true, data: recon, message: 'Reconciliation created' });
  } catch (error) {
    console.error('createReconciliation', error);
    sendError(res, error);
  }
};

exports.uploadMiddleware = upload.single('file');

exports.previewImport = async (req, res) => {
  try {
    const companyId = companyIdOf(req);
    if (!companyId) {
      return res.status(400).json({ success: false, message: 'Company context required' });
    }
    if (!req.file?.buffer) {
      return res.status(400).json({ success: false, message: 'File is required' });
    }

    let columnMapping = null;
    if (req.body.columnMapping) {
      try {
        columnMapping =
          typeof req.body.columnMapping === 'string'
            ? JSON.parse(req.body.columnMapping)
            : req.body.columnMapping;
      } catch {
        columnMapping = null;
      }
    }

    const data = await previewStatementImport({
      companyId,
      userId: req.user.id,
      bankAccountId: req.body.bankAccountId,
      buffer: req.file.buffer,
      fileName: req.file.originalname,
      columnMapping,
      openingBalance: req.body.openingBalance,
      closingBalance: req.body.closingBalance,
    });

    res.json({ success: true, data });
  } catch (error) {
    console.error('previewImport', error);
    sendError(res, error);
  }
};

exports.confirmImport = async (req, res) => {
  try {
    const companyId = companyIdOf(req);
    const {
      importId,
      rows,
      columnMapping,
      openingBalance,
      closingBalance,
      skipDuplicates = true,
      rememberMapping = true,
      reconciliationId = null,
    } = req.body || {};

    if (!importId || !Array.isArray(rows)) {
      return res.status(400).json({
        success: false,
        message: 'importId and rows are required',
      });
    }

    const data = await confirmStatementImportWithRows({
      companyId,
      userId: req.user.id,
      importId,
      rows,
      columnMapping,
      openingBalance,
      closingBalance,
      skipDuplicates,
      rememberMapping,
      reconciliationId,
    });

    res.json({
      success: true,
      data,
      message: `Imported ${data.imported} transaction(s); skipped ${data.skippedDuplicates} duplicate(s)`,
    });
  } catch (error) {
    console.error('confirmImport', error);
    sendError(res, error);
  }
};

exports.listStatementTransactions = async (req, res) => {
  try {
    const companyId = companyIdOf(req);
    const data = await getStatementTransactions({
      companyId,
      bankAccountId: req.query.bankAccountId,
      reconciliationId: req.query.reconciliationId,
      importId: req.query.importId,
      status: req.query.status,
      search: req.query.search || '',
      startDate: req.query.startDate,
      endDate: req.query.endDate,
      minAmount: req.query.minAmount,
      maxAmount: req.query.maxAmount,
      page: Number(req.query.page) || 1,
      limit: Math.min(200, Number(req.query.limit) || 50),
    });
    res.json({ success: true, data });
  } catch (error) {
    console.error('listStatementTransactions', error);
    sendError(res, error);
  }
};

exports.listBookTransactions = async (req, res) => {
  try {
    const companyId = companyIdOf(req);
    const data = await getBookTransactions({
      companyId,
      bankAccountId: req.query.bankAccountId,
      startDate: req.query.startDate,
      endDate: req.query.endDate,
      unmatchedOnly: String(req.query.unmatchedOnly || '') === 'true',
      search: req.query.search || '',
      page: Number(req.query.page) || 1,
      limit: Math.min(200, Number(req.query.limit) || 50),
    });
    res.json({ success: true, data });
  } catch (error) {
    console.error('listBookTransactions', error);
    sendError(res, error);
  }
};

exports.runAutoMatch = async (req, res) => {
  try {
    const companyId = companyIdOf(req);
    const { id } = req.params;
    const data = await autoMatch({
      companyId,
      userId: req.user.id,
      reconciliationId: id,
      dateWindowDays: Number(req.body?.dateWindowDays) || 7,
    });
    const recon = await refreshReconciliationTotals(id);
    res.json({
      success: true,
      data: { ...data, reconciliation: recon },
      message: `Auto-matched ${data.matched} transaction(s)`,
    });
  } catch (error) {
    console.error('runAutoMatch', error);
    sendError(res, error);
  }
};

exports.manualMatch = async (req, res) => {
  try {
    const companyId = companyIdOf(req);
    const { id } = req.params;
    const { statementTransactionId, journalLineId } = req.body || {};
    if (!statementTransactionId || !journalLineId) {
      return res.status(400).json({
        success: false,
        message: 'statementTransactionId and journalLineId are required',
      });
    }
    const match = await applyMatch({
      companyId,
      userId: req.user.id,
      reconciliationId: id,
      statementTransactionId,
      journalLineId,
      matchType: 'manual',
      matchReason: 'manual selection',
    });
    const recon = await refreshReconciliationTotals(id);
    res.json({ success: true, data: { match, reconciliation: recon }, message: 'Matched' });
  } catch (error) {
    console.error('manualMatch', error);
    sendError(res, error);
  }
};

exports.unmatchPair = async (req, res) => {
  try {
    const companyId = companyIdOf(req);
    const { id } = req.params;
    await unmatch({
      companyId,
      userId: req.user.id,
      reconciliationId: id,
      matchId: req.body?.matchId,
      statementTransactionId: req.body?.statementTransactionId,
    });
    const recon = await refreshReconciliationTotals(id);
    res.json({ success: true, data: recon, message: 'Unmatched' });
  } catch (error) {
    console.error('unmatchPair', error);
    sendError(res, error);
  }
};

exports.ignoreTransaction = async (req, res) => {
  try {
    const companyId = companyIdOf(req);
    const { id } = req.params;
    await ignoreStatementTxn({
      companyId,
      reconciliationId: id,
      statementTransactionId: req.body?.statementTransactionId,
      notes: req.body?.notes,
    });
    const recon = await refreshReconciliationTotals(id);
    res.json({ success: true, data: recon, message: 'Marked as ignored' });
  } catch (error) {
    console.error('ignoreTransaction', error);
    sendError(res, error);
  }
};

exports.createAdjustment = async (req, res) => {
  try {
    const companyId = companyIdOf(req);
    const { id } = req.params;
    const recon = await prisma.bankReconciliation.findFirst({
      where: { id, companyId },
    });
    if (!recon) {
      return res.status(404).json({ success: false, message: 'Reconciliation not found' });
    }
    if (recon.status === 'Completed') {
      return res.status(400).json({ success: false, message: 'Completed reconciliation is locked' });
    }

    const {
      type = 'charge',
      amount,
      offsetAccountId,
      description,
      reference,
      postingDate,
      statementTransactionId,
      autoMatchAfter = true,
    } = req.body || {};

    const result = await createBankAdjustment({
      userId: req.user.id,
      companyId,
      bankAccountId: recon.bankAccountId,
      amount,
      offsetAccountId,
      type,
      description,
      reference,
      postingDate: postingDate || recon.statementEndDate,
    });

    let match = null;
    if (autoMatchAfter && statementTransactionId && result.journalEntry?.lines) {
      const bank = await resolveCompanyBank(companyId, recon.bankAccountId);
      const bankLine = result.journalEntry.lines.find((l) => l.accountId === bank.chartOfAccountId);
      if (bankLine) {
        try {
          match = await applyMatch({
            companyId,
            userId: req.user.id,
            reconciliationId: id,
            statementTransactionId,
            journalLineId: bankLine.id,
            matchType: 'manual',
            matchReason: 'created from reconciliation',
          });
        } catch (e) {
          console.warn('auto-match after adjustment failed', e.message);
        }
      }
    }

    // Track charges/interest totals
    if (type === 'charge' || type === 'interest') {
      await prisma.bankReconciliation.update({
        where: { id },
        data:
          type === 'charge'
            ? { bankChargesTotal: { increment: Number(amount) || 0 } }
            : { bankInterestTotal: { increment: Number(amount) || 0 } },
      });
    } else {
      await prisma.bankReconciliation.update({
        where: { id },
        data: { otherAdjustments: { increment: Number(amount) || 0 } },
      });
    }

    const refreshed = await refreshReconciliationTotals(id);
    res.status(201).json({
      success: true,
      data: { journalEntry: result.journalEntry, match, reconciliation: refreshed },
      message: result.duplicate ? 'Existing journal reused' : 'Accounting entry created',
    });
  } catch (error) {
    console.error('createAdjustment', error);
    sendError(res, error);
  }
};

exports.complete = async (req, res) => {
  try {
    const companyId = companyIdOf(req);
    const { id } = req.params;
    const { exceptionAllowed, exceptionNote } = req.body || {};
    const recon = await completeReconciliation({
      companyId,
      userId: req.user.id,
      reconciliationId: id,
      exceptionAllowed: !!exceptionAllowed,
      exceptionNote,
      isAdmin: isAdminUser(req),
    });
    res.json({ success: true, data: recon, message: 'Reconciliation completed' });
  } catch (error) {
    console.error('complete', error);
    sendError(res, error);
  }
};

exports.reopen = async (req, res) => {
  try {
    const companyId = companyIdOf(req);
    const { id } = req.params;
    const recon = await reopenReconciliation({
      companyId,
      userId: req.user.id,
      reconciliationId: id,
      isAdmin: isAdminUser(req),
    });
    res.json({ success: true, data: recon, message: 'Reconciliation reopened' });
  } catch (error) {
    console.error('reopen', error);
    sendError(res, error);
  }
};

exports.refresh = async (req, res) => {
  try {
    const companyId = companyIdOf(req);
    const { id } = req.params;
    const existing = await prisma.bankReconciliation.findFirst({
      where: { id, companyId },
    });
    if (!existing) {
      return res.status(404).json({ success: false, message: 'Reconciliation not found' });
    }
    const recon = await refreshReconciliationTotals(id);
    res.json({ success: true, data: recon });
  } catch (error) {
    console.error('refresh', error);
    sendError(res, error);
  }
};

/** Dashboard helpers — bank accounts with open recon status */
exports.dashboard = async (req, res) => {
  try {
    const companyId = companyFilterOf(req);
    const banks = await prisma.bankAccount.findMany({
      where: { companyId, status: 'Active' },
      select: {
        id: true,
        accountName: true,
        accountNumber: true,
        bankName: true,
        currentBalance: true,
        lastReconciled: true,
        currency: true,
      },
      orderBy: { accountName: 'asc' },
    });

    const open = await prisma.bankReconciliation.findMany({
      where: {
        companyId,
        status: { in: ['Draft', 'InProgress', 'Reconciled'] },
      },
      select: { id: true, bankAccountId: true, status: true, difference: true, statementEndDate: true },
    });
    const openByBank = Object.fromEntries(open.map((r) => [r.bankAccountId, r]));

    const recent = await prisma.bankReconciliation.findMany({
      where: { companyId },
      orderBy: { updatedAt: 'desc' },
      take: 8,
      include: {
        bankAccount: { select: { accountName: true, accountNumber: true } },
        completer: { select: { firstName: true, lastName: true } },
      },
    });

    res.json({
      success: true,
      data: {
        bankAccounts: banks.map((b) => ({
          ...b,
          openReconciliation: openByBank[b.id] || null,
        })),
        recent,
        stats: {
          activeBanks: banks.length,
          openReconciliations: open.length,
          completedThisMonth: await prisma.bankReconciliation.count({
            where: {
              companyId,
              status: 'Completed',
              completedAt: { gte: new Date(new Date().getFullYear(), new Date().getMonth(), 1) },
            },
          }),
        },
      },
    });
  } catch (error) {
    console.error('dashboard', error);
    sendError(res, error);
  }
};

// Legacy-compatible stubs (old Mongo routes)
exports.getReconciliationData = async (req, res) => {
  try {
    const companyId = companyIdOf(req);
    const bank = await resolveCompanyBank(companyId, req.params.accountId);
    const startDate = req.query.startDate || bank.lastReconciled;
    const endDate = req.query.endDate || new Date();
    const book = await getBookTransactions({
      companyId,
      bankAccountId: bank.id,
      startDate,
      endDate,
      page: 1,
      limit: 500,
    });
    res.json({
      success: true,
      data: {
        account: {
          id: bank.id,
          name: bank.accountName,
          number: bank.accountNumber,
          openingBalance: bank.openingBalance,
          currentBalance: bank.currentBalance,
          lastReconciled: bank.lastReconciled,
        },
        transactions: book.items,
        bookBalance: bank.currentBalance,
      },
    });
  } catch (error) {
    sendError(res, error);
  }
};

exports.getReconciliationHistory = async (req, res) => {
  req.query.bankAccountId = req.params.accountId;
  return exports.listReconciliations(req, res);
};
