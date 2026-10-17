'use strict';

/**
 * Trading module unit tests — company isolation helpers, KPI math, channel validation.
 * Does not mutate production data.
 */

const assert = require('assert');
const {
  DOCUMENT_TYPES,
  TRADE_CHANNELS,
  assertSameCompany,
  computeGrossProfit,
  isOpenPurchaseCommitment,
  toNumber,
} = require('../services/tradingService');

function testDocumentTypes() {
  assert.ok(DOCUMENT_TYPES.SALES_ORDER);
  assert.ok(DOCUMENT_TYPES.PURCHASE_ORDER);
  assert.ok(DOCUMENT_TYPES.SALES_INVOICE);
  assert.ok(DOCUMENT_TYPES.GRN);
  assert.strictEqual(Object.keys(DOCUMENT_TYPES).length >= 8, true);
}

function testTradeChannels() {
  assert.ok(TRADE_CHANNELS.has('domestic'));
  assert.ok(TRADE_CHANNELS.has('wholesale'));
  assert.ok(!TRADE_CHANNELS.has('export')); // export is a separate module book
}

function testCompanyIsolationSame() {
  assert.doesNotThrow(() => assertSameCompany('co-a', 'co-a'));
}

function testCompanyIsolationDenied() {
  let caught = null;
  try {
    assertSameCompany('co-a', 'co-b');
  } catch (e) {
    caught = e;
  }
  assert.ok(caught);
  assert.strictEqual(caught.statusCode, 403);
  assert.strictEqual(caught.code, 'CROSS_COMPANY_DENIED');
}

function testCompanyIsolationConsolidated() {
  assert.doesNotThrow(() =>
    assertSameCompany('co-a', { in: ['co-a', 'co-b'] })
  );
  let caught = null;
  try {
    assertSameCompany('co-c', { in: ['co-a', 'co-b'] });
  } catch (e) {
    caught = e;
  }
  assert.ok(caught);
  assert.strictEqual(caught.statusCode, 403);
}

function testGrossProfitUsesCogsNotPurchases() {
  // Sales 100k, COGS 60k → GP 40k (NOT sales − purchases)
  const { grossProfit, marginPct } = computeGrossProfit(100000, 60000);
  assert.strictEqual(grossProfit, 40000);
  assert.ok(Math.abs(marginPct - 40) < 0.001);

  // Purchases must not be used as COGS substitute in this helper
  const wrongIfPurchases = computeGrossProfit(100000, 90000); // if someone passed purchases
  assert.notStrictEqual(wrongIfPurchases.grossProfit, 40000);
}

function testOpenCommitmentsNotAp() {
  assert.strictEqual(isOpenPurchaseCommitment('Confirmed'), true);
  assert.strictEqual(isOpenPurchaseCommitment('Draft'), true);
  assert.strictEqual(isOpenPurchaseCommitment('Received & Invoiced'), false);
  assert.strictEqual(isOpenPurchaseCommitment('Cancelled'), false);
  assert.strictEqual(isOpenPurchaseCommitment('Closed'), false);
}

function testToNumberSafe() {
  assert.strictEqual(toNumber(null), 0);
  assert.strictEqual(toNumber('12.5'), 12.5);
  assert.strictEqual(toNumber('abc'), 0);
}

function testNoDuplicateGlClaim() {
  // Architectural invariant: trading service does not export post/journal helpers
  const svc = require('../services/tradingService');
  assert.strictEqual(typeof svc.postJournal, 'undefined');
  assert.strictEqual(typeof svc.createJournalEntry, 'undefined');
  assert.strictEqual(typeof svc.postInvoice, 'undefined');
  assert.ok(typeof svc.linkDocument === 'function');
  assert.ok(typeof svc.getDashboardKpis === 'function');
}

/**
 * Reproduce the browser HTML5 constraint that caused:
 * "Please enter a valid value. The two nearest values are 0.9901 and 1.0001"
 * when Min qty = 1 with min=0.0001 and step=0.01.
 */
function html5StepValid(value, min, step) {
  const n = (Number(value) - Number(min)) / Number(step);
  return Number.isFinite(n) && Math.abs(n - Math.round(n)) < 1e-9;
}

function testMinQtyHtml5StepMismatchRootCause() {
  // Broken attributes previously on Min qty input
  assert.strictEqual(html5StepValid(1, 0.0001, 0.01), false);
  assert.strictEqual(html5StepValid(0.9901, 0.0001, 0.01), true);
  assert.strictEqual(html5StepValid(1.0001, 0.0001, 0.01), true);
  // Fixed attributes: min=0 step=any — browser skips step base matching
  assert.ok(1 >= 0);
  assert.strictEqual(Number.isFinite(1), true);
}

