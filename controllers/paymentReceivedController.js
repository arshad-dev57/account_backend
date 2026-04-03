const PaymentReceived = require('../models/PaymentReceived');
const Invoice = require('../models/Invoice');
const BankAccount = require('../models/BankAccount');
const JournalEntry = require('../models/JournalEntry');
const ChartOfAccount = require('../models/ChartOfAccount');
const Customer = require('../models/Customer');

// Helper: Get or create Accounts Receivable account
async function getOrCreateReceivableAccount(userId) {
  let arAccount = await ChartOfAccount.findOne({ 
    code: '1110',
    createdBy: userId  // 👈 Only find account created by this user
  });
  
  if (!arAccount) {
    arAccount = await ChartOfAccount.create({
      code: '1110',
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

// Helper: Get or create Cash account
async function getOrCreateCashAccount(userId) {
  let cashAccount = await ChartOfAccount.findOne({ 
    code: '1010',
    createdBy: userId  // 👈 Only find account created by this user
  });
  
  if (!cashAccount) {
    cashAccount = await ChartOfAccount.create({
      code: '1010',
      name: 'Cash in Hand',
      type: 'Assets',
      parentAccount: 'Current Assets',
      openingBalance: 0,
      description: 'Physical cash in office',
      taxCode: 'N/A',
      createdBy: userId,
    });
  }
  return cashAccount;
}

// @desc    Record payment received
// @route   POST /api/payments-received
// @access  Private
exports.recordPayment = async (req, res) => {
  try {
    const {
      customerId,
      invoiceId,
      amount,
      paymentDate,
      paymentMethod,
      reference,
      bankAccountId,
      notes,
    } = req.body;

    // 1. Validate invoice - must belong to user
    const invoice = await Invoice.findOne({
      _id: invoiceId,
      createdBy: req.user.id  // 👈 Only allow if user owns this invoice
    });
    
    if (!invoice) {
      return res.status(404).json({
        success: false,
        message: 'Invoice not found',
      });
    }

    // 2. Validate payment amount
    const outstanding = invoice.totalAmount - invoice.paidAmount;
    if (amount > outstanding) {
      return res.status(400).json({
        success: false,
        message: `Payment amount cannot exceed outstanding balance of ${outstanding}`,
      });
    }

    // 3. Get customer details - must belong to user
    const customer = await Customer.findOne({
      _id: customerId,
      createdBy: req.user.id  // 👈 Only allow if user owns this customer
    });
    
    if (!customer) {
      return res.status(404).json({
        success: false,
        message: 'Customer not found',
      });
    }

    // 4. Get bank account if selected - must belong to user
    let bankAccount = null;
    let bankChartAccount = null;
    if (bankAccountId && paymentMethod === 'Bank Transfer') {
      bankAccount = await BankAccount.findOne({
        _id: bankAccountId,
        createdBy: req.user.id  // 👈 Only find bank account created by this user
      });
      if (bankAccount) {
        bankChartAccount = await ChartOfAccount.findOne({
          _id: bankAccount.chartOfAccountId,
          createdBy: req.user.id  // 👈 Only find chart account created by this user
        });
      }
    }

    // 5. Get accounts for journal entry
    const arAccount = await getOrCreateReceivableAccount(req.user.id);
    const cashAccount = await getOrCreateCashAccount(req.user.id);

    // 6. Create payment record
    const payment = await PaymentReceived.create({
      paymentDate: paymentDate || new Date(),
      customerId,
      customerName: customer.name,
      invoiceId,
      invoiceNumber: invoice.invoiceNumber,
      invoiceAmount: invoice.totalAmount,
      amount,
      paymentMethod,
      reference,
      bankAccountId: bankAccountId || null,
      bankAccountName: bankAccount ? bankAccount.accountName : (paymentMethod === 'Cash' ? 'Cash in Hand' : ''),
      notes,
      status: paymentMethod === 'Cheque' ? 'Pending' : 'Cleared',
      createdBy: req.user.id,
    });

    // 7. Update invoice
    invoice.paidAmount += amount;
    await invoice.save();

    // 8. Create journal entry
    const journalEntry = await JournalEntry.create({
      entryNumber: `JE-${Date.now()}`,
      date: paymentDate || new Date(),
      description: `Payment received for ${invoice.invoiceNumber} from ${customer.name}`,
      reference: reference || payment.paymentNumber,
      lines: [
        {
          accountId: bankChartAccount ? bankChartAccount._id : cashAccount._id,
          accountName: bankChartAccount ? bankChartAccount.name : cashAccount.name,
          accountCode: bankChartAccount ? bankChartAccount.code : cashAccount.code,
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

    // 9. Update bank account balance
    if (bankAccountId && bankAccount) {
      bankAccount.currentBalance += amount;
      await bankAccount.save();
      
      if (bankChartAccount) {
        await ChartOfAccount.findOneAndUpdate(
          { 
            _id: bankChartAccount._id,
            createdBy: req.user.id  // 👈 Only update if user owns this account
          },
          {
            currentBalance: bankAccount.currentBalance,
          }
        );
      }
    }

    // 10. Update cash account balance if cash payment
    if (paymentMethod === 'Cash') {
      const cashChartAccount = await ChartOfAccount.findOne({
        _id: cashAccount._id,
        createdBy: req.user.id  // 👈 Only find chart account created by this user
      });
      if (cashChartAccount) {
        cashChartAccount.currentBalance += amount;
        await cashChartAccount.save();
      }
    }

    res.status(201).json({
      success: true,
      data: {
        payment,
        journalEntry,
        invoice: {
          id: invoice._id,
          invoiceNumber: invoice.invoiceNumber,
          paidAmount: invoice.paidAmount,
          outstanding: invoice.totalAmount - invoice.paidAmount,
          status: invoice.status,
        },
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

// @desc    Get all payments
// @route   GET /api/payments-received
// @access  Private
exports.getPayments = async (req, res) => {
  try {
    const { customerId, invoiceId, status, startDate, endDate, search } = req.query;
    let query = {
      createdBy: req.user.id  // 👈 Only show payments created by this user
    };

    if (customerId) {
      // Verify customer belongs to user
      const customer = await Customer.findOne({
        _id: customerId,
        createdBy: req.user.id
      });
      if (customer) {
        query.customerId = customerId;
      }
    }
    
    if (invoiceId) {
      // Verify invoice belongs to user
      const invoice = await Invoice.findOne({
        _id: invoiceId,
        createdBy: req.user.id
      });
      if (invoice) {
        query.invoiceId = invoiceId;
      }
    }
    
    if (status) query.status = status;
    if (startDate && endDate) {
      query.paymentDate = { $gte: new Date(startDate), $lte: new Date(endDate) };
    }

    if (search) {
      query.$or = [
        { paymentNumber: { $regex: search, $options: 'i' } },
        { customerName: { $regex: search, $options: 'i' } },
        { invoiceNumber: { $regex: search, $options: 'i' } },
        { reference: { $regex: search, $options: 'i' } },
      ];
    }

    const payments = await PaymentReceived.find(query)
      .populate('customerId', 'name email phone')
      .populate('invoiceId', 'invoiceNumber totalAmount')
      .sort({ paymentDate: -1, createdAt: -1 });

    res.status(200).json({
      success: true,
      count: payments.length,
      data: payments,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

// @desc    Get single payment
// @route   GET /api/payments-received/:id
// @access  Private
exports.getPayment = async (req, res) => {
  try {
    const payment = await PaymentReceived.findOne({
      _id: req.params.id,
      createdBy: req.user.id  // 👈 Only allow if user owns this payment
    })
      .populate('customerId', 'name email phone address')
      .populate('invoiceId', 'invoiceNumber date dueDate items totalAmount');

    if (!payment) {
      return res.status(404).json({
        success: false,
        message: 'Payment not found',
      });
    }

    res.status(200).json({
      success: true,
      data: payment,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

// @desc    Get unpaid invoices for customer
// @route   GET /api/payments-received/invoices/unpaid/:customerId
// @access  Private
exports.getUnpaidInvoices = async (req, res) => {
  try {
    const { customerId } = req.params;
    
    // Verify customer belongs to user
    const customer = await Customer.findOne({
      _id: customerId,
      createdBy: req.user.id  // 👈 Only allow if user owns this customer
    });
    
    if (!customer) {
      return res.status(404).json({
        success: false,
        message: 'Customer not found',
      });
    }
    
    const invoices = await Invoice.find({
      customerId,
      status: { $ne: 'Paid' },
      createdBy: req.user.id,  // 👈 Only show invoices created by this user
    }).sort({ dueDate: 1 });

    const unpaidInvoices = invoices.map(invoice => ({
      id: invoice._id,
      invoiceNumber: invoice.invoiceNumber,
      date: invoice.date,
      dueDate: invoice.dueDate,
      totalAmount: invoice.totalAmount,
      paidAmount: invoice.paidAmount,
      outstanding: invoice.totalAmount - invoice.paidAmount,
      status: invoice.status,
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

// @desc    Get payment summary
// @route   GET /api/payments-received/summary
// @access  Private
exports.getSummary = async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    let dateFilter = {
      createdBy: req.user.id  // 👈 Only show payments created by this user
    };

    if (startDate && endDate) {
      dateFilter.paymentDate = {
        $gte: new Date(startDate),
        $lte: new Date(endDate),
      };
    }

    const totalReceived = await PaymentReceived.aggregate([
      { $match: dateFilter },
      { $group: { _id: null, total: { $sum: '$amount' } } },
    ]);

    const now = new Date();
    const startOfWeek = new Date(now);
    startOfWeek.setDate(now.getDate() - now.getDay());
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    const thisWeek = await PaymentReceived.aggregate([
      { $match: { 
        paymentDate: { $gte: startOfWeek },
        createdBy: req.user.id  // 👈 Only show payments created by this user
      } },
      { $group: { _id: null, total: { $sum: '$amount' } } },
    ]);

    const thisMonth = await PaymentReceived.aggregate([
      { $match: { 
        paymentDate: { $gte: startOfMonth },
        createdBy: req.user.id  // 👈 Only show payments created by this user
      } },
      { $group: { _id: null, total: { $sum: '$amount' } } },
    ]);

    const today = await PaymentReceived.aggregate([
      { $match: { 
        paymentDate: { $gte: startOfDay },
        createdBy: req.user.id  // 👈 Only show payments created by this user
      } },
      { $group: { _id: null, total: { $sum: '$amount' } } },
    ]);

    const pending = await PaymentReceived.countDocuments({ 
      status: 'Pending',
      createdBy: req.user.id  // 👈 Only count payments created by this user
    });

    res.status(200).json({
      success: true,
      data: {
        totalReceived: totalReceived[0]?.total || 0,
        thisWeek: thisWeek[0]?.total || 0,
        thisMonth: thisMonth[0]?.total || 0,
        today: today[0]?.total || 0,
        pending,
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