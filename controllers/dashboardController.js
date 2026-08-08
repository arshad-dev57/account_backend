
const prisma = require('../prisma/client');
const { get, set } = require('../utils/redisClient');

function formatAmount(amount) {
  const formatter = new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  });
  return formatter.format(amount || 0);
}

function toNum(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/** Prefer totalAmount (includes tax) when present, else amount. */
function docAmount(doc, preferred = 'totalAmount') {
  if (preferred === 'totalAmount') {
    const t = toNum(doc.totalAmount);
    if (t > 0) return t;
    return toNum(doc.amount);
  }
  const a = toNum(doc.amount);
  if (a > 0) return a;
  return toNum(doc.totalAmount);
}

function groupByMonth(docs, getAmount) {
  const map = {};
  docs.forEach((doc) => {
    const d = new Date(doc.date);
    if (Number.isNaN(d.getTime())) return;
    const key = `${d.getFullYear()}-${d.getMonth()}`;
    map[key] = (map[key] || 0) + getAmount(doc);
  });
  return map;
}

function inRange(dateVal, from, to) {
  const d = new Date(dateVal);
  return d >= from && d <= to;
}

function sumDocs(arr, getAmount) {
  return arr.reduce((s, d) => s + getAmount(d), 0);
}

function pct(current, previous) {
  if (previous === 0) return current > 0 ? 100 : current < 0 ? -100 : 0;
  return ((current - previous) / Math.abs(previous)) * 100;
}

function startOfDay(d) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function endOfDay(d) {
  const x = new Date(d);
  x.setHours(23, 59, 59, 999);
  return x;
}

/** Parse yyyy-MM-dd as a local calendar date (avoids UTC midnight shift). */
function parseLocalDate(value) {
  if (value instanceof Date) return new Date(value.getTime());
  const raw = String(value || '').trim();
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(raw);
  if (m) {
    return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  }
  return new Date(raw);
}

function getDateRangeFromTimePeriod(timePeriod) {
  const now = new Date();

  switch (timePeriod) {
    case 'Today':
      return { start: startOfDay(now), end: endOfDay(now) };

    case 'Last Week': {
      // Rolling last 7 days (matches Flutter UI label)
      const start = startOfDay(new Date(now));
      start.setDate(start.getDate() - 6);
      return { start, end: endOfDay(now) };
    }

    case 'This Month':
      return {
        start: new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0),
        end: endOfDay(new Date(now.getFullYear(), now.getMonth() + 1, 0)),
      };

    case 'Last Month':
      return {
        start: new Date(now.getFullYear(), now.getMonth() - 1, 1, 0, 0, 0, 0),
        end: endOfDay(new Date(now.getFullYear(), now.getMonth(), 0)),
      };

    case 'This Quarter': {
      const quarterStartMonth = Math.floor(now.getMonth() / 3) * 3;
      return {
        start: new Date(now.getFullYear(), quarterStartMonth, 1, 0, 0, 0, 0),
        end: endOfDay(new Date(now.getFullYear(), quarterStartMonth + 3, 0)),
      };
    }

    case 'This Year':
      return {
        start: new Date(now.getFullYear(), 0, 1, 0, 0, 0, 0),
        end: endOfDay(new Date(now.getFullYear(), 11, 31)),
      };

    case 'Custom':
      // Custom ranges must supply startDate + endDate via resolveDateRange
      return {
        start: new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0),
        end: endOfDay(now),
      };

    default:
      return {
        start: new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0),
        end: endOfDay(new Date(now.getFullYear(), now.getMonth() + 1, 0)),
      };
  }
}

/** Previous period of equal length ending just before current start. */
function getPreviousPeriod(startDate, endDate) {
  const durationMs = endDate.getTime() - startDate.getTime();
  const prevEnd = new Date(startDate.getTime() - 1);
  const prevStart = new Date(prevEnd.getTime() - durationMs);
  return { start: prevStart, end: prevEnd };
}

/**
 * Named periods (Today, Last Week, …) are resolved on the server so
 * Flutter / web clients cannot drift. Custom ranges use startDate + endDate.
 */
function resolveDateRange(query = {}) {
  const timePeriod = String(query.timePeriod || 'This Month').trim() || 'This Month';
  const isCustom =
    timePeriod === 'Custom' ||
    timePeriod.toLowerCase() === 'custom';

  if (isCustom && query.startDate && query.endDate) {
    const start = startOfDay(parseLocalDate(query.startDate));
    const end = endOfDay(parseLocalDate(query.endDate));
    if (!Number.isNaN(start.getTime()) && !Number.isNaN(end.getTime()) && start <= end) {
      return { start, end, timePeriod: 'Custom' };
    }
  }

  // Named period → backend calendar window (ignore client start/end)
  const range = getDateRangeFromTimePeriod(timePeriod);
  return { ...range, timePeriod };
}

function incomeAmt(d) {
  return docAmount(d, 'totalAmount');
}
function expenseAmt(d) {
  // Match ExpenseModel.getSummary — use totalAmount (tax-inclusive)
  return toNum(d.totalAmount) || toNum(d.amount);
}

/** Same company scope as expenseController (incl. legacy null companyId rows). */
function expenseWhere(companyId, userId, extra = {}) {
  return {
    OR: [
      { companyId },
      { companyId: null, createdBy: userId },
    ],
    status: 'Posted',
    ...extra,
  };
}
function invoiceAmt(d) {
  return toNum(d.totalAmount);
}
function billAmt(d) {
  return toNum(d.totalAmount);
}
function creditAmt(d) {
  return toNum(d.amount);
}

