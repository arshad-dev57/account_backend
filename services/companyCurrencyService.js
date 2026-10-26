'use strict';

/**
 * Company currency configuration.
 *
 * Shared master data (Currency) + company-scoped effective-dated rates
 * (ExchangeRate). Rate direction is always 1 foreign = rate × company base.
 *
 * All writes are idempotent and preserve existing valid/user-edited rates.
 */

const prisma = require('../prisma/client');
const {
  Decimal,
  ensureCurrenciesSeeded,
  getExchangeRate,
  isSameCurrency,
  startOfUtcDay,
  toDateOnlyString,
} = require('../utils/multiCurrency');
const {
  fetchProviderRates,
  getProviderStatus,
} = require('./exchangeRateProvider');

const DEFAULT_STALE_DAYS = 7;

function apiError(message, { status = 400, code = 'VALIDATION_ERROR', field } = {}) {
  const err = new Error(message);
  err.status = status;
  err.code = code;
  if (field) err.field = field;
  return err;
}

function requireCompanyId(companyId) {
  if (!companyId) {
    throw apiError('Select a specific company to manage currencies', {
      status: 400,
      code: 'COMPANY_REQUIRED',
    });
  }
  return companyId;
}

function normalizeCode(value) {
  return String(value || '').trim().toUpperCase();
}

/**
 * Validate and normalize a manually supplied rate.
 * Positive, finite, at most 8 decimal places, fits DECIMAL(18,8).
 */
function parseRateValue(value) {
  if (value === null || value === undefined || value === '') {
    throw apiError('Exchange rate is required', {
      status: 400,
      code: 'RATE_REQUIRED',
      field: 'rate',
    });
  }
  let dec;
  try {
    dec = value instanceof Decimal ? value : new Decimal(value);
  } catch {
    throw apiError('Exchange rate must be a valid number', {
      status: 400,
      code: 'RATE_INVALID',
      field: 'rate',
    });
  }
  if (!dec.isFinite() || dec.lte(0)) {
    throw apiError('Exchange rate must be greater than zero', {
      status: 400,
      code: 'RATE_NOT_POSITIVE',
      field: 'rate',
    });
  }
  if (dec.decimalPlaces() > 8) {
    throw apiError('Exchange rate supports at most 8 decimal places', {
      status: 400,
      code: 'RATE_PRECISION',
      field: 'rate',
    });
  }
  if (dec.gte('10000000000')) {
    throw apiError('Exchange rate is too large', {
      status: 400,
      code: 'RATE_TOO_LARGE',
      field: 'rate',
    });
  }
  return dec.toDecimalPlaces(8, Decimal.ROUND_HALF_UP);
}

/** Calendar date (UTC midnight) for @db.Date; rejects future dates. */
function parseRateEffectiveDate(value, { allowFuture = false } = {}) {
  const day = startOfUtcDay(value || new Date());
  if (!day) {
    throw apiError('Effective date is invalid', {
      status: 400,
      code: 'RATE_DATE_INVALID',
      field: 'effectiveDate',
    });
  }
  const today = startOfUtcDay(new Date());
  if (!allowFuture && today && day.getTime() > today.getTime()) {
    throw apiError('Effective date must not be in the future', {
      status: 400,
      code: 'RATE_DATE_FUTURE',
      field: 'effectiveDate',
    });
  }
  return day;
}

async function runInTransaction(client, fn) {
  if (client && typeof client.$transaction === 'function') {
    return client.$transaction((tx) => fn(tx));
  }
  return fn(client);
}

async function recordHistory(client, data) {
  if (!client?.exchangeRateHistory?.create) return null;
  return client.exchangeRateHistory.create({
    data: {
      companyId: data.companyId,
      exchangeRateId: data.exchangeRateId || null,
      fromCurrencyId: data.fromCurrencyId,
      toCurrencyId: data.toCurrencyId,
      oldRate: data.oldRate ?? null,
      newRate: data.newRate ?? null,
      effectiveDate: data.effectiveDate,
      action: data.action || 'UPDATE',
      source: data.source || null,
      reason: data.reason || null,
      changedBy: data.changedBy || null,
    },
  });
}

