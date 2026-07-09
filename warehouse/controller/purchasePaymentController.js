// warehouse/controller/purchasePaymentController.js - COMPLETE

const PurchasePaymentMake = require('../models/PurchasePaymentMake');
const prisma = require('../../prisma/client');

// ============================================================
// ─── PURCHASE PAYMENT MAKE CONTROLLERS ──────────────────────
// ============================================================

// @desc    Get Supplier Invoices for Payment
// @route   GET /api/purchase/payments/supplier/:supplierId/invoices
// @access  Private
const getSupplierInvoices = async (req, res) => {
  try {
    const userId = req.user.id;
    const { supplierId } = req.params;

    // ─── Check if supplier exists ──────────────────────────
    const supplier = await prisma.supplier.findFirst({
      where: {
        id: supplierId,
        userId: userId,
        status: 'active'
      }
    });

    if (!supplier) {
      return res.status(404).json({
        success: false,
        message: 'Supplier not found'
      });
    }

    const invoices = await PurchasePaymentMake.getSupplierInvoices(supplierId, userId);

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
// warehouse/controller/purchasePaymentController.js - makePayment function with debug logs

// warehouse/controller/purchasePaymentController.js - makePayment function with enhanced debug

const makePayment = async (req, res) => {
  try {
    const userId = req.user.id;
    const {
      supplierId,
      supplierName,
      amount,
      paymentMethod,
      bankAccountId,
      bankAccountName,
      reference,
      notes,
      invoicePayments
    } = req.body;

    // ─── DEBUG: Log all received data ──────────────────────
    console.log('═══════════════════════════════════════════════════');
    console.log('🔵 [makePayment] Called');
    console.log('🔵 [makePayment] User ID:', userId);
    console.log('🔵 [makePayment] Supplier ID:', supplierId);
    console.log('🔵 [makePayment] Supplier Name:', supplierName);
    console.log('🔵 [makePayment] Amount:', amount);
    console.log('🔵 [makePayment] Payment Method:', paymentMethod);
    console.log('🔵 [makePayment] Bank Account ID:', bankAccountId);
    console.log('🔵 [makePayment] Bank Account Name:', bankAccountName);
    console.log('🔵 [makePayment] Reference:', reference);
    console.log('🔵 [makePayment] Notes:', notes);
    console.log('🔵 [makePayment] Invoice Payments:', JSON.stringify(invoicePayments, null, 2));
    console.log('═══════════════════════════════════════════════════');

    // ─── Validation ──────────────────────────────────────
    if (!supplierId) {
      console.log('❌ [makePayment] Validation failed: Supplier is required');
      return res.status(400).json({
        success: false,
        message: 'Supplier is required'
      });
    }

    if (!invoicePayments || invoicePayments.length === 0) {
      console.log('❌ [makePayment] Validation failed: No invoices selected');
      return res.status(400).json({
        success: false,
        message: 'At least one invoice must be selected'
      });
    }

    if (!amount || amount <= 0) {
      console.log('❌ [makePayment] Validation failed: Invalid amount');
      return res.status(400).json({
        success: false,
        message: 'Payment amount must be greater than 0'
      });
    }

    // ─── Check if any invoices are already fully paid ──
    console.log('🔵 [makePayment] Validating invoices...');
    for (const inv of invoicePayments) {
      console.log(`🔵 [makePayment] Checking invoice: ${inv.invoiceNumber} (ID: ${inv.invoiceId})`);
      
      const invoice = await prisma.purchaseInvoice.findFirst({
        where: {
          id: inv.invoiceId,
          userId: userId,
          isActive: true,
          isDeleted: false
        }
      });

      if (!invoice) {
        console.log(`❌ [makePayment] Invoice ${inv.invoiceNumber} not found`);
        return res.status(404).json({
          success: false,
          message: `Invoice ${inv.invoiceNumber} not found`
        });
      }

      console.log(`🔵 [makePayment] Invoice found: ${invoice.invoiceNumber}, Outstanding: ${invoice.outstanding}`);

      if (invoice.outstanding <= 0) {
        console.log(`❌ [makePayment] Invoice ${inv.invoiceNumber} is already fully paid`);
        return res.status(400).json({
          success: false,
          message: `Invoice ${inv.invoiceNumber} is already fully paid`
        });
      }

      if (inv.amountPaid > invoice.outstanding) {
        console.log(`❌ [makePayment] Amount ${inv.amountPaid} exceeds outstanding ${invoice.outstanding}`);
        return res.status(400).json({
          success: false,
          message: `Amount ${inv.amountPaid} exceeds outstanding amount ${invoice.outstanding} for invoice ${inv.invoiceNumber}`
        });
      }
    }
    console.log('✅ [makePayment] All invoices validated successfully');

    // ─── Check Bank Account Balance ─────────────────────
    console.log('🔵 [makePayment] Checking bank account...');
    console.log(`🔵 [makePayment] Payment Method: ${paymentMethod}`);
    
    if (paymentMethod === 'Bank Transfer' || paymentMethod === 'Cheque') {
      console.log('🔵 [makePayment] Bank transfer or cheque - bank account required');
      
      if (!bankAccountId) {
        console.log('❌ [makePayment] Bank account ID is missing');
        return res.status(400).json({
          success: false,
          message: 'Bank account is required for this payment method'
        });
      }

      console.log(`🔵 [makePayment] Looking for bank account with ID: ${bankAccountId}`);
      console.log(`🔵 [makePayment] For User ID: ${userId}`);
      
      // First try: Find by ID AND userId
      const bankAccount = await prisma.bankAccount.findFirst({
        where: {
          id: bankAccountId,
          userId: userId,
          status: 'Active'
        }
      });

      console.log(`🔵 [makePayment] Bank account found with userId filter: ${bankAccount ? 'YES' : 'NO'}`);
      
      // If not found, try finding by ID only (to see if it exists but with different userId)
      if (!bankAccount) {
        console.log('🔵 [makePayment] Trying to find bank account by ID only (without userId filter)...');
        const bankAccountById = await prisma.bankAccount.findFirst({
          where: {
            id: bankAccountId,
            status: 'Active'
          }
        });
        
        if (bankAccountById) {
          console.log(`🔵 [makePayment] Bank account found but with different userId!`);
          console.log(`🔵 [makePayment] Bank account userId: ${bankAccountById.userId}`);
          console.log(`🔵 [makePayment] Current user userId: ${userId}`);
          console.log('❌ [makePayment] Bank account belongs to different user');
          
          return res.status(403).json({
            success: false,
            message: 'Bank account does not belong to this user'
          });
        } else {
          console.log(`❌ [makePayment] Bank account not found with ID: ${bankAccountId}`);
          
          // List all bank accounts for this user to help debug
          console.log('🔵 [makePayment] Listing all bank accounts for this user...');
          const userBankAccounts = await prisma.bankAccount.findMany({
            where: {
              userId: userId,
              status: 'Active'
            },
            select: {
              id: true,
              accountName: true,
              bankName: true,
              status: true
            }
          });
          
          console.log(`🔵 [makePayment] User has ${userBankAccounts.length} bank accounts:`);
          for (const acc of userBankAccounts) {
            console.log(`  - ID: ${acc.id}, Name: ${acc.accountName}, Bank: ${acc.bankName}`);
          }
          
          return res.status(404).json({
            success: false,
            message: 'Bank account not found'
          });
        }
      }

      // If we have the bank account, log its details
      console.log(`🔵 [makePayment] Bank Account Details:`, {
        id: bankAccount.id,
        accountName: bankAccount.accountName,
        bankName: bankAccount.bankName,
        currentBalance: bankAccount.currentBalance,
        status: bankAccount.status,
        userId: bankAccount.userId
      });

      if (bankAccount.currentBalance < amount) {
        console.log(`❌ [makePayment] Insufficient balance: ${bankAccount.currentBalance} < ${amount}`);
        return res.status(400).json({
          success: false,
          message: `Insufficient balance in bank account. Available: ${bankAccount.currentBalance}, Required: ${amount}`
        });
      }
      
      console.log(`✅ [makePayment] Bank account balance check passed. Balance: ${bankAccount.currentBalance}`);
    } else {
      console.log(`🔵 [makePayment] Payment method is ${paymentMethod} - no bank account required`);
    }

    // ─── Process Payment ──────────────────────────────────
    console.log('🔵 [makePayment] Preparing payment data...');
    const paymentData = {
      supplierId,
      supplierName,
      amount,
      paymentMethod: paymentMethod || 'Cash',
      bankAccountId,
      bankAccountName,
      reference,
      notes,
      invoicePayments,
      userId,
      createdBy: userId
    };

    console.log('🔵 [makePayment] Payment Data:', JSON.stringify(paymentData, null, 2));
    console.log('🔵 [makePayment] Calling PurchasePaymentMake.makePayment...');

    const payment = await PurchasePaymentMake.makePayment(paymentData);

    console.log('✅ [makePayment] Payment created successfully!');
    console.log(`✅ [makePayment] Payment Number: ${payment.paymentNumber}`);
    console.log(`✅ [makePayment] Payment ID: ${payment.id}`);
    console.log('═══════════════════════════════════════════════════');

    res.status(201).json({
      success: true,
      message: 'Payment made successfully',
      data: payment
    });
  } catch (error) {
    console.error('❌ [makePayment] Error:', error);
    console.error('❌ [makePayment] Error Stack:', error.stack);
    console.log('═══════════════════════════════════════════════════');
    res.status(500).json({
      success: false,
      message: error.message || 'Server error'
    });
  }
};
const getPayments = async (req, res) => {
  try {
    const userId = req.user.id;
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

    const filter = {
      userId: userId,
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
      PurchasePaymentMake.getStats(userId)
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
    const { id } = req.params;

    const payment = await prisma.purchasePaymentMake.findFirst({
      where: {
        id: id,
        userId: userId,
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

    res.status(200).json({
      success: true,
      data: payment
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
    const { paymentNumber } = req.params;

    const payment = await prisma.purchasePaymentMake.findFirst({
      where: {
        paymentNumber: paymentNumber,
        userId: userId,
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
    const { id } = req.params;
    const { reason } = req.body;

    // ─── Check if payment exists ────────────────────────
    const payment = await prisma.purchasePaymentMake.findFirst({
      where: {
        id: id,
        userId: userId,
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
    const cancelledPayment = await PurchasePaymentMake.cancelPayment(id, userId, reason);

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
    const stats = await PurchasePaymentMake.getStats(userId);

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
    const { id } = req.params;

    // ─── Check if payment exists ────────────────────────
    const payment = await prisma.purchasePaymentMake.findFirst({
      where: {
        id: id,
        userId: userId,
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
    const { id } = req.params;

    // ─── Check if payment exists ────────────────────────
    const payment = await prisma.purchasePaymentMake.findFirst({
      where: {
        id: id,
        userId: userId,
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
        updatedBy: userId
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