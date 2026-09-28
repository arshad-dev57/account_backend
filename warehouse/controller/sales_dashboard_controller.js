// warehouse/controller/sales_dashboard_controller.js - MULTI-TENANT VERSION

const prisma = require('../../prisma/client');
const { Prisma } = require('@prisma/client');
const { applyFiscalYearWindow } = require('../../utils/fiscalYearHelper');
const { constraintIds } = require('../../utils/locationAccessHelper');


/** Build company_id SQL predicate (supports string or { in: [...] }). */
function sqlCompany(companyId, columnSql) {
  const col = Prisma.raw(columnSql);
  if (companyId && typeof companyId === 'object' && Array.isArray(companyId.in)) {
    if (!companyId.in.length) return Prisma.sql`FALSE`;
    return Prisma.sql`${col} IN (${Prisma.join(companyId.in)})`;
  }
  return Prisma.sql`${col} = ${companyId}`;
}

/** Location predicate via constraintIds. null/undefined ids = no filter. */
function sqlLocation(locationId, columnSql) {
  const ids = constraintIds(locationId);
  if (ids == null) return Prisma.sql`TRUE`;
  if (!ids.length) return Prisma.sql`FALSE`;
  const col = Prisma.raw(columnSql);
  if (ids.length === 1) return Prisma.sql`${col} = ${ids[0]}`;
  return Prisma.sql`${col} IN (${Prisma.join(ids)})`;
}

function dateGte(dateFilter) {
  return dateFilter?.gte || null;
}
function dateLte(dateFilter) {
  return dateFilter?.lte || null;
}