function companyInvoiceScope(companyId, userId) {
  if (companyId) {
    return {
      OR: [
        { companyId },
        { companyId: null, createdBy: userId },
      ],
    };
  }
  return { createdBy: userId };
}

function salesInvoiceWhere(companyId, userId, extra = {}) {
  return {
    AND: [
      companyInvoiceScope(companyId, userId),
      {
        isDeleted: false,
        isActive: true,
        ...extra,
      },
    ],
  };
}

/**
 * Merge WarehouseInvoice + SalesInvoice without double-counting.
 * Prefer SalesInvoice when both exist for the same orderId.
 * Rows without orderId are kept from both sources (manual invoices).
 */
function mergeSalesInvoiceRows(warehouseRows = [], moduleRows = []) {
  const moduleOrderIds = new Set(
    moduleRows.filter((r) => r.orderId).map((r) => r.orderId)
  );
  const filteredWarehouse = warehouseRows.filter((inv) => {
    const status = String(inv.invoiceStatus || '');
    if (status === 'Draft' || status === 'Cancelled') return false;
    if (inv.orderId && moduleOrderIds.has(inv.orderId)) return false;
    return true;
  });
  const filteredModule = moduleRows.filter((inv) => {
    const status = String(inv.invoiceStatus || '');
    return status !== 'Draft' && status !== 'Cancelled';
  });
  return [...filteredModule, ...filteredWarehouse];
}

/**
 * Accounting dashboard aggregates across modules:
 *
 *   Sales (KPI)    ← Sales invoices paidAmount (selected period)
 *   Revenue        ← Sales paid + Other income − Credit notes
 *   Purchases      ← Purchases module (PurchaseInvoice)
 *   Other income   ← Accounting Income screen
 *   Expenses       ← Accounting Expense screen
 *   Credit notes   ← Accounting Credit Notes
 *
 *   Unpaid invoice balances are NOT included in Revenue/Sales.
 *   They appear under Receivables (outstanding).
 *
 *   Net Profit = Revenue − Expenses
 *   (Purchases are already included via the Expense screen — do not subtract again)
 */
function computePeriodTotals(
  incomes,
  salesInvoices,
  creditNotes,
  expenses,
  purchaseInvoices,
  start,
  end
) {
  const curInc = incomes.filter((d) => inRange(d.date, start, end));
  const curSales = salesInvoices.filter((d) => inRange(d.date, start, end));
  const curCN = creditNotes.filter((d) => inRange(d.date, start, end));
  const curExp = expenses.filter((d) => inRange(d.date, start, end));
  const curPurch = purchaseInvoices.filter((d) => inRange(d.date, start, end));

  const otherIncome = sumDocs(curInc, incomeAmt);
  // Invoiced total kept for breakdown only (includes unpaid)
  const salesInvoiced = sumDocs(curSales, invoiceAmt);
  // Cash/collected sales — excludes unpaid portion
  const salesPaid = curSales.reduce((s, d) => s + toNum(d.paidAmount), 0);
  const creditNotesTotal = sumDocs(curCN, creditAmt);
  const operatingExpenses = sumDocs(curExp, expenseAmt);
  const purchases = sumDocs(curPurch, invoiceAmt);

  // Revenue uses PAID sales only (not unpaid invoice totals)
  const salesRevenue = salesPaid;
  const revenue = salesPaid + otherIncome - creditNotesTotal;
  // Purchases already flow into expenses — only subtract expenses for net profit
  const totalCosts = operatingExpenses;
  const netProfit = revenue - operatingExpenses;
  const profitMargin = revenue > 0 ? (netProfit / revenue) * 100 : 0;
  const grossProfit = salesPaid - purchases;

  return {
    otherIncome,
    salesRevenue,
    salesInvoiced,
    salesPaid,
    creditNotesTotal,
    operatingExpenses,
    purchases,
    revenue,
    totalExpenses: operatingExpenses,
    totalCosts,
    netProfit,
    profitMargin,
    grossProfit,
  };
}

function purchaseWhere(companyId, userId, extra = {}) {
  return {
    AND: [
      {
        OR: [
          { companyId },
          { companyId: null, createdBy: userId },
        ],
      },
      {
        invoiceStatus: { notIn: ['Draft', 'Cancelled'] },
        isDeleted: false,
        isActive: true,
        ...extra,
      },
    ],
  };
}

function groupByDay(docs, getAmount) {
  const map = {};
  docs.forEach((doc) => {
    const d = new Date(doc.date);
    if (Number.isNaN(d.getTime())) return;
    const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
    map[key] = (map[key] || 0) + getAmount(doc);
  });
  return map;
}

