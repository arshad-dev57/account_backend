'use strict';

/**
 * Import-module FX helpers.
 * Import tables historically name base-currency fields *Usd / exchangeRateToUsd;
 * they actually store company base currency amounts (e.g. PKR), not necessarily USD.
 */

const prisma = require('../prisma/client');
const { getExchangeRate, getCompanyBaseCurrency } = require('./multiCurrency');

function toNumber(val, fallback = 0) {
  if (val == null) return fallback;
  const n = Number(val);
  return Number.isFinite(n) ? n : fallback;
}

/**
 * Parse a calendar date without timezone day/month shifts.
 * Import module convention: calendar dates are YYYY-MM-DD; DB stores UTC noon.
 * Never treat the month as 0-based twice — string months are 1-based (−1 once).
 */
function parseDateOnly(input) {
  if (input == null || input === '') return null;
  if (input instanceof Date) {
    if (Number.isNaN(input.getTime())) return null;
    // Stored via toDbDateOnly → UTC noon: use UTC Y/M/D as the calendar date
    const utcH = input.getUTCHours();
    if (utcH >= 10 && utcH <= 14) {
      return new Date(input.getUTCFullYear(), input.getUTCMonth(), input.getUTCDate());
    }
    // Legacy local-midnight rows: use local calendar components
    return new Date(input.getFullYear(), input.getMonth(), input.getDate());
  }
  const s = String(input).trim();
  // Plain YYYY-MM-DD (date inputs) OR leading date of an ISO datetime.
  // For ISO with time, prefer the YYYY-MM-DD prefix when stored as UTC noon
  // (…T12:00:00.000Z). For legacy …T19:00:00Z (PKT midnight), also use UTC
  // components of the full instant so local calendar day is preserved.
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[T\s](\d{2}):(\d{2}))?/.exec(s);
  if (m) {
    const y = Number(m[1]);
    const mon = Number(m[2]); // 1-based
    const day = Number(m[3]);
    if (m[4] != null) {
      const hour = Number(m[4]);
      // UTC noon convention → trust the YYYY-MM-DD prefix
      if (hour >= 10 && hour <= 14) {
        return new Date(y, mon - 1, day);
      }
      // Legacy offset midnight: interpret full instant in local TZ
      const instant = new Date(s);
      if (!Number.isNaN(instant.getTime())) {
        return new Date(instant.getFullYear(), instant.getMonth(), instant.getDate());
      }
    }
    return new Date(y, mon - 1, day);
  }
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return null;
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

/** Persist as UTC noon on the calendar day to avoid TZ day rollover. */
function toDbDateOnly(input) {
  const d = parseDateOnly(input);
  if (!d) return null;
  return new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate(), 12, 0, 0));
}

