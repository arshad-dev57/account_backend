/**
 * Product UOM helpers for POS / inventory.
 * Stock is always maintained in product.stockUnitName (base).
 * Sales qty is in sales unit; baseQty = salesQty * salesConversionFactor.
 */
const { toNumber, roundTo } = require('./inventoryMath');

const FRACTIONAL_UNIT_CODES = new Set([
  'KG', 'G', 'GRAM', 'GRAMS', 'KILOGRAM', 'KILOGRAMS',
  'LTR', 'L', 'LITRE', 'LITER', 'LITRES', 'LITERS',
  'ML', 'MILLILITRE', 'MILLILITER', 'MILLILITRES', 'MILLILITERS',
  'M', 'MTR', 'METER', 'METRE', 'METERS', 'METRES',
]);

const UNIT_DECIMAL_PLACES = {
  PCS: 0, PIECE: 0, PIECES: 0, PC: 0,
  BOX: 0, CTN: 0, CARTON: 0, DOZ: 0, DOZEN: 0, PACKET: 0, BOTTLE: 0, BTL: 0,
  KG: 3, KILOGRAM: 3, KILOGRAMS: 3,
  G: 3, GRAM: 3, GRAMS: 3,
  LTR: 3, L: 3, LITRE: 3, LITER: 3, LITRES: 3, LITERS: 3,
  ML: 3, MILLILITRE: 3, MILLILITER: 3,
  M: 3, MTR: 3, METER: 3, METRE: 3,
};

function normalizeUnitCode(unit) {
  return String(unit || 'Pcs').trim().toUpperCase() || 'PCS';
}

function isFractionalUnit(unit) {
  const code = normalizeUnitCode(unit).replace(/[^A-Z0-9]/g, '');
  if (!code) return false;
  if (FRACTIONAL_UNIT_CODES.has(code)) return true;
  if (code === 'KGS' || code === 'GS' || code === 'LTRS') return true;
  if (code.includes('KILO') || code.includes('GRAM') || code.includes('LITR') || code.includes('MILLI') || code.includes('METR')) {
    return true;
  }
  return false;
}

function decimalPlacesForUnit(unit, allowFractional = false) {
  const code = normalizeUnitCode(unit);
  if (UNIT_DECIMAL_PLACES[code] != null) return UNIT_DECIMAL_PLACES[code];
  return allowFractional || isFractionalUnit(code) ? 3 : 0;
}

function resolveProductUom(product = {}) {
  const stockUnit = String(product.stockUnitName || product.stockUnit || 'Pcs').trim() || 'Pcs';
  const salesUnit = String(product.salesUnitName || stockUnit).trim() || stockUnit;
  const purchaseUnit = String(product.purchaseUnitName || stockUnit).trim() || stockUnit;
  let salesFactor = toNumber(product.salesConversionFactor, 1);
  if (!Number.isFinite(salesFactor) || salesFactor <= 0) salesFactor = 1;
  let purchaseFactor = toNumber(product.purchaseConversionFactor, 1);
  if (!Number.isFinite(purchaseFactor) || purchaseFactor <= 0) purchaseFactor = 1;
  const allowFractional = Boolean(
    product.allowFractionalQty ||
    isFractionalUnit(stockUnit) ||
    isFractionalUnit(salesUnit)
  );
  const decimalPlaces = decimalPlacesForUnit(salesUnit, allowFractional);
  return {
    stockUnit,
    salesUnit,
    purchaseUnit,
    salesFactor,
    purchaseFactor,
    allowFractional,
    decimalPlaces,
  };
}

/**
 * Normalize a sales-unit quantity (POS cart qty).
 */
function normalizeSalesQty(qty, productOrUom) {
  const uom = productOrUom.salesUnit != null ? productOrUom : resolveProductUom(productOrUom);
  const n = toNumber(qty);
  if (n <= 0) return 0;
  // Keep decimals when product is weight/volume OR cashier entered e.g. 1.5
  const hasFraction = Math.abs(n - Math.round(n)) > 1e-9;
  if (uom.allowFractional || hasFraction) {
    return roundTo(n, Math.max(uom.decimalPlaces || 0, 3));
  }
  return Math.max(0, Math.round(n));
}

/**
 * Convert sales qty → stock/base qty for inventory movements.
 */
function toBaseQty(salesQty, productOrUom) {
  const uom = productOrUom.salesUnit != null ? productOrUom : resolveProductUom(productOrUom);
  const qty = normalizeSalesQty(salesQty, uom);
  return roundTo(qty * uom.salesFactor, 6);
}

/**
 * Max sellable qty in sales units given available stock in base units.
 */
function maxSellableSalesQty(availableBaseStock, productOrUom) {
  const uom = productOrUom.salesUnit != null ? productOrUom : resolveProductUom(productOrUom);
  const avail = Math.max(0, toNumber(availableBaseStock));
  if (uom.salesFactor <= 0) return 0;
  const inSales = avail / uom.salesFactor;
  return normalizeSalesQty(inSales, uom);
}

/**
 * Cost per sales unit from cost stored per stock unit.
 */
function costPerSalesUnit(costPerStockUnit, productOrUom) {
  const uom = productOrUom.salesUnit != null ? productOrUom : resolveProductUom(productOrUom);
  return roundTo(toNumber(costPerStockUnit) * uom.salesFactor, 4);
}

/**
 * Cost per stock unit from purchase price per purchase unit.
 */
function costPerStockFromPurchase(purchasePrice, productOrUom) {
  const uom = productOrUom.salesUnit != null ? productOrUom : resolveProductUom(productOrUom);
  const factor = uom.purchaseFactor > 0 ? uom.purchaseFactor : 1;
  return roundTo(toNumber(purchasePrice) / factor, 4);
}

module.exports = {
  FRACTIONAL_UNIT_CODES,
  normalizeUnitCode,
  isFractionalUnit,
  decimalPlacesForUnit,
  resolveProductUom,
  normalizeSalesQty,
  toBaseQty,
  maxSellableSalesQty,
  costPerSalesUnit,
  costPerStockFromPurchase,
};
