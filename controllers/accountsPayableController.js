const Vendor = require('../models/Vendor');
const Bill = require('../models/Bill');
const JournalEntry = require('../models/JournalEntry');
const ChartOfAccount = require('../models/ChartOfAccount');
const BankAccount = require('../models/BankAccount');

// ==================== HELPER FUNCTIONS ====================

// Helper: Get or create Accounts Payable account
async function getOrCreatePayableAccount(userId) {
  let apAccount = await ChartOfAccount.findOne({ code: '2010' });
  if (!apAccount) {
    apAccount = await ChartOfAccount.create({
      code: '2010',
      name: 'Accounts Payable',
      type: 'Liabilities',
      parentAccount: 'Current Liabilities',
      openingBalance: 0,
      description: 'Amount due to vendors',
      taxCode: 'N/A',
      createdBy: userId,
    });
  }
  return apAccount;
}

// Helper: Get or create Expense account
async function getOrCreateExpenseAccount(userId) {
  let expenseAccount = await ChartOfAccount.findOne({ code: '5000' });
  if (!expenseAccount) {
    expenseAccount = await ChartOfAccount.create({
      code: '5000',
      name: 'Expense Account',
      type: 'Expenses',
      parentAccount: 'Operating Expenses',
      openingBalance: 0,
      description: 'General expenses',
      taxCode: 'N/A',
      createdBy: userId,
    });
  }
  return expenseAccount;
}

