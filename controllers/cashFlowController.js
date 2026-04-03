const Income = require('../models/Income');
const Expense = require('../models/Expense');
const BankAccount = require('../models/BankAccount');
const Loan = require('../models/Loan');
const FixedAsset = require('../models/FixedAsset');
const Invoice = require('../models/Invoice');
const PaymentMade = require('../models/PaymentMade');

// ==================== GET CASH FLOW STATEMENT ====================
exports.getCashFlowStatement = async (req, res) => {
  try {
    const { period, startDate, endDate } = req.query;
    
    let start, end;
    const now = new Date();
    now.setHours(23, 59, 59, 999);
    
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
          // Default to this month
          start = new Date(now.getFullYear(), now.getMonth(), 1);
          end = now;
      }
    }
    
    const dateFilter = {
      date: { $gte: start, $lte: end },
      status: 'Posted',
      createdBy: req.user.id  // 👈 Only show entries created by this user
    };
    
    // ==================== OPERATING ACTIVITIES ====================
    // Cash inflows from customers (Income records) - only for this user
    const incomes = await Income.find(dateFilter);
    const cashReceiptsFromCustomers = incomes.reduce((sum, inc) => sum + inc.totalAmount, 0);
    
    // Cash outflows to suppliers (Expense records) - only for this user
    const expenses = await Expense.find(dateFilter);
    const cashPaidToSuppliers = expenses.reduce((sum, exp) => sum + exp.totalAmount, 0);
    
    // Cash paid for salaries (filter salary expenses)
    const salaryExpenses = expenses.filter(exp => exp.expenseType === 'Salaries');
    const cashPaidForSalaries = salaryExpenses.reduce((sum, exp) => sum + exp.totalAmount, 0);
    
    // Cash paid for rent
    const rentExpenses = expenses.filter(exp => exp.expenseType === 'Rent');
    const cashPaidForRent = rentExpenses.reduce((sum, exp) => sum + exp.totalAmount, 0);
    
    // Cash paid for utilities
    const utilityExpenses = expenses.filter(exp => exp.expenseType === 'Utilities');
    const cashPaidForUtilities = utilityExpenses.reduce((sum, exp) => sum + exp.totalAmount, 0);
    
    // Interest received (from other income)
    const interestIncome = incomes.filter(inc => inc.incomeType === 'Interest Income');
    const interestReceived = interestIncome.reduce((sum, inc) => sum + inc.totalAmount, 0);
    
    // Interest paid (from expenses)
    const interestExpenses = expenses.filter(exp => exp.expenseType === 'Interest Expense');
    const interestPaid = interestExpenses.reduce((sum, exp) => sum + exp.totalAmount, 0);
    
    // Taxes paid
    const taxExpenses = expenses.filter(exp => exp.expenseType === 'Taxes');
    const taxesPaid = taxExpenses.reduce((sum, exp) => sum + exp.totalAmount, 0);
    
    // Calculate operating activities
    const cashFlowFromOperations = cashReceiptsFromCustomers - cashPaidToSuppliers;
    
    // ==================== INVESTING ACTIVITIES ====================
    // Purchase of fixed assets - only for this user
    const fixedAssets = await FixedAsset.find({
      purchaseDate: { $gte: start, $lte: end },
      createdBy: req.user.id  // 👈 Only show assets created by this user
    });
    const purchaseOfEquipment = fixedAssets.reduce((sum, asset) => sum + asset.purchaseCost, 0);
    
    // Sale of fixed assets (from disposed assets) - only for this user
    const disposedAssets = await FixedAsset.find({
      disposedDate: { $gte: start, $lte: end },
      status: 'Disposed',
      createdBy: req.user.id  // 👈 Only show assets created by this user
    });
    const saleOfFixedAssets = disposedAssets.reduce((sum, asset) => sum + (asset.disposalAmount || 0), 0);
    
    // Calculate investing activities
    const cashFlowFromInvesting = saleOfFixedAssets - purchaseOfEquipment;
    
    // ==================== FINANCING ACTIVITIES ====================
    // Loan proceeds (new loans) - only for this user
    const newLoans = await Loan.find({
      disbursementDate: { $gte: start, $lte: end },
      createdBy: req.user.id  // 👈 Only show loans created by this user
    });
    const loanProceeds = newLoans.reduce((sum, loan) => sum + loan.loanAmount, 0);
    
    // Loan repayments (payments made on loans) - only for this user
    const loanPayments = await PaymentMade.find({
      paymentDate: { $gte: start, $lte: end },
      loanId: { $exists: true },
      createdBy: req.user.id  // 👈 Only show payments created by this user
    });
    const loanRepayments = loanPayments.reduce((sum, payment) => sum + payment.amount, 0);
    
    // Capital investment (from equity additions) - TODO: Add EquityAccount model
    const capitalInvestments = 0;
    
    // Owner drawings (from equity withdrawals) - TODO: Add EquityAccount model
    const ownerDrawings = 0;
    
    // Calculate financing activities
    const cashFlowFromFinancing = loanProceeds - loanRepayments + capitalInvestments - ownerDrawings;
    
    // ==================== NET CASH FLOW ====================
    const netCashFlow = cashFlowFromOperations + cashFlowFromInvesting + cashFlowFromFinancing;
    
    // ==================== OPENING & CLOSING BALANCES ====================
    // Get opening cash balance (from bank accounts before period start) - only for this user
    const openingDate = new Date(start);
    openingDate.setDate(openingDate.getDate() - 1);
    
    const bankAccounts = await BankAccount.find({ 
      status: 'Active',
      createdBy: req.user.id  // 👈 Only show bank accounts created by this user
    });
    let openingCashBalance = 0;
    let closingCashBalance = 0;
    
    for (const account of bankAccounts) {
      // For simplicity, use current balance as closing
      // In production, need to track historical balances
      closingCashBalance += account.currentBalance || 0;
    }
    
    // For demo purposes, set opening balance
    openingCashBalance = closingCashBalance - netCashFlow;
    
    // ==================== BUILD RESPONSE ====================
    const operatingItems = [
      { name: 'Cash Receipts from Customers', amount: cashReceiptsFromCustomers, type: 'Inflow' },
      { name: 'Cash Paid to Suppliers', amount: -cashPaidToSuppliers, type: 'Outflow' },
      { name: 'Cash Paid for Salaries', amount: -cashPaidForSalaries, type: 'Outflow' },
      { name: 'Cash Paid for Rent', amount: -cashPaidForRent, type: 'Outflow' },
      { name: 'Cash Paid for Utilities', amount: -cashPaidForUtilities, type: 'Outflow' },
      { name: 'Interest Received', amount: interestReceived, type: 'Inflow' },
      { name: 'Interest Paid', amount: -interestPaid, type: 'Outflow' },
      { name: 'Taxes Paid', amount: -taxesPaid, type: 'Outflow' }
    ].filter(item => item.amount !== 0);
    
    const investingItems = [
      { name: 'Purchase of Equipment', amount: -purchaseOfEquipment, type: 'Outflow' },
      { name: 'Sale of Fixed Assets', amount: saleOfFixedAssets, type: 'Inflow' }
    ].filter(item => item.amount !== 0);
    
    const financingItems = [
      { name: 'Loan Proceeds', amount: loanProceeds, type: 'Inflow' },
      { name: 'Loan Repayment', amount: -loanRepayments, type: 'Outflow' },
      { name: 'Capital Investment', amount: capitalInvestments, type: 'Inflow' },
      { name: 'Owner Drawings', amount: -ownerDrawings, type: 'Outflow' }
    ].filter(item => item.amount !== 0);
    
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

