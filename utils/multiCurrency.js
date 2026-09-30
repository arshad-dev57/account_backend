/**
 * Multi-currency helpers — Decimal-safe math for accounting.
 * Convention: rate means 1 unit of foreign (from) = rate units of base (to).
 * Example: USD→PKR rate 280 ⇒ baseAmount = foreignAmount × 280
 */

const { Prisma } = require('@prisma/client');
const prisma = require('../prisma/client');

const Decimal = Prisma.Decimal;
const ZERO = new Decimal(0);
const ONE = new Decimal(1);

function toDecimal(value, fallback = ZERO) {
  if (value === null || value === undefined || value === '') return new Decimal(fallback);
  try {
    const d = value instanceof Decimal ? value : new Decimal(value);
    if (!d.isFinite()) return new Decimal(fallback);
    return d;
  } catch {
    return new Decimal(fallback);
  }
}

function roundMoney(value, decimalPlaces = 4) {
  return toDecimal(value).toDecimalPlaces(decimalPlaces, Decimal.ROUND_HALF_UP);
}

function toNumber(value, decimalPlaces = 4) {
  return Number(roundMoney(value, decimalPlaces).toFixed(decimalPlaces));
}

function multiply(a, b, decimalPlaces = 4) {
  return roundMoney(toDecimal(a).mul(toDecimal(b)), decimalPlaces);
}

function subtract(a, b, decimalPlaces = 4) {
  return roundMoney(toDecimal(a).sub(toDecimal(b)), decimalPlaces);
}

function isSameCurrency(a, b) {
  if (!a || !b) return false;
  return String(a) === String(b);
}

const DEFAULT_CURRENCIES = [
  { code: 'PKR', name: 'Pakistani Rupee', symbol: '₨', decimalPlaces: 2 },
  { code: 'USD', name: 'US Dollar', symbol: '$', decimalPlaces: 2 },
  { code: 'EUR', name: 'Euro', symbol: '€', decimalPlaces: 2 },
  { code: 'GBP', name: 'British Pound', symbol: '£', decimalPlaces: 2 },
  { code: 'AED', name: 'UAE Dirham', symbol: 'د.إ', decimalPlaces: 2 },
  { code: 'SAR', name: 'Saudi Riyal', symbol: '﷼', decimalPlaces: 2 },
];

async function ensureCurrenciesSeeded(client = prisma) {
  for (const c of DEFAULT_CURRENCIES) {
    await client.currency.upsert({
      where: { code: c.code },
      create: { ...c, isActive: true },
      update: {
        name: c.name,
        symbol: c.symbol,
        decimalPlaces: c.decimalPlaces,
      },
    });
  }
  return client.currency.findMany({ orderBy: { code: 'asc' } });
}

async function getCurrencyByCode(code, client = prisma) {
  if (!code) return null;
  return client.currency.findUnique({ where: { code: String(code).toUpperCase() } });
}

async function getCurrencyById(id, client = prisma) {
  if (!id) return null;
  return client.currency.findUnique({ where: { id } });
}

/**
 * Resolve company base currency. Falls back to PKR and persists if missing.
 */
async function getCompanyBaseCurrency(companyId, client = prisma) {
  if (!companyId) {
    await ensureCurrenciesSeeded(client);
    return getCurrencyByCode('PKR', client);
  }

  const company = await client.company.findUnique({
    where: { id: companyId },
    include: { baseCurrency: true },
  });

  if (company?.baseCurrency) return company.baseCurrency;

  await ensureCurrenciesSeeded(client);
  const pkr = await getCurrencyByCode('PKR', client);

  if (company && pkr && !company.baseCurrencyId) {
    try {
      await client.company.update({
        where: { id: companyId },
        data: { baseCurrencyId: pkr.id },
      });
    } catch {
      /* non-fatal if concurrent */
    }
  }

  return pkr;
}

/**
 * Find the latest active exchange rate on or before asOfDate.
 * Rate: 1 fromCurrency = rate toCurrency (usually company base).
 */