/**
 * Resolve the base currency for a company.
 * Priority: explicit id/code → stored base → parent company base → PKR.
 * Explicit values never silently fall back unless `allowFallback` is true.
 */
async function resolveBaseCurrency({
  companyId,
  baseCurrencyCode = null,
  baseCurrencyId = null,
  parentCompanyId = null,
  client = prisma,
  allowFallback = false,
} = {}) {
  requireCompanyId(companyId);
  await ensureCurrenciesSeeded(client);

  const company = await client.company.findUnique({
    where: { id: companyId },
    include: {
      baseCurrency: true,
      parentCompany: { include: { baseCurrency: true } },
    },
  });
  if (!company) {
    throw apiError('Company not found', { status: 404, code: 'COMPANY_NOT_FOUND' });
  }

  const persist = async (currency) => {
    if (currency && company.baseCurrencyId !== currency.id) {
      try {
        await client.company.update({
          where: { id: companyId },
          data: { baseCurrencyId: currency.id },
        });
      } catch {
        /* concurrent base update — the resolved currency is still valid */
      }
    }
    return currency;
  };

  const requestedId = baseCurrencyId || null;
  const requestedCode = normalizeCode(baseCurrencyCode);
  if (requestedId || requestedCode) {
    let requested = null;
    if (requestedId) {
      requested = await client.currency.findUnique({ where: { id: requestedId } });
    } else {
      requested = await client.currency.findUnique({ where: { code: requestedCode } });
    }
    if (requested?.isActive) return persist(requested);
    if (!allowFallback) {
      throw apiError(
        `Currency ${requestedCode || requestedId} is not available. Add or activate it first.`,
        { status: 400, code: 'BASE_CURRENCY_INVALID', field: 'baseCurrencyCode' }
      );
    }
  }

  if (company.baseCurrency?.isActive) return company.baseCurrency;

  const parentBase = company.parentCompany?.baseCurrency;
  if (company.parentCompanyId && parentBase?.isActive) {
    return persist(parentBase);
  }

  let fallback = await client.currency.findUnique({ where: { code: 'PKR' } });
  if (!fallback || !fallback.isActive) {
    fallback = await client.currency.findFirst({
      where: { isActive: true },
      orderBy: { code: 'asc' },
    });
  }
  if (!fallback) {
    throw apiError('No active currency is configured', {
      status: 400,
      code: 'CURRENCY_MASTER_EMPTY',
    });
  }
  return persist(fallback);
}

async function loadLatestRatesToBase({ companyId, baseCurrencyId, asOfDate, client = prisma }) {
  const day = startOfUtcDay(asOfDate || new Date());
  const rows = await client.exchangeRate.findMany({
    where: {
      companyId,
      toCurrencyId: baseCurrencyId,
      isActive: true,
      rate: { gt: 0 },
      effectiveDate: { lte: day },
    },
    orderBy: [{ effectiveDate: 'desc' }, { updatedAt: 'desc' }],
  });
  const map = new Map();
  for (const row of rows) {
    if (!map.has(row.fromCurrencyId)) map.set(row.fromCurrencyId, row);
  }
  return map;
}

async function upsertRateRecord(tx, {
  companyId,
  fromCurrencyId,
  toCurrencyId,
  rate,
  effectiveDate,
  source,
  fetchedAt,
  userId,
  notes,
  overwrite = false,
  action = 'UPDATE',
  reason,
}) {
  const existing = await tx.exchangeRate.findFirst({
    where: { companyId, fromCurrencyId, toCurrencyId, effectiveDate },
  });

  if (existing) {
    const oldRate = new Decimal(existing.rate);
    const nextRate = new Decimal(rate);
    const rateChanged = !oldRate.equals(nextRate);
    const reactivating = !existing.isActive;
    const previousRateValid = oldRate.gt(0);

    if (!overwrite && !reactivating && previousRateValid) {
      return { record: existing, action: 'preserved', oldRate, rateChanged };
    }

    const updated = await tx.exchangeRate.update({
      where: { id: existing.id },
      data: {
        rate: nextRate,
        isActive: true,
        source,
        fetchedAt: fetchedAt || new Date(),
        ...(notes !== undefined ? { notes } : {}),
      },
    });

    if (rateChanged || reactivating) {
      await recordHistory(tx, {
        companyId,
        exchangeRateId: updated.id,
        fromCurrencyId,
        toCurrencyId,
        oldRate: reactivating ? null : oldRate,
        newRate: nextRate,
        effectiveDate,
        action: reactivating ? 'CREATE' : action,
        source,
        reason,
        changedBy: userId,
      });
    }
    return { record: updated, action: 'updated', oldRate, rateChanged };
  }

  const created = await tx.exchangeRate.create({
    data: {
      companyId,
      fromCurrencyId,
      toCurrencyId,
      rate: new Decimal(rate),
      effectiveDate,
      isActive: true,
      source,
      fetchedAt: fetchedAt || new Date(),
      notes: notes || null,
      createdBy: userId || null,
    },
  });

  await recordHistory(tx, {
    companyId,
    exchangeRateId: created.id,
    fromCurrencyId,
    toCurrencyId,
    oldRate: null,
    newRate: new Decimal(rate),
    effectiveDate,
    action: 'CREATE',
    source,
    reason,
    changedBy: userId,
  });

  return { record: created, action: 'created', oldRate: null, rateChanged: true };
}