// Helper: Get or create Bank account (Cash)
async function getOrCreateCashAccount(userId) {
  let cashAccount = await ChartOfAccount.findOne({ code: '1010' });
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

// ==================== VENDOR CRUD ====================

// @desc    Create vendor
// @route   POST /api/accounts-payable/vendors
// @access  Private
exports.createVendor = async (req, res) => {
  try {
    req.body.createdBy = req.user.id;
    const vendor = await Vendor.create(req.body);
    
    res.status(201).json({
      success: true,
      data: vendor,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

// @desc    Get all vendors
// @route   GET /api/accounts-payable/vendors
// @access  Private
exports.getVendors = async (req, res) => {
  try {
    const { search, status } = req.query;
    let query = {};
    
    if (search) {
      query.$or = [
        { name: { $regex: search, $options: 'i' } },
        { email: { $regex: search, $options: 'i' } },
        { phone: { $regex: search, $options: 'i' } },
      ];
    }
    
    if (status === 'active') query.isActive = true;
    if (status === 'inactive') query.isActive = false;
    
    const vendors = await Vendor.find(query).sort({ name: 1 });
    
    // Calculate outstanding for each vendor
    const bills = await Bill.find({ status: { $ne: 'Paid' } });
    
    const vendorsWithOutstanding = vendors.map(vendor => {
      const vendorBills = bills.filter(
        bill => bill.vendorId.toString() === vendor._id.toString()
      );
      const totalAmount = vendorBills.reduce((sum, bill) => sum + bill.totalAmount, 0);
      const paidAmount = vendorBills.reduce((sum, bill) => sum + bill.paidAmount, 0);
      const outstandingAmount = totalAmount - paidAmount;
      
      return {
        ...vendor.toObject(),
        totalAmount,
        paidAmount,
        outstandingAmount,
        billCount: vendorBills.length,
      };
    });
    
    res.status(200).json({
      success: true,
      count: vendorsWithOutstanding.length,
      data: vendorsWithOutstanding,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

// @desc    Get single vendor
// @route   GET /api/accounts-payable/vendors/:id
// @access  Private
exports.getVendor = async (req, res) => {
  try {
    const vendor = await Vendor.findById(req.params.id);
    if (!vendor) {
      return res.status(404).json({
        success: false,
        message: 'Vendor not found',
      });
    }
    
    const bills = await Bill.find({ vendorId: vendor._id }).sort({ date: -1 });
    
    const totalAmount = bills.reduce((sum, bill) => sum + bill.totalAmount, 0);
    const paidAmount = bills.reduce((sum, bill) => sum + bill.paidAmount, 0);
    const outstandingAmount = totalAmount - paidAmount;
    
    res.status(200).json({
      success: true,
      data: {
        ...vendor.toObject(),
        bills,
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

// @desc    Update vendor
// @route   PUT /api/accounts-payable/vendors/:id
// @access  Private
exports.updateVendor = async (req, res) => {
  try {
    const vendor = await Vendor.findByIdAndUpdate(
      req.params.id,
      req.body,
      { new: true, runValidators: true }
    );
    
    if (!vendor) {
      return res.status(404).json({
        success: false,
        message: 'Vendor not found',
      });
    }
    
    res.status(200).json({
      success: true,
      data: vendor,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

// @desc    Delete vendor
// @route   DELETE /api/accounts-payable/vendors/:id
// @access  Private
exports.deleteVendor = async (req, res) => {
  try {
    const hasBills = await Bill.findOne({ vendorId: req.params.id });
    if (hasBills) {
      return res.status(400).json({
        success: false,
        message: 'Cannot delete vendor with existing bills',
      });
    }
    
    const vendor = await Vendor.findByIdAndDelete(req.params.id);
    if (!vendor) {
      return res.status(404).json({
        success: false,
        message: 'Vendor not found',
      });
    }
    
    res.status(200).json({
      success: true,
      message: 'Vendor deleted successfully',
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

// ==================== BILL CRUD ====================

// @desc    Create bill
// @route   POST /api/accounts-payable/bills
// @access  Private
exports.createBill = async (req, res) => {
  try {
    const { vendorId, date, dueDate, items, discount, notes } = req.body;
    
    const vendor = await Vendor.findById(vendorId);
    if (!vendor) {
      return res.status(404).json({
        success: false,
        message: 'Vendor not found',
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
    
    const bill = await Bill.create({
      vendorId,
      vendorName: vendor.name,
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
    
    // Get accounts for journal entry
    const apAccount = await getOrCreatePayableAccount(req.user.id);
    const expenseAccount = await getOrCreateExpenseAccount(req.user.id);
    
    // Create journal entry
    await JournalEntry.create({
      entryNumber: `JE-${Date.now()}`,
      date: new Date(),
      description: `Bill ${bill.billNumber} - ${vendor.name}`,
      reference: bill.billNumber,
      lines: [
        {
          accountId: expenseAccount._id,
          accountName: expenseAccount.name,
          accountCode: expenseAccount.code,
          debit: totalAmount,
          credit: 0,
        },
        {
          accountId: apAccount._id,
          accountName: apAccount.name,
          accountCode: apAccount.code,
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
      data: bill,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

// @desc    Get all bills
// @route   GET /api/accounts-payable/bills
// @access  Private
exports.getBills = async (req, res) => {
  try {
    const { vendorId, status, startDate, endDate } = req.query;
    let query = {};
    
    if (vendorId) query.vendorId = vendorId;
    if (status) query.status = status;
    if (startDate && endDate) {
      query.date = { $gte: new Date(startDate), $lte: new Date(endDate) };
    }
    
    const bills = await Bill.find(query)
      .populate('vendorId', 'name email phone')
      .sort({ date: -1 });
    
    res.status(200).json({
      success: true,
      count: bills.length,
      data: bills,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

// @desc    Get single bill
// @route   GET /api/accounts-payable/bills/:id
// @access  Private
exports.getBill = async (req, res) => {
  try {
    const bill = await Bill.findById(req.params.id)
      .populate('vendorId', 'name email phone address');
    
    if (!bill) {
      return res.status(404).json({
        success: false,
        message: 'Bill not found',
      });
    }
    
    res.status(200).json({
      success: true,
      data: bill,
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

// @desc    Record payment against bill
// @route   POST /api/accounts-payable/payments
// @access  Private
exports.recordPayment = async (req, res) => {
  try {
    const { billId, amount, paymentDate, paymentMethod, reference, bankAccountId } = req.body;
    
    const bill = await Bill.findById(billId).populate('vendorId');
    if (!bill) {
      return res.status(404).json({
        success: false,
        message: 'Bill not found',
      });
    }
    
    const outstanding = bill.totalAmount - bill.paidAmount;
    if (amount > outstanding) {
      return res.status(400).json({
        success: false,
        message: `Payment amount cannot exceed outstanding balance of ${outstanding}`,
      });
    }
    
    // Update bill paid amount
    bill.paidAmount += amount;
    await bill.save();
    
    // Get accounts
    const apAccount = await getOrCreatePayableAccount(req.user.id);
    
    let bankAccount = null;
    let bankChartAccount = null;
    let cashAccount = null;
    
    if (bankAccountId && bankAccountId !== '') {
      bankAccount = await BankAccount.findById(bankAccountId);
      if (bankAccount) {
        bankChartAccount = await ChartOfAccount.findById(bankAccount.chartOfAccountId);
      }
    }
    
    // If no bank account selected, use Cash account
    if (!bankChartAccount) {
      cashAccount = await getOrCreateCashAccount(req.user.id);
    }
    
    // Create journal entry for payment
    await JournalEntry.create({
      entryNumber: `JE-${Date.now()}`,
      date: paymentDate || new Date(),
      description: `Payment made for ${bill.billNumber} to ${bill.vendorId.name}`,
      reference: reference || `PAY-${bill.billNumber}`,
      lines: [
        {
          accountId: apAccount._id,
          accountName: apAccount.name,
          accountCode: apAccount.code,
          debit: amount,
          credit: 0,
        },
        {
          accountId: bankChartAccount ? bankChartAccount._id : cashAccount._id,
          accountName: bankChartAccount ? bankChartAccount.name : cashAccount.name,
          accountCode: bankChartAccount ? bankChartAccount.code : cashAccount.code,
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
      bankAccount.currentBalance -= amount;
      await bankAccount.save();
      
      if (bankChartAccount) {
        await ChartOfAccount.findByIdAndUpdate(bankChartAccount._id, {
          currentBalance: bankAccount.currentBalance,
        });
      }
    }
    
    // Update Cash account balance if cash was used
    if (!bankAccountId && cashAccount) {
      const cashChartAccount = await ChartOfAccount.findById(cashAccount._id);
      if (cashChartAccount) {
        cashChartAccount.currentBalance -= amount;
        await cashChartAccount.save();
      }
    }
    
    res.status(200).json({
      success: true,
      data: {
        bill: {
          id: bill._id,
          billNumber: bill.billNumber,
          paidAmount: bill.paidAmount,
          outstanding: bill.totalAmount - bill.paidAmount,
          status: bill.status,
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

// ==================== ACCOUNTS PAYABLE SUMMARY ====================

// @desc    Get AP summary
// @route   GET /api/accounts-payable/summary
// @access  Private
exports.getSummary = async (req, res) => {
  try {
    const bills = await Bill.find({ status: { $ne: 'Paid' } });
    
    const totalOutstanding = bills.reduce((sum, bill) => sum + (bill.totalAmount - bill.paidAmount), 0);
    
    const now = new Date();
    const endOfWeek = new Date(now);
    endOfWeek.setDate(now.getDate() + (7 - now.getDay()));
    const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    
    const overdue = bills
      .filter(bill => bill.dueDate < now && bill.status !== 'Paid')
      .reduce((sum, bill) => sum + (bill.totalAmount - bill.paidAmount), 0);
    
    const dueThisWeek = bills
      .filter(bill => bill.dueDate >= now && bill.dueDate <= endOfWeek && bill.status !== 'Paid')
      .reduce((sum, bill) => sum + (bill.totalAmount - bill.paidAmount), 0);
    
    const dueThisMonth = bills
      .filter(bill => bill.dueDate >= now && bill.dueDate <= endOfMonth && bill.status !== 'Paid')
      .reduce((sum, bill) => sum + (bill.totalAmount - bill.paidAmount), 0);
    
    const activeVendors = await Vendor.countDocuments({ isActive: true });
    
    res.status(200).json({
      success: true,
      data: {
        totalOutstanding,
        overdue,
        dueThisWeek,
        dueThisMonth,
        activeVendors,
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