async function getExchangeRate({
  companyId,
  fromCurrencyId,
  toCurrencyId,
  asOfDate = new Date(),
  client = prisma,
}) {
  if (!companyId || !fromCurrencyId || !toCurrencyId) return null;
  if (isSameCurrency(fromCurrencyId, toCurrencyId)) {
    return {
      rate: ONE,
      effectiveDate: asOfDate,
      fromCurrencyId,
      toCurrencyId,
      isIdentity: true,
    };
  }

  const day = new Date(asOfDate);
  day.setHours(0, 0, 0, 0);

  const row = await client.exchangeRate.findFirst({
    where: {
      companyId,
      fromCurrencyId,
      toCurrencyId,
      isActive: true,
      effectiveDate: { lte: day },
    },
    orderBy: { effectiveDate: 'desc' },
    include: {
      fromCurrency: true,
      toCurrency: true,
    },
  });

  if (!row) return null;

  return {
    id: row.id,
    rate: toDecimal(row.rate),
    effectiveDate: row.effectiveDate,
    fromCurrencyId: row.fromCurrencyId,
    toCurrencyId: row.toCurrencyId,
    fromCurrency: row.fromCurrency,
    toCurrency: row.toCurrency,
    isIdentity: false,
  };
}

/**
 * Resolve full currency snapshot for a transaction.
 * Priority: explicit overrides → supplier default → company base.
 * Persists historical rate on the returned object (never look up again for posted docs).
 */
async function resolveTransactionCurrency({
  companyId,
  currencyId: requestedCurrencyId,
  exchangeRate: requestedRate,
  exchangeRateDate,
  foreignAmount,
  supplierId,
  asOfDate = new Date(),
  client = prisma,
}) {
  const baseCurrency = await getCompanyBaseCurrency(companyId, client);
  if (!baseCurrency) {
    throw new Error('Company base currency could not be resolved');
  }

  let txnCurrency = null;

  if (requestedCurrencyId) {
    txnCurrency = await getCurrencyById(requestedCurrencyId, client);
    if (!txnCurrency || !txnCurrency.isActive) {
      throw new Error('Selected currency is inactive or not found');
    }
  } else if (supplierId) {
    const supplier = await client.supplier.findUnique({
      where: { id: supplierId },
      include: { currency: true },
    });
    if (supplier?.currency?.isActive) {
      txnCurrency = supplier.currency;
    }
  }

  if (!txnCurrency) {
    txnCurrency = baseCurrency;
  }

  const rateDate = exchangeRateDate ? new Date(exchangeRateDate) : new Date(asOfDate);
  let rate = null;

  if (isSameCurrency(txnCurrency.id, baseCurrency.id)) {
    rate = ONE;
  } else if (requestedRate !== null && requestedRate !== undefined && requestedRate !== '') {
    rate = toDecimal(requestedRate);
    if (rate.lte(0)) {
      throw new Error('Exchange rate must be greater than zero');
    }
  } else {
    const found = await getExchangeRate({
      companyId,
      fromCurrencyId: txnCurrency.id,
      toCurrencyId: baseCurrency.id,
      asOfDate: rateDate,
      client,
    });
    if (!found) {
      throw new Error(
        `No exchange rate found for ${txnCurrency.code} → ${baseCurrency.code} on or before ${rateDate.toISOString().slice(0, 10)}. Please set a rate or enter one on the document.`
      );
    }
    rate = toDecimal(found.rate);
  }

  const foreign = foreignAmount !== null && foreignAmount !== undefined
    ? roundMoney(foreignAmount)
    : null;
  const base = foreign !== null ? multiply(foreign, rate) : null;

  return {
    currencyId: txnCurrency.id,
    currency: txnCurrency,
    baseCurrencyId: baseCurrency.id,
    baseCurrency,
    exchangeRate: rate,
    exchangeRateDate: rateDate,
    foreignAmount: foreign,
    baseAmount: base,
    isForeign: !isSameCurrency(txnCurrency.id, baseCurrency.id),
  };
}