/**
 * Ensure the company has a base currency and one valid rate per supported
 * foreign currency. Existing valid rates are preserved unless `overwrite`.
 * Provider failures never block company creation; missing pairs are reported.
 */
async function initializeCompanyCurrencyConfiguration({
  companyId,
  userId = null,
  baseCurrencyCode = null,
  baseCurrencyId = null,
  fetchRates = true,
  overwrite = false,
  asOfDate = new Date(),
  client = prisma,
  providerFetch = null,
} = {}) {
  requireCompanyId(companyId);

  const base = await resolveBaseCurrency({
    companyId,
    baseCurrencyCode,
    baseCurrencyId,
    client,
    allowFallback: true,
  });
  if (!base) {
    throw apiError('Company base currency could not be resolved', {
      status: 500,
      code: 'BASE_CURRENCY_MISSING',
    });
  }

  const currencies = await client.currency.findMany({
    where: { isActive: true },
    orderBy: { code: 'asc' },
  });
  const foreignCurrencies = currencies.filter((c) => !isSameCurrency(c.id, base.id));

  const day = startOfUtcDay(asOfDate || new Date());
  const latestByFrom = await loadLatestRatesToBase({
    companyId,
    baseCurrencyId: base.id,
    asOfDate: day,
    client,
  });

  const preserved = [];
  const missingCandidates = [];
  for (const currency of foreignCurrencies) {
    if (latestByFrom.has(currency.id) && !overwrite) {
      preserved.push(currency.code);
    } else {
      missingCandidates.push(currency);
    }
  }

  let providerResult = null;
  if (fetchRates && missingCandidates.length) {
    const fetchFn =
      typeof providerFetch === 'function' ? providerFetch : fetchProviderRates;
    providerResult = await fetchFn({
      baseCode: base.code,
      codes: missingCandidates.map((c) => c.code),
      forceRefresh: false,
    });
  }

  const created = [];
  const updated = [];
  const missing = [];
  const errors = [];
  const providerRates = providerResult?.rates || {};
  const providerAsOf = providerResult?.asOfDate || day;
  const providerSource = providerResult?.configured
    ? `PROVIDER:${providerResult.provider}`
    : null;

  const writePlan = [];
  for (const currency of missingCandidates) {
    const providerRate = providerRates[currency.code];
    if (!providerRate) {
      missing.push(currency.code);
      continue;
    }
    writePlan.push({
      currency,
      rate: providerRate,
      effectiveDate: startOfUtcDay(providerAsOf) || day,
    });
  }

  if (writePlan.length) {
    await runInTransaction(client, async (tx) => {
      for (const item of writePlan) {
        const result = await upsertRateRecord(tx, {
          companyId,
          fromCurrencyId: item.currency.id,
          toCurrencyId: base.id,
          rate: item.rate,
          effectiveDate: item.effectiveDate,
          source: providerSource,
          fetchedAt: providerResult?.fetchedAt || new Date(),
          userId,
          overwrite,
          action: 'PROVIDER_REFRESH',
          reason: 'Automatic currency initialization',
        });
        if (result.action === 'created') created.push(item.currency.code);
        else if (result.action === 'updated') updated.push(item.currency.code);
        else preserved.push(item.currency.code);
      }
    });
  }

  return {
    companyId,
    baseCurrency: {
      id: base.id,
      code: base.code,
      name: base.name,
      symbol: base.symbol,
      decimalPlaces: base.decimalPlaces,
    },
    supportedCurrencyCount: currencies.length,
    created,
    updated,
    preserved,
    missing,
    provider: providerResult
      ? {
          configured: providerResult.configured,
          name: providerResult.provider,
          asOfDate: providerResult.asOfDate,
          fetchedAt: providerResult.fetchedAt,
          error: providerResult.error,
          unsupported: providerResult.unsupported,
          cached: providerResult.cached,
        }
      : {
          configured: getProviderStatus().configured,
          name: getProviderStatus().provider,
          error: fetchRates ? 'No missing rates required provider lookup' : 'Provider lookup skipped',
        },
    errors,
  };
}

