// controllers/transactionController.js

const Transaction = require('../models/Transaction');
const Income = require('../models/Income');
const Expense = require('../models/Expense');
const Invoice = require('../models/Invoice');
const Bill = require('../models/Bill');
const PaymentReceived = require('../models/PaymentReceived');
const PaymentMade = require('../models/PaymentMade');
const CreditNote = require('../models/CreditNote');
const Loan = require('../models/Loan');
const FixedAsset = require('../models/FixedAsset');
const Customer = require('../models/Customer');
const Vendor = require('../models/Vendor');
const BankAccount = require('../models/BankAccount');
const ChartOfAccount = require('../models/ChartOfAccount');

// Helper: Get or create Income/Expense account
async function getOrCreateAccount(userId, type, category) {
  let accountCode = type === 'income' ? '4000' : '5000';
  let accountName = type === 'income' ? 'Income' : 'Expenses';
  
  const categoryMap = {
    income: {
      'Sales': { code: '4100', name: 'Sales Revenue' },
      'Services': { code: '4200', name: 'Service Revenue' },
      'Consulting': { code: '4300', name: 'Consulting Revenue' },
      'Interest': { code: '4400', name: 'Interest Income' },
      'Rental': { code: '4500', name: 'Rental Income' },
      'Dividend': { code: '4600', name: 'Dividend Income' },
    },
    expense: {
      'Rent': { code: '5100', name: 'Rent Expense' },
      'Salaries': { code: '5200', name: 'Salaries Expense' },
      'Utilities': { code: '5300', name: 'Utilities Expense' },
      'Office Supplies': { code: '5400', name: 'Office Supplies Expense' },
      'Marketing': { code: '5500', name: 'Marketing Expense' },
      'Travel': { code: '5600', name: 'Travel Expense' },
      'Meals': { code: '5700', name: 'Meals & Entertainment' },
      'Software': { code: '5800', name: 'Software Expense' },
      'Equipment': { code: '5900', name: 'Equipment Expense' },
    }
  };
  
  if (categoryMap[type] && categoryMap[type][category]) {
    accountCode = categoryMap[type][category].code;
    accountName = categoryMap[type][category].name;
  }
  
  let account = await ChartOfAccount.findOne({ code: accountCode });
  if (!account) {
    account = await ChartOfAccount.create({
      code: accountCode,
      name: accountName,
      type: type === 'income' ? 'Income' : 'Expenses',
      parentAccount: type === 'income' ? 'Operating Income' : 'Operating Expenses',
      openingBalance: 0,
      description: `${category} account`,
      taxCode: 'N/A',
      createdBy: userId,
    });
  }
  return account;
}

// Helper: Get cash account
async function getOrCreateCashAccount(userId) {
  let cashAccount = await ChartOfAccount.findOne({ code: '1010' });
  if (!cashAccount) {
    cashAccount = await ChartOfAccount.create({
      code: '1010',
      name: 'Cash in Hand',
      type: 'Assets',
      parentAccount: 'Current Assets',
      openingBalance: 0,
      description: 'Physical cash',
      taxCode: 'N/A',
      createdBy: userId,
    });
  }
  return cashAccount;
}

