'use strict';

const assert = require('assert');
const {
  accountedOutput,
  isOperationReportComplete,
  resolveOperationReport,
  rollupOrderFromWorkOrders
} = require('../utils/manufacturingWorkflow');

function applyFgReceipt({ planned, already, inventoryPosted, thisReceipt }) {
  const remainingToProduce = Math.max(0, planned - already);
  const maxReceipt = inventoryPosted
    ? remainingToProduce
    : Math.max(remainingToProduce, already);
  const produced = inventoryPosted ? already + thisReceipt : Math.max(already, thisReceipt);
  return {
    producedQuantity: produced,
    remainingQuantity: Math.max(0, planned - produced),
    maxReceipt
  };
}

function applyCloseShort({ planned, produced, reason }) {
  if (!reason) throw new Error('A reason is required to close short');
  const remaining = Math.max(0, planned - produced);
  return {
    status: 'Closed Short',
    producedQuantity: produced,
    remainingQuantity: remaining
  };
}

function caseScrapRejectedSingleOp() {
  const report = { completedQuantity: 15, scrapQuantity: 2, rejectedQuantity: 3 };
  assert.strictEqual(accountedOutput(report), 20);
  assert.strictEqual(isOperationReportComplete(report, 20), true);
  const rollup = rollupOrderFromWorkOrders(
    { plannedQuantity: 20, producedQuantity: 0, scrapQuantity: 0, rejectedQuantity: 0 },
    [{ sequence: 1, ...report }]
  );
  assert.strictEqual(rollup.producedQuantity, 15);
  assert.strictEqual(rollup.scrapQuantity, 2);
  assert.strictEqual(rollup.rejectedQuantity, 3);
  assert.strictEqual(rollup.remainingQuantity, 5);
}

function caseMultiOpDoesNotDoubleCount() {
  const report = { completedQuantity: 15, scrapQuantity: 2, rejectedQuantity: 3 };
  const rollup = rollupOrderFromWorkOrders(
    { plannedQuantity: 20, producedQuantity: 15, scrapQuantity: 4, rejectedQuantity: 6 },
    [
      { sequence: 1, ...report },
      { sequence: 2, ...report }
    ]
  );
  assert.strictEqual(rollup.producedQuantity, 15);
  assert.strictEqual(rollup.scrapQuantity, 2);
  assert.strictEqual(rollup.rejectedQuantity, 3);
  assert.strictEqual(rollup.remainingQuantity, 5);
}

function caseGoodOnly() {
  const report = { completedQuantity: 10, scrapQuantity: 0, rejectedQuantity: 0 };
  assert.strictEqual(isOperationReportComplete(report, 10), true);
  const rollup = rollupOrderFromWorkOrders(
    { plannedQuantity: 10, producedQuantity: 0, scrapQuantity: 0, rejectedQuantity: 0 },
    [{ sequence: 1, ...report }]
  );
  assert.strictEqual(rollup.producedQuantity, 10);
  assert.strictEqual(rollup.scrapQuantity, 0);
  assert.strictEqual(rollup.rejectedQuantity, 0);
  assert.strictEqual(rollup.remainingQuantity, 0);
}

function casePartialThenReceiveRemaining() {
  const afterReport = rollupOrderFromWorkOrders(
    { plannedQuantity: 20, producedQuantity: 0, scrapQuantity: 0, rejectedQuantity: 0 },
    [{ sequence: 1, completedQuantity: 15, scrapQuantity: 2, rejectedQuantity: 3 }]
  );
  assert.strictEqual(afterReport.remainingQuantity, 5);
  const afterFg = applyFgReceipt({
    planned: 20,
    already: afterReport.producedQuantity,
    inventoryPosted: true,
    thisReceipt: 5
  });
  assert.strictEqual(afterFg.producedQuantity, 20);
  assert.strictEqual(afterFg.remainingQuantity, 0);
}

function caseCloseShortPreservesProduced() {
  const afterReport = rollupOrderFromWorkOrders(
    { plannedQuantity: 20, producedQuantity: 0, scrapQuantity: 0, rejectedQuantity: 0 },
    [{ sequence: 1, completedQuantity: 15, scrapQuantity: 2, rejectedQuantity: 3 }]
  );
  const closed = applyCloseShort({
    planned: 20,
    produced: afterReport.producedQuantity,
    reason: 'Customer reduced demand'
  });
  assert.strictEqual(closed.status, 'Closed Short');
  assert.strictEqual(closed.producedQuantity, 15);
  assert.strictEqual(closed.remainingQuantity, 5);
}