/**
 * Explicit user-triggered provider refresh. By default existing active rates are
 * kept (manual edits are never silently overwritten).
 */
async function refreshCompanyRates({
  companyId,
  userId = null,
  overwrite = false,
  asOfDate = new Date(),
  client = prisma,
  providerFetch = null,
} = {}) {
  requireCompanyId(companyId);
  const base = await resolveBaseCurrency({ companyId, client, allowFallback: true });
  const currencies = await client.currency.findMany({
    where: { isActive: true },
    orderBy: { code: 'asc' },
  });
  const foreignCurrencies = currencies.filter((c) => !isSameCurrency(c.id, base.id));
  const day = startOfUtcDay(asOfDate || new Date());

  const fetchFn = typeof providerFetch === 'function' ? providerFetch : fetchProviderRates;
  const providerResult = await fetchFn({
    baseCode: base.code,
    codes: foreignCurrencies.map((c) => c.code),
    forceRefresh: true,
  });

  const latestByFrom = await loadLatestRatesToBase({
    companyId,
    baseCurrencyId: base.id,
    asOfDate: day,
    client,
  });

  const updated = [];
  const skipped = [];
  const missing = [];
  const writePlan = [];

  for (const currency of foreignCurrencies) {
    const providerRate = providerResult.rates?.[currency.code];
    const existing = latestByFrom.get(currency.id);
    if (!providerRate) {
      if (existing) skipped.push(currency.code);
      else missing.push(currency.code);
      continue;
    }
    if (existing && !overwrite) {
      skipped.push(currency.code);
      continue;
    }
    writePlan.push({ currency, rate: providerRate, existing });
  }

  if (writePlan.length) {
    await runInTransaction(client, async (tx) => {
      for (const item of writePlan) {
        const before = item.existing ? new Decimal(item.existing.rate).toNumber() : null;
        const result = await upsertRateRecord(tx, {
          companyId,
          fromCurrencyId: item.currency.id,
          toCurrencyId: base.id,
          rate: item.rate,
          effectiveDate: startOfUtcDay(providerResult.asOfDate) || day,
          source: `PROVIDER:${providerResult.provider}`,
          fetchedAt: providerResult.fetchedAt || new Date(),
          userId,
          overwrite: true,
          action: 'PROVIDER_REFRESH',
          reason: 'Manual provider refresh',
        });
        updated.push({
          code: item.currency.code,
          oldRate: before,
          newRate: new Decimal(item.rate).toNumber(),
          action: result.action,
        });
      }
    });
  }

  return {
    companyId,
    baseCurrencyCode: base.code,
    provider: {
      configured: providerResult.configured,
      name: providerResult.provider,
      asOfDate: providerResult.asOfDate,
      fetchedAt: providerResult.fetchedAt,
      error: providerResult.error,
      cached: providerResult.cached,
      unsupported: providerResult.unsupported,
    },
    updated,
    skipped,
    missing,
  };
}

function staleDaysFromEnv() {
  const parsed = Number(process.env.FX_RATE_STALE_DAYS);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : DEFAULT_STALE_DAYS;
}

