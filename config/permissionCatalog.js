/**
 * Central Permission Catalog for Bisonstechs ERP
 * Single Source of Truth for RBAC — aligned to actual sidebar / page routes.
 */

const DATA_SCOPES = {
  ALL: 'ALL',
  OWN: 'OWN',
  TEAM: 'TEAM',
  WAREHOUSE: 'WAREHOUSE',
  BRANCH: 'BRANCH',
  DEPARTMENT: 'DEPARTMENT'
};

const STANDARD_ACTIONS = {
  VIEW: 'view',
  CREATE: 'create',
  EDIT: 'edit',
  DELETE: 'delete',
  APPROVE: 'approve',
  REJECT: 'reject',
  POST: 'post',
  CANCEL: 'cancel',
  VOID: 'void',
  REVERSE: 'reverse',
  PRINT: 'print',
  EXPORT: 'export',
  IMPORT: 'import',
  PAY: 'pay',
  RECEIVE: 'receive',
  TRANSFER: 'transfer',
  ADJUST: 'adjust',
  CLOSE: 'close',
  REOPEN: 'reopen'
};

const CRUD = ['view', 'create', 'edit', 'delete'];
const CRUD_PRINT = ['view', 'create', 'edit', 'delete', 'print', 'export'];
const CRUD_FULL = ['view', 'create', 'edit', 'delete', 'approve', 'cancel', 'print', 'export'];
const VIEW_ONLY = ['view'];
const VIEW_EXPORT = ['view', 'print', 'export'];
const VIEW_EDIT = ['view', 'edit'];

function res(key, name, description, actions, scopes = ['ALL']) {
  return { key, name, description, actions, scopes };
}