function caseLaterOpEmptyReportInheritsAndCompletes() {
  const previous = {
    sequence: 2,
    status: 'Completed',
    completedQuantity: 15,
    scrapQuantity: 2,
    rejectedQuantity: 3
  };
  const resolved = resolveOperationReport(
    { completedQuantity: 0, scrapQuantity: 0, rejectedQuantity: 0, downtime: 0 },
    previous
  );
  assert.strictEqual(resolved.completedQuantity, 15);
  assert.strictEqual(resolved.scrapQuantity, 2);
  assert.strictEqual(resolved.rejectedQuantity, 3);
  assert.strictEqual(isOperationReportComplete(resolved, 20), true);
  const rollup = rollupOrderFromWorkOrders(
    { plannedQuantity: 20, producedQuantity: 15, scrapQuantity: 2, rejectedQuantity: 3 },
    [
      { sequence: 1, ...previous },
      { sequence: 2, ...previous },
      { sequence: 3, status: 'Completed', ...resolved }
    ]
  );
  assert.strictEqual(rollup.producedQuantity, 15);
  assert.strictEqual(rollup.scrapQuantity, 2);
  assert.strictEqual(rollup.rejectedQuantity, 3);
  assert.strictEqual(rollup.remainingQuantity, 5);
}

function caseFirstOpEmptyReportDoesNotInherit() {
  const resolved = resolveOperationReport(
    { completedQuantity: 0, scrapQuantity: 0, rejectedQuantity: 0, downtime: 0 },
    null
  );
  assert.strictEqual(isOperationReportComplete(resolved, 20), false);
}

function caseFullShopFloorCompletesOrder() {
  const {
    shopFloorCompletionReady,
    materialsIssueComplete,
    fgReceiptCap,
    assertTransition
  } = require('../utils/manufacturingWorkflow');
  const order = {
    status: 'In Progress',
    plannedQuantity: 10,
    producedQuantity: 10,
    inventoryPosted: false
  };
  const workOrders = [
    { sequence: 1, status: 'Completed', completedQuantity: 10, scrapQuantity: 0, rejectedQuantity: 0 },
    { sequence: 2, status: 'Completed', completedQuantity: 10, scrapQuantity: 0, rejectedQuantity: 0 },
    { sequence: 3, status: 'Completed', completedQuantity: 10, scrapQuantity: 0, rejectedQuantity: 0 }
  ];
  const reservations = [
    { requiredQuantity: 100, materialIssues: [{ issuedQuantity: 100 }] },
    { requiredQuantity: 50, materialIssues: [{ issuedQuantity: 50 }] },
    { requiredQuantity: 20, materialIssues: [{ issuedQuantity: 20 }] }
  ];
  assert.strictEqual(materialsIssueComplete(reservations), true);
  assert.strictEqual(shopFloorCompletionReady(order, workOrders, reservations), true);
  assert.strictEqual(assertTransition(order.status, 'Completed'), 'Completed');
  assert.strictEqual(fgReceiptCap(order), 10);
}

function casePartialShopFloorDoesNotAutoComplete() {
  const { shopFloorCompletionReady, fgReceiptCap } = require('../utils/manufacturingWorkflow');
  const order = {
    status: 'In Progress',
    plannedQuantity: 20,
    producedQuantity: 15,
    inventoryPosted: false
  };
  const workOrders = [
    { sequence: 1, status: 'Completed', completedQuantity: 15, scrapQuantity: 2, rejectedQuantity: 3 }
  ];
  assert.strictEqual(shopFloorCompletionReady(order, workOrders, [{ requiredQuantity: 10, materialIssues: [{ issuedQuantity: 10 }] }]), false);
  assert.strictEqual(fgReceiptCap(order), 15);
}

function caseUnissuedMaterialsDoNotBlockShopFloorCompletion() {
  const { shopFloorCompletionReady } = require('../utils/manufacturingWorkflow');
  const order = { status: 'In Progress', plannedQuantity: 10, producedQuantity: 10 };
  const workOrders = [{ sequence: 1, status: 'Completed', completedQuantity: 10, scrapQuantity: 0, rejectedQuantity: 0 }];
  assert.strictEqual(
    shopFloorCompletionReady(order, workOrders, [{ requiredQuantity: 50, materialIssues: [] }]),
    true
  );
}

function casePostedInventoryHidesFurtherReceipt() {
  const { fgReceiptCap } = require('../utils/manufacturingWorkflow');
  assert.strictEqual(fgReceiptCap({ plannedQuantity: 10, producedQuantity: 10, inventoryPosted: true }), 0);
}

caseScrapRejectedSingleOp();
caseMultiOpDoesNotDoubleCount();
caseGoodOnly();
casePartialThenReceiveRemaining();
caseCloseShortPreservesProduced();
caseLaterOpEmptyReportInheritsAndCompletes();
caseFirstOpEmptyReportDoesNotInherit();
caseFullShopFloorCompletesOrder();
casePartialShopFloorDoesNotAutoComplete();
caseUnissuedMaterialsDoNotBlockShopFloorCompletion();
casePostedInventoryHidesFurtherReceipt();
console.log('manufacturing-operation-report tests passed');