/** YYYY-MM-DD for HTML date inputs / API payloads. */
function toDateInputValue(input) {
  const d = parseDateOnly(input);
  if (!d) return '';
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * Rate date must not be in the future and must not be before PO order date.
 * @returns {Date} DB-safe date
 */
function assertImportRateDate(rateDate, { orderDate, field = 'exchangeRateDate', label = 'Rate date' } = {}) {
  const d = parseDateOnly(rateDate);
  if (!d) {
    const err = new Error(`${label} is required`);
    err.status = 400;
    err.code = 'RATE_DATE_REQUIRED';
    err.field = field;
    throw err;
  }
  const today = parseDateOnly(new Date());
  if (today && d.getTime() > today.getTime()) {
    const err = new Error(`${label} must not be in the future`);
    err.status = 400;
    err.code = 'RATE_DATE_FUTURE';
    err.field = field;
    throw err;
  }
  if (orderDate) {
    const od = parseDateOnly(orderDate);
    if (od && d.getTime() < od.getTime()) {
      const err = new Error(`${label} must not be before the PO order date`);
      err.status = 400;
      err.code = 'RATE_DATE_BEFORE_PO';
      err.field = field;
      throw err;
    }
  }
  return toDbDateOnly(d);
}

/**
 * Never silently defaults to 1 when currencies differ.
 *
 * @returns {{
 *   currencyCode: string,
 *   baseCurrencyCode: string,
 *   exchangeRate: number,
 *   exchangeRateDate: Date,
 *   rateSource: string,
 *   foreignAmount: number,
 *   baseAmount: number,
 *   fromCurrencyId: string|null,
 *   toCurrencyId: string|null,
 * }}
 */
async function resolveImportExchangeRate({
  companyId,
  currencyCode,
  foreignAmount = 0,
  explicitRate,
  allowExplicitRate = true,
  asOfDate = new Date(),
  client = prisma,
}) {
  if (!companyId) {
    const err = new Error('companyId is required for FX resolution');
    err.status = 400;
    err.code = 'COMPANY_REQUIRED';
    throw err;
  }

  const code = String(currencyCode || 'USD').trim().toUpperCase();
  const amount = Math.round(toNumber(foreignAmount, 0) * 10000) / 10000;
  const rateDate = asOfDate ? toDbDateOnly(asOfDate) || new Date() : new Date();

  const baseCurrency = await getCompanyBaseCurrency(companyId, client);
  if (!baseCurrency) {
    const err = new Error('Company base currency could not be resolved');
    err.status = 400;
    err.code = 'BASE_CURRENCY_MISSING';
    throw err;
  }

  const baseCode = String(baseCurrency.code || '').toUpperCase();
  const fromCur = await client.currency.findFirst({
    where: { code: { equals: code, mode: 'insensitive' }, isActive: true },
  });

  if (!fromCur) {
    const err = new Error(
      `Currency "${code}" is not configured. Add it under Currency settings before creating import documents.`
    );
    err.status = 400;
    err.code = 'CURRENCY_NOT_FOUND';
    throw err;
  }

  // Same currency → identity rate only
  if (fromCur.id === baseCurrency.id || code === baseCode) {
    return {
      currencyCode: code,
      baseCurrencyCode: baseCode,
      exchangeRate: 1,
      exchangeRateDate: rateDate,
      rateSource: 'IDENTITY',
      foreignAmount: amount,
      baseAmount: amount,
      fromCurrencyId: fromCur.id,
      toCurrencyId: baseCurrency.id,
    };
  }

  const explicit = explicitRate != null && explicitRate !== '' ? toNumber(explicitRate, 0) : 0;
  if (explicit > 0) {
    if (!allowExplicitRate) {
      const err = new Error('Explicit exchange rate override is not authorized for this operation');
      err.status = 403;
      err.code = 'EXPLICIT_RATE_FORBIDDEN';
      throw err;
    }
    const baseAmount = Math.round(amount * explicit * 100) / 100;
    return {
      currencyCode: code,
      baseCurrencyCode: baseCode,
      exchangeRate: explicit,
      exchangeRateDate: rateDate,
      rateSource: 'EXPLICIT',
      foreignAmount: amount,
      baseAmount,
      fromCurrencyId: fromCur.id,
      toCurrencyId: baseCurrency.id,
    };
  }

  const fx = await getExchangeRate({
    companyId,
    fromCurrencyId: fromCur.id,
    toCurrencyId: baseCurrency.id,
    asOfDate: rateDate,
    client,
  });

  if (!fx || fx.rate == null || toNumber(fx.rate, 0) <= 0) {
    const err = new Error(
      `No exchange rate found for ${code} → ${baseCode} on or before ${rateDate
        .toISOString()
        .slice(0, 10)}. Configure a company rate or enter an authorized explicit rate.`
    );
    err.status = 400;
    err.code = 'EXCHANGE_RATE_REQUIRED';
    throw err;
  }

  const rate = toNumber(fx.rate, 0);
  const baseAmount = Math.round(amount * rate * 100) / 100;

  return {
    currencyCode: code,
    baseCurrencyCode: baseCode,
    exchangeRate: rate,
    exchangeRateDate: fx.effectiveDate || rateDate,
    rateSource: 'COMPANY_RATE_TABLE',
    foreignAmount: amount,
    baseAmount,
    fromCurrencyId: fromCur.id,
    toCurrencyId: baseCurrency.id,
  };
}

/**
 * Preview FX without persisting. Used by UI before save.
 */
async function previewImportFx(reqPayload) {
  return resolveImportExchangeRate(reqPayload);
}

module.exports = {
  toNumber,
  parseDateOnly,
  toDbDateOnly,
  toDateInputValue,
  assertImportRateDate,
  resolveImportExchangeRate,
  previewImportFx,
};
