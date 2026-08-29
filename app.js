// app.js - COMPLETE WITH ALL ROUTES (Including Sales & Purchase Orders)

const express = require('express');
const cors = require('cors');

const app = express();

app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  credentials: true
}));

// Large JSON bodies are allowed because offline-sync clients (POS desktop)
// may push sizable catalogs, and several modules accept inline images in JSON.
// The desktop push strips base64 images before sending, so in practice
// payloads stay small — this limit is a safety net, not an invitation.
app.use(express.json({ limit: '25mb' }));

app.get('/', (req, res) => {
  res.send('API is running 🚀');
});

// Prisma client health — use after deploy to catch stale Vercel cache / bad DB URL
app.get('/api/health/prisma', (req, res) => {
  try {
    const prisma = require('./prisma/client');
    const { getPrismaHealth } = require('./utils/prismaHealth');
    const { describeDatabaseUrl, resolveDatabaseUrl } = require('./utils/databaseUrl');
    const health = getPrismaHealth(prisma);
    const runtime = describeDatabaseUrl(resolveDatabaseUrl());
    res.status(health.ok ? 200 : 503).json({
      success: health.ok,
      ...health,
      database: runtime,
      tip: runtime.isPooler
        ? 'Using a pooler URL. Interactive transactions (bank/bills/products) may fail on Vercel — set DIRECT_URL to Neon Direct/Unpooled, or set PRISMA_USE_DIRECT=1.'
        : undefined
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

const userRoutes = require('./routes/userRoutes');
const userManagementRoutes = require('./routes/userManagementRoutes');
const profileRoutes = require('./routes/profileRoutes');
const subscriptionRoutes = require('./routes/subscriptionRoutes');

const chartOfAccountRoutes = require('./routes/chartOfAccountRoutes');
const journalEntryRoutes = require('./routes/journalEntryRoutes');
const generalLedgerRoutes = require('./routes/generalLedgerRoutes');
const trialBalanceRoutes = require('./routes/trialBalanceRoutes');
const bankAccountRoutes = require('./routes/bankAccountRoutes');
const bankReconciliationRoutes = require('./routes/bankReconciliationRoutes');
const transferRoutes = require('./routes/transferRoutes');
const accountsReceivableRoutes = require('./routes/accountsReceivableRoutes');
const accountsPayableRoutes = require('./routes/accountsPayableRoutes');
const paymentReceivedRoutes = require('./routes/paymentReceivedRoutes');
const paymentMadeRoutes = require('./routes/paymentMadeRoutes');
const creditNoteRoutes = require('./routes/creditNoteRoutes');
const fixedAssetRoutes = require('./routes/fixedAssetRoutes');
const expenseRoutes = require('./routes/expenseRoutes');
const incomeRoutes = require('./routes/incomeRoutes');
const equityRoutes = require('./routes/equityRoutes');
const loanRoutes = require('./routes/loanRoutes');
const fiscalYearRoutes = require('./routes/fiscalYearRoutes');
const notificationRoutes = require('./routes/notificationRoutes');

const dashboardRoutes = require('./routes/dashboardRoutes');
const transactionRoutes = require('./routes/transactionRoutes');
const cashFlowRoutes = require('./routes/cashFlowRoutes');
const plReportRoutes = require('./routes/plReportRoutes');
const balanceSheetRoutes = require('./routes/balanceSheetRoutes');
const reportRoutes = require('./routes/reportRoutes');

const productRoutes = require('./warehouse/routes/product_routes');
const WarehouseCategory = require('./warehouse/routes/category_routes');
const supplierRoutes = require("./warehouse/routes/supplier_routes");
const OrderRoutes = require("./warehouse/routes/order_routes");
const StockRoutes = require("./warehouse/routes/stock_routes");
const DashboardRoutes = require("./warehouse/routes/warehouse_dashboard_routes");
const settingRoutes = require('./warehouse/routes/settingRoutes');
const SalesreturnsRoutes = require('./warehouse/routes/returnRoutes');
const customerRoutes = require("./warehouse/routes/customerRoutes");
const refundRoutes = require('./warehouse/routes/refundRoutes');
const warehouseInvoiceRoutes = require('./warehouse/routes/invoice_routes');
const warehousePurchaseRoutes = require('./warehouse/routes/purchase_routes');
const warehouseSalesRoutes = require('./warehouse/routes/sales_routes');
const warehouseinvoiceRoutes = require('./warehouse/routes/invoiceRoutes');
const inventoryRoutes = require('./warehouse/routes/inventory_routes');
const deliveryRoutes = require('./warehouse/routes/deliveryRoutes');
const quotationRoutes = require('./warehouse/routes/quotationRoutes');
const salesInvoiceRoutes = require('./warehouse/routes/salesInvoiceRoutes');
const salesPaymentRoutes = require('./warehouse/routes/salesPaymentRoutes');
const purchaseOrderRoutes = require('./warehouse/routes/purchaseOrderRoutes');
const goodsReceivingRoutes = require('./warehouse/routes/goodsReceivingRoutes');
const purchaseInvoiceRoutes = require('./warehouse/routes/purchaseInvoiceRoutes');
const purchasePaymentRoutes = require('./warehouse/routes/purchasePaymentRoutes');
const purchaseReturnRoutes = require('./warehouse/routes/purchaseReturnRoutes');
const purchaseDashboardRoutes = require('./warehouse/routes/purchase_dashboard_routes');
const purchaseReportRoutes = require('./warehouse/routes/purchase_report_routes');
const expiryReportRoutes = require('./warehouse/routes/expiry_report_routes');
const lowStockReportRoutes = require('./warehouse/routes/low_stock_report_routes');
const emailRoutes = require('./routes/emailRoutes');
const posRoutes   = require('./pos/routes/posRoutes');
const taxRoutes   = require('./tax/routes/taxRoutes');
const platformAdminRoutes = require('./routes/platformAdminRoutes');

app.use('/api/purchase/dashboard', purchaseDashboardRoutes);
app.use('/api/purchase/reports', purchaseReportRoutes);
app.use('/api/purchase/returns', purchaseReturnRoutes);
app.use('/api/purchase/payments', purchasePaymentRoutes);
app.use('/api/purchase/invoices', purchaseInvoiceRoutes);
app.use('/api/purchase/goods-receiving', goodsReceivingRoutes);
app.use('/api/purchase/orders', purchaseOrderRoutes);
app.use('/api/sales/payments', salesPaymentRoutes);
app.use('/api/sales/invoices', salesInvoiceRoutes);
app.use('/api/quotations', quotationRoutes);
app.use('/api/users', userRoutes);
app.use('/api/admin/users', userManagementRoutes);
app.use('/api/deliveries', deliveryRoutes);
app.use('/api/profile', profileRoutes);
app.use('/api/pdf-report-settings', require('./routes/pdfReportSettingsRoutes'));
app.use('/api/subscription', subscriptionRoutes);

app.use('/api/chart-of-accounts', chartOfAccountRoutes);
app.use('/api/journal-entries', journalEntryRoutes);
app.use('/api/general-ledger', generalLedgerRoutes);
app.use('/api/trial-balance', trialBalanceRoutes);
app.use('/api/bank-accounts', bankAccountRoutes);
app.use('/api/bank-reconciliation', bankReconciliationRoutes);
app.use('/api/transfers', transferRoutes);
app.use('/api/accounts-receivable', accountsReceivableRoutes);
app.use('/api/accounts-payable', accountsPayableRoutes);
app.use('/api/payments-received', paymentReceivedRoutes);
app.use('/api/payments-made', paymentMadeRoutes);
app.use('/api/credit-notes', creditNoteRoutes);
app.use('/api/fixed-assets', fixedAssetRoutes);
app.use('/api/expenses', expenseRoutes);
app.use('/api/income', incomeRoutes);
app.use('/api/equity', equityRoutes);
app.use('/api/loans', loanRoutes);
app.use('/api/fiscal-year', fiscalYearRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/support/tickets', require('./routes/supportTicketRoutes'));
app.use('/api/accounting/reports', require('./routes/accountingReportRoutes'));

app.use('/api/dashboard', dashboardRoutes);
app.use('/api/transactions', transactionRoutes);
app.use('/api/reports/cash-flow', cashFlowRoutes);
app.use('/api/balance-sheet', balanceSheetRoutes);
app.use('/api/reports', reportRoutes);
app.use('/api/warehouse/reports', plReportRoutes);

app.use('/api/warehouse/inventory', inventoryRoutes);
// Merged sales+purchase list (invoiceType filter) must register first —
// the legacy invoiceRoutes also mounts GET / and would otherwise win.
app.use('/api/warehouse/invoices', warehouseInvoiceRoutes);
app.use('/api/warehouse/invoices', warehouseinvoiceRoutes);
app.use('/api/warehouse/purchases', warehousePurchaseRoutes);
app.use('/api/warehouse/sales', warehouseSalesRoutes);
app.use('/api/warehouse/customers', customerRoutes);
app.use('/api/warehouse/returns', SalesreturnsRoutes);
app.use('/api/sales/refunds', refundRoutes);
app.use('/api/settings', settingRoutes);
app.use('/api/warehouse/dashboard', DashboardRoutes);
app.use('/api/warehouse/stock', StockRoutes);
app.use('/api/warehouse/locations', require('./warehouse/routes/locationRoutes'));
app.use('/api/warehouse/reports/expiry', expiryReportRoutes);
app.use('/api/warehouse/reports/low-stock', lowStockReportRoutes);
app.use('/api/email', emailRoutes);
app.use('/api/pos',   posRoutes);
app.use('/api/pos/sync', require('./pos/sync/masterDataSyncRoutes'));
app.use('/api/sync', require('./pos/sync/masterDataSyncRoutes'));
app.use('/api/tax',   taxRoutes);
app.use('/api/platform', platformAdminRoutes);

app.use('/api/orders', OrderRoutes);

  app.use('/api/warehouse/supplier', supplierRoutes);
app.use('/api/warehouse/categories', WarehouseCategory);
app.use('/api/warehouse/products', productRoutes);

app.use('/api/warehouse/order', OrderRoutes);

module.exports = app;