function buildChartSeries({
  incomes,
  mappedSales,
  creditNotes,
  expenses,
  mappedPurchases,
  startDate,
  endDate,
}) {
  const daySpan =
    Math.floor((endDate.getTime() - startDate.getTime()) / (24 * 60 * 60 * 1000)) + 1;
  const useDaily = daySpan <= 45;

  const buckets = [];
  if (useDaily) {
    const cursor = startOfDay(startDate);
    const last = startOfDay(endDate);
    while (cursor <= last) {
      buckets.push(new Date(cursor));
      cursor.setDate(cursor.getDate() + 1);
    }
  } else {
    const cursor = new Date(startDate.getFullYear(), startDate.getMonth(), 1);
    const last = new Date(endDate.getFullYear(), endDate.getMonth(), 1);
    while (cursor <= last) {
      buckets.push(new Date(cursor));
      cursor.setMonth(cursor.getMonth() + 1);
    }
  }
  if (buckets.length === 0) buckets.push(startOfDay(endDate));

  const groupFn = useDaily ? groupByDay : groupByMonth;
  const bucketKey = (d) =>
    useDaily
      ? `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`
      : `${d.getFullYear()}-${d.getMonth()}`;
  const bucketLabel = (d) =>
    useDaily
      ? d.toLocaleString('default', { month: 'short', day: 'numeric' })
      : d.toLocaleString('default', { month: 'short', year: 'numeric' });

  const periodIncomes = incomes.filter((d) => inRange(d.date, startDate, endDate));
  const periodSales = mappedSales.filter((d) => inRange(d.date, startDate, endDate));
  const periodCN = creditNotes.filter((d) => inRange(d.date, startDate, endDate));
  const periodExp = expenses.filter((d) => inRange(d.date, startDate, endDate));
  const periodPurch = mappedPurchases.filter((d) => inRange(d.date, startDate, endDate));

  const incMap = groupFn(periodIncomes, incomeAmt);
  const paidMap = groupFn(periodSales, (d) => toNum(d.paidAmount));
  const cnMap = groupFn(periodCN, creditAmt);
  const expMap = groupFn(periodExp, expenseAmt);
  const purchMap = groupFn(periodPurch, invoiceAmt);

  return {
    useDaily,
    chartData: buckets.map((d) => {
      const key = bucketKey(d);
      // Revenue trend = paid sales + income − credit notes (excludes unpaid)
      const revenue =
        (incMap[key] || 0) + (paidMap[key] || 0) - (cnMap[key] || 0);
      const expensesTotal = expMap[key] || 0;
      const purchases = purchMap[key] || 0;
      return {
        month: bucketLabel(d),
        date: d.toISOString(),
        revenue,
        sales: paidMap[key] || 0,
        expenses: expensesTotal,
        purchases,
        // Purchases already included in expenses — do not subtract again
        profit: revenue - expensesTotal,
      };
    }),
  };
}

function buildExpenseCategories(expenses, startDate, endDate) {
  const categories = {};
  let totalAmount = 0;
  expenses
    .filter((d) => inRange(d.date, startDate, endDate))
    .forEach((exp) => {
      const type = exp.expenseType || 'Other';
      const amt = expenseAmt(exp);
      categories[type] = (categories[type] || 0) + amt;
      totalAmount += amt;
    });

  return Object.entries(categories)
    .map(([name, amount]) => ({
      name,
      amount,
      formatted: formatAmount(amount),
      percentage: totalAmount > 0 ? (amount / totalAmount) * 100 : 0,
    }))
    .sort((a, b) => b.amount - a.amount);
}

function buildRecentTransactions(rows, limitNum = 10) {
  const transactions = [];

  (rows.paymentsReceived || []).forEach((p) => {
    transactions.push({
      id: p.id,
      title: p.reference || `Payment from ${p.customerName}`,
      amount: toNum(p.amount),
      date: p.paymentDate,
      type: 'payment',
      icon: 'payment',
      reference: p.reference,
      invoiceNumber: p.invoiceNumber,
      source: 'payment_received',
    });
  });

  (rows.incomes || []).forEach((inc) => {
    transactions.push({
      id: inc.id,
      title: inc.description || `${inc.incomeType} - ${inc.incomeNumber}`,
      amount: incomeAmt(inc),
      date: inc.date,
      type: 'income',
      icon: 'trending_up',
      reference: inc.reference,
      source: 'income',
    });
  });

  (rows.expenses || []).forEach((exp) => {
    transactions.push({
      id: exp.id,
      title: exp.description || `${exp.expenseType} - ${exp.expenseNumber}`,
      amount: expenseAmt(exp),
      date: exp.date,
      type: 'expense',
      icon: 'trending_down',
      reference: exp.reference,
      source: 'expense',
    });
  });

  (rows.invoices || []).forEach((inv) => {
    transactions.push({
      id: inv.id,
      title: `Invoice to ${inv.customerName}`,
      amount: toNum(inv.grandTotal),
      date: inv.invoiceDate,
      type: 'income',
      icon: 'receipt_long',
      reference: inv.invoiceNumber,
      source: 'warehouse_invoice',
    });
  });

  (rows.bills || []).forEach((bill) => {
    transactions.push({
      id: bill.id,
      title: `Bill from ${bill.vendorName}`,
      amount: toNum(bill.totalAmount),
      date: bill.date,
      type: 'purchase',
      icon: 'receipt',
      reference: bill.billNumber,
      source: 'bill',
    });
  });

  (rows.purchases || []).forEach((inv) => {
    transactions.push({
      id: inv.id,
      title: `Purchase from ${inv.supplierName || 'Supplier'}`,
      amount: toNum(inv.grandTotal),
      date: inv.invoiceDate,
      type: 'purchase',
      icon: 'receipt',
      reference: inv.invoiceNumber,
      source: 'purchase_invoice',
    });
  });

  transactions.sort((a, b) => new Date(b.date) - new Date(a.date));
  return transactions.slice(0, limitNum);
}

/**
 * Single source of truth for the accounting dashboard.
 * All KPIs, charts, categories and recent txns share the same date window.
 */
