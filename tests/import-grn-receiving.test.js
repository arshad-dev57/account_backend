'use strict';

/**
 * Import GRN receiving — quantity validation, remaining calc, serialization.
 * Uses pure helpers; optional live DB checks when IMPORT_GRN_DB_TESTS=1.
 */

const assert = require('assert');
const {
  toNumber,
  validateReceiveQty,
  serializePoItemForReceiving,
  sumPostedAcceptedForPo,
  IMPORT_GRN_POSTED_STATUSES,
} = require('../services/importService');

function testSerializeReceivingLine1000Kg() {
  const line = serializePoItemForReceiving(
    {
      id: 'line-1',
      productId: 'prod-1',
      productName: 'Premium Basmati Rice',
      sku: 'CUSTOM-0003',
      quantity: 1000,
      receivedQty: 0,
      uom: 'kg',
      unitPrice: 1.2,
    },
    0
  );
  assert.strictEqual(line.orderedQty, 1000);
  assert.strictEqual(line.previouslyReceivedQty, 0);
  assert.strictEqual(line.remainingQty, 1000);
  assert.strictEqual(line.sku, 'CUSTOM-0003');
  assert.strictEqual(line.uom, 'kg');
}

function testPartialThenFullRemaining() {
  const after400 = serializePoItemForReceiving(
    { id: 'l1', productId: 'p1', productName: 'Rice', quantity: 1000, uom: 'kg', unitPrice: 1 },
    400
  );
  assert.strictEqual(after400.remainingQty, 600);

  const after1000 = serializePoItemForReceiving(
    { id: 'l1', productId: 'p1', productName: 'Rice', quantity: 1000, uom: 'kg', unitPrice: 1 },
    1000
  );
  assert.strictEqual(after1000.remainingQty, 0);
}

function testRejectOverReceive() {
  let caught = null;
  try {
    validateReceiveQty({
      orderedQty: 1000,
      alreadyReceivedQty: 400,
      receiveQty: 700,
    });
  } catch (e) {
    caught = e;
  }
  assert.ok(caught);
  assert.strictEqual(caught.code, 'OVER_RECEIVE');
}

function testAcceptExactRemaining() {
  const r = validateReceiveQty({
    orderedQty: 1000,
    alreadyReceivedQty: 400,
    receiveQty: 600,
  });
  assert.strictEqual(r.remaining, 600);
  assert.strictEqual(r.recv, 600);
}

function testRejectZeroAndNegative() {
  let z = null;
  try {
    validateReceiveQty({ orderedQty: 1000, alreadyReceivedQty: 0, receiveQty: 0 });
  } catch (e) {
    z = e;
  }
  assert.ok(z);
  assert.strictEqual(z.code, 'INVALID_QTY');

  let n = null;
  try {
    validateReceiveQty({ orderedQty: 1000, alreadyReceivedQty: 0, receiveQty: -5 });
  } catch (e) {
    n = e;
  }
  assert.ok(n);
  assert.strictEqual(n.code, 'INVALID_QTY');
}

function testDecimalCoercion() {
  assert.strictEqual(toNumber('1000'), 1000);
  assert.strictEqual(toNumber({ toString: () => '250' }, 0), 250);
  const line = serializePoItemForReceiving(
    { id: 'x', productId: 'p', productName: 'A', quantity: '1000', uom: 'kg', unitPrice: '0' },
    '0'
  );
  assert.strictEqual(line.orderedQty, 1000);
  assert.strictEqual(line.remainingQty, 1000);
}

function testPostedStatusesDoNotIncludeDraft() {
  assert.ok(!IMPORT_GRN_POSTED_STATUSES.includes('Draft'));
  assert.ok(!IMPORT_GRN_POSTED_STATUSES.includes('Cancelled'));
  assert.ok(IMPORT_GRN_POSTED_STATUSES.includes('Inspected & Received'));
}

async function testLiveAuditAndRemainingIfEnabled() {
  if (process.env.IMPORT_GRN_DB_TESTS !== '1') {
    console.log('  ⊘ testLiveAuditAndRemainingIfEnabled (skipped — set IMPORT_GRN_DB_TESTS=1)');
    return;
  }
  const prisma = require('../prisma/client');
  const po = await prisma.importPurchaseOrder.findFirst({
    where: { poNumber: 'IPO-2026-002' },
    include: { items: true },
  });
  assert.ok(po, 'IPO-2026-002 should exist for live test');
  const posted = await sumPostedAcceptedForPo(prisma, {
    companyId: po.companyId,
    importPoId: po.id,
  });
  const item = po.items[0];
  const previously =
    posted.byPoItemId[item.id] || posted.byProductId[item.productId] || 0;
  const remaining = Math.max(0, toNumber(item.quantity) - previously);
  console.log(
    `  · live IPO-2026-002 ordered=${item.quantity} previously=${previously} remaining=${remaining}`
  );
  // Two historical Inspected GRNs at 1000 each → remaining must be 0
  assert.ok(previously >= 1000, 'posted accepted should include historical IGRNs');
  assert.strictEqual(remaining, 0);
}

