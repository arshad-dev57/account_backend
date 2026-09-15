'use strict';

const {
  adjustLocationStock,
  reserveLocationStock,
  releaseLocationReservation
} = require('../warehouse/services/locationService');
const { toNum, emptyToNull } = require('./manufacturingAccess');

const ORDER_TRANSITIONS = {
  Draft: ['Released', 'Cancelled'],
  Planned: ['Released', 'Cancelled'],
  Released: ['In Progress', 'Paused', 'Cancelled', 'Partially Completed', 'Completed', 'Closed Short'],
  'In Progress': ['Paused', 'Completed', 'Partially Completed', 'Cancelled', 'Closed Short'],
  Paused: ['In Progress', 'Cancelled', 'Completed', 'Partially Completed', 'Closed Short'],
  'Partially Completed': ['Partially Completed', 'Completed', 'Closed Short', 'Cancelled'],
  Completed: ['Closed'],
  'Closed Short': [],
  Closed: [],
  Cancelled: []
};

const STATUS_ALIASES = {
  InProgress: 'In Progress',
  inprogress: 'In Progress',
  'in progress': 'In Progress',
};

function canonicalStatus(status) {
  const raw = String(status || '');
  return STATUS_ALIASES[raw] || STATUS_ALIASES[raw.toLowerCase()] || raw;
}

const SOURCE_WAREHOUSE_REQUIRED =
  'Source warehouse is required before releasing a manufacturing order. Set the source warehouse and try again.';
const SOURCE_WAREHOUSE_STOCK_MISSING =
  'Source warehouse is missing on this manufacturing order. Set a source warehouse to see on-hand stock and issue materials.';

function resolveMaterialWarehouseId(order, reservation) {
  return emptyToNull(reservation?.locationId)
    || emptyToNull(order?.sourceWarehouseId)
    || emptyToNull(order?.locationId)
    || null;
}

function stockQty(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n === 0) return 0;
  return Math.round(Math.abs(n));
}

function accountedOutput(row) {
  return Number(row?.completedQuantity || 0) + Number(row?.scrapQuantity || 0) + Number(row?.rejectedQuantity || 0);
}

function isOperationReportComplete(row, planned) {
  return accountedOutput(row) + 1e-9 >= Number(planned || 0);
}

function resolveOperationReport(incoming, previous) {
  if (accountedOutput(incoming) > 0 || !previous) return incoming;
  if (previous.status !== 'Completed' || accountedOutput(previous) <= 0) return incoming;
  return {
    completedQuantity: Number(previous.completedQuantity || 0),
    scrapQuantity: Number(previous.scrapQuantity || 0),
    rejectedQuantity: Number(previous.rejectedQuantity || 0),
    downtime: incoming.downtime
  };
}

function rollupOrderFromWorkOrders(order, workOrders) {
  const planned = Number(order?.plannedQuantity || 0);
  const ops = [...(workOrders || [])].sort((a, b) => Number(a.sequence || 0) - Number(b.sequence || 0));
  const withOutput = ops.filter((row) => accountedOutput(row) > 0);
  const last = withOutput[withOutput.length - 1];
  const reportedGood = last ? Number(last.completedQuantity || 0) : 0;
  const produced = Math.max(Number(order?.producedQuantity || 0), reportedGood);
  const scrap = last ? Number(last.scrapQuantity || 0) : Number(order?.scrapQuantity || 0);
  const rejected = last ? Number(last.rejectedQuantity || 0) : Number(order?.rejectedQuantity || 0);
  return {
    producedQuantity: produced,
    scrapQuantity: scrap,
    rejectedQuantity: rejected,
    remainingQuantity: Math.max(0, planned - produced)
  };
}

function issuedReservationQty(reservation) {
  if (reservation?.issuedQuantity != null && reservation.issuedQuantity !== '') {
    return Number(reservation.issuedQuantity || 0);
  }
  return (reservation?.materialIssues || []).reduce((sum, row) => sum + Number(row.issuedQuantity || 0), 0);
}

function materialsIssueComplete(reservations) {
  const rows = reservations || [];
  if (!rows.length) return true;
  return rows.every((row) => issuedReservationQty(row) + 1e-9 >= Number(row.requiredQuantity || 0));
}

function allWorkOrdersComplete(workOrders) {
  const ops = workOrders || [];
  return ops.length > 0 && ops.every((row) => String(row.status || '') === 'Completed');
}