async function buildDashboardOverview({
  userId,
  companyId,
  startDate,
  endDate,
  timePeriod,
  txnLimit = 10,
}) {
  const { start: previousStartDate, end: previousEndDate } = getPreviousPeriod(
    startDate,
    endDate
  );
  const fetchFrom = previousStartDate;
  const fetchTo = endDate;

  const [
    allIncomes,
    allSalesInvoices,
    allModuleSalesInvoices,
    allCreditNotes,
    allExpenses,
    allPurchaseInvoices,
    outstandingSalesInvoices,
    outstandingModuleSalesInvoices,
    outstandingBills,
    outstandingPurchaseInvoices,
    bankAccounts,
    periodPaymentsReceived,
    periodTxnIncomes,
    periodTxnExpenses,
    periodTxnInvoices,
    periodTxnBills,
    periodTxnPurchases,
  ] = await Promise.all([
    prisma.income.findMany({
      where: {
        companyId,
        date: { gte: fetchFrom, lte: fetchTo },
        status: 'Posted',
      },
      select: {
        id: true,
        date: true,
        amount: true,
        totalAmount: true,
        description: true,
        incomeType: true,
        incomeNumber: true,
        reference: true,
      },
    }),
    prisma.warehouseInvoice.findMany({
      where: salesInvoiceWhere(companyId, userId, {
        invoiceDate: { gte: fetchFrom, lte: fetchTo },
        invoiceStatus: { notIn: ['Draft', 'Cancelled'] },
      }),
      select: {
        id: true,
        orderId: true,
        invoiceDate: true,
        grandTotal: true,
        paidAmount: true,
        invoiceNumber: true,
        customerName: true,
        invoiceStatus: true,
      },
    }),
    prisma.salesInvoice.findMany({
      where: salesInvoiceWhere(companyId, userId, {
        invoiceDate: { gte: fetchFrom, lte: fetchTo },
        invoiceStatus: { notIn: ['Draft', 'Cancelled'] },
      }),
      select: {
        id: true,
        orderId: true,
        invoiceDate: true,
        grandTotal: true,
        paidAmount: true,
        invoiceNumber: true,
        customerName: true,
        invoiceStatus: true,
      },
    }),
    prisma.creditNote.findMany({
      where: {
        companyId,
        date: { gte: fetchFrom, lte: fetchTo },
        status: { notIn: ['Cancelled', 'Voided'] },
      },
      select: { date: true, amount: true },
    }),
    prisma.expense.findMany({
      where: expenseWhere(companyId, userId, {
        date: { gte: fetchFrom, lte: fetchTo },
      }),
      select: {
        id: true,
        date: true,
        amount: true,
        totalAmount: true,
        expenseType: true,
        description: true,
        expenseNumber: true,
        reference: true,
      },
    }),
    prisma.purchaseInvoice.findMany({
      where: purchaseWhere(companyId, userId, {
        invoiceDate: { gte: fetchFrom, lte: fetchTo },
      }),
      select: {
        id: true,
        invoiceDate: true,
        grandTotal: true,
        invoiceNumber: true,
        supplierName: true,
      },
    }),
    prisma.warehouseInvoice.findMany({
      where: {
        ...salesInvoiceWhere(companyId, userId, {
          paymentStatus: { in: ['Unpaid', 'Partial'] },
          outstanding: { gt: 0 },
          invoiceStatus: { notIn: ['Draft', 'Cancelled'] },
        }),
      },
      select: { outstanding: true, orderId: true, invoiceStatus: true },
    }),
    prisma.salesInvoice.findMany({
      where: {
        ...salesInvoiceWhere(companyId, userId, {
          paymentStatus: { in: ['Unpaid', 'Partial'] },
          outstanding: { gt: 0 },
          invoiceStatus: { notIn: ['Draft', 'Cancelled'] },
        }),
      },
      select: { outstanding: true, orderId: true, invoiceStatus: true },
    }),
    prisma.bill.findMany({
      where: {
        companyId,
        posted: true,
        outstanding: { gt: 0 },
        status: { notIn: ['Cancelled', 'Voided', 'Draft', 'Paid'] },
      },
      select: { outstanding: true },
    }),
    prisma.purchaseInvoice.findMany({
      where: {
        AND: [
          {
            OR: [{ companyId }, { companyId: null, createdBy: userId }],
          },
          {
            paymentStatus: { in: ['Unpaid', 'Partial', 'unpaid', 'partial'] },
            outstanding: { gt: 0 },
            invoiceStatus: { notIn: ['Draft', 'Cancelled'] },
            isDeleted: false,
            isActive: true,
          },
        ],
      },
      select: { outstanding: true },
    }),
    prisma.bankAccount.findMany({
      where: { companyId, status: 'Active' },
      select: { currentBalance: true, accountType: true },
    }),
    // Period-scoped activity feed
    prisma.paymentReceived.findMany({
      where: {
        companyId,
        status: { notIn: ['Cancelled', 'Voided'] },
        paymentDate: { gte: startDate, lte: endDate },
      },
      orderBy: { paymentDate: 'desc' },
      take: txnLimit,
      select: {
        id: true,
        reference: true,
        customerName: true,
        amount: true,
        paymentDate: true,
        invoiceNumber: true,
      },
    }),
    prisma.income.findMany({
      where: {
        companyId,
        status: 'Posted',
        date: { gte: startDate, lte: endDate },
      },
      orderBy: { date: 'desc' },
      take: txnLimit,
      select: {
        id: true,
        description: true,
        incomeType: true,
        incomeNumber: true,
        amount: true,
        totalAmount: true,
        date: true,
        reference: true,
      },
    }),
    prisma.expense.findMany({
      where: expenseWhere(companyId, userId, {
        date: { gte: startDate, lte: endDate },
      }),
      orderBy: { date: 'desc' },
      take: txnLimit,
      select: {
        id: true,
        description: true,
        expenseType: true,
        expenseNumber: true,
        amount: true,
        totalAmount: true,
        date: true,
        reference: true,
      },
    }),
    prisma.warehouseInvoice.findMany({
      where: salesInvoiceWhere(companyId, userId, {
        invoiceDate: { gte: startDate, lte: endDate },
        invoiceStatus: { notIn: ['Draft', 'Cancelled'] },
      }),
      orderBy: { invoiceDate: 'desc' },
      take: txnLimit,
      select: {
        id: true,
        invoiceNumber: true,
        customerName: true,
        grandTotal: true,
        invoiceDate: true,
      },
    }),
    prisma.bill.findMany({
      where: {
        companyId,
        posted: true,
        status: { notIn: ['Cancelled', 'Voided', 'Draft'] },
        date: { gte: startDate, lte: endDate },
      },
      orderBy: { date: 'desc' },
      take: txnLimit,
      select: {
        id: true,
        billNumber: true,
        vendorName: true,
        totalAmount: true,
        date: true,
      },
    }),
    prisma.purchaseInvoice.findMany({
      where: purchaseWhere(companyId, userId, {
        invoiceDate: { gte: startDate, lte: endDate },
      }),
      orderBy: { invoiceDate: 'desc' },
      take: txnLimit,
      select: {
        id: true,
        invoiceNumber: true,
        supplierName: true,
        grandTotal: true,
        invoiceDate: true,
      },
    }),
  ]);

  const mergedSalesRows = mergeSalesInvoiceRows(
    allSalesInvoices,
    allModuleSalesInvoices
  );
  const mappedSales = mergedSalesRows.map((inv) => ({
    date: inv.invoiceDate,
    totalAmount: inv.grandTotal,
    paidAmount: inv.paidAmount,
  }));
  const mappedPurchases = allPurchaseInvoices.map((inv) => ({
    date: inv.invoiceDate,
    totalAmount: inv.grandTotal,
  }));

  const current = computePeriodTotals(
    allIncomes,
    mappedSales,
    allCreditNotes,
    allExpenses,
    mappedPurchases,
    startDate,
    endDate
  );
  const previous = computePeriodTotals(
    allIncomes,
    mappedSales,
    allCreditNotes,
    allExpenses,
    mappedPurchases,
    previousStartDate,
    previousEndDate
  );

  const salesInPeriod = mappedSales.filter((d) => inRange(d.date, startDate, endDate));
  const totalSalesPaid = salesInPeriod.reduce((s, d) => s + toNum(d.paidAmount), 0);
  const totalSalesCount = salesInPeriod.length;
  const expenseScreenTotal = current.operatingExpenses;
  const expenseScreenCount = allExpenses.filter((d) =>
    inRange(d.date, startDate, endDate)
  ).length;
  // Purchases already included in expenses — do not subtract again
  const netProfitAmount = current.revenue - expenseScreenTotal;

  const allOutstandingSales = mergeSalesInvoiceRows(
    outstandingSalesInvoices,
    outstandingModuleSalesInvoices
  );
  const totalReceivables = allOutstandingSales.reduce(
    (s, inv) => s + toNum(inv.outstanding),
    0
  );
  const billsPayable = outstandingBills.reduce(
    (s, bill) => s + toNum(bill.outstanding),
    0
  );
  const purchasePayable = outstandingPurchaseInvoices.reduce(
    (s, inv) => s + toNum(inv.outstanding),
    0
  );
  const totalPayables = billsPayable + purchasePayable;
  const bankBalance = bankAccounts.reduce(
    (s, acc) => s + toNum(acc.currentBalance),
    0
  );
  const cashOnlyBalance = bankAccounts
    .filter((acc) => String(acc.accountType || '').toLowerCase().includes('cash'))
    .reduce((s, acc) => s + toNum(acc.currentBalance), 0);

  const prevSalesPaid = mappedSales
    .filter((d) => inRange(d.date, previousStartDate, previousEndDate))
    .reduce((s, d) => s + toNum(d.paidAmount), 0);
  const prevNetProfit = previous.revenue - previous.operatingExpenses;

  const revenueChange = pct(current.revenue, previous.revenue);
  const expenseChange = pct(expenseScreenTotal, previous.operatingExpenses);
  const profitChange = pct(netProfitAmount, prevNetProfit);
  const salesChange = pct(totalSalesPaid, prevSalesPaid);
  const purchasesChange = pct(current.purchases, previous.purchases);

  const { chartData, useDaily } = buildChartSeries({
    incomes: allIncomes,
    mappedSales,
    creditNotes: allCreditNotes,
    expenses: allExpenses,
    mappedPurchases,
    startDate,
    endDate,
  });

  const expenseCategories = buildExpenseCategories(
    allExpenses,
    startDate,
    endDate
  );

  const recentTransactions = buildRecentTransactions(
    {
      paymentsReceived: periodPaymentsReceived,
      incomes: periodTxnIncomes,
      expenses: periodTxnExpenses,
      invoices: periodTxnInvoices,
      bills: periodTxnBills,
      purchases: periodTxnPurchases,
    },
    txnLimit
  );

  // Chart totals must equal KPI period totals
  const chartTotals = chartData.reduce(
    (acc, row) => {
      acc.revenue += row.revenue;
      acc.sales += row.sales;
      acc.expenses += row.expenses;
      acc.purchases += row.purchases;
      acc.profit += row.profit;
      return acc;
    },
    { revenue: 0, sales: 0, expenses: 0, purchases: 0, profit: 0 }
  );

  return {
    kpi: {
      totalRevenue: {
        amount: current.revenue,
        formatted: formatAmount(current.revenue),
        change: Math.round(revenueChange * 10) / 10,
        isPositive: revenueChange >= 0,
        period: timePeriod,
        sources: {
          salesModule: current.salesPaid,
          salesInvoiced: current.salesInvoiced,
          incomeModule: current.otherIncome,
          creditNotes: current.creditNotesTotal,
          formula: 'Sales paid + Income − Credit Notes (excludes unpaid)',
        },
      },
      totalSales: {
        amount: totalSalesPaid,
        formatted: formatAmount(totalSalesPaid),
        change: Math.round(salesChange * 10) / 10,
        isPositive: salesChange >= 0,
        period: timePeriod,
        count: totalSalesCount,
        source: 'Sales invoices paid amount (selected period)',
      },
      totalPurchases: {
        amount: current.purchases,
        formatted: formatAmount(current.purchases),
        change: Math.round(purchasesChange * 10) / 10,
        isPositive: purchasesChange <= 0,
        period: timePeriod,
        source: 'Purchase invoices (selected period)',
      },
      totalExpenses: {
        amount: expenseScreenTotal,
        formatted: formatAmount(expenseScreenTotal),
        change: Math.round(expenseChange * 10) / 10,
        isPositive: expenseChange <= 0,
        period: timePeriod,
        count: expenseScreenCount,
        sources: {
          expenseModule: expenseScreenTotal,
          formula: 'Expense screen Posted (selected period)',
        },
      },
      netProfit: {
        amount: netProfitAmount,
        formatted: formatAmount(netProfitAmount),
        change: Math.round(profitChange * 10) / 10,
        isPositive: netProfitAmount >= 0,
        margin:
          current.revenue > 0
            ? Math.round((netProfitAmount / current.revenue) * 1000) / 10
            : 0,
        period: timePeriod,
        formula: 'Revenue − Expenses',
      },
      grossProfit: {
        amount: current.grossProfit,
        formatted: formatAmount(current.grossProfit),
        isPositive: current.grossProfit >= 0,
        period: timePeriod,
        formula: 'Sales paid − Purchases',
      },
      outstanding: {
        amount: totalReceivables,
        formatted: formatAmount(totalReceivables),
        change: 0,
        isPositive: true,
        count: allOutstandingSales.length,
        period: 'Current',
        source: 'Sales invoices outstanding',
      },
      accountsReceivable: {
        amount: totalReceivables,
        formatted: formatAmount(totalReceivables),
        change: 0,
        isPositive: true,
        count: allOutstandingSales.length,
        period: 'Current',
      },
      accountsPayable: {
        amount: totalPayables,
        formatted: formatAmount(totalPayables),
        change: 0,
        isPositive: totalPayables === 0,
        count: outstandingBills.length + outstandingPurchaseInvoices.length,
        period: 'Current',
        breakdown: {
          bills: billsPayable,
          purchaseInvoices: purchasePayable,
        },
      },
      cashBalance: {
        amount: bankBalance,
        formatted: formatAmount(bankBalance),
        change: 0,
        isPositive: bankBalance >= 0,
        cashOnly: cashOnlyBalance,
        accountsCount: bankAccounts.length,
        period: 'Current',
      },
      bankBalance: {
        amount: bankBalance,
        formatted: formatAmount(bankBalance),
        change: 0,
        isPositive: bankBalance >= 0,
        accountsCount: bankAccounts.length,
        period: 'Current',
      },
    },
    breakdown: {
      salesRevenue: current.salesRevenue,
      salesPaid: totalSalesPaid,
      otherIncome: current.otherIncome,
      creditNotes: current.creditNotesTotal,
      purchases: current.purchases,
      operatingExpenses: current.operatingExpenses,
      expenseScreenTotal,
      receivables: totalReceivables,
      payables: totalPayables,
      billsPayable,
      purchasePayable,
      bankBalance,
      cashOnlyBalance,
      bankAccountsCount: bankAccounts.length,
    },
    weeklyData: {
      revenue: current.revenue,
      expenses: expenseScreenTotal,
      profit: netProfitAmount,
    },
    dailyData: {
      revenue: current.revenue,
      expenses: expenseScreenTotal,
      profit: netProfitAmount,
    },
    chartData,
    chartMeta: {
      granularity: useDaily ? 'daily' : 'monthly',
      totals: chartTotals,
    },
    expenseCategories,
    recentTransactions,
    period: {
      timePeriod,
      startDate: startDate.toISOString(),
      endDate: endDate.toISOString(),
      startDateLocal: `${startDate.getFullYear()}-${String(startDate.getMonth() + 1).padStart(2, '0')}-${String(startDate.getDate()).padStart(2, '0')}`,
      endDateLocal: `${endDate.getFullYear()}-${String(endDate.getMonth() + 1).padStart(2, '0')}-${String(endDate.getDate()).padStart(2, '0')}`,
    },
  };
}

