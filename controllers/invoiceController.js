const Invoice = require('../models/Invoice');
const Customer = require('../models/Customer');
const JournalEntry = require('../models/JournalEntry');
const ChartOfAccount = require('../models/ChartOfAccount');

// Helper: Get or create Accounts Receivable account
async function getOrCreateReceivableAccount(userId) {
  let arAccount = await ChartOfAccount.findOne({ code: '1110' });
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
async function getOrCreateRevenueAccount(userId, itemDescription) {
  let revenueAccount = await ChartOfAccount.findOne({ code: '4010' });
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

// Helper: Generate next invoice number
async function getNextInvoiceNumber() {
  const count = await Invoice.countDocuments();
  const year = new Date().getFullYear();
  return `INV-${year}-${String(count + 1).padStart(4, '0')}`;
}

// @desc    Create invoice
// @route   POST /api/invoices
// @access  Private
exports.createInvoice = async (req, res) => {
  try {
    const { customerId, date, dueDate, items, discount, notes } = req.body;
    
    // Validate customer
    const customer = await Customer.findById(customerId);
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
      const taxAmount = amount * ((item.taxRate || 0) / 100);
      subtotal += amount;
      taxTotal += taxAmount;
      
      return {
        description: item.description,
        quantity: item.quantity,
        unitPrice: item.unitPrice,
        amount: amount,
        taxRate: item.taxRate || 0,
        taxAmount: taxAmount,
      };
    });
    
    const totalAmount = subtotal + taxTotal - (discount || 0);
    
    // Create invoice
    const invoice = await Invoice.create({
      invoiceNumber: await getNextInvoiceNumber(),
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
      posted: true,
      postedAt: new Date(),
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

// @desc    Get all invoices
// @route   GET /api/invoices
// @access  Private
exports.getInvoices = async (req, res) => {
  try {
    const { customerId, status, startDate, endDate } = req.query;
    let query = {};
    
    if (customerId) query.customerId = customerId;
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
// @route   GET /api/invoices/:id
// @access  Private
exports.getInvoice = async (req, res) => {
  try {
    const invoice = await Invoice.findById(req.params.id)
      .populate('customerId', 'name email phone address');
    
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

// @desc    Update invoice
// @route   PUT /api/invoices/:id
// @access  Private
exports.updateInvoice = async (req, res) => {
  try {
    const invoice = await Invoice.findById(req.params.id);
    
    if (!invoice) {
      return res.status(404).json({
        success: false,
        message: 'Invoice not found',
      });
    }
    
    if (invoice.status === 'Paid') {
      return res.status(400).json({
        success: false,
        message: 'Cannot update paid invoice',
      });
    }
    
    const { dueDate, items, discount, notes } = req.body;
    
    if (dueDate) invoice.dueDate = dueDate;
    if (discount !== undefined) invoice.discount = discount;
    if (notes !== undefined) invoice.notes = notes;
    
    if (items) {
      let subtotal = 0;
      let taxTotal = 0;
      
      const processedItems = items.map(item => {
        const amount = item.quantity * item.unitPrice;
        const taxAmount = amount * ((item.taxRate || 0) / 100);
        subtotal += amount;
        taxTotal += taxAmount;
        
        return {
          description: item.description,
          quantity: item.quantity,
          unitPrice: item.unitPrice,
          amount: amount,
          taxRate: item.taxRate || 0,
          taxAmount: taxAmount,
        };
      });
      
      invoice.items = processedItems;
      invoice.subtotal = subtotal;
      invoice.taxTotal = taxTotal;
      invoice.totalAmount = subtotal + taxTotal - invoice.discount;
    }
    
    await invoice.save();
    
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

// @desc    Delete invoice
// @route   DELETE /api/invoices/:id
// @access  Private
exports.deleteInvoice = async (req, res) => {
  try {
    const invoice = await Invoice.findById(req.params.id);
    
    if (!invoice) {
      return res.status(404).json({
        success: false,
        message: 'Invoice not found',
      });
    }
    
    if (invoice.status === 'Paid') {
      return res.status(400).json({
        success: false,
        message: 'Cannot delete paid invoice',
      });
    }
    
    // Delete associated journal entries
    await JournalEntry.deleteMany({ reference: invoice.invoiceNumber });
    
    await invoice.deleteOne();
    
    res.status(200).json({
      success: true,
      message: 'Invoice deleted successfully',
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};