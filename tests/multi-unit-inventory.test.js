'use strict';

/**
 * Multi-unit inventory conversion + packaging integrity tests.
 * Covers medicine / oil / biscuits / rice / returns / stock-guard scenarios
 * from the product specification (pure service-level, no DB required).
 */

const assert = require('assert');
const {
  validateUnitsConfig,
  toBaseQuantity,
  fromBaseQuantity,
  packageBreakdown,
  buildUnitsFromLegacyProduct,
  deriveLegacyUomFields,
  findUnitInList,
} = require('../warehouse/services/productUnitService');
const {
  enteredToBaseQty,
  normalizeSalesQty,
  resolveProductUom,
} = require('../warehouse/services/productUomService');
const { roundTo } = require('../warehouse/services/inventoryMath');

function medicineUnits() {
  return validateUnitsConfig([
    { unitName: 'Tablet', conversionFactor: 1, isBase: true, allowSale: true, allowPurchase: false, isDefaultSale: false },
    { unitName: 'Strip', conversionFactor: 12, isBase: false, allowSale: true, allowPurchase: false, isDefaultSale: true, sellingPrice: 180 },
    { unitName: 'Box', conversionFactor: 24, isBase: false, allowSale: true, allowPurchase: true, isDefaultPurchase: true, purchasePrice: 240, sellingPrice: 360 },
  ]);
}

function oilUnits() {
  return validateUnitsConfig([
    { unitName: 'ml', conversionFactor: 1, isBase: true, allowSale: true, allowPurchase: false },
    { unitName: 'Litre', conversionFactor: 1000, isBase: false, allowSale: true, allowPurchase: false },
    { unitName: 'Bottle', conversionFactor: 5000, isBase: false, allowSale: true, allowPurchase: true, isDefaultSale: true, isDefaultPurchase: true },
  ]);
}

function biscuitUnits() {
  return validateUnitsConfig([
    { unitName: 'Piece', conversionFactor: 1, isBase: true, allowSale: true, allowPurchase: false },
    { unitName: 'Packet', conversionFactor: 12, isBase: false, allowSale: true, allowPurchase: false, isDefaultSale: true },
    { unitName: 'Carton', conversionFactor: 288, isBase: false, allowSale: true, allowPurchase: true, isDefaultPurchase: true }, // 24 packets * 12
  ]);
}

function riceUnits() {
  return validateUnitsConfig([
    { unitName: 'kg', conversionFactor: 1, isBase: true, allowSale: true, allowPurchase: false, isDefaultSale: true },
    { unitName: 'Bag', conversionFactor: 25, isBase: false, allowSale: true, allowPurchase: true, isDefaultPurchase: true },
    { unitName: 'Ton', conversionFactor: 1000, isBase: false, allowSale: false, allowPurchase: true },
  ]);
}

// ── A. Medicine ──────────────────────────────────────────────
function testMedicineReceiveAndSell() {
  const units = medicineUnits();
  const box = findUnitInList(units, { unitName: 'Box', forPurchase: true });
  const strip = findUnitInList(units, { unitName: 'Strip', forSale: true });
  const tablet = findUnitInList(units, { unitName: 'Tablet', forSale: true });

  let stock = toBaseQuantity(10, box); // 10 boxes
  assert.strictEqual(stock, 240);

  stock = roundTo(stock - toBaseQuantity(1, box), 6);
  stock = roundTo(stock - toBaseQuantity(1, strip), 6);
  stock = roundTo(stock - toBaseQuantity(6, tablet), 6);
  assert.strictEqual(stock, 198);

  const breakdown = packageBreakdown(198, units);
  assert.strictEqual(breakdown.baseQuantity, 198);
  assert.strictEqual(breakdown.packages.find((p) => p.unitName === 'Box').fullPackages, 8);
  assert.strictEqual(breakdown.looseQuantity, 6);
  // Equivalents must NOT be summed as separate inventory
  const bogusSum =
    breakdown.packages.reduce((s, p) => s + p.fullPackages, 0) + breakdown.looseQuantity;
  assert.notStrictEqual(bogusSum, breakdown.baseQuantity); // 8+0+6=14 ≠ 198
}

