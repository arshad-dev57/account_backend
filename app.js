const express = require('express');
const app = express();

app.use(express.json());
app.get('/', (req, res) => {
  res.send('API is running 🚀');
});

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
// Add this route
// Add this import
const plReportRoutes = require('./routes/plReportRoutes');

const balanceSheetRoutes = require('./routes/balanceSheetRoutes');
app.use('/api/reports/balance-sheet', balanceSheetRoutes);

app.use('/api/reports/profit-loss', plReportRoutes);
app.use('/api/expenses', expenseRoutes);
const incomeRoutes = require('./routes/incomeRoutes');
app.use('/api/income', incomeRoutes);
const equityRoutes = require('./routes/equityRoutes');
app.use('/api/equity', equityRoutes);
const loanRoutes = require('./routes/loanRoutes');
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
app.use('/api/users', userRoutes);

module.exports = app;