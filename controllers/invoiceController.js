// backend/controllers/invoiceController.js

const Invoice = require('../models/Invoice');
const Customer = require('../models/Customer');
const JournalEntry = require('../models/JournalEntry');
const ChartOfAccount = require('../models/ChartOfAccount');

// ============================================================
// HELPER: Get or Create Account (Generic)
// ============================================================
async function getOrCreateAccount(userId, accountConfig) {
  const { code, name, type, parentAccount, description, taxCode } = accountConfig;
  
  // ✅ Find existing account for this user
  let account = await ChartOfAccount.findOne({ 
    code: code,
    createdBy: userId
  });
  
  if (!account) {
    // ✅ Check if code already exists for other users
    const existingCode = await ChartOfAccount.findOne({ code: code });
    let newCode = code;
    
    if (existingCode) {
      let counter = 1;
      // ✅ Find unique code for this user
      while (await ChartOfAccount.findOne({ code: newCode, createdBy: userId })) {
        newCode = `${code}${counter}`;
        counter++;
      }
    }
    
    // ✅ Create new account
    account = await ChartOfAccount.create({
      code: newCode,
      name: name,
      type: type,
      parentAccount: parentAccount,
      openingBalance: 0,
      currentBalance: 0,
      description: description,
      taxCode: taxCode || 'N/A',
      createdBy: userId,
    });
    
    console.log(`✅ Created account: ${name} (${newCode}) for user ${userId}`);
  }
  
  return account;
}

// ============================================================
// HELPER: Get or Create Accounts Receivable
// ============================================================
async function getOrCreateReceivableAccount(userId) {
  return getOrCreateAccount(userId, {
    code: '1110',
    name: 'Accounts Receivable',
    type: 'Assets',
    parentAccount: 'Current Assets',
    description: 'Amount due from customers',
    taxCode: 'N/A',
  });
}

// ============================================================
// HELPER: Get or Create Revenue Account
// ============================================================
async function getOrCreateRevenueAccount(userId) {
  return getOrCreateAccount(userId, {
    code: '4010',
    name: 'Sales Revenue',
    type: 'Income',
    parentAccount: 'Operating Income',
    description: 'Revenue from sales',
    taxCode: 'GST-13%',
  });
}

// ============================================================
// HELPER: Generate Next Invoice Number (FIXED)
// ============================================================
async function getNextInvoiceNumber(userId) {
  const year = new Date().getFullYear();
  
  // ✅ Get the last invoice number for this user
  const lastInvoice = await Invoice.findOne(
    { 
      createdBy: userId,
      invoiceNumber: { $regex: `^INV-${year}-` } 
    }
  )
  .sort({ invoiceNumber: -1 })
  .limit(1);
  
  let nextNumber = 1;
  
  if (lastInvoice) {
    // ✅ Extract number from last invoice
    const parts = lastInvoice.invoiceNumber.split('-');
    if (parts.length === 3) {
      const lastNum = parseInt(parts[2]);
      if (!isNaN(lastNum)) {
        nextNumber = lastNum + 1;
      }
    }
  }
  
  // ✅ Format: INV-2026-0004
  const paddedNumber = String(nextNumber).padStart(4, '0');
  return `INV-${year}-${paddedNumber}`;
}