// ==================== GET CASH FLOW SUMMARY ====================
exports.getSummary = async (req, res) => {
  try {
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const endOfMonth = new Date(now);
    endOfMonth.setHours(23, 59, 59, 999);
    
    // Get current month incomes and expenses - only for this user
    const monthIncomes = await Income.find({
      date: { $gte: startOfMonth, $lte: endOfMonth },
      status: 'Posted',
      createdBy: req.user.id  // 👈 Only show incomes created by this user
    });
    
    const monthExpenses = await Expense.find({
      date: { $gte: startOfMonth, $lte: endOfMonth },
      status: 'Posted',
      createdBy: req.user.id  // 👈 Only show expenses created by this user
    });
    
    const monthCashInflow = monthIncomes.reduce((sum, inc) => sum + inc.totalAmount, 0);
    const monthCashOutflow = monthExpenses.reduce((sum, exp) => sum + exp.totalAmount, 0);
    const monthNetCashFlow = monthCashInflow - monthCashOutflow;
    
    // Get bank balances - only for this user
    const bankAccounts = await BankAccount.find({ 
      status: 'Active',
      createdBy: req.user.id  // 👈 Only show bank accounts created by this user
    });
    const currentCashBalance = bankAccounts.reduce((sum, acc) => sum + (acc.currentBalance || 0), 0);
    
    res.status(200).json({
      success: true,
      data: {
        currentCashBalance,
        monthCashInflow,
        monthCashOutflow,
        monthNetCashFlow,
        monthNetCashFlowPercentage: currentCashBalance !== 0 ? (monthNetCashFlow / currentCashBalance) * 100 : 0
      }
    });
    
  } catch (error) {
    console.error('Error generating cash flow summary:', error);
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

// ==================== GET CASH FLOW TREND ====================
exports.getTrend = async (req, res) => {
  try {
    const { months = 12 } = req.query;
    const endDate = new Date();
    const startDate = new Date();
    startDate.setMonth(endDate.getMonth() - parseInt(months));
    
    const monthlyData = [];
    
    for (let i = 0; i <= parseInt(months); i++) {
      const date = new Date(startDate);
      date.setMonth(startDate.getMonth() + i);
      const monthStart = new Date(date.getFullYear(), date.getMonth(), 1);
      const monthEnd = new Date(date.getFullYear(), date.getMonth() + 1, 0);
      monthEnd.setHours(23, 59, 59, 999);
      
      // Get incomes for this month - only for this user
      const monthIncomes = await Income.aggregate([
        { $match: { 
          date: { $gte: monthStart, $lte: monthEnd }, 
          status: 'Posted',
          createdBy: req.user.id  // 👈 Only show incomes created by this user
        } },
        { $group: { _id: null, total: { $sum: '$totalAmount' } } }
      ]);
      
      // Get expenses for this month - only for this user
      const monthExpenses = await Expense.aggregate([
        { $match: { 
          date: { $gte: monthStart, $lte: monthEnd }, 
          status: 'Posted',
          createdBy: req.user.id  // 👈 Only show expenses created by this user
        } },
        { $group: { _id: null, total: { $sum: '$totalAmount' } } }
      ]);
      
      const inflow = monthIncomes[0]?.total || 0;
      const outflow = monthExpenses[0]?.total || 0;
      
      monthlyData.push({
        month: date.toLocaleString('default', { month: 'short', year: 'numeric' }),
        inflow: inflow,
        outflow: outflow,
        netCashFlow: inflow - outflow
      });
    }
    
    res.status(200).json({
      success: true,
      data: monthlyData
    });
    
  } catch (error) {
    console.error('Error generating cash flow trend:', error);
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

// ==================== GET DETAILED CASH FLOW ====================
exports.getDetailedCashFlow = async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    let start, end;
    
    if (startDate && endDate) {
      start = new Date(startDate);
      start.setHours(0, 0, 0, 0);
      end = new Date(endDate);
      end.setHours(23, 59, 59, 999);
    } else {
      const now = new Date();
      start = new Date(now.getFullYear(), now.getMonth(), 1);
      end = new Date(now);
      end.setHours(23, 59, 59, 999);
    }
    
    const dateFilter = {
      date: { $gte: start, $lte: end },
      status: 'Posted',
      createdBy: req.user.id  // 👈 Only show entries created by this user
    };
    
    // Get all incomes with details
    const incomes = await Income.find(dateFilter).sort({ date: -1 });
    const incomeDetails = incomes.map(inc => ({
      date: inc.date,
      type: inc.incomeType,
      description: inc.description,
      amount: inc.totalAmount,
      reference: inc.reference,
      paymentMethod: inc.paymentMethod
    }));
    
    // Get all expenses with details
    const expenses = await Expense.find(dateFilter).sort({ date: -1 });
    const expenseDetails = expenses.map(exp => ({
      date: exp.date,
      type: exp.expenseType,
      description: exp.description,
      amount: exp.totalAmount,
      reference: exp.reference,
      paymentMethod: exp.paymentMethod
    }));
    
    const totalInflow = incomes.reduce((sum, inc) => sum + inc.totalAmount, 0);
    const totalOutflow = expenses.reduce((sum, exp) => sum + exp.totalAmount, 0);
    
    res.status(200).json({
      success: true,
      data: {
        period: {
          start: start,
          end: end
        },
        summary: {
          totalInflow: totalInflow,
          totalOutflow: totalOutflow,
          netCashFlow: totalInflow - totalOutflow
        },
        inflows: incomeDetails,
        outflows: expenseDetails
      }
    });
    
  } catch (error) {
    console.error('Error generating detailed cash flow:', error);
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

// ==================== HELPER FUNCTIONS ====================
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