const MODULE_DEFINITIONS = [
  // ═══════════════════════════════════════════════════════════
  // SALES  (/sales/*)
  // ═══════════════════════════════════════════════════════════
  {
    key: 'sales',
    name: 'Sales',
    description: 'Quotations, orders, invoices, deliveries, customers, and payments',
    resources: [
      res('dashboard', 'Sales Dashboard', 'Sales module home and KPI overview', VIEW_ONLY),
      res('orders', 'Sales Orders', 'Customer sales orders and order approvals', CRUD_FULL, ['ALL', 'OWN', 'TEAM']),
      res('quotations', 'Sales Quotations', 'Price quotes and estimates for customers', CRUD_FULL, ['ALL', 'OWN', 'TEAM']),
      res('invoices', 'Sales Invoices', 'Customer billing invoices and payment collection', ['view', 'create', 'edit', 'delete', 'approve', 'post', 'cancel', 'print', 'export', 'receive'], ['ALL', 'OWN', 'TEAM']),
      res('customers', 'Customers', 'Customer master and accounts', ['view', 'create', 'edit', 'delete', 'export'], ['ALL', 'OWN']),
      res('salespersons', 'Salespersons & Territories', 'Salesperson profiles, targets, and commission territories', ['view', 'create', 'edit', 'delete', 'export'], ['ALL', 'OWN']),
      res('deliveries', 'Sales Deliveries', 'Delivery orders and dispatch tracking', ['view', 'create', 'edit', 'delete', 'approve', 'print', 'export'], ['ALL', 'WAREHOUSE']),
      res('payments', 'Sales Payments', 'Receipt of payments against invoices', ['view', 'create', 'edit', 'delete', 'approve', 'print', 'export'], ['ALL', 'OWN']),
      res('returns', 'Sales Returns', 'Returned items from customers', CRUD_PRINT, ['ALL', 'OWN', 'WAREHOUSE']),
      res('refunds', 'Sales Refunds', 'Customer refunds and cash returns', CRUD_PRINT, ['ALL', 'OWN']),
      res('credits', 'Sales Credits & Notes', 'Credit notes and customer credit applications', ['view', 'create', 'edit', 'delete', 'approve', 'void', 'print', 'export'], ['ALL', 'OWN']),
      res('products', 'Sales Product Catalog', 'Browse products while creating sales documents', VIEW_ONLY),
      res('reports', 'Sales Reports', 'Sales summaries and performance reports', VIEW_EXPORT, ['ALL', 'OWN', 'TEAM']),
      res('currency', 'Sales Display Currency', 'Currency preference for sales screens', VIEW_EDIT),
      res('settings', 'Sales Settings', 'Sales module preferences', VIEW_EDIT)
    ]
  },

  // ═══════════════════════════════════════════════════════════
  // PURCHASES  (/purchases/*)
  // ═══════════════════════════════════════════════════════════
  {
    key: 'purchases',
    name: 'Purchases',
    description: 'Purchase orders, goods receipt notes, vendor bills, and suppliers',
    resources: [
      res('dashboard', 'Purchases Dashboard', 'Purchases module home and KPI overview', VIEW_ONLY),
      res('requisitions', 'Purchase Requisitions', 'Internal purchase requests before PO', CRUD_FULL, ['ALL', 'OWN', 'TEAM']),
      res('orders', 'Purchase Orders', 'Purchase orders to suppliers', CRUD_FULL, ['ALL', 'OWN', 'TEAM']),
      res('grn', 'Goods Receiving (GRN)', 'Goods receiving notes and inbound inspection', CRUD_FULL, ['ALL', 'WAREHOUSE']),
      res('invoices', 'Purchase Invoices / Bills', 'Supplier invoices, verification, and payment processing', ['view', 'create', 'edit', 'delete', 'approve', 'post', 'cancel', 'print', 'export', 'pay'], ['ALL', 'OWN']),
      res('suppliers', 'Suppliers / Vendors', 'Supplier directory and credit terms', ['view', 'create', 'edit', 'delete', 'export']),
      res('payments', 'Purchase Payments', 'Disbursements and payments to suppliers', ['view', 'create', 'edit', 'delete', 'approve', 'print', 'export']),
      res('returns', 'Purchase Returns', 'Debit notes and goods returned to suppliers', CRUD_PRINT, ['ALL', 'WAREHOUSE']),
      res('refunds', 'Purchase Refunds', 'Supplier refunds and credit settlements', CRUD_PRINT),
      res('receipts', 'Purchase Receipts', 'Purchase receipt documents', CRUD_PRINT, ['ALL', 'WAREHOUSE']),
      res('products', 'Purchase Product Catalog', 'Browse products while creating purchase documents', VIEW_ONLY),
      res('reports', 'Purchase Reports', 'Procurement and vendor spend reports', VIEW_EXPORT),
      res('currency', 'Purchases Display Currency', 'Currency preference for purchase screens', VIEW_EDIT),
      res('settings', 'Purchases Settings', 'Purchases module preferences', VIEW_EDIT)
    ]
  },

  // ═══════════════════════════════════════════════════════════
  // INVENTORY  (/warehouse/*)
  // ═══════════════════════════════════════════════════════════
  {
    key: 'inventory',
    name: 'Inventory & Warehouse',
    description: 'Products, stock levels, transfers, adjustments, and warehouses',
    resources: [
      res('dashboard', 'Inventory Dashboard', 'Warehouse module home and stock KPIs', VIEW_ONLY),
      res('products', 'Products & Items', 'Product catalog, pricing, barcodes, and units', ['view', 'create', 'edit', 'delete', 'export', 'import']),
      res('categories', 'Categories', 'Product categories and classifications', ['view', 'create', 'edit', 'delete', 'export']),
      res('warehouses', 'Warehouses & Locations', 'Warehouse locations, racks, and stock bins', CRUD, ['ALL', 'WAREHOUSE']),
      res('stock', 'Stock Movements & Tracking', 'Live inventory balances and movement logs', ['view', 'create', 'edit', 'export'], ['ALL', 'WAREHOUSE']),
      res('transfers', 'Stock Transfers', 'Inter-warehouse stock movements and dispatches', CRUD_FULL, ['ALL', 'WAREHOUSE']),
      res('adjustments', 'Stock Adjustments & Counts', 'Physical inventory reconciliation and cycle counts', ['view', 'create', 'edit', 'delete', 'approve', 'export'], ['ALL', 'WAREHOUSE']),
      res('write_offs', 'Stock Write-Offs & Damaged Goods', 'Scrap, expired, and damaged inventory disposal', ['view', 'create', 'edit', 'delete', 'approve', 'post', 'export'], ['ALL', 'WAREHOUSE']),
      res('import', 'Import Inventory', 'Bulk product / stock import', ['view', 'import']),
      res('inventory_valuation', 'Inventory Valuation', 'Stock valuation by cost and warehouse', VIEW_EXPORT, ['ALL', 'WAREHOUSE']),
      res('customers', 'Warehouse Customers', 'Customers used in warehouse / POS context', ['view', 'create', 'edit', 'delete']),
      res('suppliers', 'Warehouse Suppliers', 'Suppliers linked to warehouse receiving', ['view', 'create', 'edit', 'delete']),
      res('product_settings', 'Product Settings', 'Units, brands, racks, and product attributes', VIEW_EDIT),
      res('reports', 'Inventory Reports', 'Stock summary, low stock, expiry, and warehouse reports', VIEW_EXPORT, ['ALL', 'WAREHOUSE'])
    ]
  },

  // ═══════════════════════════════════════════════════════════
  // ACCOUNTING  (/accounting/*)
  // ═══════════════════════════════════════════════════════════
  {
    key: 'accounting',
    name: 'Accounting & Finance',
    description: 'General ledger, journal entries, banking, capital, and financial statements',
    resources: [
      res('dashboard', 'Accounting Dashboard', 'Accounting module home and finance KPIs', VIEW_ONLY),
      res('chart_of_accounts', 'Chart of Accounts', 'Account hierarchy and COA master', ['view', 'create', 'edit', 'delete', 'export']),
      res('journal_entries', 'Journal Entries', 'General journal entries, debits/credits, and posting', ['view', 'create', 'edit', 'delete', 'post', 'reverse', 'print', 'export'], ['ALL', 'OWN']),
      res('general_ledger', 'General Ledger', 'Detailed general ledger by account and period', VIEW_EXPORT),
      res('trial_balance', 'Trial Balance', 'Summary and detailed trial balance', VIEW_EXPORT),
      res('bank_accounts', 'Bank & Cash Accounts', 'Cash in hand, bank accounts, and transfers', ['view', 'create', 'edit', 'delete', 'transfer', 'export']),
      res('bank_reconciliation', 'Bank Reconciliation', 'Bank statement import, matching, and closing', ['view', 'create', 'edit', 'delete', 'approve', 'close', 'reopen', 'export', 'import']),
      res('accounts_receivable', 'Accounts Receivable', 'Customer AR aging and outstanding invoices', VIEW_EXPORT),
      res('accounts_payable', 'Accounts Payable', 'Vendor AP aging and outstanding bills', VIEW_EXPORT),
      res('aged_receivables', 'Aged Receivables', 'AR aging analysis by customer and period', VIEW_EXPORT),
      res('expenses', 'Operating Expenses', 'Business expenses and petty cash', ['view', 'create', 'edit', 'delete', 'approve', 'post', 'print', 'export'], ['ALL', 'OWN', 'DEPARTMENT']),
      res('income', 'Direct & Other Income', 'Non-sales revenue and other receipts', ['view', 'create', 'edit', 'delete', 'post', 'export'], ['ALL', 'OWN']),
      res('cost_centers', 'Cost Centers & Dimensions', 'Cost centers, projects, and departments', CRUD),
      res('budgets', 'Budgets & Budget vs Actual', 'Departmental budgeting and variance analysis', ['view', 'create', 'edit', 'delete', 'approve', 'export'], ['ALL', 'DEPARTMENT']),
      res('capital_equity', 'Capital & Equity Management', 'Partner capital, drawings, dividends, and reserves', ['view', 'create', 'post', 'transfer', 'export']),
      res('fixed_assets', 'Fixed Assets & Depreciation', 'Asset register, depreciation, and disposals', ['view', 'create', 'edit', 'delete', 'post', 'export']),
      res('loans', 'Loans & Borrowings', 'Bank loans, interest, and repayments', ['view', 'create', 'edit', 'delete', 'post', 'export']),
      res('fiscal_years', 'Fiscal Years & Periods', 'Accounting calendar and period closing', ['view', 'create', 'close', 'reopen']),
      res('profit_loss', 'Profit & Loss Statement', 'Income statement / P&L report', VIEW_EXPORT),
      res('balance_sheet', 'Balance Sheet', 'Statement of financial position', VIEW_EXPORT),
      res('cash_flow', 'Cash Flow Statement', 'Cash flow from operating / investing / financing', VIEW_EXPORT),
      res('currency', 'Display Currency', 'Accounting display currency preference', VIEW_EDIT),
      res('currencies', 'Currency Master', 'Multi-currency master list', CRUD),
      res('exchange_rates', 'Exchange Rates', 'FX rates for multi-currency accounting', ['view', 'create', 'edit', 'delete']),
      res('pdf_reports', 'PDF Reports', 'Downloadable accounting PDF packs', VIEW_EXPORT),
      res('reports', 'Accounting Reports Hub', 'All accounting / financial reports entry', VIEW_EXPORT)
    ]
  },

  // ═══════════════════════════════════════════════════════════
  // TAX  (/tax/*)
  // ═══════════════════════════════════════════════════════════
  {
    key: 'tax',
    name: 'Tax Compliance',
    description: 'Tax setup, rates, exemptions, and compliance reports',
    resources: [
      res('overview', 'Tax Overview', 'Tax compliance home', VIEW_ONLY),
      res('setup', 'Tax Setup', 'Tax registration and compliance configuration', VIEW_EDIT),
      res('rates', 'Tax Rates', 'Sales / purchase tax rate master', CRUD),
      res('exemptions', 'Tax Exemptions', 'Tax exemption certificates and rules', CRUD),
      res('reports', 'Tax Reports', 'Output tax, input tax, and withholding reports', VIEW_EXPORT)
    ]
  },

  // ═══════════════════════════════════════════════════════════
  // POS  (/pos/*)
  // ═══════════════════════════════════════════════════════════
  {
    key: 'pos',
    name: 'Point of Sale (POS)',
    description: 'Cashier checkout counters, shifts, receipts, and terminals',
    resources: [
      res('register', 'POS Register / Checkout', 'Selling items, scanning barcodes, collecting cash/card', ['view', 'create', 'edit', 'cancel', 'print'], ['ALL', 'OWN', 'WAREHOUSE']),
      res('shifts', 'Cashier Shifts & Floats', 'Opening float, cash drop, and shift closing', ['view', 'create', 'close', 'reopen', 'print', 'export'], ['ALL', 'OWN', 'WAREHOUSE']),
      res('terminals', 'POS Terminals', 'Terminal hardware profiles and location assignment', CRUD, ['ALL', 'WAREHOUSE']),
      res('management', 'POS Management', 'POS terminals, cashiers, and shift management console', ['view', 'create', 'edit', 'delete'])
    ]
  },

  // ═══════════════════════════════════════════════════════════
  // HR  (/hr/*)
  // ═══════════════════════════════════════════════════════════
  {
    key: 'hr',
    name: 'HR & Payroll',
    description: 'Employees, attendance, leave, payroll, and organization',
    resources: [
      res('dashboard', 'HR Dashboard', 'HR module home', VIEW_ONLY),
      res('employees', 'Employees Directory', 'Employee profiles and job information', ['view', 'create', 'edit', 'delete', 'export'], ['ALL', 'DEPARTMENT', 'BRANCH']),
      res('offices', 'Offices / Branches', 'Office and branch locations', CRUD),
      res('departments', 'Departments', 'Organizational departments', CRUD),
      res('team', 'My Team', 'Manager team view', VIEW_ONLY, ['ALL', 'OWN', 'DEPARTMENT']),
      res('attendance', 'Attendance & Time Tracking', 'Check-in/out, biometric logs', ['view', 'create', 'edit', 'delete', 'approve', 'export'], ['ALL', 'OWN', 'DEPARTMENT']),
      res('leaves', 'Leave Management', 'Leave requests and balances', ['view', 'create', 'edit', 'delete', 'approve'], ['ALL', 'OWN', 'DEPARTMENT']),
      res('leave_policies', 'Leave Policies', 'Leave types and entitlement rules', CRUD),
      res('holidays', 'Holidays', 'Company holiday calendar', CRUD),
      res('overtime', 'Overtime', 'Overtime requests and approval', ['view', 'create', 'edit', 'delete', 'approve'], ['ALL', 'OWN', 'DEPARTMENT']),
      res('shifts', 'Shifts & Shift Plans', 'Work shifts and shift planning', CRUD),
      res('roster', 'Roster', 'Employee duty roster', ['view', 'create', 'edit', 'delete']),
      res('calendar', 'HR Calendar', 'Attendance / leave calendar view', VIEW_ONLY),
      res('documents', 'Employee Documents', 'Document vault for employees', ['view', 'create', 'edit', 'delete']),
      res('approvals', 'HR Approvals Inbox', 'Pending leave / overtime / payroll approvals', ['view', 'approve']),
      res('performance', 'Performance Reviews', 'Employee performance appraisals', ['view', 'create', 'edit', 'delete', 'approve'], ['ALL', 'OWN', 'DEPARTMENT']),
      res('org_chart', 'Organization Chart', 'Visual org hierarchy', VIEW_ONLY),
      res('lifecycle', 'Employee Lifecycle', 'Onboarding / offboarding workflows', ['view', 'create', 'edit']),
      res('live_tracking', 'Live Tracking', 'Live employee location / attendance tracking', VIEW_ONLY),
      res('salary', 'Salary & Compensation', 'Base salary, allowances, deductions', VIEW_EDIT),
      res('salary_structures', 'Salary Structures', 'Reusable salary structure templates', CRUD),
      res('payroll', 'Payroll Processing', 'Payroll runs, payslips, and disbursements', ['view', 'create', 'edit', 'approve', 'post', 'print', 'export', 'pay'], ['ALL', 'DEPARTMENT']),
      res('loans', 'Loans & Advances', 'Employee loans and salary advances', ['view', 'create', 'edit', 'delete', 'approve', 'pay']),
      res('bonuses', 'Bonuses', 'Employee bonuses and incentives', ['view', 'create', 'edit', 'delete', 'approve']),
      res('commissions', 'Sales Commission', 'Sales commission for payroll', ['view', 'create', 'edit', 'export']),
      res('reports', 'HR & Payroll Reports', 'Headcount, attendance, and payroll reports', VIEW_EXPORT),
      res('settings', 'HR & Payroll Settings', 'HR module configuration', VIEW_EDIT),
      res('notifications', 'HR Notifications', 'HR alert preferences', VIEW_EDIT)
    ]
  },

  // ═══════════════════════════════════════════════════════════
  // MANUFACTURING  (/manufacturing/*)
  // ═══════════════════════════════════════════════════════════
  {
    key: 'manufacturing',
    name: 'Manufacturing & MRP',
    description: 'BOM, production, planning, materials, quality, and costing',
    resources: [
      res('dashboard', 'Manufacturing Dashboard', 'Manufacturing module home', VIEW_ONLY),
      res('bom', 'Bill of Materials (BOM)', 'Product recipes and material consumption', ['view', 'create', 'edit', 'delete', 'approve', 'export']),
      res('routings', 'Routings & Operations', 'Production routings and operations', CRUD),
      res('work_centers', 'Work Centers & Machines', 'Stations, machines, and capacity', CRUD),
      res('orders', 'Production / Manufacturing Orders', 'Production jobs and work orders', ['view', 'create', 'edit', 'delete', 'approve', 'close', 'cancel', 'print', 'export'], ['ALL', 'WAREHOUSE']),
      res('planning', 'Planning (Demand / MPS / MRP)', 'Demand planning, MPS, MRP, shortages', ['view', 'create', 'edit', 'export']),
      res('materials', 'Material Issues & Reservations', 'Reservations, issues, scrap, by-products', ['view', 'create', 'edit', 'delete', 'approve'], ['ALL', 'WAREHOUSE']),
      res('quality', 'Quality Inspections & Rework', 'QC inspections and rework', ['view', 'create', 'edit', 'approve']),
      res('maintenance', 'Maintenance', 'Maintenance requests and work orders', CRUD),
      res('subcontracting', 'Subcontracting', 'Subcontract vendors and orders', CRUD),
      res('costing', 'Manufacturing Costing', 'Standard / actual cost and variances', VIEW_EXPORT),
      res('reports', 'Manufacturing Reports', 'Production and shop-floor reports', VIEW_EXPORT),
      res('settings', 'Manufacturing Settings', 'Manufacturing module preferences', VIEW_EDIT)
    ]
  },

  // ═══════════════════════════════════════════════════════════
  // DISTRIBUTOR  (/distributor/*)
  // ═══════════════════════════════════════════════════════════
  {
    key: 'distributor',
    name: 'Distributor',
    description: 'Distribution network, recovery, credit, and warehouse ops',
    resources: [
      res('dashboard', 'Distributor Dashboard', 'Distributor module home', VIEW_ONLY),
      res('customers', 'Distributor Customers', 'Distribution customer accounts', CRUD),
      res('products', 'Distributor Products', 'Products available for distribution', VIEW_ONLY),
      res('warehouses', 'Distributor Warehouses', 'Distribution warehouses', CRUD, ['ALL', 'WAREHOUSE']),
      res('salespersons', 'Distributor Salespersons', 'Field sales force', CRUD),
      res('aging', 'Distributor Aging', 'Customer aging for distribution', VIEW_EXPORT),
      res('credit', 'Credit Limits', 'Customer credit control', ['view', 'create', 'edit']),
      res('recovery', 'Recovery', 'Collection / recovery tracking', ['view', 'create', 'edit']),
      res('write_offs', 'Distributor Write-Offs', 'Bad debt / stock write-offs', ['view', 'create', 'edit', 'approve']),
      res('reports', 'Distributor Reports', 'Distribution performance reports', VIEW_EXPORT)
    ]
  },

  // ═══════════════════════════════════════════════════════════
  // TRADING  (/trading/*) — classification lens over Sales/Purchase
  // ═══════════════════════════════════════════════════════════
  {
    key: 'trading',
    name: 'Trading Operations',
    description: 'Domestic wholesale trading classification, pricing, margins, and KPIs over existing Sales/Purchase documents',
    resources: [
      res('dashboard', 'Trading Dashboard', 'Trading KPIs and operational overview', VIEW_ONLY),
      res('documents', 'Trading Documents', 'Classify and list trading-linked ERP documents', CRUD),
      res('price_lists', 'Trading Price Lists', 'Wholesale and tier price lists', CRUD),
      res('customer_pricing', 'Customer Pricing', 'Negotiated customer product prices', CRUD),
      res('margins', 'Margin Analysis', 'Gross margin by product / customer', VIEW_EXPORT),
      res('reports', 'Trading Reports', 'Trading performance reports', VIEW_EXPORT),
      res('settings', 'Trading Settings', 'Trading module preferences', VIEW_EDIT)
    ]
  },

  // ═══════════════════════════════════════════════════════════
  // IMPORT MANAGEMENT  (/import/*)
  // ═══════════════════════════════════════════════════════════
  {
    key: 'import',
    name: 'Import Management',
    description: 'International procurement, RFQs, proformas, shipments, customs clearance, import GRN, landed cost allocation, finance LC, and import bills',
    resources: [
      res('dashboard', 'Import Dashboard', 'Import KPIs, status pipeline, and cost analytics', VIEW_ONLY),
      res('rfqs', 'Import RFQs', 'Supplier requests for quotation', CRUD_FULL),
      res('orders', 'Import Purchase Orders', 'International procurement orders', CRUD_FULL),
      res('proformas', 'Import Proforma Invoices', 'Proforma invoices and advance payments', CRUD_FULL),
      res('shipments', 'Shipments & Tracking', 'Ocean/Air shipment tracking and container milestones', CRUD_FULL),
      res('carriers', 'Carriers & Freight Forwarders', 'Carrier master for ocean, air, road, rail and multimodal transport', CRUD_FULL),
      res(
        'customs',
        'Customs Clearance & Port Formalities',
        'Bill of entry, customs duties, port handling, inspection, duty payment, approval, and release. Grant Approve so a user can sign off Pending Approval clearances.',
        [
          'view',
          'create',
          'edit',
          'delete',
          'assess',
          'record_payment',
          'release',
          'hold',
          'cancel',
          'approve',
          'print',
          'export',
        ]
      ),
      res('documents', 'Import Documents', 'Bills of lading, commercial invoices, packing lists, and certificates', CRUD_FULL),
      res(
        'grn',
        'Import Goods Receiving',
        'Import goods receipt notes against shipments after customs release, container inspection, and put-away',
        ['view', 'create', 'edit', 'delete', 'post', 'approve', 'cancel', 'print', 'export']
      ),
      res('landed_costs', 'Landed Cost Allocation', 'Distribute freight, customs, insurance, and handling charges to inventory items', ['view', 'create', 'edit', 'delete', 'post', 'print', 'export']),
      res('finance', 'Import Finance & LC', 'Letters of credit, margin blocks, and trade finance instruments', CRUD_FULL),
      res('bills', 'Import Supplier Bills', 'Commercial invoices, vendor liabilities, and payments', ['view', 'create', 'edit', 'delete', 'approve', 'pay', 'print', 'export']),
      res('reports', 'Import Reports', 'Import spend, landed cost breakdown, and lead time reports', VIEW_EXPORT),
      res('settings', 'Import Settings', 'Import default Incoterms, ports, clearing accounts, and preferences', VIEW_EDIT)
    ]
  },

  // ═══════════════════════════════════════════════════════════
  // REPORTS (cross-module)
  // ═══════════════════════════════════════════════════════════
  {
    key: 'reports',
    name: 'Reports & Analytics',
    description: 'Financial, operational, tax, inventory, and management reports',
    resources: [
      res('financial', 'Financial Reports (P&L, Balance Sheet, Cash Flow)', 'Core financial statements', VIEW_EXPORT),
      res('sales', 'Sales Reports & Aging', 'Sales summaries and customer aging', VIEW_EXPORT, ['ALL', 'OWN', 'TEAM']),
      res('purchases', 'Purchase & Vendor Reports', 'Vendor aging and procurement summaries', VIEW_EXPORT),
      res('inventory', 'Inventory & Valuation Reports', 'Stock valuation and reorder alerts', VIEW_EXPORT, ['ALL', 'WAREHOUSE']),
      res('tax', 'Tax & Compliance Reports', 'Output / input tax and withholding', VIEW_EXPORT),
      res('hr', 'HR & Payroll Reports', 'Salary register and headcounts', VIEW_EXPORT),
      res('manufacturing', 'Manufacturing Reports', 'Production and costing reports', VIEW_EXPORT)
    ]
  },

  // ═══════════════════════════════════════════════════════════
  // DASHBOARD TILES & WIDGETS
  // ═══════════════════════════════════════════════════════════
  {
    key: 'dashboard',
    name: 'Dashboard & Widgets',
    description: 'Main module selection tiles, executive overview, and KPI widget visibility',
    resources: [
      res('overview', 'Executive Dashboard View', 'Access executive business dashboards', VIEW_ONLY),
      res('module_accounting', 'Module Tile: Accounting', 'Show Accounting on main dashboard selection', VIEW_ONLY),
      res('module_sales', 'Module Tile: Sales', 'Show Sales on main dashboard selection', VIEW_ONLY),
      res('module_purchases', 'Module Tile: Purchases', 'Show Purchases on main dashboard selection', VIEW_ONLY),
      res('module_inventory', 'Module Tile: Inventory', 'Show Inventory on main dashboard selection', VIEW_ONLY),
      res('module_manufacturing', 'Module Tile: Manufacturing', 'Show Manufacturing on main dashboard selection', VIEW_ONLY),
      res('module_hr', 'Module Tile: HR Management', 'Show HR on main dashboard selection', VIEW_ONLY),
      res('module_tax', 'Module Tile: Tax Compliance', 'Show Tax on main dashboard selection', VIEW_ONLY),
      res('module_users', 'Module Tile: Users', 'Show Users on main dashboard selection', VIEW_ONLY),
      res('module_pos', 'Module Tile: Point of Sale', 'Show POS on main dashboard selection', VIEW_ONLY),
      res('module_distributor', 'Module Tile: Distributor', 'Show Distributor on main dashboard selection', VIEW_ONLY),
      res('module_trading', 'Module Tile: Trading', 'Show Trading on main dashboard selection', VIEW_ONLY),
      res('module_import', 'Module Tile: Import', 'Show Import Management on main dashboard selection', VIEW_ONLY),
      res('module_export', 'Module Tile: Export', 'Show Export Management on main dashboard selection', VIEW_ONLY),
      res('widgets_sales', 'Sales Summary & Charts', 'Sales revenue and trajectory widgets', VIEW_ONLY, ['ALL', 'OWN']),
      res('widgets_purchases', 'Purchases & Vendor Summary', 'Purchase charts and open POs', VIEW_ONLY),
      res('widgets_financial', 'Revenue, Expenses & Profit', 'Gross / net profit widgets', VIEW_ONLY),
      res('widgets_cash_bank', 'Cash & Bank Balances', 'Live cash and bank balances', VIEW_ONLY),
      res('widgets_ar_ap', 'Accounts Receivable & Payable', 'AR / AP summary widgets', VIEW_ONLY),
      res('widgets_inventory', 'Inventory Valuation & Low Stock', 'Inventory value and reorder alerts', VIEW_ONLY, ['ALL', 'WAREHOUSE']),
      res('widgets_capital', 'Capital & Equity Summary', 'Equity and capital widgets', VIEW_ONLY)
    ]
  },

  // ═══════════════════════════════════════════════════════════
  // SETTINGS
  // ═══════════════════════════════════════════════════════════
  {
    key: 'settings',
    name: 'Settings & Administration',
    description: 'Company settings, users, roles, permissions, and audit logs',
    resources: [
      res('company', 'Company Profile & Preferences', 'Company information, tax numbers, logo', VIEW_EDIT),
      res('users', 'User Management', 'Invite users, assign roles, manage credentials', CRUD),
      res('roles', 'Roles & Permissions', 'Custom roles and permission matrix', CRUD),
      res('audit_logs', 'Security & Audit Logs', 'Activity logs and authorization events', ['view', 'export']),
      res('companies', 'Multi-Company Management', 'Create and switch companies', ['view', 'create', 'edit'])
    ]
  }
];