// ============================================================
// CREATE INVOICE (FIXED)
// ============================================================
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
    
    // ✅ Validate items
    if (!items || items.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'At least one item is required',
      });
    }
    
    // ✅ Generate UNIQUE invoice number with retry logic
    let invoiceNumber = await getNextInvoiceNumber(req.user.id);
    let retryCount = 0;
    const MAX_RETRIES = 3;
    
    // ✅ Check if invoice number already exists (extra safety)
    let existingInvoice = await Invoice.findOne({ 
      invoiceNumber: invoiceNumber,
      createdBy: req.user.id 
    });
    
    while (existingInvoice && retryCount < MAX_RETRIES) {
      console.log(`⚠️ Invoice number ${invoiceNumber} exists, retrying... (${retryCount + 1}/${MAX_RETRIES})`);
      
      // ✅ Generate new number using timestamp fallback
      const timestamp = Date.now().toString().slice(-6);
      const fallbackNumber = `INV-${new Date().getFullYear()}-${timestamp}`;
      
      // ✅ Check if fallback also exists
      const fallbackExists = await Invoice.findOne({ 
        invoiceNumber: fallbackNumber,
        createdBy: req.user.id 
      });
      
      if (!fallbackExists) {
        invoiceNumber = fallbackNumber;
        break;
      }
      
      // ✅ Extreme fallback: random number
      const random = Math.floor(1000 + Math.random() * 9000);
      invoiceNumber = `INV-${new Date().getFullYear()}-${random}`;
      
      existingInvoice = await Invoice.findOne({ 
        invoiceNumber: invoiceNumber,
        createdBy: req.user.id 
      });
      
      retryCount++;
    }
    
    // ✅ Calculate totals
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
    
    if (totalAmount < 0) totalAmount = 0;
    
    console.log("📊 Invoice Calculation:");
    console.log("   Invoice Number:", invoiceNumber);
    console.log("   Subtotal:", subtotal);
    console.log("   Tax Total:", taxTotal);
    console.log("   Discount:", discountAmount);
    console.log("   Total Amount:", totalAmount);
    
    // ✅ Create invoice
    const invoice = await Invoice.create({
      invoiceNumber: invoiceNumber,
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
    
    console.log(`✅ Invoice created: ${invoiceNumber}`);
    
    // ✅ Create journal entry if totalAmount > 0
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
      
      console.log(`✅ Journal entry created for invoice ${invoiceNumber}`);
    }
    
    res.status(201).json({
      success: true,
      message: 'Invoice created successfully',
      data: invoice,
    });
    
  } catch (error) {
    console.error('Create invoice error:', error);
    
    // ✅ Handle duplicate key error specifically
    if (error.code === 11000 && error.keyPattern?.invoiceNumber) {
      console.log('⚠️ Duplicate invoice number detected, retrying with new number...');
      
      try {
        // ✅ Generate new number with timestamp
        const timestamp = Date.now().toString().slice(-6);
        const fallbackNumber = `INV-${new Date().getFullYear()}-${timestamp}`;
        
        // ✅ Update invoice with new number
        const invoiceData = req.body;
        invoiceData.invoiceNumber = fallbackNumber;
        invoiceData.createdBy = req.user.id;
        
        // ✅ Recreate using same logic
        const newInvoice = await Invoice.create({
          ...invoiceData,
          invoiceNumber: fallbackNumber,
          createdBy: req.user.id,
        });
        
        return res.status(201).json({
          success: true,
          message: 'Invoice created successfully (retry)',
          data: newInvoice,
        });
        
      } catch (retryError) {
        console.error('Retry failed:', retryError);
        return res.status(500).json({
          success: false,
          message: 'Failed to create invoice after retry',
          error: retryError.message,
        });
      }
    }
    
    // ✅ Handle validation errors
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

// ============================================================
// GET ALL INVOICES
// ============================================================
exports.getInvoices = async (req, res) => {
  try {
    const { customerId, status, startDate, endDate } = req.query;
    let query = { createdBy: req.user.id };
    
    if (customerId) {
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
};

// ============================================================
// GET SINGLE INVOICE
// ============================================================
exports.getInvoice = async (req, res) => {
  try {
    const invoice = await Invoice.findOne({ 
      _id: req.params.id, 
      createdBy: req.user.id 
    })
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

// ============================================================
// UPDATE INVOICE
// ============================================================
exports.updateInvoice = async (req, res) => {
  try {
    const invoice = await Invoice.findOne({ 
      _id: req.params.id, 
      createdBy: req.user.id 
    });
    
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
      invoice.outstanding = invoice.totalAmount - invoice.paidAmount;
      
      // ✅ Update journal entry
      const je = await JournalEntry.findOne({ 
        reference: invoice.invoiceNumber, 
        createdBy: req.user.id 
      });
      
      if (je && je.lines && je.lines.length >= 2) {
        const arLine = je.lines.find(l => l.debit > 0);
        const revLine = je.lines.find(l => l.credit > 0);
        
        if (arLine && revLine) {
          arLine.debit = invoice.totalAmount;
          revLine.credit = invoice.totalAmount;
          await je.save();
        }
      }
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

// ============================================================
// DELETE INVOICE
// ============================================================
exports.deleteInvoice = async (req, res) => {
  try {
    const invoice = await Invoice.findOne({ 
      _id: req.params.id, 
      createdBy: req.user.id 
    });
    
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
    
    await JournalEntry.deleteMany({ 
      reference: invoice.invoiceNumber,
      createdBy: req.user.id 
    });
    
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