async function testLiveCreatePostIdempotencyAndOverReceive() {
  if (process.env.IMPORT_GRN_DB_TESTS !== '1') {
    console.log('  ⊘ testLiveCreatePostIdempotencyAndOverReceive (skipped)');
    return;
  }
  const prisma = require('../prisma/client');
  const { createGrn, getReceivingPreview } = require('../services/importService');

  const seedPo = await prisma.importPurchaseOrder.findFirst({
    where: { poNumber: 'IPO-2026-002' },
    include: { items: true },
  });
  assert.ok(seedPo);
  const productId = seedPo.items[0].productId;
  const companyId = seedPo.companyId;
  const user = await prisma.user.findFirst({ where: { companyId } });
  assert.ok(user, 'need a user in company for createdBy');

  const req = {
    user: { id: user.id, firstName: 'Test', companyId },
    company: { id: companyId },
    headers: {},
  };
  // companyAccess helpers typically use req.user.companyId / activeCompanyId
  req.activeCompanyId = companyId;
  req.headers['x-company-id'] = companyId;

  const beforeStock = await prisma.product.findUnique({
    where: { id: productId },
    select: { currentStock: true },
  });

  const poNumber = `IPO-TEST-GRN-${Date.now()}`;
  const importPo = await prisma.importPurchaseOrder.create({
    data: {
      companyId,
      poNumber,
      supplierName: 'Test Supplier',
      supplierId: seedPo.supplierId,
      currency: 'USD',
      exchangeRateToUsd: 1,
      status: 'Arrived',
      createdBy: user.id,
      items: {
        create: [
          {
            productId,
            productName: seedPo.items[0].productName,
            sku: seedPo.items[0].sku,
            quantity: 1000,
            uom: 'kg',
            unitPrice: 1,
            totalAmount: 1000,
            receivedQty: 0,
          },
        ],
      },
    },
    include: { items: true },
  });

  const preview = await getReceivingPreview(req, importPo.id);
  assert.strictEqual(preview.lines[0].orderedQty, 1000);
  assert.strictEqual(preview.lines[0].previouslyReceivedQty, 0);
  assert.strictEqual(preview.lines[0].remainingQty, 1000);

  const idem = `test-idem-${Date.now()}`;
  const grn1 = await createGrn(req, {
    importPoId: importPo.id,
    confirmNow: true,
    idempotencyKey: idem,
    items: [
      {
        importPoItemId: importPo.items[0].id,
        productId,
        receivedQty: 400,
        acceptedQty: 400,
        rejectedQty: 0,
      },
    ],
  });
  assert.ok(grn1.stockPostedAt);
  assert.strictEqual(toNumber(grn1.items[0].acceptedQty), 400);

  const midStock = await prisma.product.findUnique({
    where: { id: productId },
    select: { currentStock: true },
  });
  assert.ok(
    toNumber(midStock.currentStock) >= toNumber(beforeStock.currentStock) + 400 - 1e-6,
    'stock should increase by accepted qty'
  );

  const moves = await prisma.stockMovement.count({
    where: { companyId, reference: grn1.grnNumber, type: 'Goods Receiving' },
  });
  assert.strictEqual(moves, 1);

  // Idempotent retry returns same GRN, no second movement
  const grnRetry = await createGrn(req, {
    importPoId: importPo.id,
    confirmNow: true,
    idempotencyKey: idem,
    items: [
      {
        importPoItemId: importPo.items[0].id,
        productId,
        receivedQty: 400,
        acceptedQty: 400,
      },
    ],
  });
  assert.strictEqual(grnRetry.id, grn1.id);
  const movesAfter = await prisma.stockMovement.count({
    where: { companyId, reference: grn1.grnNumber, type: 'Goods Receiving' },
  });
  assert.strictEqual(movesAfter, 1);

  const preview2 = await getReceivingPreview(req, importPo.id);
  assert.strictEqual(preview2.lines[0].previouslyReceivedQty, 400);
  assert.strictEqual(preview2.lines[0].remainingQty, 600);

  const grn2 = await createGrn(req, {
    importPoId: importPo.id,
    confirmNow: true,
    idempotencyKey: `${idem}-b`,
    items: [
      {
        importPoItemId: importPo.items[0].id,
        productId,
        receivedQty: 600,
        acceptedQty: 600,
      },
    ],
  });
  assert.ok(grn2.stockPostedAt);

  const preview3 = await getReceivingPreview(req, importPo.id);
  assert.strictEqual(preview3.lines[0].remainingQty, 0);

  let over = null;
  try {
    await createGrn(req, {
      importPoId: importPo.id,
      confirmNow: true,
      idempotencyKey: `${idem}-over`,
      items: [
        {
          importPoItemId: importPo.items[0].id,
          productId,
          receivedQty: 1,
          acceptedQty: 1,
        },
      ],
    });
  } catch (e) {
    over = e;
  }
  assert.ok(over);
  assert.strictEqual(over.code, 'OVER_RECEIVE');

  // Draft must not post stock
  const draftPo = await prisma.importPurchaseOrder.create({
    data: {
      companyId,
      poNumber: `IPO-TEST-DRAFT-${Date.now()}`,
      supplierName: 'Test Supplier',
      currency: 'USD',
      exchangeRateToUsd: 1,
      status: 'Arrived',
      createdBy: user.id,
      items: {
        create: [
          {
            productId,
            productName: 'Draft Line',
            sku: 'DRAFT-SKU',
            quantity: 50,
            uom: 'kg',
            unitPrice: 1,
            totalAmount: 50,
          },
        ],
      },
    },
    include: { items: true },
  });
  const stockBeforeDraft = await prisma.product.findUnique({
    where: { id: productId },
    select: { currentStock: true },
  });
  const draft = await createGrn(req, {
    importPoId: draftPo.id,
    confirmNow: false,
    status: 'Draft',
    idempotencyKey: `${idem}-draft`,
    items: [
      {
        importPoItemId: draftPo.items[0].id,
        productId,
        receivedQty: 10,
        acceptedQty: 10,
      },
    ],
  });
  assert.strictEqual(draft.status, 'Draft');
  assert.ok(!draft.stockPostedAt);
  const stockAfterDraft = await prisma.product.findUnique({
    where: { id: productId },
    select: { currentStock: true },
  });
  assert.strictEqual(toNumber(stockAfterDraft.currentStock), toNumber(stockBeforeDraft.currentStock));

  // Cleanup disposable rows (stock movements remain as audit trail of test — reverse stock)
  await prisma.stockMovement.deleteMany({
    where: {
      companyId,
      reference: { in: [grn1.grnNumber, grn2.grnNumber] },
    },
  });
  // Revert product stock delta from this test (+1000)
  await prisma.product.update({
    where: { id: productId },
    data: {
      currentStock: { decrement: 1000 },
      availableStock: { decrement: 1000 },
    },
  });
  await prisma.importGrnItem.deleteMany({
    where: { importGrnId: { in: [grn1.id, grn2.id, draft.id] } },
  });
  await prisma.importGrn.deleteMany({
    where: { id: { in: [grn1.id, grn2.id, draft.id] } },
  });
  await prisma.importPurchaseOrderItem.deleteMany({
    where: { importPoId: { in: [importPo.id, draftPo.id] } },
  });
  await prisma.importPurchaseOrder.deleteMany({
    where: { id: { in: [importPo.id, draftPo.id] } },
  });

  console.log('  ✓ testLiveCreatePostIdempotencyAndOverReceive');
}

async function run() {
  const tests = [
    testSerializeReceivingLine1000Kg,
    testPartialThenFullRemaining,
    testRejectOverReceive,
    testAcceptExactRemaining,
    testRejectZeroAndNegative,
    testDecimalCoercion,
    testPostedStatusesDoNotIncludeDraft,
    testLiveAuditAndRemainingIfEnabled,
    testLiveCreatePostIdempotencyAndOverReceive,
  ];
  let failed = 0;
  for (const t of tests) {
    try {
      await t();
      if (!String(t.name).includes('Live')) console.log(`  ✓ ${t.name}`);
    } catch (e) {
      failed += 1;
      console.error(`  ✗ ${t.name}:`, e.message);
    }
  }
  if (failed) {
    console.error(`\nImport GRN receiving tests: ${failed}/${tests.length} failed`);
    process.exit(1);
  }
  console.log(`\nImport GRN receiving tests: ${tests.length}/${tests.length} passed`);
}

run();
