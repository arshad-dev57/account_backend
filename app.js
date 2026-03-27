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