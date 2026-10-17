'use strict';

/**
 * Import module unit tests — company isolation helpers, qty validation,
 * landed-cost allocation, status transitions, FX rules.
 * Does not mutate production data.
 */

const assert = require('assert');
const {
  toNumber,
  allocateLandedByValue,
  validateReceiveQty,
  assertPoStatusTransition,
  IMPORT_PO_STATUS_TRANSITIONS,
} = require('../services/importService');

function testToNumber() {
  assert.strictEqual(toNumber('12.5'), 12.5);
  assert.strictEqual(toNumber(null, 3), 3);
  assert.strictEqual(toNumber('x', 0), 0);
}

function testAllocateLandedByValue() {
  const items = [
    { productName: 'A', qty: 10, unitFobUsd: 100 },
    { productName: 'B', qty: 10, unitFobUsd: 50 },
  ];
  // Total FOB = 1000 + 500 = 1500; expenses = 150 → A share 2/3, B 1/3
  const allocated = allocateLandedByValue(items, 150);
  assert.strictEqual(allocated.length, 2);
  assert.ok(Math.abs(allocated[0].allocatedExpensePerUnitUsd - 10) < 0.01);
  assert.ok(Math.abs(allocated[1].allocatedExpensePerUnitUsd - 5) < 0.01);
  assert.ok(Math.abs(allocated[0].finalLandedCostPerUnitUsd - 110) < 0.01);
  assert.ok(Math.abs(allocated[1].finalLandedCostPerUnitUsd - 55) < 0.01);
}

function testOverReceiveRejected() {
  let caught = null;
  try {
    validateReceiveQty({ orderedQty: 10, alreadyReceivedQty: 8, receiveQty: 5 });
  } catch (e) {
    caught = e;
  }
  assert.ok(caught);
  assert.strictEqual(caught.code, 'OVER_RECEIVE');
  assert.strictEqual(caught.status, 400);
}

function testPartialReceiveAllowed() {
  const r = validateReceiveQty({ orderedQty: 10, alreadyReceivedQty: 4, receiveQty: 6 });
  assert.strictEqual(r.remaining, 6);
  assert.strictEqual(r.recv, 6);
}

function testNegativeReceiveRejected() {
  let caught = null;
  try {
    validateReceiveQty({ orderedQty: 10, alreadyReceivedQty: 0, receiveQty: -1 });
  } catch (e) {
    caught = e;
  }
  assert.ok(caught);
  assert.strictEqual(caught.code, 'INVALID_QTY');
}

function testPoStatusTransitions() {
  assert.doesNotThrow(() => assertPoStatusTransition('Draft', 'Ordered'));
  assert.doesNotThrow(() => assertPoStatusTransition('Ordered', 'In Transit'));
  assert.doesNotThrow(() => assertPoStatusTransition('Received', 'Costed'));
  let caught = null;
  try {
    assertPoStatusTransition('Completed', 'Draft');
  } catch (e) {
    caught = e;
  }
  assert.ok(caught);
  assert.strictEqual(caught.code, 'INVALID_STATUS_TRANSITION');
  assert.ok(IMPORT_PO_STATUS_TRANSITIONS.Draft.includes('Ordered'));
}

function testSameStatusAllowed() {
  assert.doesNotThrow(() => assertPoStatusTransition('Ordered', 'Ordered'));
}

function testCarrierExportsPresent() {
  const svc = require('../services/importService');
  assert.strictEqual(typeof svc.listCarriers, 'function');
  assert.strictEqual(typeof svc.createCarrier, 'function');
  assert.strictEqual(typeof svc.updateCarrier, 'function');
  assert.strictEqual(typeof svc.deactivateCarrier, 'function');
  assert.strictEqual(typeof svc.createShipment, 'function');
  assert.strictEqual(typeof svc.createPurchaseOrder, 'function');
}

function testOverReceiveAllowFlag() {
  const r = validateReceiveQty({
    orderedQty: 10,
    alreadyReceivedQty: 8,
    receiveQty: 5,
    allowOverReceive: true,
  });
  assert.strictEqual(r.recv, 5);
}

function run() {
  const tests = [
    testToNumber,
    testAllocateLandedByValue,
    testOverReceiveRejected,
    testPartialReceiveAllowed,
    testNegativeReceiveRejected,
    testPoStatusTransitions,
    testSameStatusAllowed,
    testCarrierExportsPresent,
    testOverReceiveAllowFlag,
  ];
  let failed = 0;
  for (const t of tests) {
    try {
      t();
      console.log(`  ✓ ${t.name}`);
    } catch (e) {
      failed += 1;
      console.error(`  ✗ ${t.name}:`, e.message);
    }
  }
  if (failed) {
    console.error(`\nImport module tests: ${failed}/${tests.length} failed`);
    process.exit(1);
  }
  console.log(`\nImport module tests: ${tests.length}/${tests.length} passed`);
}

run();
