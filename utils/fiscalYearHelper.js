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

    // Use cached fiscal year if provided and date falls within its range (Req A4)
    if (cachedFiscalYear && cachedFiscalYear.userId === userId) {
      const startDate = new Date(cachedFiscalYear.startDate);
      const endDate = new Date(cachedFiscalYear.endDate);
      if (date >= startDate && date <= endDate) {
        return cachedFiscalYear.id;
      }
    }

    const fiscalYear = await prisma.fiscalYear.findFirst({
      where: {
        userId,
        startDate: { lte: date },
        endDate:   { gte: date },
      },
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
    endDate:   new Date(fiscalYear.endDate),
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
    return await prisma.fiscalYear.findFirst({
      where: {
        userId,
        status:    'Open',
        startDate: { lte: now },
        endDate:   { gte: now },
      },
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
      const fy = await prisma.fiscalYear.findFirst({
        where: { id: fiscalYearId, userId },
      });
      if (fy) {
        const start = new Date(fy.startDate);
        start.setHours(0, 0, 0, 0);
        const end = new Date(fy.endDate);
        end.setHours(23, 59, 59, 999);
        return { start, end, fiscalYear: fy };
      }
      // Not found for this user → fall through to step 2
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

module.exports = {
  resolveFiscalYearId,
  getFiscalYearDateRange,
  lookupActiveFiscalYear,
  getFiscalYearOrCalendarFallback,
};
