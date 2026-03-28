// controllers/balanceSheetController.js

const Income = require('../models/Income');
const Expense = require('../models/Expense');
const ChartOfAccount = require('../models/ChartOfAccount');
const BankAccount = require('../models/BankAccount');
const Loan = require('../models/Loan');
const Invoice = require('../models/Invoice');

// ==================== GET BALANCE SHEET ====================
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
    
    // Get all Chart of Accounts
    const allAccounts = await ChartOfAccount.find({ isActive: true });
    
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
    
    // Get bank account balances (Cash & Bank)
    const bankAccounts = await BankAccount.find({ status: 'Active' });
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
    
    // Get accounts receivable from invoices
    const unpaidInvoices = await Invoice.find({ 
      status: { $in: ['Unpaid', 'Partial', 'Overdue'] },
      outstanding: { $gt: 0 }
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
    
    // Get loan balances
    const loans = await Loan.find({ status: { $ne: 'Fully Paid' } });
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
    
    // Get retained earnings (net profit/loss for the period)
    const incomes = await Income.find({ 
      date: { $gte: startDate, $lte: endDate },
      status: 'Posted'
    });
    
    const expenses = await Expense.find({ 
      date: { $gte: startDate, $lte: endDate },
      status: 'Posted'
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

// ==================== GET BALANCE SHEET SUMMARY ====================
exports.getSummary = async (req, res) => {
  try {
    const now = new Date();
    now.setHours(23, 59, 59, 999);
    
    // Get all Chart of Accounts
    const allAccounts = await ChartOfAccount.find({ isActive: true });
    
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
    
    // Get bank balances
    const bankAccounts = await BankAccount.find({ status: 'Active' });
    for (const account of bankAccounts) {
      totalAssets += account.currentBalance || 0;
    }
    
    // Get loan balances
    const loans = await Loan.find({ status: { $ne: 'Fully Paid' } });
    for (const loan of loans) {
      totalLiabilities += loan.outstandingBalance;
    }
    
    // Get receivables
    const unpaidInvoices = await Invoice.find({ 
      status: { $in: ['Unpaid', 'Partial', 'Overdue'] },
      outstanding: { $gt: 0 }
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