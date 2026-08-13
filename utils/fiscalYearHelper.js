// utils/fiscalYearHelper.js
// Helper functions for fiscal year resolution and date range extraction.
// Four exported functions — no cross-calling dependencies — so future
// FiscalPeriod helpers can be added alongside these without modifying them.

const prisma = require('../prisma/client');

/**
 * Resolves the fiscalYearId for a given userId and postingDate.
 *
 * Queries FiscalYear where: userId matches, startDate <= postingDate <= endDate.
 * Returns the id string, or null if not found or on any DB error.
 * NEVER throws — swallows all errors and returns null (Req 2.4, 2.5).
 *
 * @param {string} userId
 * @param {Date|string} postingDate
 * @param {object|null} cachedFiscalYear - Optional cached FiscalYear object (Req A4)
 * @returns {Promise<string|null>}
 */
async function resolveFiscalYearId(userId, postingDate, cachedFiscalYear = null) {
  try {
    const date = new Date(postingDate);

    // Use cached fiscal year if provided and date falls within its range
    if (cachedFiscalYear) {
      const startDate = new Date(cachedFiscalYear.startDate);
      const endDate = new Date(cachedFiscalYear.endDate);
      if (date >= startDate && date <= endDate) {
        return cachedFiscalYear.id;
      }
    }

    // FiscalYear is scoped by companyId — resolve via user.companyId
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { companyId: true }
    });
    const companyId = user?.companyId || cachedFiscalYear?.companyId || null;
    if (!companyId) return null;

    const fiscalYear = await prisma.fiscalYear.findFirst({
      where: {
        companyId,
        startDate: { lte: date },
        endDate: { gte: date }
      }
    });
    return fiscalYear ? fiscalYear.id : null;
  } catch {
    return null;
  }
}

/**
 * Returns { startDate, endDate } from a FiscalYear record.
 * Pure function — no DB calls.
 *
 * @param {{ startDate: Date|string, endDate: Date|string }} fiscalYear
 * @returns {{ startDate: Date, endDate: Date }}
 */
function getFiscalYearDateRange(fiscalYear) {
  return {
    startDate: new Date(fiscalYear.startDate),
    endDate:   new Date(fiscalYear.endDate)
  };
}

/**
 * Returns the single Open FiscalYear where startDate <= now <= endDate for userId.
 * Returns null if none found. Never throws.
 *
 * @param {string} userId
 * @returns {Promise<object|null>}
 */
async function lookupActiveFiscalYear(userId) {
  try {
    const now = new Date();
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { companyId: true }
    });
    if (!user?.companyId) return null;

    return await prisma.fiscalYear.findFirst({
      where: {
        companyId: user.companyId,
        status: 'Open',
        startDate: { lte: now },
        endDate: { gte: now }
      }
    });
  } catch {
    return null;
  }
}

/**
 * Resolves the effective date range for report filtering.
 *
 * Priority (Req 8.2–8.4):
 *   1. fiscalYearId provided  → look up that FiscalYear scoped to userId,
 *      use its startDate/endDate. Return { start, end, fiscalYear }.
 *      If not found for this user, fall through to step 2
 *      (security: never return another user's FY).
 *   2. startDateParam AND endDateParam provided → use them.
 *      Return { start, end, fiscalYear: null }.
 *   3. Neither → call lookupActiveFiscalYear(userId). If found, use its
 *      startDate/endDate. Return { start, end, fiscalYear }.
 *   4. Fallback → Jan 1 – Dec 31 of current year.
 *      Return { start, end, fiscalYear: null }.
 *
 * All Date inputs are coerced to Date objects.
 * start is set to midnight (00:00:00.000).
 * end   is set to end of day (23:59:59.999).
 * Never throws.
 *
 * @param {string}           userId
 * @param {Date|string|null} startDateParam
 * @param {Date|string|null} endDateParam
 * @param {string|null}      fiscalYearId
 * @returns {Promise<{ start: Date, end: Date, fiscalYear: object|null }>}
 */
async function getFiscalYearOrCalendarFallback(
  userId,
  startDateParam,
  endDateParam,
  fiscalYearId,
) {
  // ── Step 1: fiscalYearId provided ────────────────────────────────────────
  if (fiscalYearId) {
    try {
      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { companyId: true }
      });
      const fy = user?.companyId
        ? await prisma.fiscalYear.findFirst({
            where: { id: fiscalYearId, companyId: user.companyId }
          })
        : null;
      if (fy) {
        const start = new Date(fy.startDate);
        start.setHours(0, 0, 0, 0);
        const end = new Date(fy.endDate);
        end.setHours(23, 59, 59, 999);
        return { start, end, fiscalYear: fy };
      }
      // Not found for this company → fall through to step 2
    } catch {
      // DB error → fall through to step 2
    }
  }

  // ── Step 2: explicit startDate + endDate params ───────────────────────────
  if (startDateParam && endDateParam) {
    const start = new Date(startDateParam);
    start.setHours(0, 0, 0, 0);
    const end = new Date(endDateParam);
    end.setHours(23, 59, 59, 999);
    return { start, end, fiscalYear: null };
  }

  // ── Step 3: active fiscal year lookup ─────────────────────────────────────
  try {
    const fy = await lookupActiveFiscalYear(userId);
    if (fy) {
      const start = new Date(fy.startDate);
      start.setHours(0, 0, 0, 0);
      const end = new Date(fy.endDate);
      end.setHours(23, 59, 59, 999);
      return { start, end, fiscalYear: fy };
    }
  } catch {
    // DB error → fall through to step 4
  }

  // ── Step 4: calendar-year fallback ───────────────────────────────────────
  const now = new Date();
  const start = new Date(now.getFullYear(), 0, 1, 0, 0, 0, 0);
  const end   = new Date(now.getFullYear(), 11, 31, 23, 59, 59, 999);
  return { start, end, fiscalYear: null };
}

