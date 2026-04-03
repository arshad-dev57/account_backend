const express = require('express');
const axios = require('axios'); // ✅ add this
const app = express();

app.use(express.json());

// ✅ Root route (used for ping)
app.get('/', (req, res) => {
  res.send('API is running 🚀');
});

// ================= ROUTES =================
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
const profileRoutes = require('./routes/profileRoutes');

// ================= MOUNT ROUTES =================
app.use('/api/profile', profileRoutes);
app.use('/api/users', userRoutes);
app.use('/api/subscription', subscriptionRoutes);
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

// ================= SELF PING =================
const SELF_URL = process.env.RENDER_EXTERNAL_URL || 'https://account-backend-1hor.onrender.com';

console.log('🚀 Self ping service started...');
console.log(`🔗 Ping URL: ${SELF_URL}`);

// 🔁 Har 10 min baad ping
setInterval(async () => {
  const currentTime = new Date().toLocaleString();

  try {
    const response = await axios.get(SELF_URL);

    console.log(`✅ [${currentTime}] Ping Success | Status: ${response.status}`);
  } catch (error) {
    console.log(`❌ [${currentTime}] Ping Failed | Error: ${error.message}`);
  }
}, 0.1 * 60 * 1000); // 10 minutes

module.exports = app; 