/** Company-aware listing used by the currency settings screen. */
async function getCompanyCurrencyOverview({
  companyId,
  asOfDate = new Date(),
  includeInactive = false,
  client = prisma,
} = {}) {
  requireCompanyId(companyId);
  const base = await resolveBaseCurrency({ companyId, client, allowFallback: true });
  const day = startOfUtcDay(asOfDate || new Date());

  const currencies = await client.currency.findMany({
    where: includeInactive ? undefined : { isActive: true },
    orderBy: { code: 'asc' },
  });
  const latestByFrom = await loadLatestRatesToBase({
    companyId,
    baseCurrencyId: base.id,
    asOfDate: day,
    client,
  });

  const staleDays = staleDaysFromEnv();
  const now = startOfUtcDay(new Date());
  let missingCount = 0;
  let staleCount = 0;

  const rows = currencies.map((currency) => {
    const isBase = isSameCurrency(currency.id, base.id);
    const latest = latestByFrom.get(currency.id) || null;
    const effectiveDate = latest ? startOfUtcDay(latest.effectiveDate) : null;
    const ageDays =
      effectiveDate && now
        ? Math.floor((now.getTime() - effectiveDate.getTime()) / (24 * 60 * 60 * 1000))
        : null;
    const isMissing = !isBase && !latest;
    const isStale = !isMissing && ageDays !== null && ageDays > staleDays;
    if (isMissing) missingCount += 1;
    if (isStale) staleCount += 1;

    return {
      id: currency.id,
      code: currency.code,
      name: currency.name,
      symbol: currency.symbol,
      decimalPlaces: currency.decimalPlaces,
      isActive: currency.isActive,
      isBase,
      rateId: latest?.id || null,
      rate: latest ? new Decimal(latest.rate).toString() : null,
      effectiveDate: latest ? toDateOnlyString(latest.effectiveDate) : null,
      source: latest?.source || null,
      fetchedAt: latest?.fetchedAt || null,
      lastUpdated: latest?.fetchedAt || latest?.updatedAt || null,
      notes: latest?.notes || null,
      isMissing,
      isStale,
      ageDays,
    };
  });

  rows.sort((a, b) => {
    if (a.isBase !== b.isBase) return a.isBase ? -1 : 1;
    return a.code.localeCompare(b.code);
  });

  return {
    companyId,
    baseCurrency: {
      id: base.id,
      code: base.code,
      name: base.name,
      symbol: base.symbol,
      decimalPlaces: base.decimalPlaces,
    },
    asOfDate: toDateOnlyString(day),
    staleDays,
    provider: getProviderStatus(),
    counts: {
      currencies: rows.length,
      rateAvailable: rows.filter((r) => !r.isBase && r.rate).length,
      missing: missingCount,
      stale: staleCount,
    },
    currencies: rows,
  };
}

async function findCurrency({ currencyId, code, client = prisma }) {
  if (currencyId) {
    const row = await client.currency.findUnique({ where: { id: currencyId } });
    if (row) return row;
  }
  if (code) {
    const row = await client.currency.findUnique({ where: { code: normalizeCode(code) } });
    if (row) return row;
  }
  return null;
}

/**
 * Convert an amount using the shared, effective-dated company rate table.
 * Tries direct, inverse, then cross via the company base. Never returns 1 for
 * different currencies when no rate exists.
 */
