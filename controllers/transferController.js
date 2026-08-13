/**
 * controllers/transferController.js
 * Bank-to-bank transfer via Prisma + bankAccountingService.
 * Accounting: Dr Destination Bank / Cr Source Bank (no P&L).
 */

const prisma = require('../prisma/client');
const { createBankTransfer } = require('../services/bankAccountingService');
// @desc    Transfer money between bank accounts
// @route   POST /api/transfers
// @access  Private
exports.transferMoney = async (req, res) => {
  try {
    const {
      fromAccountId,
      toAccountId,
      amount,
      date,
      reference,
      description
    } = req.body;

    const userId = req.user.id;
    const companyId = req.user.companyId;

    const result = await createBankTransfer({
      userId,
      companyId,
      fromBankAccountId: fromAccountId,
      toBankAccountId: toAccountId,
      amount,
      postingDate: date ? new Date(date) : new Date(),
      description,
      reference
    });

    try {
    } catch (_) {}

    return res.status(result.duplicate ? 200 : 201).json({
      success: true,
      data: {
        journalEntry: result.journalEntry,
        fromAccount: result.fromAccount,
        toAccount: result.toAccount
      },
      duplicate: !!result.duplicate,
      message: result.duplicate
        ? 'Transfer already recorded (duplicate reference)'
        : 'Transfer completed successfully'
    });
  } catch (error) {
    console.error('❌ Transfer error:', error);
    const statusCode =
      error.statusCode || (error.code === 'FISCAL_YEAR_CLOSED' ? 400 : 500);
    return res.status(statusCode).json({
      success: false,
      message: error.message || 'Transfer failed'
    });
  }
};

// @desc    Get transfer history (JournalEntries type BankTransfer)
// @route   GET /api/transfers
// @access  Private
exports.getTransferHistory = async (req, res) => {
  try {
    const userId = req.user.id;
    const companyId = req.user.companyId;
    const { page = 1, limit = 20 } = req.query;
    const pageNum = parseInt(page, 10) || 1;
    const limitNum = Math.min(parseInt(limit, 10) || 20, 100);
    const skip = (pageNum - 1) * limitNum;

    const where = {
      companyId,
      status: 'Posted',
      OR: [
        { type: 'BankTransfer' },
        { reference: { startsWith: 'XFER-' } },
        { reference: { startsWith: 'TRANS-' } },
        { description: { contains: 'Transfer from', mode: 'insensitive' } },
      ]
    };

    const [entries, total] = await Promise.all([
      prisma.journalEntry.findMany({
        where,
        include: { lines: true },
        orderBy: { date: 'desc' },
        skip,
        take: limitNum
      }),
      prisma.journalEntry.count({ where }),
    ]);

    const payload = {
      data: entries,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        pages: Math.ceil(total / limitNum)
      }
    };

    return res.status(200).json({ success: true, ...payload });
  } catch (error) {
    console.error('❌ Transfer history error:', error);
    return res.status(500).json({
      success: false,
      message: error.message || 'Server Error'
    });
  }
};

// @desc    Get transfer details
// @route   GET /api/transfers/:id
// @access  Private
exports.getTransferDetails = async (req, res) => {
  try {
    const { id } = req.params;
    const companyId = req.user.companyId;

    const entry = await prisma.journalEntry.findFirst({
      where: { id, companyId },
      include: { lines: { include: { account: true } } }
    });

    if (!entry) {
      return res.status(404).json({
        success: false,
        message: 'Transfer not found'
      });
    }

    return res.status(200).json({ success: true, data: entry });
  } catch (error) {
    console.error('❌ Transfer details error:', error);
    return res.status(500).json({
      success: false,
      message: error.message || 'Server Error'
    });
  }
};
