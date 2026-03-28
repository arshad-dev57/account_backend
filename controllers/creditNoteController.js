const CreditNote = require('../models/CreditNote');
const Customer = require('../models/Customer');
const Invoice = require('../models/Invoice');
const JournalEntry = require('../models/JournalEntry');
const ChartOfAccount = require('../models/ChartOfAccount');

// Helper: Get or create Sales Returns account
async function getOrCreateSalesReturnsAccount(userId) {
  let salesReturnsAccount = await ChartOfAccount.findOne({ code: '4100' });
  if (!salesReturnsAccount) {
    salesReturnsAccount = await ChartOfAccount.create({
      code: '4100',
      name: 'Sales Returns & Allowances',
      type: 'Expenses',
      parentAccount: 'Operating Expenses',
      openingBalance: 0,
      description: 'Returns and allowances on sales',
      taxCode: 'N/A',
      createdBy: userId,
    });
  }
  return salesReturnsAccount;
}

// Helper: Get or create Accounts Receivable account
async function getOrCreateReceivableAccount(userId) {
  let arAccount = await ChartOfAccount.findOne({ code: '1020' });
  if (!arAccount) {
    arAccount = await ChartOfAccount.create({
      code: '1020',
      name: 'Accounts Receivable',
      type: 'Assets',
      parentAccount: 'Current Assets',
      openingBalance: 0,
      description: 'Amount due from customers',
      taxCode: 'N/A',
      createdBy: userId,
    });
  }
  return arAccount;
}

// ==================== CREATE CREDIT NOTE ====================
// @desc    Create a new credit note
// @route   POST /api/credit-notes
// @access  Private
// In your creditNoteController.js, replace the create function with this:

