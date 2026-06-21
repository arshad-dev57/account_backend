const express = require('express');
const axios = require('axios');
const cors = require('cors');

const app = express();

app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  credentials: true
}));
const { handleWebhook } = require('./controllers/stripeController');
app.post(
  '/api/subscription/stripe/webhook',
  express.raw({ type: 'application/json' }),
  handleWebhook
);

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
const productRoutes = require('./warehouse/routes/product_routes');
const WarehouseCategory = require('./warehouse/routes/category_routes');
const supplierRoutes = require("./warehouse/routes/supplier_routes");
const OrderRoutes = require("./warehouse/routes/order_routes");
const StockRoutes = require("./warehouse/routes/stock_routes");
const InventoryRoutes = require("./warehouse/routes/inventory_routes");
const DashboardRoutes = require("./warehouse/routes/warehouse_dashboard_routes");

app.use("/api/warehouse/dashboard",DashboardRoutes);
app.use("/api/warehouse/inventory",InventoryRoutes);
app.use("/api/warehouse/stock",StockRoutes);
app.use("/api/warehouse/order",OrderRoutes);
app.use("/api/warehouse/supplier",supplierRoutes)
app.use('/api/warehouse/categories',WarehouseCategory);
app.use('/api/warehouse/products',productRoutes);
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
app.use('/api/bank-accounts', bankAccountRoutes);
app.use('/api/trial-balance', trialBalanceRoutes);
app.use('/api/general-ledger', generalLedgerRoutes);
app.use('/api/journal-entries', journalEntryRoutes);
app.use('/api/chart-of-accounts', chartOfAccountRoutes);





module.exports = app;