// ==================== CREATE TRANSACTION ====================
exports.createTransaction = async (req, res) => {
  try {
    const {
      date,
      type,
      title,
      description,
      amount,
      category,
      paymentMethod,
      reference,
      customerId,
      vendorId,
      bankAccountId,
    } = req.body;

    let customerName = '';
    let vendorName = '';
    
    if (customerId) {
      const customer = await Customer.findById(customerId);
      if (customer) customerName = customer.name;
    }
    
    if (vendorId) {
      const vendor = await Vendor.findById(vendorId);
      if (vendor) vendorName = vendor.name;
    }

    const transaction = await Transaction.create({
      date: date || new Date(),
      type,
      title,
      description: description || '',
      amount,
      category,
      paymentMethod: paymentMethod || 'Cash',
      reference: reference || '',
      customerId: customerId || null,
      customerName,
      vendorId: vendorId || null,
      vendorName,
      bankAccountId: bankAccountId || null,
      status: 'Posted',
      postedBy: req.user.id,
      postedAt: new Date(),
      createdBy: req.user.id,
    });

    // Create journal entry
    const account = await getOrCreateAccount(req.user.id, type, category);
    let cashOrBankAccount;
    
    if (paymentMethod === 'Cash') {
      cashOrBankAccount = await getOrCreateCashAccount(req.user.id);
    } else if (bankAccountId) {
      const bankAccount = await BankAccount.findById(bankAccountId);
      if (bankAccount) {
        cashOrBankAccount = await ChartOfAccount.findById(bankAccount.chartOfAccountId);
      }
    }
    
    if (!cashOrBankAccount) {
      cashOrBankAccount = await getOrCreateCashAccount(req.user.id);
    }

    await JournalEntry.create({
      entryNumber: `JE-${Date.now()}`,
      date: date || new Date(),
      description: description || `${title} - ${transaction.transactionNumber}`,
      reference: reference || transaction.transactionNumber,
      lines: type === 'income' ? [
        {
          accountId: cashOrBankAccount._id,
          accountName: cashOrBankAccount.name,
          accountCode: cashOrBankAccount.code,
          debit: amount,
          credit: 0,
        },
        {
          accountId: account._id,
          accountName: account.name,
          accountCode: account.code,
          debit: 0,
          credit: amount,
        },
      ] : [
        {
          accountId: account._id,
          accountName: account.name,
          accountCode: account.code,
          debit: amount,
          credit: 0,
        },
        {
          accountId: cashOrBankAccount._id,
          accountName: cashOrBankAccount.name,
          accountCode: cashOrBankAccount.code,
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
      data: transaction,
      message: `${type === 'income' ? 'Income' : 'Expense'} recorded successfully`,
    });
  } catch (error) {
    console.error('Error creating transaction:', error);
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};
// ==================== GET ALL TRANSACTIONS (FROM ALL SOURCES) ====================
exports.getTransactions = async (req, res) => {
  try {
    const {
      type,
      category,
      paymentMethod,
      startDate,
      endDate,
      search,
      page = 1,
      limit = 10,
    } = req.query;

    console.log("🔍 ========== GET TRANSACTIONS DEBUG ==========");
    console.log("📅 startDate:", startDate);
    console.log("📅 endDate:", endDate);
    console.log("🏷️ type:", type);
    console.log("📂 category:", category);
    console.log("💳 paymentMethod:", paymentMethod);
    console.log("🔎 search:", search);
    console.log("📄 page:", page);
    console.log("📏 limit:", limit);
    console.log("==========================================");

    // Create date filters properly
    let dateFilter = {};
    let paymentDateFilter = {};
    let loanDateFilter = {};
    let assetDateFilter = {};
    
    if (startDate && endDate) {
      const start = new Date(startDate);
      const end = new Date(endDate);
      end.setHours(23, 59, 59, 999);
      
      console.log("📆 Start Date Object:", start);
      console.log("📆 End Date Object:", end);
      
      dateFilter = {
        date: { $gte: start, $lte: end }
      };
      paymentDateFilter = {
        paymentDate: { $gte: start, $lte: end }
      };
      loanDateFilter = {
        disbursementDate: { $gte: start, $lte: end }
      };
      assetDateFilter = {
        purchaseDate: { $gte: start, $lte: end }
      };
    }

    let allTransactions = [];

    // ==================== 1. INCOME ====================
    console.log("\n📊 Fetching INCOME...");
    const incomes = await Income.find({
      ...dateFilter,
      status: 'Posted'
    }).lean();
    console.log("💰 Income count:", incomes.length);
    if (incomes.length > 0) {
      console.log("📝 First income:", JSON.stringify(incomes[0], null, 2));
    }
    
    incomes.forEach(inc => {
      allTransactions.push({
        id: inc._id,
        transactionNumber: inc.incomeNumber,
        type: 'income',
        title: inc.incomeType,
        description: inc.description,
        amount: inc.totalAmount,
        date: inc.date,
        category: inc.incomeType,
        paymentMethod: inc.paymentMethod,
        reference: inc.reference,
        customerName: inc.customerName,
        source: 'income',
        icon: 'trending_up',
        color: '#2ECC71',
      });
    });

    // ==================== 2. EXPENSE ====================
    console.log("\n📊 Fetching EXPENSE...");
    const expenses = await Expense.find({
      ...dateFilter,
      status: 'Posted'
    }).lean();
    console.log("💰 Expense count:", expenses.length);
    if (expenses.length > 0) {
      console.log("📝 First expense:", JSON.stringify(expenses[0], null, 2));
    }
    
    expenses.forEach(exp => {
      allTransactions.push({
        id: exp._id,
        transactionNumber: exp.expenseNumber,
        type: 'expense',
        title: exp.expenseType,
        description: exp.description,
        amount: exp.totalAmount,
        date: exp.date,
        category: exp.expenseType,
        paymentMethod: exp.paymentMethod,
        reference: exp.reference,
        vendorName: exp.vendorName,
        source: 'expense',
        icon: 'trending_down',
        color: '#E74C3C',
      });
    });

    // ==================== 3. INVOICES ====================
    console.log("\n📊 Fetching INVOICES...");
    const invoices = await Invoice.find({
      ...dateFilter,
      status: { $in: ['Unpaid', 'Partial', 'Overdue', 'Paid'] }
    }).lean();
    console.log("💰 Invoice count:", invoices.length);
    if (invoices.length > 0) {
      console.log("📝 First invoice:", JSON.stringify(invoices[0], null, 2));
    }
    
    invoices.forEach(inv => {
      allTransactions.push({
        id: inv._id,
        transactionNumber: inv.invoiceNumber,
        type: 'receivable',
        title: 'Invoice Created',
        description: `Invoice for ${inv.customerName}`,
        amount: inv.totalAmount,
        date: inv.date,
        category: 'Sales',
        paymentMethod: 'On Credit',
        reference: inv.invoiceNumber,
        customerName: inv.customerName,
        dueDate: inv.dueDate,
        outstanding: inv.outstanding,
        source: 'invoice',
        icon: 'receipt',
        color: '#3498DB',
      });
    });

    // ==================== 4. BILLS ====================
    console.log("\n📊 Fetching BILLS...");
    const bills = await Bill.find({
      ...dateFilter,
      status: { $in: ['Unpaid', 'Partial', 'Overdue', 'Paid'] }
    }).lean();
    console.log("💰 Bill count:", bills.length);
    if (bills.length > 0) {
      console.log("📝 First bill:", JSON.stringify(bills[0], null, 2));
    }
    
    bills.forEach(bill => {
      allTransactions.push({
        id: bill._id,
        transactionNumber: bill.billNumber,
        type: 'payable',
        title: 'Bill Received',
        description: `Bill from ${bill.vendorName}`,
        amount: bill.totalAmount,
        date: bill.date,
        category: 'Purchase',
        paymentMethod: 'On Credit',
        reference: bill.billNumber,
        vendorName: bill.vendorName,
        dueDate: bill.dueDate,
        outstanding: bill.outstanding,
        source: 'bill',
        icon: 'receipt',
        color: '#E67E22',
      });
    });

    // ==================== 5. PAYMENTS RECEIVED ====================
    console.log("\n📊 Fetching PAYMENTS RECEIVED...");
    const paymentsReceived = await PaymentReceived.find({
      ...paymentDateFilter,
      status: 'Posted'
    }).populate('invoiceId').lean();
    console.log("💰 Payments Received count:", paymentsReceived.length);
    if (paymentsReceived.length > 0) {
      console.log("📝 First payment received:", JSON.stringify(paymentsReceived[0], null, 2));
    }
    
    paymentsReceived.forEach(payment => {
      allTransactions.push({
        id: payment._id,
        transactionNumber: payment.reference,
        type: 'income',
        title: 'Payment Received',
        description: `Payment from ${payment.customerName}`,
        amount: payment.amount,
        date: payment.paymentDate,
        category: 'Receipt',
        paymentMethod: payment.paymentMethod,
        reference: payment.reference,
        customerName: payment.customerName,
        invoiceNumber: payment.invoiceId?.invoiceNumber,
        source: 'payment_received',
        icon: 'arrow_downward',
        color: '#2ECC71',
      });
    });

    // ==================== 6. PAYMENTS MADE ====================
    console.log("\n📊 Fetching PAYMENTS MADE...");
    const paymentsMade = await PaymentMade.find({
      ...paymentDateFilter,
      status: 'Cleared'
    }).populate('billId').lean();
    console.log("💰 Payments Made count:", paymentsMade.length);
    if (paymentsMade.length > 0) {
      console.log("📝 First payment made:", JSON.stringify(paymentsMade[0], null, 2));
    }
    
    paymentsMade.forEach(payment => {
      allTransactions.push({
        id: payment._id,
        transactionNumber: payment.reference,
        type: 'expense',
        title: 'Payment Made',
        description: `Payment to ${payment.vendorName}`,
        amount: payment.amount,
        date: payment.paymentDate,
        category: 'Payment',
        paymentMethod: payment.paymentMethod,
        reference: payment.reference,
        vendorName: payment.vendorName,
        billNumber: payment.billId?.billNumber,
        source: 'payment_made',
        icon: 'arrow_upward',
        color: '#E74C3C',
      });
    });

    // ==================== 7. CREDIT NOTES ====================
    console.log("\n📊 Fetching CREDIT NOTES...");
    const creditNotes = await CreditNote.find({
      ...dateFilter,
      status: { $in: ['Issued', 'Applied'] }
    }).lean();
    console.log("💰 Credit Notes count:", creditNotes.length);
    if (creditNotes.length > 0) {
      console.log("📝 First credit note:", JSON.stringify(creditNotes[0], null, 2));
    }
    
    creditNotes.forEach(cn => {
      allTransactions.push({
        id: cn._id,
        transactionNumber: cn.creditNoteNumber,
        type: cn.status === 'Applied' ? 'income' : 'adjustment',
        title: 'Credit Note',
        description: cn.reason,
        amount: cn.amount,
        date: cn.date,
        category: 'Adjustment',
        paymentMethod: 'Credit',
        reference: cn.creditNoteNumber,
        customerName: cn.customerName,
        appliedAmount: cn.appliedAmount,
        remainingAmount: cn.remainingAmount,
        source: 'credit_note',
        icon: 'note',
        color: '#F1C40F',
      });
    });

    // ==================== 8. LOANS ====================
    console.log("\n📊 Fetching LOANS...");
    const loans = await Loan.find({
      ...loanDateFilter,
      status: { $ne: 'Fully Paid' }
    }).lean();
    console.log("💰 Loans count:", loans.length);
    if (loans.length > 0) {
      console.log("📝 First loan:", JSON.stringify(loans[0], null, 2));
    }
    
    loans.forEach(loan => {
      allTransactions.push({
        id: loan._id,
        transactionNumber: loan.loanNumber,
        type: 'financing',
        title: 'Loan Disbursement',
        description: `${loan.loanType} from ${loan.lenderName}`,
        amount: loan.loanAmount,
        date: loan.disbursementDate,
        category: 'Financing',
        paymentMethod: 'Bank Transfer',
        reference: loan.loanNumber,
        source: 'loan',
        icon: 'credit_card',
        color: '#3498DB',
      });
    });

    // ==================== 9. FIXED ASSETS ====================
    console.log("\n📊 Fetching FIXED ASSETS...");
    const assets = await FixedAsset.find({
      ...assetDateFilter,
      status: 'Active'
    }).lean();
    console.log("💰 Fixed Assets count:", assets.length);
    if (assets.length > 0) {
      console.log("📝 First asset:", JSON.stringify(assets[0], null, 2));
    }
    
    assets.forEach(asset => {
      allTransactions.push({
        id: asset._id,
        transactionNumber: asset.assetCode,
        type: 'investment',
        title: 'Asset Purchase',
        description: `Purchase of ${asset.name}`,
        amount: asset.purchaseCost,
        date: asset.purchaseDate,
        category: 'Fixed Asset',
        paymentMethod: 'Bank Transfer',
        reference: asset.assetCode,
        source: 'fixed_asset',
        icon: 'business_center',
        color: '#1ABC9C',
      });
    });

    console.log("\n📊 TOTAL TRANSACTIONS BEFORE FILTERS:", allTransactions.length);
    
    // ==================== FILTERS ====================
    
    // Filter by type
    if (type && type !== 'All') {
      const beforeCount = allTransactions.length;
      allTransactions = allTransactions.filter(t => t.type === type);
      console.log(`🔍 Filter by type '${type}': ${beforeCount} -> ${allTransactions.length}`);
    }
    
    // Filter by category
    if (category && category !== 'All') {
      const beforeCount = allTransactions.length;
      allTransactions = allTransactions.filter(t => t.category === category);
      console.log(`🔍 Filter by category '${category}': ${beforeCount} -> ${allTransactions.length}`);
    }
    
    // Filter by payment method
    if (paymentMethod && paymentMethod !== 'All') {
      const beforeCount = allTransactions.length;
      allTransactions = allTransactions.filter(t => t.paymentMethod === paymentMethod);
      console.log(`🔍 Filter by paymentMethod '${paymentMethod}': ${beforeCount} -> ${allTransactions.length}`);
    }
    
    // Filter by search
    if (search) {
      const searchLower = search.toLowerCase();
      const beforeCount = allTransactions.length;
      allTransactions = allTransactions.filter(t => 
        t.title?.toLowerCase().includes(searchLower) ||
        t.description?.toLowerCase().includes(searchLower) ||
        t.reference?.toLowerCase().includes(searchLower) ||
        t.customerName?.toLowerCase().includes(searchLower) ||
        t.vendorName?.toLowerCase().includes(searchLower)
      );
      console.log(`🔍 Filter by search '${search}': ${beforeCount} -> ${allTransactions.length}`);
    }

    // Sort by date
    allTransactions.sort((a, b) => new Date(b.date) - new Date(a.date));

    // Pagination
    const skip = (parseInt(page) - 1) * parseInt(limit);
    const paginated = allTransactions.slice(skip, skip + parseInt(limit));
    const total = allTransactions.length;

    console.log("\n📊 FINAL RESULTS:");
    console.log("📄 Total records:", total);
    console.log("📄 Paginated count:", paginated.length);
    console.log("📄 Page:", page);
    console.log("📄 Pages:", Math.ceil(total / parseInt(limit)));
    console.log("==========================================\n");

    // Calculate summary
    const totalIncome = allTransactions
      .filter(t => t.type === 'income')
      .reduce((sum, t) => sum + t.amount, 0);
    const totalExpense = allTransactions
      .filter(t => t.type === 'expense')
      .reduce((sum, t) => sum + t.amount, 0);
    const totalReceivable = allTransactions
      .filter(t => t.type === 'receivable')
      .reduce((sum, t) => sum + t.amount, 0);
    const totalPayable = allTransactions
      .filter(t => t.type === 'payable')
      .reduce((sum, t) => sum + t.amount, 0);

    res.status(200).json({
      success: true,
      count: paginated.length,
      total: total,
      page: parseInt(page),
      pages: Math.ceil(total / parseInt(limit)),
      data: paginated,
      summary: {
        totalIncome,
        totalExpense,
        totalReceivable,
        totalPayable,
        netCashFlow: totalIncome - totalExpense,
      },
    });
  } catch (error) {
    console.error('🔥 Error getting transactions:', error);
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

// ==================== GET SINGLE TRANSACTION ====================
exports.getTransaction = async (req, res) => {
  try {
    const transaction = await Transaction.findById(req.params.id)
      .populate('customerId', 'name email phone')
      .populate('vendorId', 'name email phone')
      .populate('bankAccountId', 'accountName accountNumber');

    if (!transaction) {
      return res.status(404).json({
        success: false,
        message: 'Transaction not found',
      });
    }

    res.status(200).json({
      success: true,
      data: transaction,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

// ==================== UPDATE TRANSACTION ====================
exports.updateTransaction = async (req, res) => {
  try {
    const transaction = await Transaction.findById(req.params.id);

    if (!transaction) {
      return res.status(404).json({
        success: false,
        message: 'Transaction not found',
      });
    }

    if (transaction.status === 'Posted') {
      return res.status(400).json({
        success: false,
        message: 'Cannot update posted transaction',
      });
    }

    const allowedUpdates = [
      'date', 'title', 'description', 'amount', 'category',
      'paymentMethod', 'reference', 'customerId', 'vendorId', 'bankAccountId'
    ];
    
    allowedUpdates.forEach(field => {
      if (req.body[field] !== undefined) {
        transaction[field] = req.body[field];
      }
    });

    if (req.body.customerId) {
      const customer = await Customer.findById(req.body.customerId);
      if (customer) transaction.customerName = customer.name;
    }
    
    if (req.body.vendorId) {
      const vendor = await Vendor.findById(req.body.vendorId);
      if (vendor) transaction.vendorName = vendor.name;
    }

    await transaction.save();

    res.status(200).json({
      success: true,
      data: transaction,
      message: 'Transaction updated successfully',
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

// ==================== DELETE TRANSACTION ====================
exports.deleteTransaction = async (req, res) => {
  try {
    const transaction = await Transaction.findById(req.params.id);

    if (!transaction) {
      return res.status(404).json({
        success: false,
        message: 'Transaction not found',
      });
    }

    if (transaction.status === 'Posted') {
      return res.status(400).json({
        success: false,
        message: 'Cannot delete posted transaction',
      });
    }

    await transaction.deleteOne();

    res.status(200).json({
      success: true,
      message: 'Transaction deleted successfully',
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

// ==================== GET SUMMARY ====================
exports.getSummary = async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    let dateFilter = {};
    let paymentDateFilter = {};

    if (startDate && endDate) {
      const start = new Date(startDate);
      const end = new Date(endDate);
      end.setHours(23, 59, 59, 999);
      
      dateFilter = {
        date: { $gte: start, $lte: end }
      };
      paymentDateFilter = {
        paymentDate: { $gte: start, $lte: end }
      };
    }

    const incomes = await Income.find({ ...dateFilter, status: 'Posted' });
    const expenses = await Expense.find({ ...dateFilter, status: 'Posted' });
    const paymentsReceived = await PaymentReceived.find({ ...paymentDateFilter, status: 'Posted' });
    const paymentsMade = await PaymentMade.find({ ...paymentDateFilter, status: 'Cleared' });
    
    const totalIncome = incomes.reduce((sum, inc) => sum + inc.totalAmount, 0) +
                         paymentsReceived.reduce((sum, pay) => sum + pay.amount, 0);
    const totalExpense = expenses.reduce((sum, exp) => sum + exp.totalAmount, 0) +
                         paymentsMade.reduce((sum, pay) => sum + pay.amount, 0);

    res.status(200).json({
      success: true,
      data: {
        totalIncome,
        totalExpense,
        netCashFlow: totalIncome - totalExpense,
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

// ==================== GET CATEGORIES ====================
exports.getCategories = async (req, res) => {
  try {
    const incomeCategories = [
      'Sales', 'Services', 'Consulting', 'Interest', 'Rental', 'Dividend', 'Other', 'Receipt'
    ];
    
    const expenseCategories = [
      'Rent', 'Salaries', 'Utilities', 'Office Supplies', 'Marketing', 
      'Travel', 'Meals', 'Software', 'Equipment', 'Payment', 'Other'
    ];
    
    const otherCategories = [
      'Sales', 'Purchase', 'Adjustment', 'Financing', 'Investment', 'Fixed Asset'
    ];
    
    res.status(200).json({
      success: true,
      data: {
        income: incomeCategories,
        expense: expenseCategories,
        other: otherCategories,
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