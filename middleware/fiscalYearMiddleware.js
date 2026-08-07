// middleware/fiscalYearMiddleware.js
// Provides fiscalYearGuard — a shared protection function that prevents any
// write operation from landing in a Closed fiscal year.
//
// NEVER reads fiscalYearId from req.body or req.query — always resolves the
// fiscal year internally using only userId + date (Req 10.7).

const prisma = require('../prisma/client');

/**
 * Looks up the FiscalYear record that contains the given date for a user.
 * Returns null if none found or on any DB error (no-op per Req 5.3 / Req 11.4).
 *
 * @param {string}      userId
 * @param {Date|string} date
 * @returns {Promise<object|null>}
 */
async function findFiscalYearForDate(userId, date) {
  try {
    const d = new Date(date);
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { companyId: true },
    });
    if (!user?.companyId) return null;

    return await prisma.fiscalYear.findFirst({
      where: {
        companyId: user.companyId,
        startDate: { lte: d },
        endDate: { gte: d },
      },
    });
  } catch {
    return null;
  }
}

/**
 * Guards a write operation against a Closed fiscal year.
 *
 * Checks whether `postingDate` (and optionally `existingDate`) falls in a
 * Closed FiscalYear for the given user.  Throws a structured error if so.
 * Is a silent no-op when no FiscalYear record is found for a date (Req 5.3,
 * Req 11.4).
 *
 * NEVER accepts fiscalYearId from the caller — fiscal year resolution is done
 * internally from userId + date only (Req 10.7).
 *
 * Usage in controllers:
 *   // create
 *   await fiscalYearGuard(req.user.id, postingDate);
 *   // edit / delete
 *   await fiscalYearGuard(req.user.id, newPostingDate, existingRecord.date);
 *
 * Error handling in controllers:
 *   try {
 *     await fiscalYearGuard(req.user.id, date);
 *   } catch (err) {
 *     if (err.code === 'FISCAL_YEAR_CLOSED') {
 *       return res.status(400).json({ success: false, message: err.message });
 *     }
 *     throw err; // re-throw unexpected errors
 *   }
 *
 * @param {string}           userId        - Authenticated user's id (req.user.id)
 * @param {Date|string}      postingDate   - New / create posting date
 * @param {Date|string|null} [existingDate] - Existing record's posting date (edit/delete)
 * @throws {Error} err.code === 'FISCAL_YEAR_CLOSED', err.statusCode === 400
 */
async function fiscalYearGuard(userId, postingDate, existingDate) {
  // ── 1. Check the new / incoming posting date ─────────────────────────────
  const fy = await findFiscalYearForDate(userId, postingDate);

  if (fy && fy.status === 'Closed') {
    const err = new Error(
      `Cannot post to a closed fiscal year: ${fy.name}. This period has been locked.`
    );
    err.code       = 'FISCAL_YEAR_CLOSED';
    err.statusCode = 400;
    throw err;
  }

  // ── 2. Check the existing record's date (edit / delete only) ─────────────
  //    Only check when existingDate is supplied AND differs from postingDate
  //    (comparing as Date objects to avoid string-format false-positives).
  if (existingDate != null) {
    const newD      = new Date(postingDate).getTime();
    const existingD = new Date(existingDate).getTime();

    if (existingD !== newD) {
      const existingFy = await findFiscalYearForDate(userId, existingDate);

      if (existingFy && existingFy.status === 'Closed') {
        const err = new Error(
          `Cannot post to a closed fiscal year: ${existingFy.name}. This period has been locked.`
        );
        err.code       = 'FISCAL_YEAR_CLOSED';
        err.statusCode = 400;
        throw err;
      }
    }
  }

  // No closed fiscal year found for either date — allow the operation.
}

module.exports = { fiscalYearGuard };
