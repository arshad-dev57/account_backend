const Invoice = require('../models/Invoice');
const Customer = require('../models/Customer');
const JournalEntry = require('../models/JournalEntry');
const ChartOfAccount = require('../models/ChartOfAccount');

// Helper: Get or create Accounts Receivable account
// Helper: Get or create Accounts Receivable account (WITHOUT duplicate error)
async function getOrCreateReceivableAccount(userId) {
  let arAccount = await ChartOfAccount.findOne({ 
    code: '1110',
    createdBy: userId
  });
  
  if (!arAccount) {
    // Check if code exists for other user
    const existingCode = await ChartOfAccount.findOne({ code: '1110' });
    let newCode = '1110';
    
    if (existingCode) {
      let counter = 1;
      while (await ChartOfAccount.findOne({ code: newCode, createdBy: userId })) {
        newCode = `111${counter}`;
        counter++;
      }
    }
    
    arAccount = await ChartOfAccount.create({
      code: newCode,
      name: 'Accounts Receivable',
      type: 'Assets',
      parentAccount: 'Current Assets',
      openingBalance: 0,
      currentBalance: 0,
      description: 'Amount due from customers',
      taxCode: 'N/A',
      createdBy: userId,
    });
  }
  return arAccount;
}

// Helper: Get or create Revenue account (WITHOUT duplicate error)
async function getOrCreateRevenueAccount(userId) {
  let revenueAccount = await ChartOfAccount.findOne({ 
    code: '4010',
    createdBy: userId
  });
  
  if (!revenueAccount) {
    const existingCode = await ChartOfAccount.findOne({ code: '4010' });
    let newCode = '4010';
    
    if (existingCode) {
      let counter = 1;
      while (await ChartOfAccount.findOne({ code: newCode, createdBy: userId })) {
        newCode = `401${counter}`;
        counter++;
      }
    }
    
    revenueAccount = await ChartOfAccount.create({
      code: newCode,
      name: 'Sales Revenue',
      type: 'Income',
      parentAccount: 'Operating Income',
      openingBalance: 0,
      currentBalance: 0,
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
    
    // ✅ Validate customer belongs to user
    const customer = await Customer.findOne({
      _id: customerId,
      createdBy: req.user.id
    });
    
    if (!customer) {
      return res.status(404).json({
        success: false,
        message: 'Customer not found',
      });
    }
    
    // ✅ Validate items exist
    if (!items || items.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'At least one item is required',
      });
    }
    
    // Calculate totals
    let subtotal = 0;
    let taxTotal = 0;
    
    const processedItems = items.map(item => {
      const quantity = item.quantity || 1;
      const unitPrice = item.unitPrice || 0;
      const amount = quantity * unitPrice;
      const taxRate = item.taxRate || 0;
      const taxAmount = amount * (taxRate / 100);
      
      subtotal += amount;
      taxTotal += taxAmount;
      
      return {
        description: item.description || 'Item',
        quantity: quantity,
        unitPrice: unitPrice,
        amount: amount,
        taxRate: taxRate,
        taxAmount: taxAmount,
      };
    });
    
    const discountAmount = discount || 0;
    let totalAmount = subtotal + taxTotal - discountAmount;
    
    // ✅ Ensure totalAmount is not negative
    if (totalAmount < 0) {
      totalAmount = 0;
    }
    
    console.log("📊 Invoice Calculation:");
    console.log("   Subtotal:", subtotal);
    console.log("   Tax Total:", taxTotal);
    console.log("   Discount:", discountAmount);
    console.log("   Total Amount:", totalAmount);
    
    // Create invoice
    const invoice = await Invoice.create({
      invoiceNumber: await getNextInvoiceNumber(req.user.id),
      customerId,
      customerName: customer.name,
      date: date || new Date(),
      dueDate: dueDate || new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      items: processedItems,
      subtotal,
      taxTotal,
      discount: discountAmount,
      totalAmount,
      notes: notes || '',
      createdBy: req.user.id,
      status: 'Unpaid',
      outstanding: totalAmount,
      paidAmount: 0,
    });
    
    // ✅ Only create journal entry if totalAmount > 0
    if (totalAmount > 0) {
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
    }
    
    res.status(201).json({
      success: true,
      data: invoice,
    });
  } catch (error) {
    console.error('Create invoice error:', error);
    
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

// Helper: Generate next invoice number (with user isolation)
async function getNextInvoiceNumber(userId) {
  const count = await Invoice.countDocuments({ createdBy: userId });
  const year = new Date().getFullYear();
  return `INV-${year}-${String(count + 1).padStart(4, '0')}`;
}
// @desc    Get all invoices
// @route   GET /api/invoices
// @access  Private
// @desc    Get all invoices
// @route   GET /api/invoices
// @access  Private
exports.getInvoices = async (req, res) => {
  try {
    const { customerId, status, startDate, endDate } = req.query;
    let query = { createdBy: req.user.id };
    
    if (customerId) {
      // Verify customer belongs to user
      const customer = await Customer.findOne({
        _id: customerId,
        createdBy: req.user.id
      });
      if (customer) query.customerId = customerId;
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
};// @desc    Get single invoice
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