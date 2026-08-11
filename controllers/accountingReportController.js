// controllers/accountingReportController.js
const prisma = require('../prisma/client');

function toNum(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function getDateFilter(period, startDate, endDate) {
  if (period === 'custom' && startDate && endDate) {
    const start = new Date(startDate);
    const end = new Date(endDate);
    end.setHours(23, 59, 59, 999);
    return { gte: start, lte: end };
  }

  const now = new Date();
  const start = new Date(now);

  if (period === 'today') {
    start.setHours(0, 0, 0, 0);
  } else if (period === 'week') {
    start.setDate(start.getDate() - 7);
    start.setHours(0, 0, 0, 0);
  } else if (period === 'month') {
    start.setMonth(start.getMonth() - 1);
    start.setHours(0, 0, 0, 0);
  } else if (period === 'year') {
    start.setFullYear(start.getFullYear() - 1);
    start.setHours(0, 0, 0, 0);
  } else {
    start.setMonth(start.getMonth() - 1);
    start.setHours(0, 0, 0, 0);
  }

  return { gte: start };
}

function detectChannel(entry) {
  if (entry.salesInvoice || entry.salesPayment) return 'invoices';
  if (entry.PurchaseInvoice || entry.purchasePayment || entry.purchaseReturn) return 'bills';
  if (entry.posSale || entry.posReturn) return 'pos';
  if (entry.transaction) return 'transfers';
  const t = String(entry.type || '').toLowerCase();
  if (t.includes('expense')) return 'expenses';
  if (t.includes('income') || t.includes('revenue')) return 'income';
  if (t.includes('payment')) return 'payments';
  return 'journals';
}

function emptySummary() {
  return {
    count: 0,
    debitTotal: 0,
    creditTotal: 0,
    grandTotal: 0,
    postedCount: 0,
    draftCount: 0,
    byChannel: {
      journals: { count: 0, debitTotal: 0, creditTotal: 0 },
      invoices: { count: 0, debitTotal: 0, creditTotal: 0 },
      bills: { count: 0, debitTotal: 0, creditTotal: 0 },
      expenses: { count: 0, debitTotal: 0, creditTotal: 0 },
      income: { count: 0, debitTotal: 0, creditTotal: 0 },
      payments: { count: 0, debitTotal: 0, creditTotal: 0 },
      pos: { count: 0, debitTotal: 0, creditTotal: 0 },
      transfers: { count: 0, debitTotal: 0, creditTotal: 0 },
    },
  };
}

function mapEntry(entry) {
  const debit = (entry.lines || []).reduce((s, l) => s + toNum(l.debit), 0);
  const credit = (entry.lines || []).reduce((s, l) => s + toNum(l.credit), 0);
  const channel = detectChannel(entry);
  return {
    id: entry.id,
    channel,
    reference: entry.entryNumber || entry.reference || '',
    date: entry.date,
    description: entry.description || '',
    partyName: entry.description || entry.reference || '—',
    status: entry.status || 'Draft',
    type: entry.type || 'Normal',
    debit,
    credit,
    grandTotal: Math.max(debit, credit),
  };
}

// GET /api/accounting/reports
const getAccountingReports = async (req, res) => {
  try {
    const companyId = req.user.companyId;
    if (!companyId) {
      return res.status(400).json({ success: false, message: 'Company required' });
    }

    const {
      channel = 'all',
      period = 'month',
      status = 'all',
      search = '',
      startDate,
      endDate,
      page = 1,
      limit = 50,
    } = req.query;

    const dateFilter = getDateFilter(period, startDate, endDate);
    const take = Math.min(Math.max(parseInt(limit, 10) || 50, 1), 2000);
    const pageNum = Math.max(parseInt(page, 10) || 1, 1);

    const where = {
      companyId,
      date: dateFilter,
    };

    if (status && status !== 'all') {
      where.status = String(status);
    }

    if (search && String(search).trim()) {
      const q = String(search).trim();
      where.OR = [
        { entryNumber: { contains: q, mode: 'insensitive' } },
        { description: { contains: q, mode: 'insensitive' } },
        { reference: { contains: q, mode: 'insensitive' } },
      ];
    }

    const entries = await prisma.journalEntry.findMany({
      where,
      orderBy: { date: 'desc' },
      include: {
        lines: true,
        salesInvoice: { select: { id: true } },
        salesPayment: { select: { id: true } },
        PurchaseInvoice: { select: { id: true } },
        purchasePayment: { select: { id: true } },
        purchaseReturn: { select: { id: true } },
        posSale: { select: { id: true } },
        posReturn: { select: { id: true } },
        transaction: { select: { id: true } },
      },
    });

    let rows = entries.map(mapEntry);

    if (channel && channel !== 'all') {
      rows = rows.filter((r) => r.channel === channel);
    }

    const summary = emptySummary();
    for (const row of rows) {
      summary.count += 1;
      summary.debitTotal += row.debit;
      summary.creditTotal += row.credit;
      summary.grandTotal += row.grandTotal;
      if (row.status === 'Posted') summary.postedCount += 1;
      else summary.draftCount += 1;

      const bucket = summary.byChannel[row.channel] || summary.byChannel.journals;
      bucket.count += 1;
      bucket.debitTotal += row.debit;
      bucket.creditTotal += row.credit;
    }

    const total = rows.length;
    const totalPages = Math.max(1, Math.ceil(total / take));
    const skip = (pageNum - 1) * take;
    const paged = rows.slice(skip, skip + take);

    res.status(200).json({
      success: true,
      data: {
        filters: {
          channel,
          period,
          startDate: startDate || null,
          endDate: endDate || null,
          status,
          search: search || '',
        },
        summary,
        rows: paged,
        pagination: {
          page: pageNum,
          limit: take,
          total,
          totalPages,
        },
      },
    });
  } catch (error) {
    console.error('getAccountingReports error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

module.exports = { getAccountingReports };