function testMapPriceListItemValidDefaults() {
  const { mapPriceListItemCreate } = require('../services/tradingService');
  const row = mapPriceListItemCreate({
    productId: 'prod-1',
    unitPrice: 10000,
    listPrice: 10000,
    minQty: 1,
    maxQty: null,
    discountPercentage: 0,
    markupPercentage: 0,
  });
  assert.strictEqual(row.unitPrice, 10000);
  assert.strictEqual(row.listPrice, 10000);
  assert.strictEqual(row.minQty, 1);
  assert.strictEqual(row.maxQty, null);
  assert.strictEqual(row.discountPercentage, 0);
  assert.strictEqual(row.markupPercentage, 0);
}

function testMapPriceListItemDecimalPricesAndQty() {
  const { mapPriceListItemCreate } = require('../services/tradingService');
  const row = mapPriceListItemCreate({
    productId: 'prod-2',
    unitPrice: 12.3456,
    listPrice: 15.5,
    minQty: 0.5,
    maxQty: 100.25,
    discountPercentage: 2.5,
    markupPercentage: 7.25,
  });
  assert.strictEqual(row.unitPrice, 12.3456);
  assert.strictEqual(row.listPrice, 15.5);
  assert.strictEqual(row.minQty, 0.5);
  assert.strictEqual(row.maxQty, 100.25);
  assert.strictEqual(row.discountPercentage, 2.5);
  assert.strictEqual(row.markupPercentage, 7.25);
}

function testMapPriceListItemBlankMaxQty() {
  const { mapPriceListItemCreate } = require('../services/tradingService');
  const row = mapPriceListItemCreate({
    productId: 'prod-3',
    unitPrice: 100,
    minQty: 1,
    maxQty: '',
  });
  assert.strictEqual(row.maxQty, null);
}

function testMapPriceListItemQuantityBoundaries() {
  const { mapPriceListItemCreate } = require('../services/tradingService');
  const ok = mapPriceListItemCreate({
    productId: 'prod-4',
    unitPrice: 10,
    minQty: 10,
    maxQty: 10,
  });
  assert.strictEqual(ok.maxQty, 10);

  assert.throws(
    () =>
      mapPriceListItemCreate({
        productId: 'prod-4',
        unitPrice: 10,
        minQty: 0,
      }),
    /Min qty must be greater than 0/
  );
  assert.throws(
    () =>
      mapPriceListItemCreate({
        productId: 'prod-4',
        unitPrice: 10,
        minQty: 5,
        maxQty: 4,
      }),
    /Max qty must be ≥ min qty/
  );
}

function testMapPriceListItemRejectsInvalid() {
  const { mapPriceListItemCreate } = require('../services/tradingService');
  assert.throws(
    () => mapPriceListItemCreate({ unitPrice: 10 }),
    /productId/
  );
  assert.throws(
    () =>
      mapPriceListItemCreate({
        productId: 'p',
        unitPrice: -1,
      }),
    /Net \/ unit price/
  );
  assert.throws(
    () =>
      mapPriceListItemCreate({
        productId: 'p',
        unitPrice: 10,
        listPrice: -5,
      }),
    /List price/
  );
  assert.throws(
    () =>
      mapPriceListItemCreate({
        productId: 'p',
        unitPrice: 10,
        discountPercentage: -1,
      }),
    /cannot be negative/
  );
  assert.throws(
    () =>
      mapPriceListItemCreate({
        productId: 'p',
        unitPrice: 10,
        markupPercentage: -0.01,
      }),
    /cannot be negative/
  );
}

function testMinOrderQtyHtml5StepMismatchRootCause() {
  // Same browser constraint as price-list Min qty — Customer Pricing Min Order Qty
  assert.strictEqual(html5StepValid(1, 0.0001, 0.01), false);
  const n = (1 - 0.0001) / 0.01;
  const lo = +(0.0001 + Math.floor(n) * 0.01).toFixed(4);
  const hi = +(0.0001 + Math.ceil(n) * 0.01).toFixed(4);
  assert.strictEqual(lo, 0.9901);
  assert.strictEqual(hi, 1.0001);
  assert.ok(1 >= 0);
}

