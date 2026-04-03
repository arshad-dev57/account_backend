// controllers/balanceSheetController.js

const Income = require('../models/Income');
const Expense = require('../models/Expense');
const ChartOfAccount = require('../models/ChartOfAccount');
const BankAccount = require('../models/BankAccount');
const Loan = require('../models/Loan');
const Invoice = require('../models/Invoice');

exports.getBalanceSheet = async (req, res) => {
  try {
    const { period, asOfDate } = req.query;
    
    let reportDate;
    let startDate, endDate;
    const now = new Date();
    
    // Set report date
    if (asOfDate) {
      reportDate = new Date(asOfDate);
      reportDate.setHours(23, 59, 59, 999);
    } else {
      reportDate = new Date(now);
      reportDate.setHours(23, 59, 59, 999);
    }
    
    // Set date range based on period
    switch (period) {
      case 'This Month':
        startDate = new Date(reportDate.getFullYear(), reportDate.getMonth(), 1);
        endDate = reportDate;
        break;
      case 'This Quarter':
        const quarter = Math.floor(reportDate.getMonth() / 3);
        startDate = new Date(reportDate.getFullYear(), quarter * 3, 1);
        endDate = reportDate;
        break;
      case 'This Year':
        startDate = new Date(reportDate.getFullYear(), 0, 1);
        endDate = reportDate;
        break;
      case 'All Time':
      default:
        startDate = new Date(2000, 0, 1);
        endDate = reportDate;
    }
    
    // Get all Chart of Accounts - only for this user
    const allAccounts = await ChartOfAccount.find({ 
      isActive: true,
      createdBy: req.user.id  // 👈 Only show accounts created by this user
    });
    
    // Initialize balance sheet structure
    const balanceSheet = {
      liabilities: {},
      assets: {},
      totalLiabilities: 0,
      totalAssets: 0
    };
    
    // Organize accounts by category
    for (const account of allAccounts) {
      const balance = account.currentBalance || account.openingBalance || 0;
      
      if (account.type === 'Liabilities') {
        // Group by parent account
        const parent = account.parentAccount || 'Other Liabilities';
        if (!balanceSheet.liabilities[parent]) {
          balanceSheet.liabilities[parent] = {};
        }
        balanceSheet.liabilities[parent][account.name] = balance;
        balanceSheet.totalLiabilities += balance;
      } 
      else if (account.type === 'Assets') {
        // Group by parent account
        const parent = account.parentAccount || 'Other Assets';
        if (!balanceSheet.assets[parent]) {
          balanceSheet.assets[parent] = {};
        }
        balanceSheet.assets[parent][account.name] = balance;
        balanceSheet.totalAssets += balance;
      }
      else if (account.type === 'Equity') {
        // Equity accounts go to liabilities side
        const parent = account.parentAccount || 'Owners Equity';
        if (!balanceSheet.liabilities[parent]) {
          balanceSheet.liabilities[parent] = {};
        }
        balanceSheet.liabilities[parent][account.name] = balance;
        balanceSheet.totalLiabilities += balance;
      }
    }
    
    // Get bank account balances (Cash & Bank) - only for this user
    const bankAccounts = await BankAccount.find({ 
      status: 'Active',
      createdBy: req.user.id  // 👈 Only show bank accounts created by this user
    });
    let totalBankBalance = 0;
    
    for (const account of bankAccounts) {
      totalBankBalance += account.currentBalance || 0;
    }
    
    // Add cash and bank to current assets
    if (totalBankBalance > 0) {
      if (!balanceSheet.assets['Current Assets']) {
        balanceSheet.assets['Current Assets'] = {};
      }
      balanceSheet.assets['Current Assets']['Cash & Bank'] = totalBankBalance;
      balanceSheet.totalAssets += totalBankBalance;
    }
    
    // Get accounts receivable from invoices - only for this user
    const unpaidInvoices = await Invoice.find({ 
      status: { $in: ['Unpaid', 'Partial', 'Overdue'] },
      outstanding: { $gt: 0 },
      createdBy: req.user.id  // 👈 Only show invoices created by this user
    });
    
    let totalReceivables = 0;
    for (const invoice of unpaidInvoices) {
      totalReceivables += invoice.outstanding;
    }
    
    if (totalReceivables > 0) {
      if (!balanceSheet.assets['Current Assets']) {
        balanceSheet.assets['Current Assets'] = {};
      }
      balanceSheet.assets['Current Assets']['Accounts Receivable'] = totalReceivables;
      balanceSheet.totalAssets += totalReceivables;
    }
    
    // Get loan balances - only for this user
    const loans = await Loan.find({ 
      status: { $ne: 'Fully Paid' },
      createdBy: req.user.id  // 👈 Only show loans created by this user
    });
    let totalLoanBalance = 0;
    const loanCategories = {
      'Short-term Loans': 0,
      'Long-term Debt': 0
    };
    
    for (const loan of loans) {
      const outstanding = loan.outstandingBalance;
      totalLoanBalance += outstanding;
      
      if (loan.tenureMonths <= 12) {
        loanCategories['Short-term Loans'] += outstanding;
      } else {
        loanCategories['Long-term Debt'] += outstanding;
      }
    }
    
    // Add loans to liabilities
    if (loanCategories['Short-term Loans'] > 0) {
      if (!balanceSheet.liabilities['Current Liabilities']) {
        balanceSheet.liabilities['Current Liabilities'] = {};
      }
      balanceSheet.liabilities['Current Liabilities']['Short-term Loans'] = loanCategories['Short-term Loans'];
      balanceSheet.totalLiabilities += loanCategories['Short-term Loans'];
    }
    
    if (loanCategories['Long-term Debt'] > 0) {
      if (!balanceSheet.liabilities['Other Liabilities']) {
        balanceSheet.liabilities['Other Liabilities'] = {};
      }
      balanceSheet.liabilities['Other Liabilities']['Long-term Debt'] = loanCategories['Long-term Debt'];
      balanceSheet.totalLiabilities += loanCategories['Long-term Debt'];
    }
    
    // Get retained earnings (net profit/loss for the period) - only for this user
    const incomes = await Income.find({ 
      date: { $gte: startDate, $lte: endDate },
      status: 'Posted',
      createdBy: req.user.id  // 👈 Only show incomes created by this user
    });
    
    const expenses = await Expense.find({ 
      date: { $gte: startDate, $lte: endDate },
      status: 'Posted',
      createdBy: req.user.id  // 👈 Only show expenses created by this user
    });
    
    const totalIncome = incomes.reduce((sum, inc) => sum + inc.totalAmount, 0);
    const totalExpense = expenses.reduce((sum, exp) => sum + exp.totalAmount, 0);
    const retainedEarnings = totalIncome - totalExpense;
    
    // Add retained earnings to equity
    if (retainedEarnings !== 0) {
      if (!balanceSheet.liabilities['Profit and Loss']) {
        balanceSheet.liabilities['Profit and Loss'] = {};
      }
      balanceSheet.liabilities['Profit and Loss']['Retained Earnings'] = retainedEarnings;
      balanceSheet.totalLiabilities += retainedEarnings;
    }
    
    // Sort categories
    const sortedLiabilities = {};
    const liabilityOrder = ['Current Liabilities', 'Other Liabilities', 'Owners Equity', 'Profit and Loss'];
    for (const key of liabilityOrder) {
      if (balanceSheet.liabilities[key]) {
        sortedLiabilities[key] = balanceSheet.liabilities[key];
      }
    }
    // Add any remaining categories
    for (const key in balanceSheet.liabilities) {
      if (!sortedLiabilities[key]) {
        sortedLiabilities[key] = balanceSheet.liabilities[key];
      }
    }
    
    const sortedAssets = {};
    const assetOrder = ['Current Assets', 'Fixed Assets', 'Intangible Assets', 'Other Assets'];
    for (const key of assetOrder) {
      if (balanceSheet.assets[key]) {
        sortedAssets[key] = balanceSheet.assets[key];
      }
    }
    for (const key in balanceSheet.assets) {
      if (!sortedAssets[key]) {
        sortedAssets[key] = balanceSheet.assets[key];
      }
    }
    
    res.status(200).json({
      success: true,
      data: {
        asOfDate: reportDate,
        period: period || 'All Time',
        liabilities: sortedLiabilities,
        assets: sortedAssets,
        totalLiabilities: balanceSheet.totalLiabilities,
        totalAssets: balanceSheet.totalAssets,
        equity: balanceSheet.totalAssets - balanceSheet.totalLiabilities
      }
    });
    
  } catch (error) {
    console.error('Error generating balance sheet:', error);
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

exports.getSummary = async (req, res) => {
  try {
    const now = new Date();
    now.setHours(23, 59, 59, 999);
    
    // Get all Chart of Accounts - only for this user
    const allAccounts = await ChartOfAccount.find({ 
      isActive: true,
      createdBy: req.user.id  // 👈 Only show accounts created by this user
    });
    
    let totalAssets = 0;
    let totalLiabilities = 0;
    let totalEquity = 0;
    
    for (const account of allAccounts) {
      const balance = account.currentBalance || account.openingBalance || 0;
      
      if (account.type === 'Assets') {
        totalAssets += balance;
      } else if (account.type === 'Liabilities') {
        totalLiabilities += balance;
      } else if (account.type === 'Equity') {
        totalEquity += balance;
      }
    }
    
    // Get bank accounts - only for this user
    const bankAccounts = await BankAccount.find({ 
      status: 'Active',
      createdBy: req.user.id  // 👈 Only show bank accounts created by this user
    });
    for (const account of bankAccounts) {
      totalAssets += account.currentBalance || 0;
    }
    
    // Get loans - only for this user
    const loans = await Loan.find({ 
      status: { $ne: 'Fully Paid' },
      createdBy: req.user.id  // 👈 Only show loans created by this user
    });
    for (const loan of loans) {
      totalLiabilities += loan.outstandingBalance;
    }
    
    // Get unpaid invoices - only for this user
    const unpaidInvoices = await Invoice.find({ 
      status: { $in: ['Unpaid', 'Partial', 'Overdue'] },
      outstanding: { $gt: 0 },
      createdBy: req.user.id  // 👈 Only show invoices created by this user
    });
    for (const invoice of unpaidInvoices) {
      totalAssets += invoice.outstanding;
    }
    
    res.status(200).json({
      success: true,
      data: {
        asOfDate: now,
        totalAssets,
        totalLiabilities,
        totalEquity: totalAssets - totalLiabilities
      }
    });
    
  } catch (error) {
    console.error('Error generating balance sheet summary:', error);
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

// ==================== GET BALANCE SHEET BY DATE ====================
exports.getBalanceSheetByDate = async (req, res) => {
  try {
    const { date } = req.params;
    const reportDate = new Date(date);
    reportDate.setHours(23, 59, 59, 999);
    
    // Get all Chart of Accounts as of date - only for this user
    const allAccounts = await ChartOfAccount.find({ 
      isActive: true,
      createdBy: req.user.id  // 👈 Only show accounts created by this user
    });
    
    let totalAssets = 0;
    let totalLiabilities = 0;
    let totalEquity = 0;
    
    const assets = [];
    const liabilities = [];
    const equity = [];
    
    for (const account of allAccounts) {
      const balance = account.currentBalance || account.openingBalance || 0;
      
      if (account.type === 'Assets') {
        totalAssets += balance;
        assets.push({
          code: account.code,
          name: account.name,
          balance: balance
        });
      } else if (account.type === 'Liabilities') {
        totalLiabilities += balance;
        liabilities.push({
          code: account.code,
          name: account.name,
          balance: balance
        });
      } else if (account.type === 'Equity') {
        totalEquity += balance;
        equity.push({
          code: account.code,
          name: account.name,
          balance: balance
        });
      }
    }
    
    // Get bank accounts as of date - only for this user
    const bankAccounts = await BankAccount.find({ 
      status: 'Active',
      createdBy: req.user.id
    });
    let totalBankBalance = 0;
    for (const account of bankAccounts) {
      totalBankBalance += account.currentBalance || 0;
    }
    totalAssets += totalBankBalance;
    assets.push({
      code: '1010',
      name: 'Cash & Bank',
      balance: totalBankBalance
    });
    
    // Get loans as of date - only for this user
    const loans = await Loan.find({ 
      status: { $ne: 'Fully Paid' },
      createdBy: req.user.id
    });
    let totalLoanBalance = 0;
    for (const loan of loans) {
      totalLoanBalance += loan.outstandingBalance;
    }
    totalLiabilities += totalLoanBalance;
    liabilities.push({
      code: '2100',
      name: 'Loans Payable',
      balance: totalLoanBalance
    });
    
    // Get current period profit/loss
    const startOfYear = new Date(reportDate.getFullYear(), 0, 1);
    const incomes = await Income.aggregate([
      { $match: { 
        date: { $gte: startOfYear, $lte: reportDate }, 
        status: 'Posted',
        createdBy: req.user.id
      } },
      { $group: { _id: null, total: { $sum: '$totalAmount' } } }
    ]);
    
    const expenses = await Expense.aggregate([
      { $match: { 
        date: { $gte: startOfYear, $lte: reportDate }, 
        status: 'Posted',
        createdBy: req.user.id
      } },
      { $group: { _id: null, total: { $sum: '$totalAmount' } } }
    ]);
    
    const currentProfit = (incomes[0]?.total || 0) - (expenses[0]?.total || 0);
    
    res.status(200).json({
      success: true,
      data: {
        asOfDate: reportDate,
        assets: {
          total: totalAssets,
          items: assets
        },
        liabilities: {
          total: totalLiabilities,
          items: liabilities
        },
        equity: {
          total: totalEquity + currentProfit,
          currentProfit: currentProfit,
          items: equity
        }
      }
    });
    
  } catch (error) {
    console.error('Error generating balance sheet by date:', error);
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

// ==================== GET ASSETS BREAKDOWN ====================
exports.getAssetsBreakdown = async (req, res) => {
  try {
    const { asOfDate } = req.query;
    const reportDate = asOfDate ? new Date(asOfDate) : new Date();
    reportDate.setHours(23, 59, 59, 999);
    
    // Get assets from Chart of Accounts - only for this user
    const assetAccounts = await ChartOfAccount.find({ 
      type: 'Assets',
      isActive: true,
      createdBy: req.user.id  // 👈 Only show accounts created by this user
    });
    
    let currentAssets = 0;
    let fixedAssets = 0;
    let otherAssets = 0;
    
    const assetDetails = [];
    
    for (const account of assetAccounts) {
      const balance = account.currentBalance || account.openingBalance || 0;
      assetDetails.push({
        code: account.code,
        name: account.name,
        parentAccount: account.parentAccount,
        balance: balance
      });
      
      if (account.parentAccount === 'Current Assets') {
        currentAssets += balance;
      } else if (account.parentAccount === 'Fixed Assets') {
        fixedAssets += balance;
      } else {
        otherAssets += balance;
      }
    }
    
    // Get bank balances - only for this user
    const bankAccounts = await BankAccount.find({ 
      status: 'Active',
      createdBy: req.user.id
    });
    let totalBankBalance = 0;
    for (const account of bankAccounts) {
      totalBankBalance += account.currentBalance || 0;
    }
    currentAssets += totalBankBalance;
    assetDetails.push({
      code: '1010',
      name: 'Cash & Bank',
      parentAccount: 'Current Assets',
      balance: totalBankBalance
    });
    
    // Get receivables - only for this user
    const unpaidInvoices = await Invoice.find({ 
      status: { $in: ['Unpaid', 'Partial', 'Overdue'] },
      outstanding: { $gt: 0 },
      createdBy: req.user.id
    });
    let totalReceivables = 0;
    for (const invoice of unpaidInvoices) {
      totalReceivables += invoice.outstanding;
    }
    currentAssets += totalReceivables;
    assetDetails.push({
      code: '1110',
      name: 'Accounts Receivable',
      parentAccount: 'Current Assets',
      balance: totalReceivables
    });
    
    res.status(200).json({
      success: true,
      data: {
        asOfDate: reportDate,
        currentAssets,
        fixedAssets,
        otherAssets,
        totalAssets: currentAssets + fixedAssets + otherAssets,
        details: assetDetails
      }
    });
    
  } catch (error) {
    console.error('Error generating assets breakdown:', error);
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

// ==================== GET LIABILITIES BREAKDOWN ====================
exports.getLiabilitiesBreakdown = async (req, res) => {
  try {
    const { asOfDate } = req.query;
    const reportDate = asOfDate ? new Date(asOfDate) : new Date();
    reportDate.setHours(23, 59, 59, 999);
    
    // Get liabilities from Chart of Accounts - only for this user
    const liabilityAccounts = await ChartOfAccount.find({ 
      type: 'Liabilities',
      isActive: true,
      createdBy: req.user.id  // 👈 Only show accounts created by this user
    });
    
    let currentLiabilities = 0;
    let longTermLiabilities = 0;
    let equity = 0;
    
    const liabilityDetails = [];
    
    for (const account of liabilityAccounts) {
      const balance = account.currentBalance || account.openingBalance || 0;
      liabilityDetails.push({
        code: account.code,
        name: account.name,
        parentAccount: account.parentAccount,
        balance: balance
      });
      
      if (account.parentAccount === 'Current Liabilities') {
        currentLiabilities += balance;
      } else if (account.parentAccount === 'Long Term Liabilities') {
        longTermLiabilities += balance;
      } else {
        equity += balance;
      }
    }
    
    // Get loans - only for this user
    const loans = await Loan.find({ 
      status: { $ne: 'Fully Paid' },
      createdBy: req.user.id
    });
    let shortTermLoans = 0;
    let longTermLoans = 0;
    for (const loan of loans) {
      if (loan.tenureMonths <= 12) {
        shortTermLoans += loan.outstandingBalance;
      } else {
        longTermLoans += loan.outstandingBalance;
      }
    }
    currentLiabilities += shortTermLoans;
    longTermLiabilities += longTermLoans;
    
    liabilityDetails.push({
      code: '2100',
      name: 'Short-term Loans',
      parentAccount: 'Current Liabilities',
      balance: shortTermLoans
    });
    liabilityDetails.push({
      code: '2110',
      name: 'Long-term Debt',
      parentAccount: 'Long Term Liabilities',
      balance: longTermLoans
    });
    
    res.status(200).json({
      success: true,
      data: {
        asOfDate: reportDate,
        currentLiabilities,
        longTermLiabilities,
        equity,
        totalLiabilities: currentLiabilities + longTermLiabilities,
        totalEquityAndLiabilities: currentLiabilities + longTermLiabilities + equity,
        details: liabilityDetails
      }
    });
    
  } catch (error) {
    console.error('Error generating liabilities breakdown:', error);
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};