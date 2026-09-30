/**
 * Shared inventory math — quantity + cost precision.
 * Avoid float drift for stock/value calculations.
 */

function roundTo(value, precision = 6) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  const p = Math.max(0, Math.min(12, Number(precision) || 6));
  const factor = 10 ** p;
  return Math.round((n + Number.EPSILON) * factor) / factor;
}

function toNumber(value, fallback = 0) {
  if (value === null || value === undefined || value === '') return fallback;
  const n = typeof value === 'number' ? value : Number(String(value).replace(/,/g, '').trim());
  return Number.isFinite(n) ? n : fallback;
}

/**
 * Weighted Average Cost:
 * newAvg = (existingQty * existingAvg + recvQty * recvCost) / (existingQty + recvQty)
 */
function computeWeightedAverageCost({
  existingQty,
  existingAvgCost,
  receivedQty,
  receivedUnitCost,
  costPrecision = 4,
}) {
  const eq = toNumber(existingQty);
  const rq = toNumber(receivedQty);
  const ea = toNumber(existingAvgCost);
  const rc = toNumber(receivedUnitCost);

  if (rq <= 0) return roundTo(ea, costPrecision);
  if (eq <= 0) return roundTo(rc, costPrecision);

  const totalQty = eq + rq;
  if (totalQty <= 0) return roundTo(rc, costPrecision);
  return roundTo((eq * ea + rq * rc) / totalQty, costPrecision);
}

function stockValue(qty, unitCost, costPrecision = 4) {
  return roundTo(toNumber(qty) * toNumber(unitCost), costPrecision);
}

function availableStock(onHand, reserved) {
  return Math.max(0, toNumber(onHand) - toNumber(reserved));
}

/** Canonical movement types for the stock ledger */
const MOVEMENT_TYPES = {
  OPENING_BALANCE: 'OPENING_BALANCE',
  OPENING_ADJUSTMENT: 'OPENING_ADJUSTMENT',
  STOCK_TAKE: 'STOCK_TAKE',
  PURCHASE_RECEIPT: 'PURCHASE_RECEIPT',
  PURCHASE_RETURN: 'PURCHASE_RETURN',
  SALES_DELIVERY: 'SALES_DELIVERY',
  SALES_RETURN: 'SALES_RETURN',
  TRANSFER_OUT: 'TRANSFER_OUT',
  TRANSFER_IN: 'TRANSFER_IN',
  STOCK_ADJUSTMENT: 'STOCK_ADJUSTMENT',
  PRODUCTION_RECEIPT: 'PRODUCTION_RECEIPT',
  PRODUCTION_CONSUMPTION: 'PRODUCTION_CONSUMPTION',
  STOCK_ISSUE: 'STOCK_ISSUE',
  STOCK_RECEIPT: 'STOCK_RECEIPT',
};

module.exports = {
  roundTo,
  toNumber,
  computeWeightedAverageCost,
  stockValue,
  availableStock,
  MOVEMENT_TYPES,
};