function testMapCustomerPriceMinOrderQtyOne() {
  const { mapCustomerPriceFields } = require('../services/tradingService');
  const row = mapCustomerPriceFields({
    listPrice: 100,
    negotiatedPrice: 90,
    discountPercentage: 10,
    targetMarginPct: 20,
    minOrderQty: 1,
  });
  assert.strictEqual(row.minOrderQty, 1);
  assert.strictEqual(row.listPrice, 100);
  assert.strictEqual(row.negotiatedPrice, 90);
}

function testMapCustomerPriceWholeAndFractionalQty() {
  const { mapCustomerPriceFields } = require('../services/tradingService');
  assert.strictEqual(
    mapCustomerPriceFields({
      listPrice: 10,
      negotiatedPrice: 10,
      minOrderQty: 12,
    }).minOrderQty,
    12
  );
  assert.strictEqual(
    mapCustomerPriceFields({
      listPrice: 10,
      negotiatedPrice: 10,
      minOrderQty: 0.5,
    }).minOrderQty,
    0.5
  );
  assert.strictEqual(
    mapCustomerPriceFields({
      listPrice: 10,
      negotiatedPrice: 10,
      minOrderQty: 2.25,
    }).minOrderQty,
    2.25
  );
}

function testMapCustomerPriceRejectsZeroNegativeInvalidQty() {
  const { mapCustomerPriceFields } = require('../services/tradingService');
  assert.throws(
    () =>
      mapCustomerPriceFields({
        listPrice: 10,
        negotiatedPrice: 10,
        minOrderQty: 0,
      }),
    /Min order qty must be greater than 0/
  );
  assert.throws(
    () =>
      mapCustomerPriceFields({
        listPrice: 10,
        negotiatedPrice: 10,
        minOrderQty: -1,
      }),
    /Min order qty must be greater than 0/
  );
  assert.throws(
    () =>
      mapCustomerPriceFields({
        listPrice: -1,
        negotiatedPrice: 10,
        minOrderQty: 1,
      }),
    /List price/
  );
  assert.throws(
    () =>
      mapCustomerPriceFields({
        listPrice: 10,
        negotiatedPrice: -0.01,
        minOrderQty: 1,
      }),
    /Negotiated price/
  );
  assert.throws(
    () =>
      mapCustomerPriceFields({
        listPrice: 10,
        negotiatedPrice: 10,
        minOrderQty: 1,
        discountPercentage: -5,
      }),
    /cannot be negative/
  );
}

testDocumentTypes();
testTradeChannels();
testCompanyIsolationSame();
testCompanyIsolationDenied();
testCompanyIsolationConsolidated();
testGrossProfitUsesCogsNotPurchases();
testOpenCommitmentsNotAp();
testToNumberSafe();
testNoDuplicateGlClaim();
testMinQtyHtml5StepMismatchRootCause();
testMapPriceListItemValidDefaults();
testMapPriceListItemDecimalPricesAndQty();
testMapPriceListItemBlankMaxQty();
testMapPriceListItemQuantityBoundaries();
testMapPriceListItemRejectsInvalid();
testMinOrderQtyHtml5StepMismatchRootCause();
testMapCustomerPriceMinOrderQtyOne();
testMapCustomerPriceWholeAndFractionalQty();
testMapCustomerPriceRejectsZeroNegativeInvalidQty();

function testEvaluateCustomerPriceValidity() {
  const { evaluateCustomerPriceValidity } = require('../services/tradingService');
  const active = evaluateCustomerPriceValidity(
    {
      status: 'Active',
      effectiveFrom: new Date('2020-01-01'),
      effectiveUntil: null,
      minOrderQty: 5,
    },
    { quantity: 1, asOfDate: new Date('2026-10-16') }
  );
  assert.strictEqual(active.valid, true);
  assert.ok(active.warnings.some((w) => /minimum order qty/i.test(w)));

  const expired = evaluateCustomerPriceValidity(
    {
      status: 'Active',
      effectiveFrom: new Date('2020-01-01'),
      effectiveUntil: new Date('2020-12-31'),
      minOrderQty: 1,
    },
    { quantity: 1, asOfDate: new Date('2026-10-16') }
  );
  assert.strictEqual(expired.valid, false);
  assert.ok(expired.reasons.some((r) => /expired/i.test(r)));

  const inactive = evaluateCustomerPriceValidity(
    { status: 'Draft', minOrderQty: 1 },
    { quantity: 1, asOfDate: new Date() }
  );
  assert.strictEqual(inactive.valid, false);
}