function shopFloorCompletionReady(order, workOrders, reservations) {
  const rolled = rollupOrderFromWorkOrders(order, workOrders);
  const planned = Number(order?.plannedQuantity || 0);
  if (planned <= 0) return false;
  if (!allWorkOrdersComplete(workOrders)) return false;
  if (rolled.remainingQuantity > 0) return false;
  return rolled.producedQuantity + 1e-9 >= planned;
}

function fgReceiptCap(order) {
  const planned = Number(order?.plannedQuantity || 0);
  const already = Number(order?.producedQuantity || 0);
  const remainingToProduce = Math.max(0, planned - already);
  return order?.inventoryPosted ? remainingToProduce : Math.max(remainingToProduce, already);
}

function requiredComponentQty(component, plannedQty) {
  const qty = Number(component.quantity || 0) * Number(plannedQty || 0);
  const scrap = 1 + Number(component.scrapPercentage || 0) / 100;
  return qty * scrap;
}

function assertTransition(fromStatus, toStatus) {
  const from = canonicalStatus(fromStatus);
  const to = canonicalStatus(toStatus);
  if (from === to) return to;
  const allowed = ORDER_TRANSITIONS[from] || [];
  if (!allowed.includes(to)) {
    const err = new Error(`Cannot move a manufacturing order from ${from} to ${to}`);
    err.status = 400;
    throw err;
  }
  return to;
}

function parameterResult(expected, actual, tolerance) {
  const exp = String(expected ?? '').trim();
  const act = String(actual ?? '').trim();
  if (!exp || !act) return act ? 'Pass' : 'Pending';
  const expN = Number(exp);
  const actN = Number(act);
  const tolN = Number(tolerance);
  if (Number.isFinite(expN) && Number.isFinite(actN)) {
    const band = Number.isFinite(tolN) ? Math.abs(tolN) : 0;
    return Math.abs(actN - expN) <= band ? 'Pass' : 'Fail';
  }
  return exp.toLowerCase() === act.toLowerCase() ? 'Pass' : 'Fail';
}

function mapQualityParameters(list) {
  const items = Array.isArray(list) ? list : [];
  return items
    .map((item) => {
      const name = emptyToNull(item.parameterName || item.name);
      if (!name) return null;
      const expected = String(item.expectedValue ?? item.standard ?? '');
      const actual = String(item.actualValue ?? item.actual ?? '');
      const tolerance = item.tolerance == null || item.tolerance === '' ? null : String(item.tolerance);
      return {
        parameterName: name,
        expectedValue: expected,
        actualValue: actual,
        tolerance,
        unitOfMeasure: item.unitOfMeasure || item.unit || '',
        result: item.result || parameterResult(expected, actual, tolerance),
        notes: emptyToNull(item.notes)
      };
    })
    .filter(Boolean);
}

async function recordHistory(tx, { entityType, entityId, fromStatus, toStatus, reason, createdBy, companyId }) {
  if (!tx?.manufacturingStatusHistory) return null;
  return tx.manufacturingStatusHistory.create({
    data: {
      entityType,
      entityId,
      fromStatus: fromStatus || null,
      toStatus,
      reason: emptyToNull(reason),
      createdBy: createdBy || null,
      companyId
    }
  });
}

async function releaseRemainingReservations(tx, order, companyId) {
  for (const reservation of order.materialReservations || []) {
    const leftover = Number(reservation.reservedQuantity || 0);
    if (leftover > 0 && reservation.locationId) {
      await releaseComponent(tx, {
        companyId,
        productId: reservation.componentId,
        locationId: reservation.locationId,
        qty: leftover
      });
    }
    await tx.manufacturingMaterialReservation.update({
      where: { id: reservation.id },
      data: { reservedQuantity: 0, status: 'Completed' }
    });
  }
}

async function companySettings(tx, companyId) {
  const row = await tx.manufacturingSetting.findUnique({ where: { companyId } }).catch(() => null);
  return row?.settings || {};
}

async function postStockOut(tx, { companyId, productId, locationId, qty, productName, allowNegative, reservedQty }) {
  const amount = stockQty(qty);
  if (!amount || !locationId || !productId) return null;
  const reservedOut = reservedQty == null ? amount : Math.min(amount, stockQty(reservedQty));
  try {
    return await adjustLocationStock(tx, {
      companyId,
      productId,
      locationId,
      delta: -amount,
      reservedDelta: reservedOut ? -reservedOut : 0,
      checkAvailable: !allowNegative,
      productName,
      allowNegative: Boolean(allowNegative)
    });
  } catch (error) {
    error.status = error.statusCode || error.status || 400;
    throw error;
  }
}