async function convertAmountBetweenCurrencies({
  companyId,
  fromCurrencyId,
  fromCode,
  toCurrencyId,
  toCode,
  amount,
  asOfDate = new Date(),
  client = prisma,
} = {}) {
  requireCompanyId(companyId);
  const base = await resolveBaseCurrency({ companyId, client, allowFallback: true });
  const from = await findCurrency({ currencyId: fromCurrencyId, code: fromCode, client });
  const to = await findCurrency({ currencyId: toCurrencyId, code: toCode, client });
  if (!from) throw apiError('Source currency not found', { status: 404, code: 'CURRENCY_NOT_FOUND' });
  if (!to) throw apiError('Target currency not found', { status: 404, code: 'CURRENCY_NOT_FOUND' });

  const decAmount = new Decimal(amount ?? 0);
  if (!decAmount.isFinite()) {
    throw apiError('Amount must be a valid number', { status: 400, code: 'AMOUNT_INVALID' });
  }

  if (isSameCurrency(from.id, to.id)) {
    return {
      amount: decAmount.toDecimalPlaces(4, Decimal.ROUND_HALF_UP).toNumber(),
      rate: 1,
      fromCode: from.code,
      toCode: to.code,
      converted: true,
      via: 'IDENTITY',
      effectiveDate: toDateOnlyString(asOfDate),
      rateSource: 'IDENTITY',
      baseCurrencyCode: base.code,
    };
  }

  const day = startOfUtcDay(asOfDate || new Date());
  const direct = await getExchangeRate({
    companyId,
    fromCurrencyId: from.id,
    toCurrencyId: to.id,
    asOfDate: day,
    client,
  });
  if (direct && Number(direct.rate) > 0) {
    const rate = new Decimal(direct.rate);
    return {
      amount: decAmount.mul(rate).toDecimalPlaces(4, Decimal.ROUND_HALF_UP).toNumber(),
      rate: rate.toDecimalPlaces(8, Decimal.ROUND_HALF_UP).toNumber(),
      fromCode: from.code,
      toCode: to.code,
      converted: true,
      via: 'DIRECT',
      effectiveDate: toDateOnlyString(direct.effectiveDate || day),
      rateSource: direct.source || 'COMPANY_RATE_TABLE',
      baseCurrencyCode: base.code,
    };
  }

  const inverse = await getExchangeRate({
    companyId,
    fromCurrencyId: to.id,
    toCurrencyId: from.id,
    asOfDate: day,
    client,
  });
  if (inverse && Number(inverse.rate) > 0) {
    const rate = new Decimal(1).div(inverse.rate);
    if (rate.isFinite() && rate.gt(0)) {
      return {
        amount: decAmount.mul(rate).toDecimalPlaces(4, Decimal.ROUND_HALF_UP).toNumber(),
        rate: rate.toDecimalPlaces(8, Decimal.ROUND_HALF_UP).toNumber(),
        fromCode: from.code,
        toCode: to.code,
        converted: true,
        via: 'INVERSE',
        effectiveDate: toDateOnlyString(inverse.effectiveDate || day),
        rateSource: inverse.source || 'COMPANY_RATE_TABLE_INVERSE',
        baseCurrencyCode: base.code,
      };
    }
  }

  const fromToBase =
    from.id === base.id
      ? { rate: new Decimal(1), effectiveDate: day, source: 'BASE' }
      : await getExchangeRate({
          companyId,
          fromCurrencyId: from.id,
          toCurrencyId: base.id,
          asOfDate: day,
          client,
        });
  const toToBase =
    to.id === base.id
      ? { rate: new Decimal(1), effectiveDate: day, source: 'BASE' }
      : await getExchangeRate({
          companyId,
          fromCurrencyId: to.id,
          toCurrencyId: base.id,
          asOfDate: day,
          client,
        });

  if (fromToBase && toToBase && Number(fromToBase.rate) > 0 && Number(toToBase.rate) > 0) {
    const rate = new Decimal(fromToBase.rate).div(toToBase.rate);
    if (rate.isFinite() && rate.gt(0)) {
      const effectiveSource =
        fromToBase.source && fromToBase.source !== 'BASE'
          ? fromToBase.source
          : toToBase.source || 'COMPANY_RATE_TABLE';
      return {
        amount: decAmount.mul(rate).toDecimalPlaces(4, Decimal.ROUND_HALF_UP).toNumber(),
        rate: rate.toDecimalPlaces(8, Decimal.ROUND_HALF_UP).toNumber(),
        fromCode: from.code,
        toCode: to.code,
        converted: true,
        via: 'BASE_CROSS',
        effectiveDate: toDateOnlyString(day),
        rateSource: effectiveSource,
        baseCurrencyCode: base.code,
      };
    }
  }

  throw apiError(
    `No exchange rate found for ${from.code} → ${to.code} on or before ${toDateOnlyString(day)}. Configure a company rate or enter an explicit rate.`,
    { status: 404, code: 'EXCHANGE_RATE_REQUIRED' }
  );
}

module.exports = {
  apiError,
  requireCompanyId,
  parseRateValue,
  parseRateEffectiveDate,
  resolveBaseCurrency,
  initializeCompanyCurrencyConfiguration,
  refreshCompanyRates,
  getCompanyCurrencyOverview,
  convertAmountBetweenCurrencies,
  recordHistory,
  upsertRateRecord,
};