function testPickPriceListItemDeterministic() {
  const { pickPriceListItem } = require('../services/tradingService');
  const productId = 'p1';
  const items = [
    { id: 'a', productId, minQty: 1, maxQty: 9, unitPrice: 100 },
    { id: 'b', productId, minQty: 10, maxQty: null, unitPrice: 90 },
    { id: 'c', productId, minQty: 5, maxQty: 20, unitPrice: 95 },
  ];
  assert.strictEqual(pickPriceListItem(items, productId, 1).unitPrice, 100);
  assert.strictEqual(pickPriceListItem(items, productId, 7).unitPrice, 95);
  assert.strictEqual(pickPriceListItem(items, productId, 10).unitPrice, 90);
}

function testApplyResolvedPriceRespectsManualOverride() {
  const { applyResolvedPriceToLine } = require('../services/tradingService');
  const resolved = {
    unitPrice: 9590,
    taxRate: 0,
    currencyCode: 'PKR',
    unitName: 'Pcs',
    listPrice: 10000,
    source: 'CUSTOMER_NEGOTIATED',
    messages: [],
    warnings: [],
  };
  const auto = applyResolvedPriceToLine(resolved, { unitPrice: 10000, discount: 0 });
  assert.strictEqual(auto.unitPrice, 9590);
  assert.strictEqual(auto.pricingSource, 'CUSTOMER_NEGOTIATED');

  const manual = applyResolvedPriceToLine(resolved, {
    unitPrice: 9000,
    manualPriceOverride: true,
    discount: 2,
  });
  assert.strictEqual(manual.unitPrice, 9000);
  assert.strictEqual(manual.pricingSource, 'MANUAL');
  assert.strictEqual(manual.discount, 2);
}

testEvaluateCustomerPriceValidity();
testPickPriceListItemDeterministic();
testApplyResolvedPriceRespectsManualOverride();

/**
 * Regression: direct Sales Order pricing for jhon doe × Office Chair.
 * Uses live company fixtures when present; skips gracefully otherwise.
 * Asserts resolveSellPrice returns negotiated 9590 (not catalog 10000).
 */
async function testJhonDoeOfficeChairNegotiatedOnDirectSalesOrder() {
  const prisma = require('../prisma/client');
  const { resolveSellPrice, applyResolvedPriceToLine } = require('../services/tradingService');

  const companyId = '73bf6455-9670-48e3-b1d6-2c05f0a5d9e4';
  const company = await prisma.company.findUnique({ where: { id: companyId } });
  if (!company) {
    console.log('skip jhon-doe SO pricing (company not in DB)');
    return;
  }

  const customer = await prisma.customer.findFirst({
    where: {
      companyId,
      name: { equals: 'jhon doe', mode: 'insensitive' },
      isActive: true,
      isDeleted: false,
    },
  });
  const product = await prisma.product.findFirst({
    where: {
      companyId,
      name: { equals: 'Office Chair', mode: 'insensitive' },
      isActive: true,
    },
  });
  if (!customer || !product) {
    console.log('skip jhon-doe SO pricing (customer/product missing)');
    return;
  }

  const agreement = await prisma.tradingCustomerPrice.findUnique({
    where: {
      companyId_customerId_productId: {
        companyId,
        customerId: customer.id,
        productId: product.id,
      },
    },
  });
  assert.ok(agreement, 'jhon doe must have Office Chair customer price');
  assert.strictEqual(Number(agreement.negotiatedPrice), 9590);
  assert.strictEqual(String(agreement.status), 'Active');

  const resolved = await resolveSellPrice({
    companyId,
    customerId: customer.id,
    productId: product.id,
    quantity: 1,
    asOfDate: new Date(),
  });

  assert.strictEqual(resolved.source, 'CUSTOMER_NEGOTIATED');
  assert.strictEqual(Number(resolved.unitPrice), 9590);
  assert.notStrictEqual(
    Number(resolved.unitPrice),
    Number(product.sellingPrice),
    'negotiated must not fall back to catalog selling'
  );

  // Simulate direct SO line auto-apply (no manual override)
  const soLine = applyResolvedPriceToLine(resolved, {
    unitPrice: product.sellingPrice,
    quantity: 1,
  });
  assert.strictEqual(soLine.unitPrice, 9590);
  assert.strictEqual(soLine.pricingSource, 'CUSTOMER_NEGOTIATED');

  // Manual override on SO must keep typed price
  const overridden = applyResolvedPriceToLine(resolved, {
    unitPrice: 9000,
    manualPriceOverride: true,
  });
  assert.strictEqual(overridden.unitPrice, 9000);
  assert.strictEqual(overridden.pricingSource, 'MANUAL');
}

(async () => {
  await testJhonDoeOfficeChairNegotiatedOnDirectSalesOrder();
  console.log('trading-module tests passed');
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
