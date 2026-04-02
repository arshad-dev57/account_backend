const express = require('express');
const app = express();

app.use(express.json());

app.get('/', (req, res) => {
  res.send('API is running 🚀');
});

// Routes imports
const userRoutes = require('./routes/userRoutes');
const chartOfAccountRoutes = require('./routes/chartOfAccountRoutes');
const journalEntryRoutes = require('./routes/journalEntryRoutes');
const generalLedgerRoutes = require('./routes/generalLedgerRoutes');
const trialBalanceRoutes = require('./routes/trialBalanceRoutes');
const bankAccountRoutes = require('./routes/bankAccountRoutes');
const bankReconciliationRoutes = require('./routes/bankReconciliationRoutes');
const transferRoutes = require('./routes/transferRoutes');
const accountsReceivableRoutes = require('./routes/accountsReceivableRoutes');
const invoiceRoutes = require('./routes/invoiceRoutes');
const accountsPayableRoutes = require('./routes/accountsPayableRoutes');
const paymentReceivedRoutes = require('./routes/paymentReceivedRoutes');
const paymentMadeRoutes = require('./routes/paymentMadeRoutes');
const creditNoteRoutes = require('./routes/creditNoteRoutes');
const fixedAssetRoutes = require('./routes/fixedAssetRoutes');
const expenseRoutes = require('./routes/expenseRoutes');
const dashboardRoutes = require('./routes/dashboardRoutes');
const transactionRoutes = require('./routes/transactionRoutes');
const subscriptionRoutes = require('./routes/subscriptionRoutes');
const cashFlowRoutes = require('./routes/cashFlowRoutes');
const plReportRoutes = require('./routes/plReportRoutes');
const balanceSheetRoutes = require('./routes/balanceSheetRoutes');
const reportRoutes = require('./routes/reportRoutes');
const incomeRoutes = require('./routes/incomeRoutes');
const equityRoutes = require('./routes/equityRoutes');
const loanRoutes = require('./routes/loanRoutes');

// ========== MOUNT ROUTES ==========
// Middleware (protect & subscription) will be applied inside route files

// Public routes (no middleware)
app.use('/api/users', userRoutes);
app.use('/api/subscription', subscriptionRoutes);

// Protected routes (middleware applied inside route files)
app.use('/api/transactions', transactionRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/reports/cash-flow', cashFlowRoutes);
app.use('/api/reports/balance-sheet', balanceSheetRoutes);
app.use('/api/reports', reportRoutes);
app.use('/api/reports/profit-loss', plReportRoutes);
app.use('/api/expenses', expenseRoutes);
app.use('/api/income', incomeRoutes);
app.use('/api/equity', equityRoutes);
app.use('/api/loans', loanRoutes);
app.use('/api/fixed-assets', fixedAssetRoutes);
app.use('/api/credit-notes', creditNoteRoutes);
app.use('/api/payments-made', paymentMadeRoutes);
app.use('/api/payments-received', paymentReceivedRoutes);
app.use('/api/accounts-payable', accountsPayableRoutes);
app.use('/api/invoices', invoiceRoutes);
app.use('/api/accounts-receivable', accountsReceivableRoutes);
app.use('/api/transfers', transferRoutes);
app.use('/api/bank-reconciliation', bankReconciliationRoutes);
app.use('/api/bank-accounts', bankAccountRoutes);
app.use('/api/trial-balance', trialBalanceRoutes);
app.use('/api/general-ledger', generalLedgerRoutes);
app.use('/api/journal-entries', journalEntryRoutes);
app.use('/api/chart-of-accounts', chartOfAccountRoutes);

module.exports = app;