// ─── Get Dashboard Overview (single API) ───────────────────────

const getDashboardOverview = async (req, res) => {
  try {
    const userId = req.user.id;
    const companyId = req.user.companyId;
    const { start: startDate, end: endDate, timePeriod } = resolveDateRange(req.query);
    const txnLimit = parseInt(req.query.limit, 10) || 10;

    const cacheKey = `dashboard:overview:v3:${userId}:${timePeriod}:${startDate.toISOString()}:${endDate.toISOString()}:${txnLimit}`;
    const cached = await get(cacheKey);
    if (cached) {
      return res.status(200).json({ success: true, data: cached, cached: true });
    }

    const data = await buildDashboardOverview({
      userId,
      companyId,
      startDate,
      endDate,
      timePeriod,
      txnLimit,
    });

    await set(cacheKey, data, 60);

    return res.status(200).json({ success: true, data, cached: false });
  } catch (error) {
    console.error('Error getting dashboard overview:', error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

// ─── Get Dashboard Summary ─────────────────────────────────────

const getDashboardSummary = async (req, res) => {
  try {
    const userId = req.user.id;
    const companyId = req.user.companyId;
    const { start: startDate, end: endDate, timePeriod } = resolveDateRange(req.query);

    const cacheKey = `dashboard:summary:v11:${userId}:${timePeriod}:${startDate.toISOString()}:${endDate.toISOString()}`;

    const cached = await get(cacheKey);
    if (cached) {
      return res.status(200).json({
        success: true,
        data: cached,
        cached: true,
      });
    }

    const overview = await buildDashboardOverview({
      userId,
      companyId,
      startDate,
      endDate,
      timePeriod,
    });

    const summaryData = {
      kpi: overview.kpi,
      breakdown: overview.breakdown,
      weeklyData: overview.weeklyData,
      dailyData: overview.dailyData,
      period: overview.period,
    };

    await set(cacheKey, summaryData, 60);

    res.status(200).json({
      success: true,
      data: summaryData,
      cached: false,
    });
  } catch (error) {
    console.error('Error getting dashboard summary:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// ─── Get Chart Data ────────────────────────────────────────────

const getChartData = async (req, res) => {
  try {
    const userId = req.user.id;
    const companyId = req.user.companyId;
    const { start: startDate, end: endDate, timePeriod } = resolveDateRange(req.query);

    const overview = await buildDashboardOverview({
      userId,
      companyId,
      startDate,
      endDate,
      timePeriod,
    });

    res.status(200).json({
      success: true,
      data: overview.chartData,
      cached: false,
    });
  } catch (error) {
    console.error('Error getting chart data:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// ─── Get Expense Categories ────────────────────────────────────

const getExpenseCategories = async (req, res) => {
  try {
    const userId = req.user.id;
    const companyId = req.user.companyId;
    const { start: startDate, end: endDate, timePeriod } = resolveDateRange(req.query);

    const overview = await buildDashboardOverview({
      userId,
      companyId,
      startDate,
      endDate,
      timePeriod,
    });

    res.status(200).json({
      success: true,
      data: overview.expenseCategories,
      cached: false,
    });
  } catch (error) {
    console.error('Error getting expense categories:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// ─── Get Recent Transactions ───────────────────────────────────

const getRecentTransactions = async (req, res) => {
  try {
    const { limit = 10 } = req.query;
    const limitNum = parseInt(limit, 10) || 10;
    const userId = req.user.id;
    const companyId = req.user.companyId;

    const cacheKey = `dashboard:recent-transactions:v2:${userId}:${limitNum}`;

    const cached = await get(cacheKey);
    if (cached) {
      return res.status(200).json({
        success: true,
        data: cached,
        cached: true,
      });
    }

    const [paymentsReceived, incomes, expenses, invoices, bills] = await Promise.all([
      prisma.paymentReceived.findMany({
        where: { companyId, status: { notIn: ['Cancelled', 'Voided'] } },
        orderBy: { paymentDate: 'desc' },
        take: limitNum,
        select: {
          id: true,
          reference: true,
          customerName: true,
          amount: true,
          paymentDate: true,
          invoiceNumber: true,
        },
      }),
      prisma.income.findMany({
        where: { companyId, status: 'Posted' },
        orderBy: { date: 'desc' },
        take: limitNum,
        select: {
          id: true,
          description: true,
          incomeType: true,
          incomeNumber: true,
          amount: true,
          totalAmount: true,
          date: true,
          reference: true,
        },
      }),
      prisma.expense.findMany({
        where: expenseWhere(companyId, userId),
        orderBy: { date: 'desc' },
        take: limitNum,
        select: {
          id: true,
          description: true,
          expenseType: true,
          expenseNumber: true,
          amount: true,
          totalAmount: true,
          date: true,
          reference: true,
        },
      }),
      prisma.warehouseInvoice.findMany({
        where: {
          companyId,
          invoiceStatus: { notIn: ['Draft', 'Cancelled'] },
          isDeleted: false,
        },
        orderBy: { invoiceDate: 'desc' },
        take: limitNum,
        select: {
          id: true,
          invoiceNumber: true,
          customerName: true,
          grandTotal: true,
          invoiceDate: true,
        },
      }),
      prisma.bill.findMany({
        where: {
          companyId,
          posted: true,
          status: { notIn: ['Cancelled', 'Voided', 'Draft'] },
        },
        orderBy: { date: 'desc' },
        take: limitNum,
        select: {
          id: true,
          billNumber: true,
          vendorName: true,
          totalAmount: true,
          date: true,
        },
      }),
    ]);

    const transactions = [];

    paymentsReceived.forEach((p) => {
      transactions.push({
        id: p.id,
        title: p.reference || `Payment from ${p.customerName}`,
        amount: toNum(p.amount),
        date: p.paymentDate,
        type: 'payment',
        icon: 'payment',
        reference: p.reference,
        invoiceNumber: p.invoiceNumber,
        source: 'payment_received',
      });
    });

    incomes.forEach((inc) => {
      transactions.push({
        id: inc.id,
        title: inc.description || `${inc.incomeType} - ${inc.incomeNumber}`,
        amount: incomeAmt(inc),
        date: inc.date,
        type: 'income',
        icon: 'trending_up',
        reference: inc.reference,
        source: 'income',
      });
    });

    expenses.forEach((exp) => {
      transactions.push({
        id: exp.id,
        title: exp.description || `${exp.expenseType} - ${exp.expenseNumber}`,
        amount: expenseAmt(exp),
        date: exp.date,
        type: 'expense',
        icon: 'trending_down',
        reference: exp.reference,
        source: 'expense',
      });
    });

    invoices.forEach((inv) => {
      transactions.push({
        id: inv.id,
        title: `Invoice to ${inv.customerName}`,
        amount: toNum(inv.grandTotal),
        date: inv.invoiceDate,
        type: 'income',
        icon: 'receipt_long',
        reference: inv.invoiceNumber,
        source: 'warehouse_invoice',
      });
    });

    bills.forEach((bill) => {
      transactions.push({
        id: bill.id,
        title: `Bill from ${bill.vendorName}`,
        amount: toNum(bill.totalAmount),
        date: bill.date,
        type: 'purchase',
        icon: 'receipt',
        reference: bill.billNumber,
        source: 'bill',
      });
    });

    transactions.sort((a, b) => new Date(b.date) - new Date(a.date));
    const recentTransactions = transactions.slice(0, limitNum);

    await set(cacheKey, recentTransactions, 120);

    res.status(200).json({
      success: true,
      data: recentTransactions,
      cached: false,
    });
  } catch (error) {
    console.error('Error getting recent transactions:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// ─── Get Quick Actions ────────────────────────────────────────

const getQuickActions = async (req, res) => {
  res.status(200).json({
    success: true,
    data: [
      { id: 'add_income', label: 'Income', icon: 'add_circle_outline', color: '#2ECC71', route: '/income' },
      { id: 'add_expense', label: 'Expense', icon: 'remove_circle_outline', color: '#E74C3C', route: '/expense' },
      { id: 'create_invoice', label: 'Invoice', icon: 'receipt_long', color: '#3498DB', route: '/invoices' },
      { id: 'record_payment', label: 'Payment', icon: 'payment', color: '#F39C12', route: '/payments' },
      { id: 'add_customer', label: 'Customer', icon: 'person_add', color: '#9B59B6', route: '/customers' },
    ],
  });
};

// ─── Get Yearly Summary ───────────────────────────────────────

const getYearlySummary = async (req, res) => {
  try {
    const { year = new Date().getFullYear() } = req.query;
    const userId = req.user.id;
    const companyId = req.user.companyId;
    const y = parseInt(year, 10);
    const startDate = new Date(y, 0, 1, 0, 0, 0, 0);
    const endDate = endOfDay(new Date(y, 11, 31));

    const cacheKey = `dashboard:yearly-summary:v5:${userId}:${y}`;

    const cached = await get(cacheKey);
    if (cached) {
      return res.status(200).json({
        success: true,
        data: cached,
        cached: true,
      });
    }

    const [incomes, invoices, creditNotes, expenses] = await Promise.all([
      prisma.income.findMany({
        where: {
          companyId,
          date: { gte: startDate, lte: endDate },
          status: 'Posted',
        },
        select: { date: true, amount: true, totalAmount: true },
      }),
      prisma.warehouseInvoice.findMany({
        where: {
          companyId,
          invoiceDate: { gte: startDate, lte: endDate },
          invoiceStatus: { notIn: ['Draft', 'Cancelled'] },
          isDeleted: false,
        },
        select: { invoiceDate: true, grandTotal: true },
      }),
      prisma.creditNote.findMany({
        where: {
          companyId,
          date: { gte: startDate, lte: endDate },
          status: { notIn: ['Cancelled', 'Voided'] },
        },
        select: { date: true, amount: true },
      }),
      prisma.expense.findMany({
        where: expenseWhere(companyId, userId, {
          date: { gte: startDate, lte: endDate },
        }),
        select: { date: true, amount: true, totalAmount: true },
      }),
    ]);

    const mappedInvoices = invoices.map((inv) => ({
      date: inv.invoiceDate,
      totalAmount: inv.grandTotal,
    }));

    const incMap = groupByMonth(incomes, incomeAmt);
    const invMap = groupByMonth(mappedInvoices, invoiceAmt);
    const cnMap = groupByMonth(creditNotes, creditAmt);
    const expMap = groupByMonth(expenses, expenseAmt);

    const monthNames = [
      'January', 'February', 'March', 'April', 'May', 'June',
      'July', 'August', 'September', 'October', 'November', 'December',
    ];

    const monthlyData = monthNames.map((name, m) => {
      const key = `${y}-${m}`;
      const revenue = (incMap[key] || 0) + (invMap[key] || 0) - (cnMap[key] || 0);
      const expensesTotal = expMap[key] || 0;
      return {
        month: name,
        revenue,
        expenses: expensesTotal,
        profit: revenue - expensesTotal,
      };
    });

    const totalRevenue = monthlyData.reduce((s, m) => s + m.revenue, 0);
    const totalExpenses = monthlyData.reduce((s, m) => s + m.expenses, 0);

    const summaryData = {
      year: y,
      totalRevenue,
      totalExpenses,
      totalProfit: totalRevenue - totalExpenses,
      monthlyData,
    };

    await set(cacheKey, summaryData, 600);

    res.status(200).json({
      success: true,
      data: summaryData,
      cached: false,
    });
  } catch (error) {
    console.error('Error getting yearly summary:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

module.exports = {
  getDashboardOverview,
  getDashboardSummary,
  getChartData,
  getExpenseCategories,
  getRecentTransactions,
  getQuickActions,
  getYearlySummary,
};