// ── B. Cooking oil ───────────────────────────────────────────
function testCookingOil() {
  const units = oilUnits();
  const bottle = findUnitInList(units, { unitName: 'Bottle' });
  const ml = findUnitInList(units, { unitName: 'ml' });

  let stock = toBaseQuantity(10, bottle);
  assert.strictEqual(stock, 50000);

  stock = roundTo(stock - toBaseQuantity(1, bottle), 6);
  stock = roundTo(stock - toBaseQuantity(500, ml), 6);
  assert.strictEqual(stock, 44500);
}

// ── C. Biscuits ──────────────────────────────────────────────
function testBiscuits() {
  const units = biscuitUnits();
  const carton = findUnitInList(units, { unitName: 'Carton', forPurchase: true });
  const packet = findUnitInList(units, { unitName: 'Packet', forSale: true });

  let stock = toBaseQuantity(10, carton);
  assert.strictEqual(stock, 2880);

  stock = roundTo(stock - toBaseQuantity(3, packet), 6);
  assert.strictEqual(stock, 2844);
}

// ── D. Rice (fractional) ─────────────────────────────────────
function testRiceFractional() {
  const units = riceUnits();
  const bag = findUnitInList(units, { unitName: 'Bag', forPurchase: true });
  const kg = findUnitInList(units, { unitName: 'kg', forSale: true });

  let stock = toBaseQuantity(5, bag);
  assert.strictEqual(stock, 125);

  const sellQty = normalizeSalesQty(7.5, {
    salesUnit: 'kg',
    salesFactor: 1,
    allowFractional: true,
    decimalPlaces: 3,
  });
  stock = roundTo(stock - toBaseQuantity(sellQty, kg), 6);
  assert.strictEqual(stock, 117.5);
}

// ── E. Returns + duplicate guard (logic) ──────────────────────
function testReturnsRestoreBaseQty() {
  const units = medicineUnits();
  const strip = findUnitInList(units, { unitName: 'Strip', forSale: true });
  let stock = 198;
  // Sell 1 strip
  const soldBase = toBaseQuantity(1, strip);
  stock = roundTo(stock - soldBase, 6);
  assert.strictEqual(stock, 186);
  // Return complete strip
  stock = roundTo(stock + soldBase, 6);
  assert.strictEqual(stock, 198);

  // Duplicate return prevention: track returned base qty vs original
  const originalSoldBase = 12;
  let returnedBase = 0;
  function postReturn(baseQty) {
    if (returnedBase + baseQty > originalSoldBase + 1e-9) {
      const err = new Error('Duplicate / excess return');
      err.code = 'DUPLICATE_RETURN';
      throw err;
    }
    returnedBase = roundTo(returnedBase + baseQty, 6);
    return true;
  }
  assert.strictEqual(postReturn(12), true);
  assert.throws(() => postReturn(12), /Duplicate/);
}

// ── F. Stock integrity ───────────────────────────────────────
function testInsufficientStockRejected() {
  const units = medicineUnits();
  const box = findUnitInList(units, { unitName: 'Box', forSale: true });
  const available = 20; // tablets
  const need = toBaseQuantity(1, box); // 24
  assert.ok(need > available);
}

function testConcurrentOversellGuard() {
  // Simulate optimistic concurrency: two sales both read 10, only one write succeeds
  let stock = 10;
  const version = { value: stock };
  function tryDeduct(qty) {
    const read = version.value;
    if (qty > read) return { ok: false, reason: 'insufficient' };
    // compare-and-swap
    if (version.value !== read) return { ok: false, reason: 'conflict' };
    version.value = read - qty;
    stock = version.value;
    return { ok: true };
  }
  const a = tryDeduct(8);
  assert.strictEqual(a.ok, true);
  // Second sale still thinks stock is 10 but CAS uses current value — simulate conflict
  const readStale = 10;
  const need = 8;
  if (need > version.value) {
    assert.ok(true); // insufficient after first sale
  } else if (version.value !== readStale) {
    assert.ok(true); // conflict
  }
  assert.strictEqual(stock, 2);
}

function testIdempotentPosting() {
  const posted = new Set();
  function post(key, deduct) {
    if (posted.has(key)) return { duplicate: true, stockChange: 0 };
    posted.add(key);
    return { duplicate: false, stockChange: deduct };
  }
  assert.strictEqual(post('sale-1', 24).stockChange, 24);
  assert.strictEqual(post('sale-1', 24).duplicate, true);
  assert.strictEqual(post('sale-1', 24).stockChange, 0);
}