function getFlatPermissionList() {
  const list = [];
  for (const mod of MODULE_DEFINITIONS) {
    for (const r of mod.resources) {
      for (const act of r.actions) {
        list.push({
          name: `${mod.key}.${r.key}.${act}`,
          module: mod.key,
          resource: r.key,
          action: act,
          description: `${act.toUpperCase()} permission for ${r.name} (${mod.name})`,
          supportedScopes: r.scopes || ['ALL']
        });
      }
    }
  }
  return list;
}

const DEFAULT_SYSTEM_ROLES = [
  {
    name: 'Super Admin',
    description: 'Full unconstrained access to all modules, financial data, and system settings',
    isSystem: true,
    allPermissions: true
  },
  {
    name: 'Company Admin',
    description: 'Complete administrative access to all company modules and settings',
    isSystem: true,
    allPermissions: true
  },
  {
    name: 'Finance Manager',
    description: 'Full accounting, banking, journal entries, capital, and financial reports',
    isSystem: true,
    patterns: [
      'accounting.*',
      'tax.*',
      'reports.financial.*',
      'reports.tax.*',
      'purchases.invoices.*',
      'purchases.payments.*',
      'sales.invoices.*',
      'sales.payments.*',
      'sales.credits.*',
      'import.customs.view',
      'import.customs.record_payment',
      'import.settings.view',
      'dashboard.overview.view',
      'dashboard.module_accounting.view',
      'dashboard.module_import.view',
      'dashboard.module_sales.view',
      'dashboard.module_purchases.view',
      'dashboard.module_tax.view',
      'dashboard.widgets_financial.view',
      'dashboard.widgets_cash_bank.view',
      'dashboard.widgets_ar_ap.view',
      'dashboard.widgets_capital.view',
      'dashboard.widgets_sales.view',
      'dashboard.widgets_purchases.view'
    ]
  },
  {
    name: 'Accountant',
    description: 'Handles day-to-day bookkeeping, journal entries, vouchers, and ledger checks',
    isSystem: true,
    patterns: [
      'accounting.dashboard.view',
      'accounting.chart_of_accounts.view',
      'accounting.journal_entries.*',
      'accounting.general_ledger.*',
      'accounting.trial_balance.*',
      'accounting.bank_accounts.view',
      'accounting.bank_accounts.create',
      'accounting.bank_accounts.transfer',
      'accounting.bank_reconciliation.*',
      'accounting.accounts_receivable.*',
      'accounting.accounts_payable.*',
      'accounting.aged_receivables.*',
      'accounting.expenses.*',
      'accounting.income.*',
      'accounting.cost_centers.view',
      'accounting.budgets.view',
      'accounting.fixed_assets.view',
      'accounting.loans.view',
      'accounting.profit_loss.*',
      'accounting.balance_sheet.*',
      'accounting.cash_flow.*',
      'accounting.reports.*',
      'tax.overview.view',
      'tax.reports.view',
      'reports.financial.view',
      'reports.financial.print',
      'sales.invoices.view',
      'sales.invoices.create',
      'sales.payments.*',
      'purchases.invoices.view',
      'purchases.payments.*',
      'import.customs.view',
      'import.customs.record_payment',
      'import.rfqs.view',
      'import.rfqs.approve',
      'import.settings.view',
      'dashboard.overview.view',
      'dashboard.module_accounting.view',
      'dashboard.module_import.view',
      'dashboard.module_tax.view',
      'dashboard.widgets_cash_bank.view',
      'dashboard.widgets_ar_ap.view'
    ]
  },
  {
    name: 'Sales Manager',
    description: 'Manages sales team, orders, pricing quotations, deliveries, and sales analytics',
    isSystem: true,
    patterns: [
      'sales.*',
      'trading.*',
      'inventory.products.view',
      'inventory.stock.view',
      'reports.sales.*',
      'dashboard.overview.view',
      'dashboard.module_sales.view',
      'dashboard.widgets_sales.view'
    ]
  },
  {
    name: 'Salesperson',
    description: 'Creates quotations and sales orders; limited to own records without financial margin access',
    isSystem: true,
    scopedPermissions: [
      { name: 'sales.dashboard.view', scope: 'ALL' },
      { name: 'sales.orders.view', scope: 'OWN' },
      { name: 'sales.orders.create', scope: 'OWN' },
      { name: 'sales.orders.edit', scope: 'OWN' },
      { name: 'sales.orders.print', scope: 'OWN' },
      { name: 'sales.quotations.view', scope: 'OWN' },
      { name: 'sales.quotations.create', scope: 'OWN' },
      { name: 'sales.quotations.edit', scope: 'OWN' },
      { name: 'sales.customers.view', scope: 'ALL' },
      { name: 'sales.customers.create', scope: 'ALL' },
      { name: 'sales.invoices.view', scope: 'OWN' },
      { name: 'sales.products.view', scope: 'ALL' },
      { name: 'inventory.products.view', scope: 'ALL' },
      { name: 'inventory.stock.view', scope: 'ALL' },
      { name: 'dashboard.overview.view', scope: 'ALL' },
      { name: 'dashboard.module_sales.view', scope: 'ALL' },
      { name: 'dashboard.widgets_sales.view', scope: 'OWN' }
    ]
  },
  {
    name: 'Purchase Manager',
    description: 'Manages suppliers, procurement purchase orders, and goods receiving',
    isSystem: true,
    patterns: [
      'purchases.*',
      'import.dashboard.view',
      'import.rfqs.*',
      'import.orders.*',
      'import.proformas.*',
      'import.shipments.*',
      'import.carriers.*',
      'import.customs.view',
      'import.customs.create',
      'import.customs.edit',
      'import.customs.assess',
      'import.customs.release',
      'import.customs.hold',
      'import.customs.cancel',
      'import.documents.*',
      'import.grn.*',
      'import.landed_costs.*',
      'import.finance.*',
      'import.bills.view',
      'import.bills.create',
      'import.bills.edit',
      'import.reports.view',
      'import.settings.view',
      'inventory.products.view',
      'inventory.stock.view',
      'reports.purchases.*',
      'dashboard.overview.view',
      'dashboard.module_purchases.view',
      'dashboard.module_import.view',
      'dashboard.widgets_purchases.view'
    ]
  },
  {
    name: 'Purchase User',
    description: 'Raises purchase orders and checks inbound supplier bills',
    isSystem: true,
    patterns: [
      'purchases.dashboard.view',
      'purchases.orders.view',
      'purchases.orders.create',
      'purchases.orders.edit',
      'purchases.orders.print',
      'purchases.requisitions.*',
      'purchases.grn.view',
      'purchases.suppliers.view',
      'purchases.suppliers.create',
      'purchases.invoices.view',
      'purchases.products.view',
      'inventory.products.view',
      'inventory.stock.view',
      'dashboard.module_purchases.view'
    ]
  },
  {
    name: 'Inventory Manager',
    description: 'Oversees warehouse inventory, transfers, adjustments, write-offs, and stock valuation',
    isSystem: true,
    patterns: [
      'inventory.*',
      'purchases.grn.*',
      'import.grn.view',
      'import.grn.create',
      'import.grn.post',
      'import.grn.cancel',
      'sales.deliveries.*',
      'reports.inventory.*',
      'dashboard.overview.view',
      'dashboard.module_inventory.view',
      'dashboard.widgets_inventory.view',
      'dashboard.module_import.view'
    ]
  },
  {
    name: 'Warehouse User',
    description: 'Handles physical stock picking, goods receiving, and warehouse transfers',
    isSystem: true,
    patterns: [
      'inventory.dashboard.view',
      'inventory.products.view',
      'inventory.stock.view',
      'inventory.stock.create',
      'inventory.transfers.view',
      'inventory.transfers.create',
      'inventory.adjustments.view',
      'inventory.adjustments.create',
      'purchases.grn.view',
      'purchases.grn.create',
      'import.grn.view',
      'import.grn.create',
      'import.grn.post',
      'sales.deliveries.view',
      'sales.deliveries.edit',
      'dashboard.module_inventory.view',
      'dashboard.module_import.view'
    ]
  },
  {
    name: 'HR Manager',
    description: 'Manages employees, attendance records, leaves, payroll processing, and departments',
    isSystem: true,
    patterns: [
      'hr.*',
      'reports.hr.*',
      'dashboard.overview.view',
      'dashboard.module_hr.view'
    ]
  },
  {
    name: 'Cashier',
    description: 'Operates POS terminal, processes checkout payments, and manages cashier shift cash float',
    isSystem: true,
    patterns: [
      'pos.register.*',
      'pos.shifts.view',
      'pos.shifts.create',
      'pos.shifts.close',
      'pos.shifts.print',
      'sales.orders.create',
      'sales.invoices.create',
      'sales.payments.create',
      'dashboard.module_pos.view'
    ]
  },
  {
    name: 'Viewer',
    description: 'Read-only access across allowed non-financial operational records',
    isSystem: true,
    patterns: [
      'sales.*.view',
      'purchases.*.view',
      'inventory.*.view',
      'pos.*.view',
      'manufacturing.*.view',
      'dashboard.overview.view',
      'dashboard.module_sales.view',
      'dashboard.module_purchases.view',
      'dashboard.module_inventory.view',
      'dashboard.module_pos.view',
      'dashboard.module_manufacturing.view'
    ]
  }
];

module.exports = {
  DATA_SCOPES,
  STANDARD_ACTIONS,
  MODULE_DEFINITIONS,
  DEFAULT_SYSTEM_ROLES,
  getFlatPermissionList
};
