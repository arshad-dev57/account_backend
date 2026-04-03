const Customer = require('../models/Customer');
const Invoice = require('../models/Invoice');
const JournalEntry = require('../models/JournalEntry');
const ChartOfAccount = require('../models/ChartOfAccount');
const BankAccount = require('../models/BankAccount');

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

// Helper: Get or create Revenue account
async function getOrCreateRevenueAccount(userId) {
  let revenueAccount = await ChartOfAccount.findOne({ 
    code: '4010',
    createdBy: userId  // 👈 Only find account created by this user
  });
  
  if (!revenueAccount) {
    revenueAccount = await ChartOfAccount.create({
      code: '4010',
      name: 'Sales Revenue',
      type: 'Income',
      parentAccount: 'Operating Income',
      openingBalance: 0,
      description: 'Revenue from sales',
      taxCode: 'GST-13%',
      createdBy: userId,
    });
  }
  return revenueAccount;
}

// ==================== CUSTOMER CRUD ====================

// @desc    Create customer
// @route   POST /api/accounts-receivable/customers
// @access  Private
exports.createCustomer = async (req, res) => {
  try {
    req.body.createdBy = req.user.id;
    const customer = await Customer.create(req.body);
    
    res.status(201).json({
      success: true,
      data: customer,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

// @desc    Get all customers
// @route   GET /api/accounts-receivable/customers
// @access  Private
exports.getCustomers = async (req, res) => {
  try {
    const { search, status } = req.query;
    let query = {
      createdBy: req.user.id  // 👈 Only show customers created by this user
    };
    
    if (search) {
      query.$or = [
        { name: { $regex: search, $options: 'i' } },
        { email: { $regex: search, $options: 'i' } },
        { phone: { $regex: search, $options: 'i' } },
      ];
    }
    
    if (status === 'active') query.isActive = true;
    if (status === 'inactive') query.isActive = false;
    
    const customers = await Customer.find(query).sort({ name: 1 });
    
    // Calculate outstanding for each customer - only invoices created by this user
    const invoices = await Invoice.find({ 
      status: { $ne: 'Paid' },
      createdBy: req.user.id  // 👈 Only show invoices created by this user
    });
    
    const customersWithOutstanding = customers.map(customer => {
      const customerInvoices = invoices.filter(
        inv => inv.customerId.toString() === customer._id.toString()
      );
      const totalAmount = customerInvoices.reduce((sum, inv) => sum + inv.totalAmount, 0);
      const paidAmount = customerInvoices.reduce((sum, inv) => sum + inv.paidAmount, 0);
      const outstandingAmount = totalAmount - paidAmount;
      
      return {
        ...customer.toObject(),
        totalAmount,
        paidAmount,
        outstandingAmount,
        invoiceCount: customerInvoices.length,
      };
    });
    
    res.status(200).json({
      success: true,
      count: customersWithOutstanding.length,
      data: customersWithOutstanding,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

// @desc    Get single customer
// @route   GET /api/accounts-receivable/customers/:id
// @access  Private
exports.getCustomer = async (req, res) => {
  try {
    const customer = await Customer.findOne({
      _id: req.params.id,
      createdBy: req.user.id  // 👈 Only allow if user owns this customer
    });
    
    if (!customer) {
      return res.status(404).json({
        success: false,
        message: 'Customer not found',
      });
    }
    
    const invoices = await Invoice.find({ 
      customerId: customer._id,
      createdBy: req.user.id  // 👈 Only show invoices created by this user
    }).sort({ date: -1 });
    
    const totalAmount = invoices.reduce((sum, inv) => sum + inv.totalAmount, 0);
    const paidAmount = invoices.reduce((sum, inv) => sum + inv.paidAmount, 0);
    const outstandingAmount = totalAmount - paidAmount;
    
    res.status(200).json({
      success: true,
      data: {
        ...customer.toObject(),
        invoices,
        totalAmount,
        paidAmount,
        outstandingAmount,
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

// @desc    Update customer
// @route   PUT /api/accounts-receivable/customers/:id
// @access  Private
exports.updateCustomer = async (req, res) => {
  try {
    const customer = await Customer.findOneAndUpdate(
      { 
        _id: req.params.id,
        createdBy: req.user.id  // 👈 Only allow if user owns this customer
      },
      req.body,
      { new: true, runValidators: true }
    );
    
    if (!customer) {
      return res.status(404).json({
        success: false,
        message: 'Customer not found',
      });
    }
    
    res.status(200).json({
      success: true,
      data: customer,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

// @desc    Delete customer
// @route   DELETE /api/accounts-receivable/customers/:id
// @access  Private
exports.deleteCustomer = async (req, res) => {
  try {
    const hasInvoices = await Invoice.findOne({ 
      customerId: req.params.id,
      createdBy: req.user.id  // 👈 Only check invoices created by this user
    });
    
    if (hasInvoices) {
      return res.status(400).json({
        success: false,
        message: 'Cannot delete customer with existing invoices',
      });
    }
    
    const customer = await Customer.findOneAndDelete({
      _id: req.params.id,
      createdBy: req.user.id  // 👈 Only allow if user owns this customer
    });
    
    if (!customer) {
      return res.status(404).json({
        success: false,
        message: 'Customer not found',
      });
    }
    
    res.status(200).json({
      success: true,
      message: 'Customer deleted successfully',
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

// ==================== INVOICE CRUD ====================

// @desc    Create invoice
// @route   POST /api/accounts-receivable/invoices
// @access  Private
exports.createInvoice = async (req, res) => {
  try {
    const { customerId, date, dueDate, items, discount, notes } = req.body;
    
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
    
    // Calculate totals
    let subtotal = 0;
    let taxTotal = 0;
    
    const processedItems = items.map(item => {
      const amount = item.quantity * item.unitPrice;
      const taxAmount = amount * (item.taxRate / 100);
      subtotal += amount;
      taxTotal += taxAmount;
      
      return {
        ...item,
        amount,
        taxAmount,
      };
    });
    
    const totalAmount = subtotal + taxTotal - (discount || 0);
    
    const invoice = await Invoice.create({
      customerId,
      customerName: customer.name,
      date: date || new Date(),
      dueDate,
      items: processedItems,
      subtotal,
      taxTotal,
      discount: discount || 0,
      totalAmount,
      notes,
      createdBy: req.user.id,
    });
    
    // Create journal entry
    const arAccount = await getOrCreateReceivableAccount(req.user.id);
    const revenueAccount = await getOrCreateRevenueAccount(req.user.id);
    
    await JournalEntry.create({
      entryNumber: `JE-${Date.now()}`,
      date: new Date(),
      description: `Invoice ${invoice.invoiceNumber} - ${customer.name}`,
      reference: invoice.invoiceNumber,
      lines: [
        {
          accountId: arAccount._id,
          accountName: arAccount.name,
          accountCode: arAccount.code,
          debit: totalAmount,
          credit: 0,
        },
        {
          accountId: revenueAccount._id,
          accountName: revenueAccount.name,
          accountCode: revenueAccount.code,
          debit: 0,
          credit: totalAmount,
        },
      ],
      status: 'Posted',
      createdBy: req.user.id,
      postedBy: req.user.id,
      postedAt: new Date(),
    });
    
    res.status(201).json({
      success: true,
      data: invoice,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

// @desc    Get all invoices (with filters)
// @route   GET /api/accounts-receivable/invoices
// @access  Private
exports.getInvoices = async (req, res) => {
  try {
    const { customerId, status, startDate, endDate } = req.query;
    let query = {
      createdBy: req.user.id  // 👈 Only show invoices created by this user
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
    
    if (status) query.status = status;
    if (startDate && endDate) {
      query.date = { $gte: new Date(startDate), $lte: new Date(endDate) };
    }
    
    const invoices = await Invoice.find(query)
      .populate('customerId', 'name email phone')
      .sort({ date: -1 });
    
    res.status(200).json({
      success: true,
      count: invoices.length,
      data: invoices,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

// @desc    Get single invoice
// @route   GET /api/accounts-receivable/invoices/:id
// @access  Private
exports.getInvoice = async (req, res) => {
  try {
    const invoice = await Invoice.findOne({
      _id: req.params.id,
      createdBy: req.user.id  // 👈 Only allow if user owns this invoice
    }).populate('customerId', 'name email phone address');
    
    if (!invoice) {
      return res.status(404).json({
        success: false,
        message: 'Invoice not found',
      });
    }
    
    res.status(200).json({
      success: true,
      data: invoice,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

// ==================== PAYMENT RECORDING ====================

// @desc    Record payment against invoice
// @route   POST /api/accounts-receivable/payments
// @access  Private
exports.recordPayment = async (req, res) => {
  try {
    const { invoiceId, amount, paymentDate, paymentMethod, reference, bankAccountId } = req.body;
    
    const invoice = await Invoice.findOne({
      _id: invoiceId,
      createdBy: req.user.id  // 👈 Only allow if user owns this invoice
    }).populate('customerId');
    
    if (!invoice) {
      return res.status(404).json({
        success: false,
        message: 'Invoice not found',
      });
    }
    
    const outstanding = invoice.totalAmount - invoice.paidAmount;
    if (amount > outstanding) {
      return res.status(400).json({
        success: false,
        message: `Payment amount cannot exceed outstanding balance of ${outstanding}`,
      });
    }
    
    // Update invoice paid amount
    invoice.paidAmount += amount;
    await invoice.save();
    
    // Get bank account and AR account
    const arAccount = await getOrCreateReceivableAccount(req.user.id);
    
    let bankAccount = null;
    if (bankAccountId) {
      bankAccount = await BankAccount.findOne({
        _id: bankAccountId,
        createdBy: req.user.id  // 👈 Only find bank account created by this user
      });
    }
    
    // Create journal entry for payment
    await JournalEntry.create({
      entryNumber: `JE-${Date.now()}`,
      date: paymentDate || new Date(),
      description: `Payment received for ${invoice.invoiceNumber} from ${invoice.customerId.name}`,
      reference: reference || `PAY-${invoice.invoiceNumber}`,
      lines: [
        {
          accountId: bankAccount ? bankAccount.chartOfAccountId : arAccount._id,
          accountName: bankAccount ? bankAccount.accountName : 'Cash in Hand',
          accountCode: bankAccount ? bankAccount.accountCode : '1010',
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
    
    // Update bank account balance if bank account selected
    if (bankAccountId && bankAccount) {
      bankAccount.currentBalance += amount;
      await bankAccount.save();
      
      // Update Chart of Accounts balance
      await ChartOfAccount.findOneAndUpdate(
        { 
          _id: bankAccount.chartOfAccountId,
          createdBy: req.user.id  // 👈 Only update if user owns this account
        },
        {
          currentBalance: bankAccount.currentBalance,
        }
      );
    }
    
    res.status(200).json({
      success: true,
      data: {
        invoice: {
          id: invoice._id,
          invoiceNumber: invoice.invoiceNumber,
          paidAmount: invoice.paidAmount,
          outstanding: invoice.totalAmount - invoice.paidAmount,
          status: invoice.status,
        },
        payment: {
          amount,
          date: paymentDate,
          method: paymentMethod,
          reference,
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

// ==================== ACCOUNTS RECEIVABLE SUMMARY ====================

// @desc    Get AR summary
// @route   GET /api/accounts-receivable/summary
// @access  Private
exports.getSummary = async (req, res) => {
  try {
    const invoices = await Invoice.find({ 
      status: { $ne: 'Paid' },
      createdBy: req.user.id  // 👈 Only show invoices created by this user
    });
    
    const totalOutstanding = invoices.reduce((sum, inv) => sum + (inv.totalAmount - inv.paidAmount), 0);
    
    const now = new Date();
    const endOfWeek = new Date(now);
    endOfWeek.setDate(now.getDate() + (7 - now.getDay()));
    
    const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    
    const overdue = invoices
      .filter(inv => inv.dueDate < now && inv.status !== 'Paid')
      .reduce((sum, inv) => sum + (inv.totalAmount - inv.paidAmount), 0);
    
    const dueThisWeek = invoices
      .filter(inv => inv.dueDate >= now && inv.dueDate <= endOfWeek && inv.status !== 'Paid')
      .reduce((sum, inv) => sum + (inv.totalAmount - inv.paidAmount), 0);
    
    const dueThisMonth = invoices
      .filter(inv => inv.dueDate >= now && inv.dueDate <= endOfMonth && inv.status !== 'Paid')
      .reduce((sum, inv) => sum + (inv.totalAmount - inv.paidAmount), 0);
    
    const activeCustomers = await Customer.countDocuments({ 
      isActive: true,
      createdBy: req.user.id  // 👈 Only count customers created by this user
    });
    
    res.status(200).json({
      success: true,
      data: {
        totalOutstanding,
        overdue,
        dueThisWeek,
        dueThisMonth,
        activeCustomers,
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