// ==================== CREATE CREDIT NOTE ====================
exports.createCreditNote = async (req, res) => {
  try {
    const {
      customerId,
      originalInvoiceId,
      amount,
      reason,
      reasonType,
      items,
      notes,
      expiryDays,
    } = req.body;

    console.log('Creating credit note with data:', {
      customerId,
      originalInvoiceId,
      amount,
      reason,
      reasonType,
    });

    // 1. Validate customer
    const customer = await Customer.findById(customerId);
    if (!customer) {
      return res.status(404).json({
        success: false,
        message: 'Customer not found',
      });
    }

    // 2. Validate invoice
    const invoice = await Invoice.findById(originalInvoiceId);
    if (!invoice) {
      return res.status(404).json({
        success: false,
        message: 'Invoice not found',
      });
    }

    console.log('Invoice found:', {
      id: invoice._id,
      invoiceNumber: invoice.invoiceNumber,
      totalAmount: invoice.totalAmount,
      outstanding: invoice.outstanding
    });

    // 3. Validate amount doesn't exceed invoice outstanding
    if (amount > invoice.outstanding) {
      return res.status(400).json({
        success: false,
        message: `Credit note amount cannot exceed invoice outstanding balance of ${invoice.outstanding}`,
      });
    }

    // 4. Calculate expiry date
    const expiryDate = new Date();
    expiryDate.setDate(expiryDate.getDate() + (expiryDays || 30));

    // 5. Generate credit note number manually
    const count = await CreditNote.countDocuments();
    const year = new Date().getFullYear();
    const creditNoteNumber = `CN-${year}-${String(count + 1).padStart(4, '0')}`;
    console.log(`Generated credit note number: ${creditNoteNumber}`);

    // 6. Create credit note with explicit number
    const creditNote = await CreditNote.create({
      creditNoteNumber: creditNoteNumber, // Explicitly set the number
      date: new Date(),
      customerId,
      customerName: customer.name,
      originalInvoiceId,
      originalInvoiceNumber: invoice.invoiceNumber,
      originalInvoiceAmount: invoice.totalAmount,
      amount,
      reason,
      reasonType,
      items: items || [
        {
          description: reason,
          quantity: 1,
          unitPrice: amount,
          amount: amount,
        },
      ],
      status: 'Issued',
      appliedAmount: 0,
      remainingAmount: amount,
      expiryDate,
      notes: notes || '',
      createdBy: req.user.id,
    });

    console.log('Credit note created successfully:', {
      id: creditNote._id,
      creditNoteNumber: creditNote.creditNoteNumber
    });

    // 7. Create journal entry
    const salesReturnsAccount = await getOrCreateSalesReturnsAccount(req.user.id);
    const arAccount = await getOrCreateReceivableAccount(req.user.id);

    await JournalEntry.create({
      entryNumber: `JE-${Date.now()}`,
      date: new Date(),
      description: `Credit note ${creditNote.creditNoteNumber} issued to ${customer.name}`,
      reference: creditNote.creditNoteNumber,
      lines: [
        {
          accountId: salesReturnsAccount._id,
          accountName: salesReturnsAccount.name,
          accountCode: salesReturnsAccount.code,
          debit: amount,
          credit: 0,
        },
        {
          accountId: arAccount._id,
          accountName: arAccount.name,
          accountCode: arAccount.code,
          debit: 0,
          credit: amount,
        },
      ],
      status: 'Posted',
      createdBy: req.user.id,
      postedBy: req.user.id,
      postedAt: new Date(),
    });

    res.status(201).json({
      success: true,
      data: creditNote,
      message: 'Credit note created successfully',
    });
  } catch (error) {
    console.error('Error in createCreditNote:', error);
    
    // Handle validation errors
    if (error.name === 'ValidationError') {
      const errors = {};
      for (const field in error.errors) {
        errors[field] = error.errors[field].message;
      }
      return res.status(400).json({
        success: false,
        message: 'Validation error',
        errors,
      });
    }
    
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};
// ==================== GET ALL CREDIT NOTES ====================
// @desc    Get all credit notes with filters
// @route   GET /api/credit-notes
// @access  Private
exports.getCreditNotes = async (req, res) => {
  try {
    const { customerId, status, startDate, endDate, search } = req.query;
    let query = {};

    if (customerId) query.customerId = customerId;
    if (status) query.status = status;
    
    if (startDate && endDate) {
      query.date = {
        $gte: new Date(startDate),
        $lte: new Date(endDate),
      };
    }

    if (search) {
      query.$or = [
        { creditNoteNumber: { $regex: search, $options: 'i' } },
        { customerName: { $regex: search, $options: 'i' } },
        { originalInvoiceNumber: { $regex: search, $options: 'i' } },
      ];
    }

    const creditNotes = await CreditNote.find(query)
      .populate('customerId', 'name email phone')
      .populate('originalInvoiceId', 'invoiceNumber totalAmount')
      .sort({ date: -1, createdAt: -1 });

    res.status(200).json({
      success: true,
      count: creditNotes.length,
      data: creditNotes,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

// ==================== GET SINGLE CREDIT NOTE ====================
// @desc    Get single credit note by ID
// @route   GET /api/credit-notes/:id
// @access  Private
exports.getCreditNote = async (req, res) => {
  try {
    const creditNote = await CreditNote.findById(req.params.id)
      .populate('customerId', 'name email phone address')
      .populate('originalInvoiceId', 'invoiceNumber date items totalAmount')
      .populate('appliedToInvoices.invoiceId', 'invoiceNumber date totalAmount');

    if (!creditNote) {
      return res.status(404).json({
        success: false,
        message: 'Credit note not found',
      });
    }

    res.status(200).json({
      success: true,
      data: creditNote,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

// ==================== GET CREDIT NOTE SUMMARY ====================
// @desc    Get credit note summary statistics
// @route   GET /api/credit-notes/summary
// @access  Private
exports.getSummary = async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    let dateFilter = {};

    if (startDate && endDate) {
      dateFilter = {
        date: {
          $gte: new Date(startDate),
          $lte: new Date(endDate),
        },
      };
    }

    const allCreditNotes = await CreditNote.find(dateFilter);
    
    const totalCount = allCreditNotes.length;
    const totalAmount = allCreditNotes.reduce((sum, cn) => sum + cn.amount, 0);
    const appliedAmount = allCreditNotes.reduce((sum, cn) => sum + cn.appliedAmount, 0);
    const remainingAmount = allCreditNotes.reduce((sum, cn) => sum + cn.remainingAmount, 0);
    const expiredAmount = allCreditNotes
      .filter(cn => cn.status === 'Expired')
      .reduce((sum, cn) => sum + cn.amount, 0);

    // This month summary
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const thisMonth = await CreditNote.aggregate([
      {
        $match: {
          date: { $gte: startOfMonth },
          ...dateFilter,
        },
      },
      {
        $group: {
          _id: null,
          total: { $sum: '$amount' },
          count: { $sum: 1 },
        },
      },
    ]);

    // This week summary
    const startOfWeek = new Date(now);
    startOfWeek.setDate(now.getDate() - now.getDay());
    const thisWeek = await CreditNote.aggregate([
      {
        $match: {
          date: { $gte: startOfWeek },
          ...dateFilter,
        },
      },
      {
        $group: {
          _id: null,
          total: { $sum: '$amount' },
          count: { $sum: 1 },
        },
      },
    ]);

    res.status(200).json({
      success: true,
      data: {
        totalCount,
        totalAmount,
        appliedAmount,
        remainingAmount,
        expiredAmount,
        thisMonth: thisMonth[0]?.total || 0,
        thisMonthCount: thisMonth[0]?.count || 0,
        thisWeek: thisWeek[0]?.total || 0,
        thisWeekCount: thisWeek[0]?.count || 0,
      },
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

// ==================== GET UNPAID INVOICES ====================
// @desc    Get unpaid/partially paid invoices for customer
// @route   GET /api/credit-notes/unpaid-invoices/:customerId
// @access  Private
exports.getUnpaidInvoices = async (req, res) => {
  try {
    const { customerId } = req.params;
    
    const invoices = await Invoice.find({
      customerId,
      outstanding: { $gt: 0 }, // Only invoices with outstanding balance
      status: { $ne: 'Paid' },
    }).sort({ date: -1 });

    const unpaidInvoices = invoices.map(invoice => ({
      id: invoice._id,
      invoiceNumber: invoice.invoiceNumber,
      amount: invoice.totalAmount,
      outstanding: invoice.outstanding,
      date: invoice.date,
      status: invoice.status,
      paidAmount: invoice.paidAmount,
    }));

    res.status(200).json({
      success: true,
      count: unpaidInvoices.length,
      data: unpaidInvoices,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

// ==================== APPLY CREDIT NOTE TO INVOICE ====================
// @desc    Apply credit note to an invoice
// @route   POST /api/credit-notes/apply
// @access  Private
exports.applyCreditNote = async (req, res) => {
  try {
    const { creditNoteId, invoiceId, amount } = req.body;

    // 1. Find credit note
    const creditNote = await CreditNote.findById(creditNoteId);
    if (!creditNote) {
      return res.status(404).json({
        success: false,
        message: 'Credit note not found',
      });
    }

    // 2. Check if credit note is expired
    if (creditNote.isExpired()) {
      return res.status(400).json({
        success: false,
        message: 'Credit note has expired and cannot be applied',
      });
    }

    // 3. Check if credit note is already fully applied
    if (creditNote.status === 'Applied') {
      return res.status(400).json({
        success: false,
        message: 'Credit note is already fully applied',
      });
    }

    // 4. Validate amount
    if (amount > creditNote.remainingAmount) {
      return res.status(400).json({
        success: false,
        message: `Amount exceeds remaining credit note amount of ${creditNote.remainingAmount}`,
      });
    }

    // 5. Find invoice
    const invoice = await Invoice.findById(invoiceId);
    if (!invoice) {
      return res.status(404).json({
        success: false,
        message: 'Invoice not found',
      });
    }

    // 6. Validate invoice outstanding
    if (amount > invoice.outstanding) {
      return res.status(400).json({
        success: false,
        message: `Amount exceeds invoice outstanding balance of ${invoice.outstanding}`,
      });
    }

    // 7. Apply credit note to invoice
    const result = await creditNote.applyToInvoice(invoiceId, amount);

    // 8. Create journal entry for application
    const arAccount = await getOrCreateReceivableAccount(req.user.id);
    const salesReturnsAccount = await getOrCreateSalesReturnsAccount(req.user.id);

    await JournalEntry.create({
      entryNumber: `JE-${Date.now()}`,
      date: new Date(),
      description: `Applied credit note ${creditNote.creditNoteNumber} to invoice ${invoice.invoiceNumber}`,
      reference: `${creditNote.creditNoteNumber} -> ${invoice.invoiceNumber}`,
      lines: [
        {
          accountId: arAccount._id,
          accountName: arAccount.name,
          accountCode: arAccount.code,
          debit: amount,
          credit: 0,
        },
        {
          accountId: salesReturnsAccount._id,
          accountName: salesReturnsAccount.name,
          accountCode: salesReturnsAccount.code,
          debit: 0,
          credit: amount,
        },
      ],
      status: 'Posted',
      createdBy: req.user.id,
      postedBy: req.user.id,
      postedAt: new Date(),
    });

    res.status(200).json({
      success: true,
      data: {
        creditNote: {
          id: result.creditNote._id,
          creditNoteNumber: result.creditNote.creditNoteNumber,
          remainingAmount: result.creditNote.remainingAmount,
          status: result.creditNote.status,
        },
        invoice: {
          id: result.invoice._id,
          invoiceNumber: result.invoice.invoiceNumber,
          outstanding: result.invoice.outstanding,
          status: result.invoice.status,
        },
      },
      message: 'Credit note applied successfully',
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

// ==================== EXPIRE CREDIT NOTES (Cron Job) ====================
// @desc    Auto-expire credit notes that have passed expiry date
// @access  Private (Admin only)
exports.expireCreditNotes = async (req, res) => {
  try {
    const now = new Date();
    
    const expiredCreditNotes = await CreditNote.updateMany(
      {
        expiryDate: { $lt: now },
        status: { $in: ['Issued', 'PartiallyApplied'] },
        remainingAmount: { $gt: 0 },
      },
      {
        $set: {
          status: 'Expired',
        },
      }
    );

    res.status(200).json({
      success: true,
      data: {
        updated: expiredCreditNotes.modifiedCount,
      },
      message: `${expiredCreditNotes.modifiedCount} credit notes expired`,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

// ==================== DELETE CREDIT NOTE ====================
// @desc    Delete credit note (only if not applied)
// @route   DELETE /api/credit-notes/:id
// @access  Private
exports.deleteCreditNote = async (req, res) => {
  try {
    const creditNote = await CreditNote.findById(req.params.id);

    if (!creditNote) {
      return res.status(404).json({
        success: false,
        message: 'Credit note not found',
      });
    }

    // Check if credit note has been applied
    if (creditNote.appliedAmount > 0) {
      return res.status(400).json({
        success: false,
        message: 'Cannot delete credit note that has been partially or fully applied',
      });
    }

    await creditNote.deleteOne();

    res.status(200).json({
      success: true,
      message: 'Credit note deleted successfully',
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};