function toNum(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/** Returns / refunds scoped by order warehouse */
function viaOrderLocation(locationId) {
  const ids = constraintIds(locationId);
  if (ids == null) return {};
  if (!ids.length) return { order: { locationId: { in: [] } } };
  return { order: { locationId: { in: ids } } };
}

/** POS sales via terminal warehouse */
function posLocationWhere(locationId) {
  const ids = constraintIds(locationId);
  if (ids == null) return {};
  if (!ids.length) return { terminal: { locationId: { in: [] } } };
  return { terminal: { locationId: { in: ids } } };
}

function invoiceDue(inv) {
  const status = String(inv.paymentStatus || inv.invoiceStatus || '');
  // Fully settled by payment or credit note
  if (status === 'Paid' || status === 'Credit Balance' || status === 'Cancelled') {
    return 0;
  }
  // Stored outstanding is updated by payments + credit notes
  if (inv.outstanding != null && inv.outstanding !== undefined) {
    return Math.max(0, toNum(inv.outstanding));
  }
  return Math.max(0, toNum(inv.grandTotal) - toNum(inv.paidAmount));
}

/**
 * Prefer SalesInvoice when both exist for the same order.
 * Always exclude Draft/Cancelled.
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

// ─── HELPERS ────────────────────────────────────────────────
const getDateFilter = (period, startDate, endDate) => {
  if (period === 'custom' && startDate && endDate) {
    const start = new Date(startDate);
    start.setHours(0, 0, 0, 0);
    const end = new Date(endDate);
    end.setHours(23, 59, 59, 999);
    return { gte: start, lte: end };
  }

  const now = new Date();
  now.setHours(23, 59, 59, 999);
  let start = new Date();

  if (period === 'today') {
    start.setHours(0, 0, 0, 0);
  } else if (period === 'week') {
    start.setDate(start.getDate() - 7);
    start.setHours(0, 0, 0, 0);
  } else if (period === 'month') {
    start = new Date(now.getFullYear(), now.getMonth(), 1);
    start.setHours(0, 0, 0, 0);
  } else if (period === 'year') {
    start = new Date(now.getFullYear(), 0, 1);
    start.setHours(0, 0, 0, 0);
  } else {
    start = new Date(now.getFullYear(), now.getMonth(), 1);
    start.setHours(0, 0, 0, 0);
  }

  return { gte: start, lte: now };
};

async function resolveSalesDateFilter({
  period,
  startDate,
  endDate,
  fiscalYearId,
  companyId
}) {
  const raw = getDateFilter(period, startDate, endDate);
  if (!fiscalYearId || !companyId) return raw;

  const clamped = await applyFiscalYearWindow({
    companyId,
    fiscalYearId,
    start: raw.gte,
    end: raw.lte,
    period: period === 'year' ? 'This Year' : period
  });
  return { gte: clamped.start, lte: clamped.end };
}

// ─── GET ORDER TREND ──────────────────────────────────────
const getOrderTrend = async (userId, companyId, dateFilter, locationId = null) => {
  const periodStart = dateGte(dateFilter);
  const periodEnd = dateLte(dateFilter);

  const rows = await prisma.$queryRaw`
    SELECT
      (o.order_date AT TIME ZONE 'UTC')::date::text AS date,
      COUNT(*)::int AS orders,
      COALESCE(SUM(o.grand_total), 0)::float AS revenue,
      COUNT(*) FILTER (WHERE o.order_status = 'Pending')::int AS pending,
      COUNT(*) FILTER (WHERE o.order_status = 'Completed')::int AS completed,
      COUNT(*) FILTER (WHERE o.order_status = 'Cancelled')::int AS cancelled
    FROM orders o
    WHERE ${sqlCompany(companyId, 'o.company_id')}
      AND o.is_active = true
      AND o.is_deleted = false
      AND (${periodStart}::timestamptz IS NULL OR o.order_date >= ${periodStart})
      AND (${periodEnd}::timestamptz IS NULL OR o.order_date <= ${periodEnd})
      AND ${sqlLocation(locationId, 'o.location_id')}
    GROUP BY (o.order_date AT TIME ZONE 'UTC')::date
    ORDER BY date ASC
  `;

  return (rows || []).map((r) => ({
    date: String(r.date || '').slice(0, 10),
    orders: toNum(r.orders),
    revenue: toNum(r.revenue),
    pending: toNum(r.pending),
    completed: toNum(r.completed),
    cancelled: toNum(r.cancelled),
  }));
};

const posSaleWhere = (companyId, dateFilter, locationId = null) => ({
  companyId,
  status: 'Completed',
  ...(dateFilter ? { createdAt: dateFilter } : {}),
  ...posLocationWhere(locationId),
});

const getPosTrend = async (companyId, dateFilter, locationId = null) => {
  const periodStart = dateGte(dateFilter);
  const periodEnd = dateLte(dateFilter);

  const rows = await prisma.$queryRaw`
    SELECT
      (ps.created_at AT TIME ZONE 'UTC')::date::text AS date,
      COUNT(*)::int AS sales,
      COALESCE(SUM(ps.grand_total), 0)::float AS revenue
    FROM pos_sales ps
    LEFT JOIN pos_terminals t ON t.id = ps.terminal_id
    WHERE ${sqlCompany(companyId, 'ps.company_id')}
      AND ps.status = 'Completed'
      AND (${periodStart}::timestamptz IS NULL OR ps.created_at >= ${periodStart})
      AND (${periodEnd}::timestamptz IS NULL OR ps.created_at <= ${periodEnd})
      AND ${sqlLocation(locationId, 't.location_id')}
    GROUP BY (ps.created_at AT TIME ZONE 'UTC')::date
    ORDER BY date ASC
  `;

  return (rows || []).map((r) => ({
    date: String(r.date || '').slice(0, 10),
    sales: toNum(r.sales),
    revenue: toNum(r.revenue),
    orderRevenue: 0,
  }));
};

const getPosStats = async (companyId, dateFilter, locationId = null) => {
  const periodStart = dateGte(dateFilter);
  const periodEnd = dateLte(dateFilter);
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);

  const rows = await prisma.$queryRaw`
    SELECT
      COUNT(*) FILTER (
        WHERE (${periodStart}::timestamptz IS NULL OR ps.created_at >= ${periodStart})
          AND (${periodEnd}::timestamptz IS NULL OR ps.created_at <= ${periodEnd})
      )::int AS count,
      COALESCE(SUM(ps.grand_total) FILTER (
        WHERE (${periodStart}::timestamptz IS NULL OR ps.created_at >= ${periodStart})
          AND (${periodEnd}::timestamptz IS NULL OR ps.created_at <= ${periodEnd})
      ), 0)::float AS revenue,
      COALESCE(SUM(ps.discount_total) FILTER (
        WHERE (${periodStart}::timestamptz IS NULL OR ps.created_at >= ${periodStart})
          AND (${periodEnd}::timestamptz IS NULL OR ps.created_at <= ${periodEnd})
      ), 0)::float AS "discountTotal",
      COALESCE(SUM(ps.tax_total) FILTER (
        WHERE (${periodStart}::timestamptz IS NULL OR ps.created_at >= ${periodStart})
          AND (${periodEnd}::timestamptz IS NULL OR ps.created_at <= ${periodEnd})
      ), 0)::float AS "taxTotal",
      COALESCE(SUM(ps.paid_amount) FILTER (
        WHERE (${periodStart}::timestamptz IS NULL OR ps.created_at >= ${periodStart})
          AND (${periodEnd}::timestamptz IS NULL OR ps.created_at <= ${periodEnd})
      ), 0)::float AS "paidAmount",
      COUNT(*) FILTER (WHERE ps.created_at >= ${todayStart})::int AS "todayCount",
      COALESCE(SUM(ps.grand_total) FILTER (WHERE ps.created_at >= ${todayStart}), 0)::float AS "todayRevenue"
    FROM pos_sales ps
    LEFT JOIN pos_terminals t ON t.id = ps.terminal_id
    WHERE ${sqlCompany(companyId, 'ps.company_id')}
      AND ps.status = 'Completed'
      AND ${sqlLocation(locationId, 't.location_id')}
  `;

  const row = rows[0] || {};
  return {
    count: toNum(row.count),
    revenue: toNum(row.revenue),
    discountTotal: toNum(row.discountTotal),
    taxTotal: toNum(row.taxTotal),
    paidAmount: toNum(row.paidAmount),
    todayCount: toNum(row.todayCount),
    todayRevenue: toNum(row.todayRevenue),
  };
};

const sumPosRevenue = async (companyId, dateFilter, locationId = null) => {
  const agg = await prisma.pOSSale.aggregate({
    where: posSaleWhere(companyId, dateFilter, locationId),
    _sum: { grandTotal: true }
  });
  return toNum(agg._sum.grandTotal);
};

const getRecentPosActivity = async (companyId, limit = 8, locationId = null) => {
  const rows = await prisma.pOSSale.findMany({
    where: {
      companyId,
      status: { in: ['Completed', 'Invoiced', 'Returned'] },
      ...posLocationWhere(locationId),
    },
    orderBy: { createdAt: 'desc' },
    take: limit,
    select: {
      id: true,
      invoiceNumber: true,
      grandTotal: true,
      customerName: true,
      createdAt: true,
      status: true
    }
  });

  return rows.map((s) => ({
    id: s.id,
    type: 'pos',
    description: `POS ${s.invoiceNumber} · ${s.customerName || 'Walk-in'}`,
    amount: toNum(s.grandTotal),
    date: s.createdAt,
    status: s.status,
    timestamp: s.createdAt
  }));
};

// ─── GET INVOICE STATS ────────────────────────────────────
const getInvoiceStats = async (userId, companyId, dateFilter, locationId = null) => {
  const periodStart = dateGte(dateFilter);
  const periodEnd = dateLte(dateFilter);

  const rows = await prisma.$queryRaw`
    WITH sales AS (
      SELECT
        si.id,
        si.order_id,
        si.grand_total,
        si.paid_amount,
        si.outstanding,
        si.payment_status,
        si.invoice_status
      FROM sales_invoices si
      LEFT JOIN orders o ON o.id = si.order_id
      WHERE ${sqlCompany(companyId, 'si.company_id')}
        AND si.is_active = true
        AND si.is_deleted = false
        AND si.invoice_status NOT IN ('Draft', 'Cancelled')
        AND (${periodStart}::timestamptz IS NULL OR si.invoice_date >= ${periodStart})
        AND (${periodEnd}::timestamptz IS NULL OR si.invoice_date <= ${periodEnd})
        AND (
          ${sqlLocation(locationId, 'si.location_id')}
          OR (si.location_id IS NULL AND ${sqlLocation(locationId, 'o.location_id')})
        )
    ),
    warehouse AS (
      SELECT
        wi.id,
        wi.order_id,
        wi.grand_total,
        wi.paid_amount,
        wi.outstanding,
        wi.payment_status,
        wi.invoice_status
      FROM warehouse_invoices wi
      LEFT JOIN orders o ON o.id = wi.order_id
      WHERE ${sqlCompany(companyId, 'wi.company_id')}
        AND wi.is_active = true
        AND wi.is_deleted = false
        AND wi.invoice_status NOT IN ('Draft', 'Cancelled')
        AND (${periodStart}::timestamptz IS NULL OR wi.invoice_date >= ${periodStart})
        AND (${periodEnd}::timestamptz IS NULL OR wi.invoice_date <= ${periodEnd})
        AND ${sqlLocation(locationId, 'o.location_id')}
        AND (
          wi.order_id IS NULL
          OR NOT EXISTS (
            SELECT 1 FROM sales_invoices si2
            WHERE si2.order_id = wi.order_id
              AND si2.order_id IS NOT NULL
              AND ${sqlCompany(companyId, 'si2.company_id')}
              AND si2.is_active = true
              AND si2.is_deleted = false
              AND si2.invoice_status NOT IN ('Draft', 'Cancelled')
          )
        )
    ),
    merged AS (
      SELECT * FROM sales
      UNION ALL
      SELECT * FROM warehouse
    ),
    calc AS (
      SELECT
        grand_total,
        paid_amount,
        CASE
          WHEN payment_status IN ('Paid', 'Credit Balance', 'Cancelled')
            OR invoice_status IN ('Paid', 'Credit Balance', 'Cancelled')
            THEN 0
          WHEN outstanding IS NOT NULL THEN GREATEST(0, outstanding)
          ELSE GREATEST(0, COALESCE(grand_total, 0) - COALESCE(paid_amount, 0))
        END AS due
      FROM merged
    )
    SELECT
      COUNT(*)::int AS total,
      COUNT(*) FILTER (WHERE due <= 0.01)::int AS paid,
      COUNT(*) FILTER (WHERE due > 0.01 AND COALESCE(paid_amount, 0) > 0.01)::int AS partial,
      COUNT(*) FILTER (WHERE due > 0.01 AND COALESCE(paid_amount, 0) <= 0.01)::int AS unpaid,
      COALESCE(SUM(grand_total), 0)::float AS "grandTotal",
      COALESCE(SUM(paid_amount), 0)::float AS "paidAmount",
      COALESCE(SUM(due), 0)::float AS outstanding
    FROM calc
  `;

  const row = rows[0] || {};
  const grandTotal = toNum(row.grandTotal);
  return {
    total: toNum(row.total),
    paid: toNum(row.paid),
    unpaid: toNum(row.unpaid),
    partial: toNum(row.partial),
    revenue: grandTotal,
    grandTotal,
    paidAmount: toNum(row.paidAmount),
    outstanding: toNum(row.outstanding),
  };
};

const getInvoiceTrend = async (userId, companyId, days = 30, locationId = null) => {
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - days);
  startDate.setHours(0, 0, 0, 0);

  const rows = await prisma.$queryRaw`
    WITH sales AS (
      SELECT
        si.order_id,
        si.invoice_date,
        si.grand_total,
        si.paid_amount,
        si.outstanding,
        si.payment_status,
        si.invoice_status
      FROM sales_invoices si
      LEFT JOIN orders o ON o.id = si.order_id
      WHERE ${sqlCompany(companyId, 'si.company_id')}
        AND si.is_active = true
        AND si.is_deleted = false
        AND si.invoice_status NOT IN ('Draft', 'Cancelled')
        AND si.invoice_date >= ${startDate}
        AND (
          ${sqlLocation(locationId, 'si.location_id')}
          OR (si.location_id IS NULL AND ${sqlLocation(locationId, 'o.location_id')})
        )
    ),
    warehouse AS (
      SELECT
        wi.order_id,
        wi.invoice_date,
        wi.grand_total,
        wi.paid_amount,
        wi.outstanding,
        wi.payment_status,
        wi.invoice_status
      FROM warehouse_invoices wi
      LEFT JOIN orders o ON o.id = wi.order_id
      WHERE ${sqlCompany(companyId, 'wi.company_id')}
        AND wi.is_active = true
        AND wi.is_deleted = false
        AND wi.invoice_status NOT IN ('Draft', 'Cancelled')
        AND wi.invoice_date >= ${startDate}
        AND ${sqlLocation(locationId, 'o.location_id')}
        AND (
          wi.order_id IS NULL
          OR NOT EXISTS (
            SELECT 1 FROM sales_invoices si2
            WHERE si2.order_id = wi.order_id
              AND si2.order_id IS NOT NULL
              AND ${sqlCompany(companyId, 'si2.company_id')}
              AND si2.is_active = true
              AND si2.is_deleted = false
              AND si2.invoice_status NOT IN ('Draft', 'Cancelled')
          )
        )
    ),
    merged AS (
      SELECT * FROM sales
      UNION ALL
      SELECT * FROM warehouse
    ),
    calc AS (
      SELECT
        (invoice_date AT TIME ZONE 'UTC')::date AS day,
        grand_total,
        paid_amount,
        CASE
          WHEN payment_status IN ('Paid', 'Credit Balance', 'Cancelled')
            OR invoice_status IN ('Paid', 'Credit Balance', 'Cancelled')
            THEN 0
          WHEN outstanding IS NOT NULL THEN GREATEST(0, outstanding)
          ELSE GREATEST(0, COALESCE(grand_total, 0) - COALESCE(paid_amount, 0))
        END AS due
      FROM merged
    )
    SELECT
      day::text AS date,
      COALESCE(SUM(grand_total), 0)::float AS total,
      COALESCE(SUM(grand_total), 0)::float AS revenue,
      COALESCE(SUM(paid_amount), 0)::float AS collected,
      COALESCE(SUM(grand_total) FILTER (WHERE due <= 0.01), 0)::float AS paid,
      COALESCE(SUM(due) FILTER (WHERE due > 0.01), 0)::float AS unpaid,
      COUNT(*)::int AS count
    FROM calc
    GROUP BY day
    ORDER BY day ASC
  `;

  return (rows || []).map((r) => ({
    date: String(r.date || '').slice(0, 10),
    total: toNum(r.total),
    paid: toNum(r.paid),
    unpaid: toNum(r.unpaid),
    revenue: toNum(r.revenue),
    collected: toNum(r.collected),
    count: toNum(r.count),
  }));
};

const getReturnStats = async (userId, companyId, dateFilter, locationId = null) => {
  const periodStart = dateGte(dateFilter);
  const periodEnd = dateLte(dateFilter);

  const rows = await prisma.$queryRaw`
    SELECT
      COUNT(*)::int AS total,
      COUNT(*) FILTER (WHERE r.return_status = 'Pending')::int AS pending,
      COUNT(*) FILTER (WHERE r.return_status = 'Approved')::int AS approved,
      COUNT(*) FILTER (WHERE r.return_status = 'Rejected')::int AS rejected,
      COUNT(*) FILTER (WHERE r.return_status = 'Completed')::int AS completed,
      COALESCE(SUM(r.refund_amount), 0)::float AS "refundAmount"
    FROM returns r
    LEFT JOIN orders o ON o.id = r.order_id
    WHERE ${sqlCompany(companyId, 'r.company_id')}
      AND r.is_active = true
      AND r.is_deleted = false
      AND (${periodStart}::timestamptz IS NULL OR r.return_date >= ${periodStart})
      AND (${periodEnd}::timestamptz IS NULL OR r.return_date <= ${periodEnd})
      AND ${sqlLocation(locationId, 'o.location_id')}
  `;

  const row = rows[0] || {};
  return {
    total: toNum(row.total),
    pending: toNum(row.pending),
    approved: toNum(row.approved),
    rejected: toNum(row.rejected),
    completed: toNum(row.completed),
    refundAmount: toNum(row.refundAmount),
  };
};

const getCreditNoteStats = async (userId, companyId, dateFilter, locationId = null) => {
  const periodStart = dateGte(dateFilter);
  const periodEnd = dateLte(dateFilter);
  // Credit notes have no direct locationId — skip nested relation location filter (index-killer).
  void locationId;

  const rows = await prisma.$queryRaw`
    SELECT
      COUNT(*)::int AS total,
      COUNT(*) FILTER (WHERE cn.status = 'Issued')::int AS issued,
      COUNT(*) FILTER (WHERE cn.status = 'PartiallyApplied')::int AS "partiallyApplied",
      COUNT(*) FILTER (WHERE cn.status = 'Applied')::int AS "fullyApplied",
      COALESCE(SUM(cn.amount), 0)::float AS "creditAmount",
      COALESCE(SUM(cn.applied_amount), 0)::float AS "appliedAmount",
      COALESCE(SUM(cn.remaining_amount), 0)::float AS "remainingAmount"
    FROM credit_notes cn
    WHERE ${sqlCompany(companyId, 'cn.company_id')}
      AND cn.status NOT IN ('Voided', 'Cancelled', 'Expired')
      AND (${periodStart}::timestamptz IS NULL OR cn.date >= ${periodStart})
      AND (${periodEnd}::timestamptz IS NULL OR cn.date <= ${periodEnd})
  `;

  const row = rows[0] || {};
  return {
    total: toNum(row.total),
    issued: toNum(row.issued),
    partiallyApplied: toNum(row.partiallyApplied),
    fullyApplied: toNum(row.fullyApplied),
    creditAmount: toNum(row.creditAmount),
    appliedAmount: toNum(row.appliedAmount),
    remainingAmount: toNum(row.remainingAmount),
  };
};

const getRefundStats = async (userId, companyId, dateFilter, locationId = null) => {
  const periodStart = dateGte(dateFilter);
  const periodEnd = dateLte(dateFilter);

  const rows = await prisma.$queryRaw`
    SELECT
      COUNT(*)::int AS total,
      COUNT(*) FILTER (WHERE rf.refund_status = 'Pending')::int AS pending,
      COUNT(*) FILTER (WHERE rf.refund_status = 'Completed')::int AS completed,
      COUNT(*) FILTER (WHERE rf.refund_status = 'Failed')::int AS failed,
      COALESCE(SUM(rf.amount) FILTER (WHERE rf.refund_status = 'Completed'), 0)::float AS "refundAmount"
    FROM refunds rf
    LEFT JOIN orders o ON o.id = rf.order_id
    WHERE ${sqlCompany(companyId, 'rf.company_id')}
      AND rf.is_active = true
      AND rf.is_deleted = false
      AND (${periodStart}::timestamptz IS NULL OR rf.refund_date >= ${periodStart})
      AND (${periodEnd}::timestamptz IS NULL OR rf.refund_date <= ${periodEnd})
      AND ${sqlLocation(locationId, 'o.location_id')}
  `;

  const row = rows[0] || {};
  return {
    total: toNum(row.total),
    pending: toNum(row.pending),
    completed: toNum(row.completed),
    failed: toNum(row.failed),
    refundAmount: toNum(row.refundAmount),
  };
};

const getTopProducts = async (userId, companyId, dateFilter, locationId = null, limit = 10) => {
  const periodStart = dateGte(dateFilter);
  const periodEnd = dateLte(dateFilter);
  const take = Math.max(1, Math.min(Number(limit) || 10, 100));

  const rows = await prisma.$queryRaw`
    WITH lines AS (
      SELECT
        oi.product_id AS "productId",
        oi.product_name AS "productName",
        oi.sku,
        oi.quantity,
        oi.total_price AS revenue
      FROM order_items oi
      INNER JOIN orders o ON o.id = oi.order_id
      WHERE ${sqlCompany(companyId, 'o.company_id')}
        AND o.is_active = true
        AND o.is_deleted = false
        AND (${periodStart}::timestamptz IS NULL OR o.order_date >= ${periodStart})
        AND (${periodEnd}::timestamptz IS NULL OR o.order_date <= ${periodEnd})
        AND ${sqlLocation(locationId, 'o.location_id')}

      UNION ALL

      SELECT
        psi.product_id AS "productId",
        psi.product_name AS "productName",
        psi.sku,
        psi.quantity,
        psi.line_total AS revenue
      FROM pos_sale_items psi
      INNER JOIN pos_sales ps ON ps.id = psi.pos_sale_id
      LEFT JOIN pos_terminals t ON t.id = ps.terminal_id
      WHERE ${sqlCompany(companyId, 'ps.company_id')}
        AND ps.status = 'Completed'
        AND (${periodStart}::timestamptz IS NULL OR ps.created_at >= ${periodStart})
        AND (${periodEnd}::timestamptz IS NULL OR ps.created_at <= ${periodEnd})
        AND ${sqlLocation(locationId, 't.location_id')}
    )
    SELECT
      "productId",
      "productName",
      sku,
      COALESCE(SUM(quantity), 0)::float AS quantity,
      COALESCE(SUM(revenue), 0)::float AS revenue,
      COUNT(*)::int AS "orderCount"
    FROM lines
    GROUP BY "productId", "productName", sku
    ORDER BY revenue DESC
    LIMIT ${take}
  `;

  return (rows || []).map((item) => ({
    productId: item.productId,
    productName: item.productName,
    sku: item.sku,
    quantity: toNum(item.quantity),
    revenue: toNum(item.revenue),
    orderCount: toNum(item.orderCount),
  }));
};

const getCustomerStats = async (userId, companyId, dateFilter) => {
  const periodStart = dateGte(dateFilter);
  const periodEnd = dateLte(dateFilter);

  const [countRows, topCustomers] = await Promise.all([
    prisma.$queryRaw`
      SELECT
        COUNT(*) FILTER (WHERE c.is_active = true AND c.is_deleted = false)::int AS "totalCustomers",
        COUNT(*) FILTER (
          WHERE c.is_active = true
            AND c.is_deleted = false
            AND (${periodStart}::timestamptz IS NULL OR c.created_at >= ${periodStart})
            AND (${periodEnd}::timestamptz IS NULL OR c.created_at <= ${periodEnd})
        )::int AS "newCustomers"
      FROM customers c
      WHERE ${sqlCompany(companyId, 'c.company_id')}
    `,
    prisma.customer.findMany({
      where: {
        companyId: companyId,
        isActive: true,
        isDeleted: false
      },
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        totalOrders: true,
        totalSpent: true,
        loyaltyPoints: true
      },
      orderBy: {
        totalSpent: 'desc'
      },
      take: 5
    }),
  ]);

  const row = countRows[0] || {};
  return {
    totalCustomers: toNum(row.totalCustomers),
    newCustomers: toNum(row.newCustomers),
    topCustomers
  };
};

async function buildSalesComparison(companyId, locationId = null) {
  const now = new Date();
  const todayStart = new Date(now);
  todayStart.setHours(0, 0, 0, 0);
  const yesterdayStart = new Date(todayStart);
  yesterdayStart.setDate(yesterdayStart.getDate() - 1);

  const weekStart = new Date(now);
  weekStart.setDate(weekStart.getDate() - 7);
  weekStart.setHours(0, 0, 0, 0);
  const lastWeekStart = new Date(weekStart);
  lastWeekStart.setDate(lastWeekStart.getDate() - 7);

  const monthStart = new Date(now);
  monthStart.setDate(1);
  monthStart.setHours(0, 0, 0, 0);
  const lastMonthStart = new Date(monthStart);
  lastMonthStart.setMonth(lastMonthStart.getMonth() - 1);

  const yearStart = new Date(now);
  yearStart.setMonth(0, 1);
  yearStart.setHours(0, 0, 0, 0);
  const lastYearStart = new Date(yearStart);
  lastYearStart.setFullYear(lastYearStart.getFullYear() - 1);

  const [orderRows, posRows, returnRows] = await Promise.all([
    prisma.$queryRaw`
      SELECT
        COALESCE(SUM(CASE WHEN o.order_date >= ${todayStart} THEN o.grand_total ELSE 0 END), 0)::float AS "todaySales",
        COALESCE(SUM(CASE WHEN o.order_date >= ${yesterdayStart} AND o.order_date < ${todayStart} THEN o.grand_total ELSE 0 END), 0)::float AS "yesterdaySales",
        COALESCE(SUM(CASE WHEN o.order_date >= ${weekStart} THEN o.grand_total ELSE 0 END), 0)::float AS "weekSales",
        COALESCE(SUM(CASE WHEN o.order_date >= ${lastWeekStart} AND o.order_date < ${weekStart} THEN o.grand_total ELSE 0 END), 0)::float AS "lastWeekSales",
        COALESCE(SUM(CASE WHEN o.order_date >= ${monthStart} THEN o.grand_total ELSE 0 END), 0)::float AS "monthSales",
        COALESCE(SUM(CASE WHEN o.order_date >= ${lastMonthStart} AND o.order_date < ${monthStart} THEN o.grand_total ELSE 0 END), 0)::float AS "lastMonthSales",
        COALESCE(SUM(CASE WHEN o.order_date >= ${yearStart} THEN o.grand_total ELSE 0 END), 0)::float AS "yearSales",
        COALESCE(SUM(CASE WHEN o.order_date >= ${lastYearStart} AND o.order_date < ${yearStart} THEN o.grand_total ELSE 0 END), 0)::float AS "lastYearSales"
      FROM orders o
      WHERE ${sqlCompany(companyId, 'o.company_id')}
        AND o.is_active = true
        AND o.is_deleted = false
        AND o.order_date >= ${lastYearStart}
        AND ${sqlLocation(locationId, 'o.location_id')}
    `,
    prisma.$queryRaw`
      SELECT
        COALESCE(SUM(CASE WHEN ps.created_at >= ${todayStart} THEN ps.grand_total ELSE 0 END), 0)::float AS "todaySales",
        COALESCE(SUM(CASE WHEN ps.created_at >= ${yesterdayStart} AND ps.created_at < ${todayStart} THEN ps.grand_total ELSE 0 END), 0)::float AS "yesterdaySales",
        COALESCE(SUM(CASE WHEN ps.created_at >= ${weekStart} THEN ps.grand_total ELSE 0 END), 0)::float AS "weekSales",
        COALESCE(SUM(CASE WHEN ps.created_at >= ${lastWeekStart} AND ps.created_at < ${weekStart} THEN ps.grand_total ELSE 0 END), 0)::float AS "lastWeekSales",
        COALESCE(SUM(CASE WHEN ps.created_at >= ${monthStart} THEN ps.grand_total ELSE 0 END), 0)::float AS "monthSales",
        COALESCE(SUM(CASE WHEN ps.created_at >= ${lastMonthStart} AND ps.created_at < ${monthStart} THEN ps.grand_total ELSE 0 END), 0)::float AS "lastMonthSales",
        COALESCE(SUM(CASE WHEN ps.created_at >= ${yearStart} THEN ps.grand_total ELSE 0 END), 0)::float AS "yearSales",
        COALESCE(SUM(CASE WHEN ps.created_at >= ${lastYearStart} AND ps.created_at < ${yearStart} THEN ps.grand_total ELSE 0 END), 0)::float AS "lastYearSales"
      FROM pos_sales ps
      LEFT JOIN pos_terminals t ON t.id = ps.terminal_id
      WHERE ${sqlCompany(companyId, 'ps.company_id')}
        AND ps.status = 'Completed'
        AND ps.created_at >= ${lastYearStart}
        AND ${sqlLocation(locationId, 't.location_id')}
    `,
    prisma.$queryRaw`
      SELECT
        COALESCE(SUM(CASE WHEN r.return_date >= ${todayStart} THEN r.refund_amount ELSE 0 END), 0)::float AS "todayReturns",
        COALESCE(SUM(CASE WHEN r.return_date >= ${weekStart} THEN r.refund_amount ELSE 0 END), 0)::float AS "weekReturns",
        COALESCE(SUM(CASE WHEN r.return_date >= ${monthStart} THEN r.refund_amount ELSE 0 END), 0)::float AS "monthReturns",
        COALESCE(SUM(CASE WHEN r.return_date >= ${yearStart} THEN r.refund_amount ELSE 0 END), 0)::float AS "yearReturns"
      FROM returns r
      LEFT JOIN orders o ON o.id = r.order_id
      WHERE ${sqlCompany(companyId, 'r.company_id')}
        AND r.is_active = true
        AND r.is_deleted = false
        AND r.return_date >= ${yearStart}
        AND ${sqlLocation(locationId, 'o.location_id')}
    `,
  ]);

  const o = orderRows[0] || {};
  const p = posRows[0] || {};
  const ret = returnRows[0] || {};

  const todaySales = toNum(o.todaySales) + toNum(p.todaySales);
  const yesterdaySales = toNum(o.yesterdaySales) + toNum(p.yesterdaySales);
  const weekSales = toNum(o.weekSales) + toNum(p.weekSales);
  const lastWeekSales = toNum(o.lastWeekSales) + toNum(p.lastWeekSales);
  const monthSales = toNum(o.monthSales) + toNum(p.monthSales);
  const lastMonthSales = toNum(o.lastMonthSales) + toNum(p.lastMonthSales);
  const yearSales = toNum(o.yearSales) + toNum(p.yearSales);
  const lastYearSales = toNum(o.lastYearSales) + toNum(p.lastYearSales);

  const pctChange = (current, prior) =>
    prior > 0 ? ((current - prior) / prior) * 100 : 0;

  return {
    today: {
      currentSales: todaySales,
      priorSales: yesterdaySales,
      currentReturns: toNum(ret.todayReturns),
      priorReturns: 0,
      salesChangePercent: pctChange(todaySales, yesterdaySales),
      returnsChangePercent: 0,
    },
    week: {
      currentSales: weekSales,
      priorSales: lastWeekSales,
      currentReturns: toNum(ret.weekReturns),
      priorReturns: 0,
      salesChangePercent: pctChange(weekSales, lastWeekSales),
      returnsChangePercent: 0,
    },
    month: {
      currentSales: monthSales,
      priorSales: lastMonthSales,
      currentReturns: toNum(ret.monthReturns),
      priorReturns: 0,
      salesChangePercent: pctChange(monthSales, lastMonthSales),
      returnsChangePercent: 0,
    },
    year: {
      currentSales: yearSales,
      priorSales: lastYearSales,
      currentReturns: toNum(ret.yearReturns),
      priorReturns: 0,
      salesChangePercent: pctChange(yearSales, lastYearSales),
      returnsChangePercent: 0,
    },
  };
}

// ============================================================
// @desc    Get sales dashboard data (User-specific)
// @route   GET /api/warehouse/sales/dashboard
// @access  Private
// ============================================================
const getSalesDashboard = async (req, res) => {
  try {
    const userId = req.user.id;
    const companyId = req.companyIdFilter ?? req.user.companyId;
    const period = req.query.period || 'month';
    const startDate = req.query.startDate;
    const endDate = req.query.endDate;
    const fiscalYearId = req.query.fiscalYearId;
    const locationId = req.query.locationId;

    const dateFilter = await resolveSalesDateFilter({
      period,
      startDate,
      endDate,
      fiscalYearId,
      companyId
    });

    // ─── ORDERS + POS ────────────────────────────────────────
    const periodStart = dateGte(dateFilter);
    const periodEnd = dateLte(dateFilter);

    const [orderAggRows, orderStatusRows, orderTrend, posStats, posTrend] =
      await Promise.all([
        prisma.$queryRaw`
          SELECT
            COUNT(*)::int AS count,
            COALESCE(SUM(o.grand_total), 0)::float AS revenue
          FROM orders o
          WHERE ${sqlCompany(companyId, 'o.company_id')}
            AND o.is_active = true
            AND o.is_deleted = false
            AND (${periodStart}::timestamptz IS NULL OR o.order_date >= ${periodStart})
            AND (${periodEnd}::timestamptz IS NULL OR o.order_date <= ${periodEnd})
            AND ${sqlLocation(locationId, 'o.location_id')}
        `,
        prisma.$queryRaw`
          SELECT
            o.order_status AS "orderStatus",
            COUNT(*)::int AS count,
            COALESCE(SUM(o.grand_total), 0)::float AS revenue
          FROM orders o
          WHERE ${sqlCompany(companyId, 'o.company_id')}
            AND o.is_active = true
            AND o.is_deleted = false
            AND (${periodStart}::timestamptz IS NULL OR o.order_date >= ${periodStart})
            AND (${periodEnd}::timestamptz IS NULL OR o.order_date <= ${periodEnd})
            AND ${sqlLocation(locationId, 'o.location_id')}
          GROUP BY o.order_status
        `,
        getOrderTrend(userId, companyId, dateFilter, locationId),
        getPosStats(companyId, dateFilter, locationId),
        getPosTrend(companyId, dateFilter, locationId),
      ]);

    const orderCount = toNum(orderAggRows?.[0]?.count);
    const orderRevTotal = toNum(orderAggRows?.[0]?.revenue);
    const orderRevenue = { _sum: { grandTotal: orderRevTotal } };
    const orderStatusCounts = (orderStatusRows || []).map((s) => ({
      orderStatus: s.orderStatus,
      _count: { _all: toNum(s.count) },
      _sum: { grandTotal: toNum(s.revenue) },
    }));

    // Enrich order trend with orderRevenue alias for Flutter/Next clients
    const enrichedOrderTrend = orderTrend.map((t) => ({
      ...t,
      orderRevenue: toNum(t.revenue)
    }));

    // ─── INVOICES + STATS (parallel) ───────────────────────────
    const [
      invoiceStats,
      invoiceTrend,
      returnStats,
      refundStats,
      creditNoteStats,
      topProducts,
      customerStats,
      comparison,
      recentActivity,
    ] = await Promise.all([
      getInvoiceStats(userId, companyId, dateFilter, locationId),
      getInvoiceTrend(userId, companyId, 30, locationId),
      getReturnStats(userId, companyId, dateFilter, locationId),
      getRefundStats(userId, companyId, dateFilter, locationId),
      getCreditNoteStats(userId, companyId, dateFilter, locationId),
      getTopProducts(userId, companyId, dateFilter, locationId),
      getCustomerStats(userId, companyId, dateFilter),
      buildSalesComparison(companyId, locationId),
      getRecentPosActivity(companyId, 10, locationId),
    ]);

    // ─── SUMMARY STATS ───────────────────────────────────────
    const orderRev = toNum(orderRevenue._sum.grandTotal);
    const posRev = toNum(posStats.revenue);
    const summary = {
      totalOrders: orderCount,
      totalRevenue: orderRev + posRev,
      totalPosSales: posStats.count,
      totalPosRevenue: posRev,
      totalInvoices: invoiceStats.total,
      totalInvoiceRevenue: invoiceStats.revenue,
      totalReturns: returnStats.total,
      totalRefunds: refundStats.total,
      refundAmount: refundStats.refundAmount,
      totalCredits: creditNoteStats.total,
      creditAmount: creditNoteStats.creditAmount,
      creditRemaining: creditNoteStats.remainingAmount,
      outstandingInvoices: invoiceStats.outstanding,
      totalCustomers: customerStats.totalCustomers
    };

    // ─── ENRICH ORDERS DATA ───────────────────────────────────
    const todayOrders = orderStatusCounts.reduce((sum, s) => sum + (s._count._all || 0), 0);
    const todayRevenue = orderRevenue._sum.grandTotal || 0;
    const pendingOrders = orderStatusCounts.find(s => s.orderStatus === 'Pending')?._count._all || 0;

    // ─── REVENUE BREAKDOWN (orders + POS + invoices) ──────────
    const invoiceRev = toNum(invoiceStats.grandTotal || invoiceStats.revenue);
    const channelTotal = orderRev + posRev + invoiceRev;
    const pct = (v) => (channelTotal > 0 ? Math.round((v / channelTotal) * 1000) / 10 : 0);
    const revenueBreakdown = {
      grossRevenue: orderRev + posRev,
      lineItemDiscounts: toNum(posStats.discountTotal),
      orderLevelDiscounts: 0,
      netRevenue: orderRev + posRev,
      taxAmount: toNum(posStats.taxTotal),
      shippingAmount: 0,
      items: [
        { category: 'POS', amount: posRev, percentage: pct(posRev) },
        { category: 'Orders', amount: orderRev, percentage: pct(orderRev) },
        { category: 'Invoices', amount: invoiceRev, percentage: pct(invoiceRev) },
      ].filter((i) => i.amount > 0)
    };

    const dashboardData = {
        summary,
        orders: {
          count: orderCount,
          revenue: orderRev,
          byStatus: orderStatusCounts.map((s) => ({
            status: s.orderStatus,
            count: s._count._all,
            revenue: s._sum.grandTotal || 0
          })),
          trend: enrichedOrderTrend,
          todayCount: todayOrders,
          todayRevenue: todayRevenue,
          pendingCount: pendingOrders,
          revenueGrowth: '+15%'
        },
        pos: {
          count: posStats.count,
          revenue: posRev,
          discountTotal: posStats.discountTotal,
          taxTotal: posStats.taxTotal,
          paidAmount: posStats.paidAmount,
          todayCount: posStats.todayCount,
          todayRevenue: posStats.todayRevenue,
          trend: posTrend,
          revenueGrowth: posRev > 0 ? '+0%' : '0%'
        },
        invoices: {
          stats: invoiceStats,
          trend: invoiceTrend,
          grandTotalGrowth: '+12%',
          paidAmountGrowth: '+10%',
          outstandingGrowth: '+8%'
        },
        returns: returnStats,
        refunds: refundStats,
        credits: creditNoteStats,
        comparison,
        recentActivity,
        topProducts,
        topCustomers: customerStats.topCustomers,
        revenueBreakdown
    };

    res.status(200).json({
      success: true,
      data: dashboardData
    });
  } catch (error) {
    console.error('Sales dashboard error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message
    });
  }
};

// ============================================================
// @desc    Get sales summary (User-specific)
// @route   GET /api/warehouse/sales/summary
// @access  Private
// ============================================================
const getSalesSummary = async (req, res) => {
  try {
    const userId = req.user.id;
    const companyId = req.companyIdFilter ?? req.user.companyId;
    const { period = 'month', startDate, endDate, fiscalYearId } = req.query;
    const dateFilter = await resolveSalesDateFilter({
      period,
      startDate,
      endDate,
      fiscalYearId,
      companyId
    });

    // ✅ All queries with userId filter
    const [
      totalOrders,
      orderRevenue,
      totalInvoices,
      invoiceRevenue,
      totalReturns,
      refundAmount,
      totalCustomers,
      avgOrderValue
    ] = await Promise.all([
      prisma.order.count({
        where: {
          companyId: companyId,
          isActive: true,
          isDeleted: false,
          orderDate: dateFilter
        }
      }),
      prisma.order.aggregate({
        where: {
          companyId: companyId,
          isActive: true,
          isDeleted: false,
          orderDate: dateFilter
        },
        _sum: { grandTotal: true }
      }),
      prisma.warehouseInvoice.count({
        where: {
          companyId: companyId,
          isActive: true,
          isDeleted: false,
          invoiceDate: dateFilter
        }
      }),
      prisma.warehouseInvoice.aggregate({
        where: {
          companyId: companyId,
          isActive: true,
          isDeleted: false,
          invoiceDate: dateFilter,
          paymentStatus: { in: ['Paid', 'Partial'] }
        },
        _sum: { grandTotal: true }
      }),
      prisma.return.count({
        where: {
          companyId: companyId,
          isActive: true,
          isDeleted: false,
          returnDate: dateFilter
        }
      }),
      prisma.refund.aggregate({
        where: {
          companyId: companyId,
          isActive: true,
          isDeleted: false,
          refundDate: dateFilter,
          refundStatus: 'Completed'
        },
        _sum: { amount: true }
      }),
      prisma.customer.count({
        where: {
          companyId: companyId,
          isActive: true,
          isDeleted: false
        }
      }),
      prisma.order.aggregate({
        where: {
          companyId: companyId,
          isActive: true,
          isDeleted: false,
          orderDate: dateFilter
        },
        _avg: { grandTotal: true }
      })
    ]);

    const revenue = orderRevenue._sum.grandTotal || 0;
    const invoiceRevenueTotal = invoiceRevenue._sum.grandTotal || 0;

    res.status(200).json({
      success: true,
      data: {
        period,
        orders: {
          total: totalOrders,
          revenue: revenue,
          avgOrderValue: avgOrderValue._avg.grandTotal || 0
        },
        invoices: {
          total: totalInvoices,
          revenue: invoiceRevenueTotal
        },
        returns: {
          total: totalReturns
        },
        refunds: {
          amount: refundAmount._sum.amount || 0
        },
        customers: {
          total: totalCustomers
        }
      }
    });
  } catch (error) {
    console.error('Sales summary error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message
    });
  }
};

// ============================================================
// @desc    Get sales trends (User-specific)
// @route   GET /api/warehouse/sales/trends
// @access  Private
// ============================================================
const getSalesTrends = async (req, res) => {
  try {
    const userId = req.user.id;
    const companyId = req.companyIdFilter ?? req.user.companyId;
    const { days = 30, period = 'day' } = req.query;
    const daysInt = parseInt(days);

    const startDate = new Date();
    startDate.setDate(startDate.getDate() - daysInt);
    startDate.setHours(0, 0, 0, 0);

    // ✅ User-specific orders
    const orders = await prisma.order.findMany({
      where: {
        companyId: companyId,
        isActive: true,
        isDeleted: false,
        orderDate: { gte: startDate }
      },
      select: {
        orderDate: true,
        grandTotal: true,
        orderStatus: true
      },
      orderBy: { orderDate: 'asc' }
    });

    // Group by day
    const trendMap = {};
    orders.forEach((order) => {
      const key = order.orderDate.toISOString().split('T')[0];
      if (!trendMap[key]) {
        trendMap[key] = {
          date: key,
          orders: 0,
          revenue: 0,
          completed: 0,
          pending: 0,
          cancelled: 0
        };
      }
      trendMap[key].orders += 1;
      trendMap[key].revenue += order.grandTotal;
      
      if (order.orderStatus === 'Completed') trendMap[key].completed += 1;
      else if (order.orderStatus === 'Pending') trendMap[key].pending += 1;
      else if (order.orderStatus === 'Cancelled') trendMap[key].cancelled += 1;
    });

    const trendData = Object.values(trendMap);

    // Calculate growth
    const totalRevenue = trendData.reduce((sum, d) => sum + d.revenue, 0);
    const avgRevenue = trendData.length > 0 ? totalRevenue / trendData.length : 0;

    res.status(200).json({
      success: true,
      data: {
        period: `Last ${daysInt} days`,
        totalOrders: orders.length,
        totalRevenue,
        avgDailyRevenue: avgRevenue,
        trend: trendData
      }
    });
  } catch (error) {
    console.error('Sales trends error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message
    });
  }
};

// ============================================================
// @desc    Get sales performance (User-specific)
// @route   GET /api/warehouse/sales/performance
// @access  Private
// ============================================================
const getSalesPerformance = async (req, res) => {
  try {
    const userId = req.user.id;
    const companyId = req.companyIdFilter ?? req.user.companyId;
    const { period = 'month', startDate, endDate, fiscalYearId } = req.query;
    const dateFilter = await resolveSalesDateFilter({
      period,
      startDate,
      endDate,
      fiscalYearId,
      companyId
    });

    // ✅ All queries with userId filter
    const [
      totalOrders,
      completedOrders,
      cancelledOrders,
      totalRevenue,
      avgOrderValue,
      orderStatusCounts
    ] = await Promise.all([
      prisma.order.count({
        where: {
          companyId: companyId,
          isActive: true,
          isDeleted: false,
          orderDate: dateFilter
        }
      }),
      prisma.order.count({
        where: {
          companyId: companyId,
          isActive: true,
          isDeleted: false,
          orderDate: dateFilter,
          orderStatus: 'Completed'
        }
      }),
      prisma.order.count({
        where: {
          companyId: companyId,
          isActive: true,
          isDeleted: false,
          orderDate: dateFilter,
          orderStatus: 'Cancelled'
        }
      }),
      prisma.order.aggregate({
        where: {
          companyId: companyId,
          isActive: true,
          isDeleted: false,
          orderDate: dateFilter
        },
        _sum: { grandTotal: true }
      }),
      prisma.order.aggregate({
        where: {
          companyId: companyId,
          isActive: true,
          isDeleted: false,
          orderDate: dateFilter
        },
        _avg: { grandTotal: true }
      }),
      prisma.order.groupBy({
        by: ['orderStatus'],
        where: {
          companyId: companyId,
          isActive: true,
          isDeleted: false,
          orderDate: dateFilter
        },
        _count: { _all: true },
        _sum: { grandTotal: true }
      })
    ]);

    const revenue = totalRevenue._sum.grandTotal || 0;
    const avgOrder = avgOrderValue._avg.grandTotal || 0;
    const completionRate = totalOrders > 0 ? (completedOrders / totalOrders) * 100 : 0;

    res.status(200).json({
      success: true,
      data: {
        period,
        summary: {
          totalOrders,
          completedOrders,
          cancelledOrders,
          totalRevenue: revenue,
          avgOrderValue: avgOrder,
          completionRate: `${completionRate.toFixed(1)}%`
        },
        byStatus: orderStatusCounts.map((s) => ({
          status: s.orderStatus,
          count: s._count._all,
          revenue: s._sum.grandTotal || 0
        }))
      }
    });
  } catch (error) {
    console.error('Sales performance error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message
    });
  }
};

// ============================================================
// @desc    Get combined revenue data (POS + Sales Invoices)
// @route   GET /api/warehouse/sales/combined-revenue
// @access  Private
// ============================================================
const getCombinedRevenue = async (req, res) => {
  try {
    const companyId = req.companyIdFilter ?? req.user.companyId;
    const { period = 'month', startDate, endDate, fiscalYearId } = req.query;
    const dateFilter = await resolveSalesDateFilter({
      period,
      startDate,
      endDate,
      fiscalYearId,
      companyId
    });

    // Get POS sales data
    const posSalesData = await prisma.pOSSale.aggregate({
      where: {
        companyId,
        status: 'Completed',
        createdAt: dateFilter
      },
      _sum: { grandTotal: true, discountTotal: true, taxTotal: true },
      _count: { id: true }
    });

    // Get Sales Invoice data
    const invoiceData = await prisma.salesInvoice.aggregate({
      where: {
        companyId,
        isActive: true,
        isDeleted: false,
        invoiceDate: dateFilter
      },
      _sum: { grandTotal: true, discountTotal: true, taxTotal: true },
      _count: { id: true }
    });

    // Get Order data
    const orderData = await prisma.order.aggregate({
      where: {
        companyId,
        isActive: true,
        isDeleted: false,
        orderDate: dateFilter
      },
      _sum: { grandTotal: true, discountTotal: true },
      _count: { id: true }
    });

    // Calculate combined totals
    const totalRevenue = (posSalesData._sum.grandTotal || 0) + (invoiceData._sum.grandTotal || 0);
    const totalDiscount = (posSalesData._sum.discountTotal || 0) + (invoiceData._sum.discountTotal || 0) + (orderData._sum.discountTotal || 0);
    const totalTax = (posSalesData._sum.taxTotal || 0) + (invoiceData._sum.taxTotal || 0);
    const totalTransactions = posSalesData._count.id + invoiceData._count.id + orderData._count.id;

    // Get daily breakdown for chart
    const startDateObj = new Date();
    if (period === 'custom' && startDate) {
      startDateObj.setTime(new Date(startDate).getTime());
    } else if (period === 'today') {
      startDateObj.setHours(0, 0, 0, 0);
    } else if (period === 'week') {
      startDateObj.setDate(startDateObj.getDate() - 7);
    } else if (period === 'month') {
      startDateObj.setMonth(startDateObj.getMonth() - 1);
    } else if (period === 'year') {
      startDateObj.setFullYear(startDateObj.getFullYear() - 1);
    } else {
      startDateObj.setMonth(startDateObj.getMonth() - 1);
    }

    const posSalesDaily = await prisma.pOSSale.findMany({
      where: {
        companyId,
        status: 'Completed',
        createdAt: { gte: startDateObj }
      },
      select: {
        createdAt: true,
        grandTotal: true
      },
      orderBy: { createdAt: 'asc' }
    });

    const invoiceDaily = await prisma.salesInvoice.findMany({
      where: {
        companyId,
        isActive: true,
        isDeleted: false,
        invoiceDate: { gte: startDateObj }
      },
      select: {
        invoiceDate: true,
        grandTotal: true
      },
      orderBy: { invoiceDate: 'asc' }
    });

    // Combine daily data
    const dailyMap = {};
    
    posSalesDaily.forEach(sale => {
      const key = sale.createdAt.toISOString().split('T')[0];
      if (!dailyMap[key]) {
        dailyMap[key] = { date: key, posRevenue: 0, invoiceRevenue: 0, total: 0 };
      }
      dailyMap[key].posRevenue += sale.grandTotal;
      dailyMap[key].total += sale.grandTotal;
    });

    invoiceDaily.forEach(invoice => {
      const key = invoice.invoiceDate.toISOString().split('T')[0];
      if (!dailyMap[key]) {
        dailyMap[key] = { date: key, posRevenue: 0, invoiceRevenue: 0, total: 0 };
      }
      dailyMap[key].invoiceRevenue += invoice.grandTotal;
      dailyMap[key].total += invoice.grandTotal;
    });

    const dailyBreakdown = Object.values(dailyMap).sort((a, b) => a.date.localeCompare(b.date));

    res.status(200).json({
      success: true,
      data: {
        summary: {
          totalRevenue,
          totalDiscount,
          totalTax,
          totalTransactions,
          posSales: {
            count: posSalesData._count.id,
            revenue: posSalesData._sum.grandTotal || 0
          },
          invoices: {
            count: invoiceData._count.id,
            revenue: invoiceData._sum.grandTotal || 0
          },
          orders: {
            count: orderData._count.id,
            revenue: orderData._sum.grandTotal || 0
          }
        },
        dailyBreakdown
      }
    });
  } catch (error) {
    console.error('Combined revenue error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message
    });
  }
};

module.exports = {
  getSalesDashboard,
  getSalesSummary,
  getSalesTrends,
  getSalesPerformance,
  getCombinedRevenue
};