/**
 * Build persisted currency fields from a resolved snapshot + foreign amount.
 * grandTotal / amount Float fields remain the FOREIGN transaction amount for UX continuity.
 * Accounting posting must use baseAmount (number).
 */
function buildCurrencyPersistFields(resolved, foreignAmount) {
  const foreign = roundMoney(
    foreignAmount !== null && foreignAmount !== undefined
      ? foreignAmount
      : resolved.foreignAmount || 0
  );
  const rate = toDecimal(resolved.exchangeRate || 1);
  if (rate.lte(0)) {
    throw new Error('Exchange rate must be greater than zero');
  }
  const base = multiply(foreign, rate);

  return {
    currencyId: resolved.currencyId,
    baseCurrencyId: resolved.baseCurrencyId,
    exchangeRate: rate,
    exchangeRateDate: resolved.exchangeRateDate || new Date(),
    foreignAmount: foreign,
    baseAmount: base,
    /** Float-compatible number for JE / existing Float columns that store base for GL */
    baseAmountNumber: toNumber(base, 4),
    foreignAmountNumber: toNumber(foreign, 4),
    exchangeRateNumber: toNumber(rate, 8),
  };
}

/**
 * Compute realized FX difference on settlement.
 * AP was booked at invoiceBase (historical).
 * Payment settles foreignPaid at paymentRate → paymentBase.
 * difference = paymentBase - proportionalInvoiceBase
 *   > 0 → exchange loss (pay more local to settle same foreign)
 *   < 0 → exchange gain
 */
function computeExchangeDifference({
  foreignPaid,
  invoiceExchangeRate,
  paymentExchangeRate,
}) {
  const foreign = toDecimal(foreignPaid);
  const invRate = toDecimal(invoiceExchangeRate);
  const payRate = toDecimal(paymentExchangeRate);

  const invoiceBaseSlice = multiply(foreign, invRate);
  const paymentBase = multiply(foreign, payRate);
  const difference = subtract(paymentBase, invoiceBaseSlice);

  return {
    foreignPaid: roundMoney(foreign),
    invoiceBaseSlice,
    paymentBase,
    difference,
    isLoss: difference.gt(0),
    isGain: difference.lt(0),
    isZero: difference.abs().lt(0.005),
    differenceNumber: toNumber(difference, 4),
    paymentBaseNumber: toNumber(paymentBase, 4),
    invoiceBaseSliceNumber: toNumber(invoiceBaseSlice, 4),
  };
}

/**
 * Safe snapshot from an already-persisted document (immutable historical values).
 */
function snapshotFromDocument(doc, fallbackBaseCurrencyId = null) {
  const foreign = doc.foreignAmount != null
    ? toDecimal(doc.foreignAmount)
    : toDecimal(doc.grandTotal ?? doc.amount ?? 0);
  const rate = doc.exchangeRate != null ? toDecimal(doc.exchangeRate) : ONE;
  const base = doc.baseAmount != null
    ? toDecimal(doc.baseAmount)
    : multiply(foreign, rate);

  return {
    currencyId: doc.currencyId || fallbackBaseCurrencyId,
    baseCurrencyId: doc.baseCurrencyId || fallbackBaseCurrencyId,
    exchangeRate: rate,
    exchangeRateDate: doc.exchangeRateDate || null,
    foreignAmount: foreign,
    baseAmount: base,
    baseAmountNumber: toNumber(base, 4),
    foreignAmountNumber: toNumber(foreign, 4),
    exchangeRateNumber: toNumber(rate, 8),
  };
}

module.exports = {
  Decimal,
  ZERO,
  ONE,
  toDecimal,
  roundMoney,
  toNumber,
  multiply,
  subtract,
  isSameCurrency,
  DEFAULT_CURRENCIES,
  ensureCurrenciesSeeded,
  getCurrencyByCode,
  getCurrencyById,
  getCompanyBaseCurrency,
  getExchangeRate,
  resolveTransactionCurrency,
  buildCurrencyPersistFields,
  computeExchangeDifference,
  snapshotFromDocument,
};