async function postStockIn(tx, { companyId, productId, locationId, qty, productName }) {
  const amount = stockQty(qty);
  if (!amount || !locationId || !productId) return null;
  try {
    return await adjustLocationStock(tx, {
      companyId,
      productId,
      locationId,
      delta: amount,
      reservedDelta: 0,
      productName
    });
  } catch (error) {
    error.status = error.statusCode || error.status || 400;
    throw error;
  }
}

async function reserveComponent(tx, { companyId, productId, locationId, qty }) {
  const amount = stockQty(qty);
  if (!amount || !locationId || !productId) return 0;
  try {
    await reserveLocationStock(tx, { companyId, productId, locationId, qty: amount });
    return amount;
  } catch (error) {
    error.status = error.statusCode || error.status || 400;
    throw error;
  }
}

async function releaseComponent(tx, { companyId, productId, locationId, qty }) {
  const amount = stockQty(qty);
  if (!amount || !locationId || !productId) return 0;
  await releaseLocationReservation(tx, { companyId, productId, locationId, qty: amount });
  return amount;
}

function operationCost(op, plannedQty) {
  const setup = Number(op.setupTime || 0);
  const run = Number(op.runTime || 0) * Number(plannedQty || 1);
  const hours = (setup + run) / 60;
  const workers = Number(op.laborRequirement || 1) || 1;
  const laborRate = Number(op.workCenter?.costPerHour || 0);
  const machineRate = Number(op.machine?.hourlyOperatingCost || 0);
  const labor = hours * laborRate * workers;
  const machine = hours * machineRate;
  const estimated = Number(op.estimatedCost || 0);
  return {
    hours,
    laborCost: labor || estimated,
    machineCost: machine,
    total: (labor || estimated) + machine
  };
}

function orderCostBreakdown(order) {
  const planned = Number(order.plannedQuantity || 1);
  const produced = Number(order.producedQuantity || 0) || planned;
  const materialCost = (order.bom?.components || []).reduce((sum, c) => {
    const line = Number(c.estimatedCost || 0);
    return sum + line * planned;
  }, 0);
  const ops = order.routing?.operations || [];
  const laborCost = ops.reduce((sum, op) => sum + operationCost(op, planned).laborCost, 0);
  const machineCost = ops.reduce((sum, op) => sum + operationCost(op, planned).machineCost, 0);
  const woHours = (order.workOrders || []).reduce((sum, wo) => {
    if (!wo.startTime) return sum;
    const end = wo.endTime ? new Date(wo.endTime) : new Date();
    const mins = Math.max(0, (end - new Date(wo.startTime)) / 60000) + Number(wo.downtime || 0);
    return sum + mins / 60;
  }, 0);
  const actualMachine = (order.workOrders || []).reduce((sum, wo) => {
    const rate = Number(wo.machine?.hourlyOperatingCost || wo.workCenter?.costPerHour || 0);
    if (!wo.startTime) return sum;
    const end = wo.endTime ? new Date(wo.endTime) : new Date();
    const hours = Math.max(0, (end - new Date(wo.startTime)) / 3600000);
    return sum + hours * rate;
  }, 0);
  const overhead = laborCost * 0.1;
  const additional = (order.scraps || []).reduce((s, row) => s + Number(row.cost || 0), 0);
  const total = materialCost + laborCost + (actualMachine || machineCost) + overhead + additional;
  const unit = produced ? total / produced : total;
  return {
    materialCost,
    laborCost,
    machineCost: actualMachine || machineCost,
    overhead,
    additionalCost: additional,
    totalCost: total,
    unitCost: unit,
    plannedHours: ops.reduce((s, op) => s + operationCost(op, planned).hours, 0),
    actualHours: woHours,
    variance: 0
  };
}

module.exports = {
  ORDER_TRANSITIONS,
  canonicalStatus,
  SOURCE_WAREHOUSE_REQUIRED,
  SOURCE_WAREHOUSE_STOCK_MISSING,
  resolveMaterialWarehouseId,
  stockQty,
  requiredComponentQty,
  accountedOutput,
  isOperationReportComplete,
  resolveOperationReport,
  rollupOrderFromWorkOrders,
  materialsIssueComplete,
  allWorkOrdersComplete,
  shopFloorCompletionReady,
  fgReceiptCap,
  assertTransition,
  parameterResult,
  mapQualityParameters,
  recordHistory,
  companySettings,
  postStockOut,
  postStockIn,
  reserveComponent,
  releaseComponent,
  releaseRemainingReservations,
  operationCost,
  orderCostBreakdown
};