/**
 * Load a fiscal year owned by companyId (or null).
 */
async function getCompanyFiscalYear(companyId, fiscalYearId) {
  if (!companyId || !fiscalYearId) return null;
  try {
    return await prisma.fiscalYear.findFirst({
      where: { id: fiscalYearId, companyId }
    });
  } catch {
    return null;
  }
}

function toDayStart(d) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function toDayEnd(d) {
  const x = new Date(d);
  x.setHours(23, 59, 59, 999);
  return x;
}

/**
 * Intersect two inclusive date ranges. empty=true when no overlap.
 */
function intersectRanges(aStart, aEnd, bStart, bEnd) {
  const start = aStart > bStart ? aStart : bStart;
  const end = aEnd < bEnd ? aEnd : bEnd;
  return { start, end, empty: start > end };
}

/**
 * Clamp a resolved report window to the selected fiscal year.
 *
 * Filtering by FY date range (not only fiscalYearId FK) so older rows with
 * null fiscalYearId still appear in the correct year.
 *
 * - period This Year / All Time / Fiscal Year / empty → use FY window
 * - other periods → intersect calendar period with FY
 * - end is never after "now" for open years still in progress
 */
async function applyFiscalYearWindow({
  companyId,
  fiscalYearId,
  start,
  end,
  period
}) {
  if (!fiscalYearId || !companyId) {
    return { start, end, fiscalYear: null, empty: false };
  }

  const fy = await getCompanyFiscalYear(companyId, fiscalYearId);
  if (!fy) {
    return { start, end, fiscalYear: null, empty: false };
  }

  const fyStart = toDayStart(fy.startDate);
  let fyEnd = toDayEnd(fy.endDate);
  const now = toDayEnd(new Date());
  if (fyEnd > now) fyEnd = now;

  const periodLabel = String(period || '').trim();
  const preferFullFy =
    !periodLabel ||
    /^(this year|all time|fiscal year|year)$/i.test(periodLabel);

  if (preferFullFy) {
    // Future FY (starts after today) → empty window
    if (fyStart > now) {
      return { start: fyStart, end: fyStart, fiscalYear: fy, empty: true };
    }
    return { start: fyStart, end: fyEnd, fiscalYear: fy, empty: fyStart > fyEnd };
  }

  const hit = intersectRanges(start, end, fyStart, fyEnd);
  return { ...hit, fiscalYear: fy };
}

/**
 * Resolve a { gte, lte } Prisma date filter from period + optional FY.
 */
async function resolveQueryDateFilter({
  period,
  startDate,
  endDate,
  fiscalYearId,
  companyId
}) {
  const now = toDayEnd(new Date());
  let start;
  let end = now;
  const p = String(period || 'month').toLowerCase();

  if (p === 'custom' && startDate && endDate) {
    start = toDayStart(startDate);
    end = toDayEnd(endDate);
  } else if (p === 'today') {
    start = toDayStart(now);
  } else if (p === 'week' || p === 'last_week') {
    start = toDayStart(now);
    start.setDate(start.getDate() - 6);
  } else if (p === 'last_month') {
    start = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    start.setHours(0, 0, 0, 0);
    end = toDayEnd(new Date(now.getFullYear(), now.getMonth(), 0));
  } else if (p === 'quarter' || p === 'this_quarter') {
    const q = Math.floor(now.getMonth() / 3);
    start = new Date(now.getFullYear(), q * 3, 1);
    start.setHours(0, 0, 0, 0);
  } else if (p === 'year') {
    start = new Date(now.getFullYear(), 0, 1);
    start.setHours(0, 0, 0, 0);
  } else {
    start = new Date(now.getFullYear(), now.getMonth(), 1);
    start.setHours(0, 0, 0, 0);
  }

  const clamped = await applyFiscalYearWindow({
    companyId,
    fiscalYearId,
    start,
    end,
    period: p === 'year' ? 'This Year' : period
  });
  return { gte: clamped.start, lte: clamped.end };
}

module.exports = {
  resolveFiscalYearId,
  getFiscalYearDateRange,
  lookupActiveFiscalYear,
  getFiscalYearOrCalendarFallback,
  getCompanyFiscalYear,
  applyFiscalYearWindow,
  intersectRanges,
  resolveQueryDateFilter
};
