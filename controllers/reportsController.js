  const Income = require('../models/Income');
  const Expense = require('../models/Expense');
  const ChartOfAccount = require('../models/ChartOfAccount');
  const BankAccount = require('../models/BankAccount');
  const Loan = require('../models/Loan');
  const Invoice = require('../models/Invoice');
  const Bill = require('../models/Bill');
  const PaymentReceived = require('../models/PaymentReceived');
  const PaymentMade = require('../models/PaymentMade');
  const JournalEntry = require('../models/JournalEntry');

  // Helper function for period display text
  function _getPeriodDisplayText(period, start, end) {
    if (period && period !== 'Custom Range') {
      switch (period) {
        case 'Today': return new Date(start).toLocaleDateString();
        case 'This Week': return `${start.toLocaleDateString()} - ${end.toLocaleDateString()}`;
        case 'This Month': return start.toLocaleString('default', { month: 'long', year: 'numeric' });
        case 'This Quarter': return `Q${Math.floor(start.getMonth() / 3) + 1} ${start.getFullYear()}`;
        case 'This Year': return `Year ${start.getFullYear()}`;
        default: return `${start.toLocaleDateString()} - ${end.toLocaleDateString()}`;
      }
    }
    return `${start.toLocaleDateString()} - ${end.toLocaleDateString()}`;
  }

  // ==================== 1. PROFIT & LOSS STATEMENT ====================
  exports.getProfitLossStatement = async (req, res) => {
    try {
      const { startDate, endDate, period } = req.query;
      
      let start, end;
      
      // Handle period presets
      const now = new Date();
      switch (period) {
        case 'Today':
          start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
          end = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59);
          break;
        case 'This Week':
          start = new Date(now);
          start.setDate(now.getDate() - now.getDay());
          start.setHours(0, 0, 0, 0);
          end = new Date(now);
          end.setHours(23, 59, 59, 999);
          break;
        case 'This Month':
          start = new Date(now.getFullYear(), now.getMonth(), 1);
          end = new Date(now);
          end.setHours(23, 59, 59, 999);
          break;
        case 'This Quarter':
          const quarter = Math.floor(now.getMonth() / 3);
          start = new Date(now.getFullYear(), quarter * 3, 1);
          end = new Date(now);
          end.setHours(23, 59, 59, 999);
          break;
        case 'This Year':
          start = new Date(now.getFullYear(), 0, 1);
          end = new Date(now);
          end.setHours(23, 59, 59, 999);
          break;
        default:
          if (startDate && endDate) {
            start = new Date(startDate);
            end = new Date(endDate);
            end.setHours(23, 59, 59, 999);
          } else {
            // Default to this month
            start = new Date(now.getFullYear(), now.getMonth(), 1);
            end = new Date(now);
            end.setHours(23, 59, 59, 999);
          }
      }
      
      const dateFilter = {
        date: { $gte: start, $lte: end },
        status: 'Posted'
      };
      
      // Get all incomes and expenses
      const incomes = await Income.find(dateFilter);
      const expenses = await Expense.find(dateFilter);
      
      // Group incomes by type
      const revenueByType = {};
      let totalRevenue = 0;
      
      incomes.forEach(inc => {
        const type = inc.incomeType;
        const amount = inc.totalAmount;
        
        if (!revenueByType[type]) {
          revenueByType[type] = 0;
        }
        revenueByType[type] += amount;
        totalRevenue += amount;
      });
      
      // Group expenses by type
      const expensesByType = {};
      let totalExpenses = 0;
      let costOfGoodsSold = 0;
      let operatingExpenses = 0;
      
      expenses.forEach(exp => {
        const type = exp.expenseType;
        const amount = exp.totalAmount;
        
        if (!expensesByType[type]) {
          expensesByType[type] = 0;
        }
        expensesByType[type] += amount;
        totalExpenses += amount;
        
        if (type === 'Cost of Goods Sold' || type === 'Inventory Purchase') {
          costOfGoodsSold += amount;
        } else {
          operatingExpenses += amount;
        }
      });
      
      // Separate operating vs other
      const operatingIncomeTypes = ['Sales', 'Services'];
      const otherIncomeTypes = ['Interest Income', 'Rental Income', 'Dividend Income', 'Other Income'];
      
      let operatingRevenue = 0;
      let otherRevenue = 0;
      
      Object.entries(revenueByType).forEach(([type, amount]) => {
        if (operatingIncomeTypes.includes(type)) {
          operatingRevenue += amount;
        } else if (otherIncomeTypes.includes(type)) {
          otherRevenue += amount;
        } else {
          operatingRevenue += amount;
        }
      });
      
      // Prepare revenue items
      const revenueItems = [];
      for (const [type, amount] of Object.entries(revenueByType)) {
        revenueItems.push({
          name: type,
          amount: amount
        });
      }
      
      // Prepare expense items
      const expenseItems = [];
      for (const [type, amount] of Object.entries(expensesByType)) {
        expenseItems.push({
          name: type,
          amount: amount
        });
      }
      
      // Calculate final figures
      const grossProfit = operatingRevenue - costOfGoodsSold;
      const netProfit = grossProfit - totalExpenses;
      
      res.status(200).json({
        success: true,
        data: {
          period: {
            start: start,
            end: end,
            displayText: _getPeriodDisplayText(period, start, end)
          },
          revenue: {
            total: totalRevenue,
            operating: operatingRevenue,
            other: otherRevenue,
            items: revenueItems
          },
          costOfGoodsSold: costOfGoodsSold,
          grossProfit: grossProfit,
          operatingExpenses: {
            total: operatingExpenses,
            items: expenseItems.filter(item => item.name !== 'Cost of Goods Sold')
          },
          netProfit: netProfit,
          netProfitMargin: totalRevenue > 0 ? (netProfit / totalRevenue) * 100 : 0
        }
      });
    } catch (error) {
      console.error('Error generating P&L statement:', error);
      res.status(500).json({
        success: false,
        message: error.message
      });
    }
  };

  // ==================== 2. BALANCE SHEET ====================
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
      
      // Set date range based on period for retained earnings
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
          const parent = account.parentAccount || 'Other Liabilities';
          if (!balanceSheet.liabilities[parent]) {
            balanceSheet.liabilities[parent] = {};
          }
          balanceSheet.liabilities[parent][account.name] = balance;
          balanceSheet.totalLiabilities += balance;
        } 
        else if (account.type === 'Assets') {
          const parent = account.parentAccount || 'Other Assets';
          if (!balanceSheet.assets[parent]) {
            balanceSheet.assets[parent] = {};
          }
          balanceSheet.assets[parent][account.name] = balance;
          balanceSheet.totalAssets += balance;
        }
        else if (account.type === 'Equity') {
          const parent = account.parentAccount || 'Owners Equity';
          if (!balanceSheet.liabilities[parent]) {
            balanceSheet.liabilities[parent] = {};
          }
          balanceSheet.liabilities[parent][account.name] = balance;
          balanceSheet.totalLiabilities += balance;
        }
      }
      
      // Get bank account balances
      const bankAccounts = await BankAccount.find({ status: 'Active' });
      let totalBankBalance = 0;
      
      for (const account of bankAccounts) {
        totalBankBalance += account.currentBalance || 0;
      }
      
      if (totalBankBalance > 0) {
        if (!balanceSheet.assets['Current Assets']) {
          balanceSheet.assets['Current Assets'] = {};
        }
        balanceSheet.assets['Current Assets']['Cash & Bank'] = totalBankBalance;
        balanceSheet.totalAssets += totalBankBalance;
      }
      
      // Get accounts receivable
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
      
      for (const loan of loans) {
        const outstanding = loan.outstandingBalance;
        if (loan.tenureMonths <= 12) {
          if (!balanceSheet.liabilities['Current Liabilities']) {
            balanceSheet.liabilities['Current Liabilities'] = {};
          }
          balanceSheet.liabilities['Current Liabilities']['Short-term Loans'] = 
            (balanceSheet.liabilities['Current Liabilities']['Short-term Loans'] || 0) + outstanding;
        } else {
          if (!balanceSheet.liabilities['Other Liabilities']) {
            balanceSheet.liabilities['Other Liabilities'] = {};
          }
          balanceSheet.liabilities['Other Liabilities']['Long-term Debt'] = 
            (balanceSheet.liabilities['Other Liabilities']['Long-term Debt'] || 0) + outstanding;
        }
        balanceSheet.totalLiabilities += outstanding;
      }
      
      // Get retained earnings
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

  // ==================== 3. CASH FLOW STATEMENT ====================
  exports.getCashFlowStatement = async (req, res) => {
    try {
      const { startDate, endDate, period } = req.query;
      
      let start, end;
      const now = new Date();
      
      // Set date range based on period
      if (startDate && endDate) {
        start = new Date(startDate);
        start.setHours(0, 0, 0, 0);
        end = new Date(endDate);
        end.setHours(23, 59, 59, 999);
      } else {
        switch (period) {
          case 'Today':
            start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
            end = now;
            break;
          case 'This Week':
            start = new Date(now);
            start.setDate(now.getDate() - now.getDay());
            start.setHours(0, 0, 0, 0);
            end = now;
            break;
          case 'This Month':
            start = new Date(now.getFullYear(), now.getMonth(), 1);
            end = now;
            break;
          case 'This Quarter':
            const quarter = Math.floor(now.getMonth() / 3);
            start = new Date(now.getFullYear(), quarter * 3, 1);
            end = now;
            break;
          case 'This Year':
            start = new Date(now.getFullYear(), 0, 1);
            end = now;
            break;
          default:
            start = new Date(now.getFullYear(), now.getMonth(), 1);
            end = now;
        }
      }
      
      // ==================== OPERATING ACTIVITIES ====================
      const incomes = await Income.find({
        date: { $gte: start, $lte: end },
        status: 'Posted'
      });
      const cashReceiptsFromCustomers = incomes.reduce((sum, inc) => sum + inc.totalAmount, 0);
      
      const expenses = await Expense.find({
        date: { $gte: start, $lte: end },
        status: 'Posted'
      });
      const cashPaidToSuppliers = expenses.reduce((sum, exp) => sum + exp.totalAmount, 0);
      
      // Separate expense categories
      const salaryExpenses = expenses.filter(exp => exp.expenseType === 'Salaries');
      const rentExpenses = expenses.filter(exp => exp.expenseType === 'Rent');
      const utilityExpenses = expenses.filter(exp => exp.expenseType === 'Utilities');
      const interestIncome = incomes.filter(inc => inc.incomeType === 'Interest Income');
      const taxExpenses = expenses.filter(exp => exp.expenseType === 'Taxes');
      
      const cashPaidForSalaries = salaryExpenses.reduce((sum, exp) => sum + exp.totalAmount, 0);
      const cashPaidForRent = rentExpenses.reduce((sum, exp) => sum + exp.totalAmount, 0);
      const cashPaidForUtilities = utilityExpenses.reduce((sum, exp) => sum + exp.totalAmount, 0);
      const interestReceived = interestIncome.reduce((sum, inc) => sum + inc.totalAmount, 0);
      const taxesPaid = taxExpenses.reduce((sum, exp) => sum + exp.totalAmount, 0);
      
      const cashFlowFromOperations = cashReceiptsFromCustomers - cashPaidToSuppliers;
      
      // ==================== INVESTING ACTIVITIES ====================
      // Get payments made for assets (from PaymentMade table)
      const assetPayments = await PaymentMade.find({
        paymentDate: { $gte: start, $lte: end },
        reference: { $regex: 'asset', $options: 'i' }
      });
      const purchaseOfEquipment = assetPayments.reduce((sum, payment) => sum + payment.amount, 0);
      
      // Get asset sales (from PaymentReceived)
      const assetSales = await PaymentReceived.find({
        paymentDate: { $gte: start, $lte: end },
        reference: { $regex: 'asset sale', $options: 'i' }
      });
      const saleOfFixedAssets = assetSales.reduce((sum, payment) => sum + payment.amount, 0);
      
      const cashFlowFromInvesting = saleOfFixedAssets - purchaseOfEquipment;
      
      // ==================== FINANCING ACTIVITIES ====================
      // Get loans disbursed
      const loans = await Loan.find({
        disbursementDate: { $gte: start, $lte: end }
      });
      const loanProceeds = loans.reduce((sum, loan) => sum + loan.loanAmount, 0);
      
      // Get loan repayments from PaymentMade
      const loanPayments = await PaymentMade.find({
        paymentDate: { $gte: start, $lte: end },
        reference: { $regex: 'loan', $options: 'i' }
      });
      const loanRepayments = loanPayments.reduce((sum, payment) => sum + payment.amount, 0);
      
      const cashFlowFromFinancing = loanProceeds - loanRepayments;
      
      // ==================== NET CASH FLOW ====================
      const netCashFlow = cashFlowFromOperations + cashFlowFromInvesting + cashFlowFromFinancing;
      
      // Get opening and closing balances
      const bankAccounts = await BankAccount.find({ status: 'Active' });
      let closingCashBalance = 0;
      for (const account of bankAccounts) {
        closingCashBalance += account.currentBalance || 0;
      }
      
      const openingCashBalance = closingCashBalance - netCashFlow;
      
      // Build response items
      const operatingItems = [
        { name: 'Cash Receipts from Customers', amount: cashReceiptsFromCustomers, type: 'Inflow' },
        { name: 'Cash Paid to Suppliers', amount: -cashPaidToSuppliers, type: 'Outflow' },
      ];
      
      if (cashPaidForSalaries > 0) operatingItems.push({ name: 'Cash Paid for Salaries', amount: -cashPaidForSalaries, type: 'Outflow' });
      if (cashPaidForRent > 0) operatingItems.push({ name: 'Cash Paid for Rent', amount: -cashPaidForRent, type: 'Outflow' });
      if (cashPaidForUtilities > 0) operatingItems.push({ name: 'Cash Paid for Utilities', amount: -cashPaidForUtilities, type: 'Outflow' });
      if (interestReceived > 0) operatingItems.push({ name: 'Interest Received', amount: interestReceived, type: 'Inflow' });
      if (taxesPaid > 0) operatingItems.push({ name: 'Taxes Paid', amount: -taxesPaid, type: 'Outflow' });
      
      const investingItems = [];
      if (purchaseOfEquipment > 0) investingItems.push({ name: 'Purchase of Equipment', amount: -purchaseOfEquipment, type: 'Outflow' });
      if (saleOfFixedAssets > 0) investingItems.push({ name: 'Sale of Fixed Assets', amount: saleOfFixedAssets, type: 'Inflow' });
      
      const financingItems = [];
      if (loanProceeds > 0) financingItems.push({ name: 'Loan Proceeds', amount: loanProceeds, type: 'Inflow' });
      if (loanRepayments > 0) financingItems.push({ name: 'Loan Repayment', amount: -loanRepayments, type: 'Outflow' });
      
      res.status(200).json({
        success: true,
        data: {
          period: {
            start: start,
            end: end,
            displayText: _getPeriodDisplayText(period, start, end)
          },
          operatingActivities: {
            items: operatingItems,
            total: cashFlowFromOperations
          },
          investingActivities: {
            items: investingItems,
            total: cashFlowFromInvesting
          },
          financingActivities: {
            items: financingItems,
            total: cashFlowFromFinancing
          },
          netCashFlow: netCashFlow,
          openingCashBalance: openingCashBalance,
          closingCashBalance: closingCashBalance,
          netCashFlowPercentage: openingCashBalance !== 0 ? (netCashFlow / openingCashBalance) * 100 : 0
        }
      });
    } catch (error) {
      console.error('Error generating cash flow statement:', error);
      res.status(500).json({
        success: false,
        message: error.message
      });
    }
  };

  // ==================== 4. JOURNAL ENTRIES (with Pagination) ====================
  exports.getJournalEntries = async (req, res) => {
    try {
      const { 
        status, 
        search, 
        startDate, 
        endDate,
        page = 1,
        limit = 10
      } = req.query;
      
      let query = {};
      
      if (status && status !== 'All') {
        query.status = status;
      }
      
      if (startDate && endDate) {
        query.date = {
          $gte: new Date(startDate),
          $lte: new Date(endDate),
        };
      }
      
      if (search) {
        query.$or = [
          { entryNumber: { $regex: search, $options: 'i' } },
          { description: { $regex: search, $options: 'i' } },
          { reference: { $regex: search, $options: 'i' } },
        ];
      }
      
      const skip = (parseInt(page) - 1) * parseInt(limit);
      
      const journalEntries = await JournalEntry.find(query)
        .populate('createdBy', 'firstName lastName')
        .populate('postedBy', 'firstName lastName')
        .sort({ date: -1, createdAt: -1 })
        .skip(skip)
        .limit(parseInt(limit));
      
      const total = await JournalEntry.countDocuments(query);
      const totalPages = Math.ceil(total / parseInt(limit));
      
      // Calculate summary
      const allEntries = await JournalEntry.find(query);
      let totalDebit = 0;
      let totalCredit = 0;
      let postedCount = 0;
      let draftCount = 0;
      
      allEntries.forEach(entry => {
        const entryDebit = entry.lines.reduce((sum, line) => sum + line.debit, 0);
        const entryCredit = entry.lines.reduce((sum, line) => sum + line.credit, 0);
        totalDebit += entryDebit;
        totalCredit += entryCredit;
        
        if (entry.status === 'Posted') postedCount++;
        else draftCount++;
      });
      
      res.status(200).json({
        success: true,
        count: journalEntries.length,
        total: total,
        page: parseInt(page),
        pages: totalPages,
        data: journalEntries,
        summary: {
          totalDebit,
          totalCredit,
          difference: Math.abs(totalDebit - totalCredit),
          postedCount,
          draftCount,
        },
      });
    } catch (error) {
      console.error('Error getting journal entries:', error);
      res.status(500).json({
        success: false,
        message: error.message
      });
    }
  };

  // ==================== GET SINGLE JOURNAL ENTRY ====================
  exports.getJournalEntry = async (req, res) => {
    try {
      const journalEntry = await JournalEntry.findById(req.params.id)
        .populate('createdBy', 'firstName lastName')
        .populate('postedBy', 'firstName lastName');
      
      if (!journalEntry) {
        return res.status(404).json({
          success: false,
          message: 'Journal entry not found'
        });
      }
      
      res.status(200).json({
        success: true,
        data: journalEntry
      });
    } catch (error) {
      console.error(error);
      res.status(500).json({
        success: false,
        message: error.message
      });
    }
  };