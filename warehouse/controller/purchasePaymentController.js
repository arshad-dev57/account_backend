// warehouse/controller/purchasePaymentController.js - COMPLETE FIXED

const PurchasePaymentMake = require('../models/PurchasePaymentMake');
const prisma = require('../../prisma/client');
const { fiscalYearGuard } = require('../../middleware/fiscalYearMiddleware');
const { resolveFiscalYearId } = require('../../utils/fiscalYearHelper');

// ============================================================
// ─── PURCHASE PAYMENT MAKE CONTROLLERS ──────────────────────
// ============================================================

// @desc    Get Supplier Invoices for Payment
// @route   GET /api/purchase/payments/supplier/:supplierId/invoices
// @access  Private
const getSupplierInvoices = async (req, res) => {
  try {
    const companyId = req.user.companyId;
    const userId = req.user.id;
    const { supplierId } = req.params;

    // ─── Check if supplier exists ──────────────────────────
    const supplier = await prisma.supplier.findFirst({
      where: {
        id: supplierId,
        companyId: companyId,
        status: 'active'
      }
    });

    if (!supplier) {
      return res.status(404).json({
        success: false,
        message: 'Supplier not found'
      });
    }

    const invoices = await PurchasePaymentMake.getSupplierInvoices(
      supplierId,
      companyId,
      userId
    );

    res.status(200).json({
      success: true,
      count: invoices.length,
      data: invoices
    });
  } catch (error) {
    console.error('Get supplier invoices error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Server error'
    });
  }
};

// @desc    Make Payment to Supplier
// @route   POST /api/purchase/payments/make
// @access  Private
const makePayment = async (req, res) => {
  try {
    const userId = req.user.id;
    const companyId = req.user.companyId;
    const {
      supplierId,
      supplierName,
      amount,
      paymentMethod,
      bankAccountId,
      bankAccountName,
      reference,
      notes,
      invoicePayments,
      paymentDate
    } = req.body;

    const postingDate = paymentDate ? new Date(paymentDate) : new Date();

    // ─── Fiscal Year Guard ────────────────────────────────────
    try {
      await fiscalYearGuard(userId, postingDate);
    } catch (err) {
      if (err.code === 'FISCAL_YEAR_CLOSED') {
        return res.status(400).json({ success: false, message: err.message });
      }
      throw err;
    }

    // ─── Resolve Fiscal Year ID ──────────────────────────────
    const fiscalYearId = await resolveFiscalYearId(userId, postingDate);

    // ─── Validation ──────────────────────────────────────────
    if (!supplierId) {
      return res.status(400).json({
        success: false,
        message: 'Supplier is required'
      });
    }

    if (!invoicePayments || invoicePayments.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'At least one invoice must be selected'
      });
    }

    if (!amount || amount <= 0) {
      return res.status(400).json({
        success: false,
        message: 'Payment amount must be greater than 0'
      });
    }

    // ─── Check if any invoices are already fully paid ──────
    for (const inv of invoicePayments) {
      const invoice = await prisma.purchaseInvoice.findFirst({
        where: {
          id: inv.invoiceId,
          companyId: companyId,
          isActive: true,
          isDeleted: false
        }
      });

      if (!invoice) {
        return res.status(404).json({
          success: false,
          message: `Invoice ${inv.invoiceNumber} not found`
        });
      }

      if (invoice.outstanding <= 0) {
        return res.status(400).json({
          success: false,
          message: `Invoice ${inv.invoiceNumber} is already fully paid`
        });
      }

      if (inv.amountPaid > invoice.outstanding) {
        return res.status(400).json({
          success: false,
          message: `Amount ${inv.amountPaid} exceeds outstanding amount ${invoice.outstanding} for invoice ${inv.invoiceNumber}`
        });
      }
    }

    // ─── Check Bank Account Balance ─────────────────────────
    if (paymentMethod === 'Bank Transfer' || paymentMethod === 'Cheque' || paymentMethod === 'Online Payment') {
      if (!bankAccountId) {
        return res.status(400).json({
          success: false,
          message: 'Bank account is required for this payment method'
        });
      }

      const bankAccount = await prisma.bankAccount.findFirst({
        where: {
          id: bankAccountId,
          companyId: companyId,
          status: 'Active'
        }
      });

      if (!bankAccount) {
        return res.status(404).json({
          success: false,
          message: 'Bank account not found'
        });
      }

      if (bankAccount.currentBalance < amount) {
        return res.status(400).json({
          success: false,
          message: `Insufficient balance in bank account. Available: ${bankAccount.currentBalance}, Required: ${amount}`
        });
      }
    }

    // ─── Process Payment ──────────────────────────────────
    const paymentData = {
      supplierId,
      supplierName,
      amount,
      paymentMethod: paymentMethod || 'Cash',
      bankAccountId,
      bankAccountName,
      reference: reference || '',
      notes: notes || '',
      invoicePayments,
      userId,
      createdBy: userId,
      companyId,
      fiscalYearId
    };

    const payment = await PurchasePaymentMake.makePayment(paymentData);

    // Payment is balance-sheet only (Dr AP / Cr Cash). Do NOT create Expense —
    // that double-counts purchases in Net Profit (Purchases + Expenses).

    res.status(201).json({
      success: true,
      message: 'Payment made successfully',
      data: payment
    });
  } catch (error) {
    console.error('Make payment error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Server error'
    });
  }
};