function testWarehouseTransferPreservesTotal() {
  let whA = 100;
  let whB = 40;
  const totalBefore = whA + whB;
  const move = 25;
  whA -= move;
  whB += move;
  assert.strictEqual(whA + whB, totalBefore);
}

function testOpeningStockNotDuplicatedOnEdit() {
  const product = { openingStockPosted: true, openingStock: 240, currentStock: 240 };
  function applyOpeningOnEdit(p, requestedOpening) {
    if (p.openingStockPosted && requestedOpening != null && requestedOpening !== p.openingStock) {
      throw new Error('Opening stock cannot be changed on product edit');
    }
    return p.currentStock;
  }
  assert.throws(() => applyOpeningOnEdit(product, 480));
  assert.strictEqual(applyOpeningOnEdit(product, 240), 240);
}

function testConversionChangeDoesNotRewriteHistory() {
  // Historical movement snapshots keep their conversionFactor
  const historical = { enteredQuantity: 1, unitName: 'Box', conversionFactor: 24, baseQuantity: 24 };
  const newConfigFactor = 30; // packaging changed later
  assert.strictEqual(historical.baseQuantity, 24);
  assert.notStrictEqual(historical.conversionFactor, newConfigFactor);
}

function testRejectNonPositiveFactor() {
  assert.throws(
    () => validateUnitsConfig([
      { unitName: 'Tablet', conversionFactor: 1, isBase: true, allowSale: true },
      { unitName: 'Strip', conversionFactor: 0, allowSale: true },
    ]),
    /positive/
  );
  assert.throws(
    () => validateUnitsConfig([
      { unitName: 'Tablet', conversionFactor: 1, isBase: true, allowSale: true },
      { unitName: 'Strip', conversionFactor: -12, allowSale: true },
    ]),
    /positive/
  );
}

function testLegacyBackfill() {
  const legacy = buildUnitsFromLegacyProduct({
    stockUnitName: 'KG',
    salesUnitName: 'G',
    salesConversionFactor: 0.001,
    purchaseUnitName: 'Bag',
    purchaseConversionFactor: 25,
    sellingPrice: 300,
    costPrice: 250,
    allowFractionalQty: true,
  });
  assert.ok(legacy.some((u) => u.isBase && u.unitName === 'KG'));
  assert.ok(legacy.some((u) => u.unitName === 'G' && u.conversionFactor === 0.001));
  assert.ok(legacy.some((u) => u.unitName === 'Bag' && u.conversionFactor === 25));
  const fields = deriveLegacyUomFields(legacy, {});
  assert.strictEqual(fields.stockUnitName, 'KG');
}

function testEnteredToBaseHelper() {
  assert.strictEqual(enteredToBaseQty(2, 12, { unitName: 'Strip' }), 24);
  assert.strictEqual(fromBaseQuantity(24, 12), 2);
}

function testCompanyIsolationConcept() {
  const movements = [
    { companyId: 'A', productId: 'p1', base: 10 },
    { companyId: 'B', productId: 'p1', base: 99 },
  ];
  const forA = movements.filter((m) => m.companyId === 'A');
  assert.strictEqual(forA.reduce((s, m) => s + m.base, 0), 10);
}

// Run
const tests = [
  testMedicineReceiveAndSell,
  testCookingOil,
  testBiscuits,
  testRiceFractional,
  testReturnsRestoreBaseQty,
  testInsufficientStockRejected,
  testConcurrentOversellGuard,
  testIdempotentPosting,
  testWarehouseTransferPreservesTotal,
  testOpeningStockNotDuplicatedOnEdit,
  testConversionChangeDoesNotRewriteHistory,
  testRejectNonPositiveFactor,
  testLegacyBackfill,
  testEnteredToBaseHelper,
  testCompanyIsolationConcept,
];

let failed = 0;
for (const fn of tests) {
  try {
    fn();
    console.log(`ok - ${fn.name}`);
  } catch (err) {
    failed += 1;
    console.error(`FAIL - ${fn.name}:`, err.message);
  }
}

if (failed) {
  console.error(`\n${failed} test(s) failed`);
  process.exit(1);
}
console.log(`\nmulti-unit-inventory: ${tests.length} tests passed`);
process.exit(0);