// @desc    Get All Payments with Filters
// @route   GET /api/purchase/payments
// @access  Private
const getPayments = async (req, res) => {
  try {
    const userId = req.user.id;
    const companyId = req.user.companyId;
    const {
      page = 1,
      limit = 20,
      search,
      supplierId,
      fromDate,
      toDate,
      sortBy = 'paymentDate',
      sortOrder = 'desc'
    } = req.query;

    // Use companyId for filtering instead of userId
    const filter = {
      companyId: companyId,
      isActive: true,
      isDeleted: false
    };

    if (search) {
      filter.OR = [
        { paymentNumber: { contains: search, mode: 'insensitive' } },
        { supplierName: { contains: search, mode: 'insensitive' } },
        { reference: { contains: search, mode: 'insensitive' } }
      ];
    }

    if (supplierId) {
      filter.supplierId = supplierId;
    }

    if (fromDate || toDate) {
      filter.paymentDate = {};
      if (fromDate) filter.paymentDate.gte = new Date(fromDate);
      if (toDate) {
        const endDate = new Date(toDate);
        endDate.setHours(23, 59, 59, 999);
        filter.paymentDate.lte = endDate;
      }
    }

    const pageNum = parseInt(page);
    const limitNum = parseInt(limit);
    const skip = (pageNum - 1) * limitNum;
    const orderBy = { [sortBy]: sortOrder === 'asc' ? 'asc' : 'desc' };

    const [payments, total, stats] = await Promise.all([
      PurchasePaymentMake.findAll(filter, { skip, take: limitNum, orderBy }),
      PurchasePaymentMake.count(filter),
      PurchasePaymentMake.getStats(userId, companyId) // Pass companyId
    ]);

    res.status(200).json({
      success: true,
      count: payments.length,
      data: payments,
      stats,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        pages: Math.ceil(total / limitNum),
        hasNext: pageNum < Math.ceil(total / limitNum),
        hasPrev: pageNum > 1
      }
    });
  } catch (error) {
    console.error('Get payments error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// @desc    Get Payment by ID
// @route   GET /api/purchase/payments/:id
// @access  Private
const getPaymentById = async (req, res) => {
  try {
    const userId = req.user.id;
    const companyId = req.user.companyId;
    const { id } = req.params;

    const payment = await prisma.purchasePaymentMake.findFirst({
      where: {
        id: id,
        companyId: companyId,
        isActive: true,
        isDeleted: false
      },
      include: {
        invoicePayments: {
          include: {
            invoice: {
              include: {
                items: true,
                supplier: true
              }
            }
          }
        },
        supplier: true,
        bankAccount: true,
        journalEntry: {
          include: {
            lines: {
              include: {
                account: true
              }
            }
          }
        },
        creator: {
          select: { id: true, firstName: true, lastName: true, email: true }
        }
      }
    });

    if (!payment) {
      return res.status(404).json({
        success: false,
        message: 'Payment not found'
      });
    }

    // Add computed properties
    const paymentWithProps = {
      ...payment,
      totalInvoices: payment.invoicePayments.length,
      canCancel: payment.status === 'Completed',
      canDelete: payment.status === 'Cancelled'
    };

    res.status(200).json({
      success: true,
      data: paymentWithProps
    });
  } catch (error) {
    console.error('Get payment error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// @desc    Get Payment by Number
// @route   GET /api/purchase/payments/number/:paymentNumber
// @access  Private
const getPaymentByNumber = async (req, res) => {
  try {
    const userId = req.user.id;
    const companyId = req.user.companyId;
    const { paymentNumber } = req.params;

    const payment = await prisma.purchasePaymentMake.findFirst({
      where: {
        paymentNumber: paymentNumber,
        companyId: companyId,
        isActive: true,
        isDeleted: false
      },
      include: {
        invoicePayments: {
          include: {
            invoice: true
          }
        },
        supplier: true,
        bankAccount: true,
        journalEntry: {
          include: {
            lines: {
              include: {
                account: true
              }
            }
          }
        }
      }
    });

    if (!payment) {
      return res.status(404).json({
        success: false,
        message: 'Payment not found'
      });
    }

    res.status(200).json({
      success: true,
      data: payment
    });
  } catch (error) {
    console.error('Get payment by number error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// @desc    Cancel Payment
// @route   POST /api/purchase/payments/:id/cancel
// @access  Private
const cancelPayment = async (req, res) => {
  try {
    const userId = req.user.id;
    const companyId = req.user.companyId;
    const { id } = req.params;
    const { reason } = req.body;

    // ─── Check if payment exists ────────────────────────
    const payment = await prisma.purchasePaymentMake.findFirst({
      where: {
        id: id,
        companyId: companyId,
        isActive: true,
        isDeleted: false
      }
    });

    if (!payment) {
      return res.status(404).json({
        success: false,
        message: 'Payment not found'
      });
    }

    if (payment.status === 'Cancelled') {
      return res.status(400).json({
        success: false,
        message: 'Payment already cancelled'
      });
    }

    // ─── Cancel Payment ──────────────────────────────────
    const cancelledPayment = await PurchasePaymentMake.cancelPayment(
      id,
      userId,
      companyId,
      reason || ''
    );

    res.status(200).json({
      success: true,
      message: 'Payment cancelled successfully',
      data: cancelledPayment
    });
  } catch (error) {
    console.error('Cancel payment error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Server error'
    });
  }
};

// @desc    Get Payment Stats
// @route   GET /api/purchase/payments/stats
// @access  Private
const getPaymentStats = async (req, res) => {
  try {
    const userId = req.user.id;
    const companyId = req.user.companyId;
    const stats = await PurchasePaymentMake.getStats(userId, companyId);

    res.status(200).json({
      success: true,
      data: stats
    });
  } catch (error) {
    console.error('Get payment stats error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// @desc    Get Payment Voucher Data
// @route   GET /api/purchase/payments/:id/voucher
// @access  Private
const getPaymentVoucher = async (req, res) => {
  try {
    const userId = req.user.id;
    const companyId = req.user.companyId;
    const { id } = req.params;

    // ─── Check if payment exists ────────────────────────
    const payment = await prisma.purchasePaymentMake.findFirst({
      where: {
        id: id,
        companyId: companyId,
        isActive: true,
        isDeleted: false
      }
    });

    if (!payment) {
      return res.status(404).json({
        success: false,
        message: 'Payment not found'
      });
    }

    const voucherData = await PurchasePaymentMake.getVoucherData(id);

    res.status(200).json({
      success: true,
      data: voucherData
    });
  } catch (error) {
    console.error('Get payment voucher error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Server error'
    });
  }
};

// @desc    Delete Payment (Soft Delete)
// @route   DELETE /api/purchase/payments/:id
// @access  Private
const deletePayment = async (req, res) => {
  try {
    const userId = req.user.id;
    const companyId = req.user.companyId;
    const { id } = req.params;

    // ─── Check if payment exists ────────────────────────
    const payment = await prisma.purchasePaymentMake.findFirst({
      where: {
        id: id,
        companyId: companyId,
        isActive: true,
        isDeleted: false
      }
    });

    if (!payment) {
      return res.status(404).json({
        success: false,
        message: 'Payment not found'
      });
    }

    if (payment.status !== 'Cancelled') {
      return res.status(400).json({
        success: false,
        message: 'Only cancelled payments can be deleted'
      });
    }

    // ─── Soft Delete Payment ────────────────────────────
    await prisma.purchasePaymentMake.update({
      where: { id },
      data: {
        isDeleted: true,
        isActive: false,
        updatedBy: userId,
        updatedAt: new Date()
      }
    });

    res.status(200).json({
      success: true,
      message: 'Payment deleted successfully'
    });
  } catch (error) {
    console.error('Delete payment error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// ─── EXPORT CONTROLLERS ──────────────────────────────────────

module.exports = {
  getSupplierInvoices,
  makePayment,
  getPayments,
  getPaymentById,
  getPaymentByNumber,
  cancelPayment,
  getPaymentStats,
  getPaymentVoucher,
  deletePayment
};