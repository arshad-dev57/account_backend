'use strict';

const prisma = require('../prisma/client');
const {
  requireCompany,
  userIdOf,
  paginationParams,
  paginationMeta,
  toDate,
  toNum,
  emptyToNull,
  addDays,
  isoWeek
} = require('../utils/manufacturingAccess');

function fail(res, status, message) {
  return res.status(status).json({ success: false, message });
}

function ok(res, data, extra = {}) {
  return res.json({ success: true, data, ...extra });
}

function hasMfg() {
  return Boolean(prisma?.manufacturingBOM && prisma?.manufacturingProductionOrder);
}

function requireMfg(res) {
  if (hasMfg()) return true;
  fail(
    res,
    503,
    'Manufacturing tables are not available yet. Run the manufacturing Prisma migration and regenerate the client.'
  );
  return false;
}

function searchOr(fields, search) {
  const q = String(search || '').trim();
  if (!q || !fields.length) return {};
  return { OR: fields.map((field) => ({ [field]: { contains: q, mode: 'insensitive' } })) };
}

async function nextNumber(delegate, field, prefix, companyId) {
  const tag = String(companyId || '').replace(/-/g, '').slice(0, 6).toUpperCase() || 'CO';
  const count = await delegate.count({ where: { companyId } });
  return `${prefix}-${tag}-${String(count + 1).padStart(4, '0')}`;
}

async function findProduct(companyId, productId) {
  if (!productId) return null;
  return prisma.product.findFirst({
    where: { id: productId, companyId },
    select: { id: true, name: true, sku: true, costPrice: true }
  });
}

async function requireProduct(companyId, productId) {
  const product = await findProduct(companyId, productId);
  if (!product) {
    const err = new Error('Product not found');
    err.status = 400;
    throw err;
  }
  return product;
}

async function mapBomComponents(companyId, list) {
  const items = Array.isArray(list) ? list : [];
  const out = [];
  for (let i = 0; i < items.length; i += 1) {
    const item = items[i] || {};
    const product = await requireProduct(companyId, item.componentId || item.productId || item.id);
    const quantity = toNum(item.quantity, 1);
    out.push({
      componentId: product.id,
      componentName: product.name,
      quantity,
      unitOfMeasure: item.unitOfMeasure || 'pcs',
      scrapPercentage: toNum(item.scrapPercentage),
      estimatedCost: toNum(item.estimatedCost, Number(product.costPrice || 0) * quantity),
      sequence: toNum(item.sequence, i + 1),
      notes: emptyToNull(item.notes)
    });
  }
  return out;
}

async function firstEmployeeId(companyId) {
  const emp = await prisma.hrEmployee?.findFirst?.({
    where: { companyId },
    select: { id: true }
  });
  return emp?.id || null;
}

async function firstLocationId(companyId, preferred) {
  if (preferred) {
    const loc = await prisma.location.findFirst({
      where: { id: preferred, companyId },
      select: { id: true }
    });
    if (loc) return loc.id;
  }
  const loc = await prisma.location.findFirst({
    where: { companyId },
    select: { id: true }
  });
  return loc?.id || null;
}

async function stockMap(companyId, locationId) {
  const where = { companyId };
  if (locationId) where.locationId = locationId;
  const rows = await prisma.productStock.findMany({ where });
  const map = new Map();
  rows.forEach((row) => {
    const prev = map.get(row.productId) || { available: 0, reserved: 0, current: 0 };
    prev.available += Number(row.availableStock || 0);
    prev.reserved += Number(row.reservedStock || 0);
    prev.current += Number(row.currentStock || 0);
    map.set(row.productId, prev);
  });
  return map;
}

function wrap(handler) {
  return async (req, res) => {
    try {
      if (!requireMfg(res)) return;
      const companyId = requireCompany(req, res);
      if (!companyId) return;
      req.mfg = { companyId, userId: userIdOf(req) };
      await handler(req, res);
    } catch (error) {
      const status = error.status || 500;
      if (error.code === 'P2021' || /does not exist/i.test(error.message || '')) {
        return fail(
          res,
          503,
          'Manufacturing tables are not migrated yet. Run the manufacturing Prisma migration.'
        );
      }
      console.error('[manufacturing]', error);
      return fail(res, status, error.message || 'Manufacturing request failed');
    }
  };
}

const RESOURCES = {
  boms: {
    model: 'manufacturingBOM',
    search: ['bomNumber', 'productName', 'version'],
    include: { components: true, product: { select: { id: true, name: true, sku: true } } },
    numberField: 'bomNumber',
    prefix: 'BOM',
    hasLocation: true,
    async toCreate(body, ctx) {
      const product = await requireProduct(ctx.companyId, body.productId);
      const components = await mapBomComponents(ctx.companyId, body.components);
      const totalEstimatedCost = components.reduce((s, c) => s + Number(c.estimatedCost || 0), 0);
      return {
        bomNumber: emptyToNull(body.bomNumber) || (await nextNumber(prisma.manufacturingBOM, 'bomNumber', 'BOM', ctx.companyId)),
        productId: product.id,
        productName: product.name,
        version: body.version || '1.0',
        status: body.status || 'Draft',
        effectiveFrom: toDate(body.effectiveFrom, new Date()),
        effectiveTo: toDate(body.effectiveTo),
        description: emptyToNull(body.description) || emptyToNull(body.name),
        notes: emptyToNull(body.notes),
        totalEstimatedCost: toNum(body.totalEstimatedCost, totalEstimatedCost),
        locationId: emptyToNull(body.locationId) || ctx.locationId,
        components: { create: components }
      };
    }
  },
  routings: {
    model: 'manufacturingRouting',
    search: ['routingNumber', 'productName'],
    include: { operations: true, product: { select: { id: true, name: true, sku: true } } },
    numberField: 'routingNumber',
    prefix: 'RT',
    async toCreate(body, ctx) {
      const product = await requireProduct(ctx.companyId, body.productId);
      return {
        routingNumber: emptyToNull(body.routingNumber) || (await nextNumber(prisma.manufacturingRouting, 'routingNumber', 'RT', ctx.companyId)),
        productId: product.id,
        productName: product.name,
        version: body.version || '1.0',
        status: body.status === 'Inactive' ? 'Obsolete' : (body.status || 'Draft'),
        description: emptyToNull(body.description) || emptyToNull(body.name),
        notes: emptyToNull(body.notes),
        totalEstimatedTime: toNum(body.totalEstimatedTime),
        totalEstimatedCost: toNum(body.totalEstimatedCost)
      };
    }
  },
  'work-centers': {
    model: 'manufacturingWorkCenter',
    search: ['workCenterCode', 'name', 'department'],
    numberField: 'workCenterCode',
    prefix: 'WC',
    hasLocation: true,
    async toCreate(body, ctx) {
      return {
        workCenterCode: emptyToNull(body.workCenterCode) || emptyToNull(body.code) || (await nextNumber(prisma.manufacturingWorkCenter, 'workCenterCode', 'WC', ctx.companyId)),
        name: body.name,
        department: emptyToNull(body.department),
        locationId: emptyToNull(body.locationId) || ctx.locationId,
        factory: emptyToNull(body.factory) || emptyToNull(body.factoryId),
        capacity: toNum(body.capacity),
        workingHours: typeof body.workingHours === 'object' ? body.workingHours : null,
        shift: emptyToNull(body.shift),
        efficiency: toNum(body.efficiency, 100),
        costPerHour: toNum(body.costPerHour),
        status: body.status || 'Active',
        description: emptyToNull(body.description),
        notes: emptyToNull(body.notes)
      };
    }
  },
  machines: {
    model: 'manufacturingMachine',
    search: ['machineCode', 'name', 'serialNumber', 'model'],
    include: { workCenter: { select: { id: true, name: true, workCenterCode: true } } },
    numberField: 'machineCode',
    prefix: 'MC',
    hasLocation: true,
    async toCreate(body, ctx) {
      return {
        machineCode: emptyToNull(body.machineCode) || emptyToNull(body.code) || (await nextNumber(prisma.manufacturingMachine, 'machineCode', 'MC', ctx.companyId)),
        name: body.name || body.machineName,
        serialNumber: emptyToNull(body.serialNumber),
        model: emptyToNull(body.model),
        manufacturer: emptyToNull(body.manufacturer),
        workCenterId: emptyToNull(body.workCenterId),
        locationId: emptyToNull(body.locationId) || ctx.locationId,
        purchaseDate: toDate(body.purchaseDate),
        installationDate: toDate(body.installationDate),
        currentStatus: body.currentStatus || body.status || 'Idle',
        hourlyOperatingCost: toNum(body.hourlyOperatingCost || body.hourlyCost),
        capacity: toNum(body.capacity),
        efficiency: toNum(body.efficiency, 100),
        description: emptyToNull(body.description),
        notes: emptyToNull(body.notes)
      };
    }
  },
  'production-orders': {
    model: 'manufacturingProductionOrder',
    search: ['orderNumber', 'productName'],
    include: {
      product: { select: { id: true, name: true, sku: true } },
      bom: { select: { id: true, bomNumber: true, version: true } },
      routing: { select: { id: true, routingNumber: true } }
    },
    numberField: 'orderNumber',
    prefix: 'MO',
    hasLocation: true,
    async toCreate(body, ctx) {
      const product = await requireProduct(ctx.companyId, body.productId);
      const planned = toNum(body.plannedQuantity, 1);
      const startDate = toDate(body.startDate, new Date());
      const dueDate = toDate(body.dueDate, addDays(startDate, 7));
      const priority = body.priority === 'Medium' ? 'Normal' : (body.priority || 'Normal');
      let bomId = emptyToNull(body.bomId);
      let routingId = emptyToNull(body.routingId);
      let bomVersion = emptyToNull(body.bomVersion);
      if (!bomId) {
        const bom = await prisma.manufacturingBOM.findFirst({
          where: { companyId: ctx.companyId, productId: product.id, status: 'Active' },
          orderBy: { updatedAt: 'desc' }
        });
        if (bom) {
          bomId = bom.id;
          bomVersion = bom.version;
        }
      }
      if (!routingId) {
        const routing = await prisma.manufacturingRouting.findFirst({
          where: { companyId: ctx.companyId, productId: product.id, status: 'Active' },
          orderBy: { updatedAt: 'desc' }
        });
        if (routing) routingId = routing.id;
      }
      return {
        orderNumber: emptyToNull(body.orderNumber) || (await nextNumber(prisma.manufacturingProductionOrder, 'orderNumber', 'MO', ctx.companyId)),
        productId: product.id,
        productName: product.name,
        bomId,
        bomVersion,
        routingId,
        plannedQuantity: planned,
        producedQuantity: 0,
        scrapQuantity: 0,
        reworkQuantity: 0,
        remainingQuantity: planned,
        startDate,
        dueDate,
        sourceWarehouseId: emptyToNull(body.sourceWarehouseId),
        wipWarehouseId: emptyToNull(body.wipWarehouseId),
        finishedGoodsWarehouseId: emptyToNull(body.finishedGoodsWarehouseId),
        priority,
        status: 'Draft',
        progress: 0,
        description: emptyToNull(body.description) || emptyToNull(body.demandType),
        notes: emptyToNull(body.notes),
        locationId: emptyToNull(body.locationId) || ctx.locationId
      };
    }
  },
  'work-orders': {
    model: 'manufacturingWorkOrder',
    search: ['workOrderNumber', 'operationName'],
    include: {
      productionOrder: { select: { id: true, orderNumber: true, productName: true } },
      workCenter: { select: { id: true, name: true, workCenterCode: true } },
      machine: { select: { id: true, name: true, machineCode: true } }
    },
    numberField: 'workOrderNumber',
    prefix: 'WO',
    async toCreate(body, ctx) {
      const productionOrderId = body.productionOrderId;
      const order = await prisma.manufacturingProductionOrder.findFirst({
        where: { id: productionOrderId, companyId: ctx.companyId }
      });
      if (!order) {
        const err = new Error('Production order not found');
        err.status = 400;
        throw err;
      }
      const workCenterId = emptyToNull(body.workCenterId);
      if (!workCenterId) {
        const err = new Error('Work center is required');
        err.status = 400;
        throw err;
      }
      return {
        workOrderNumber: emptyToNull(body.workOrderNumber) || (await nextNumber(prisma.manufacturingWorkOrder, 'workOrderNumber', 'WO', ctx.companyId)),
        productionOrderId,
        operationName: body.operationName || body.operationId || 'Operation',
        sequence: toNum(body.sequence, 1),
        workCenterId,
        machineId: emptyToNull(body.machineId),
        employeeId: emptyToNull(body.employeeId),
        plannedQuantity: toNum(body.plannedQuantity, order.plannedQuantity),
        completedQuantity: toNum(body.completedQuantity),
        rejectedQuantity: toNum(body.rejectedQuantity),
        scrapQuantity: toNum(body.scrapQuantity),
        status: body.status === 'InProgress' ? 'In Progress' : (body.status || 'Pending'),
        notes: emptyToNull(body.notes)
      };
    }
  },
  'material-reservations': {
    model: 'manufacturingMaterialReservation',
    search: ['reservationNumber', 'componentName'],
    include: {
      productionOrder: { select: { id: true, orderNumber: true } },
      component: { select: { id: true, name: true, sku: true } }
    },
    numberField: 'reservationNumber',
    prefix: 'RES',
    hasLocation: true,
    async toCreate(body, ctx) {
      const product = await requireProduct(ctx.companyId, body.componentId || body.productId);
      const required = toNum(body.requiredQuantity || body.requiredQty);
      const reserved = toNum(body.reservedQuantity || body.reservedQty);
      const available = toNum(body.availableQuantity || body.availableQty, reserved);
      return {
        reservationNumber: emptyToNull(body.reservationNumber) || (await nextNumber(prisma.manufacturingMaterialReservation, 'reservationNumber', 'RES', ctx.companyId)),
        productionOrderId: body.productionOrderId,
        componentId: product.id,
        componentName: product.name,
        requiredQuantity: required,
        availableQuantity: available,
        reservedQuantity: reserved,
        shortageQuantity: Math.max(0, required - reserved),
        locationId: emptyToNull(body.locationId) || ctx.locationId,
        status: body.status || (reserved >= required ? 'Reserved' : reserved > 0 ? 'PartiallyReserved' : 'Pending'),
        notes: emptyToNull(body.notes)
      };
    }
  },
  'material-issues': {
    model: 'manufacturingMaterialIssue',
    search: ['issueNumber', 'componentName'],
    include: {
      productionOrder: { select: { id: true, orderNumber: true } },
      component: { select: { id: true, name: true, sku: true } }
    },
    numberField: 'issueNumber',
    prefix: 'ISS',
    async toCreate(body, ctx) {
      const product = await requireProduct(ctx.companyId, body.componentId || body.productId);
      const fromLocationId = emptyToNull(body.fromLocationId) || emptyToNull(body.warehouseId) || ctx.locationId || (await firstLocationId(ctx.companyId));
      const toLocationId = emptyToNull(body.toLocationId) || fromLocationId;
      if (!fromLocationId || !toLocationId) {
        const err = new Error('Warehouse / location is required to issue material');
        err.status = 400;
        throw err;
      }
      return {
        issueNumber: emptyToNull(body.issueNumber) || (await nextNumber(prisma.manufacturingMaterialIssue, 'issueNumber', 'ISS', ctx.companyId)),
        reservationId: emptyToNull(body.reservationId),
        productionOrderId: body.productionOrderId,
        componentId: product.id,
        componentName: product.name,
        issuedQuantity: toNum(body.issuedQuantity || body.quantity),
        unitOfMeasure: body.unitOfMeasure || 'pcs',
        fromLocationId,
        toLocationId,
        issueDate: toDate(body.issueDate, new Date()),
        status: body.status || 'Issued',
        notes: emptyToNull(body.notes)
      };
    }
  },
  'material-consumption': {
    model: 'manufacturingMaterialConsumption',
    search: ['componentName'],
    include: {
      productionOrder: { select: { id: true, orderNumber: true } },
      component: { select: { id: true, name: true } }
    },
    readOnly: false,
    async toCreate(body, ctx) {
      const product = await requireProduct(ctx.companyId, body.componentId || body.productId);
      return {
        materialIssueId: body.materialIssueId,
        productionOrderId: body.productionOrderId,
        componentId: product.id,
        componentName: product.name,
        requiredQuantity: toNum(body.requiredQuantity || body.requiredQty),
        consumedQuantity: toNum(body.consumedQuantity || body.quantity),
        varianceQuantity: toNum(body.varianceQuantity),
        unitOfMeasure: body.unitOfMeasure || 'pcs',
        consumptionDate: toDate(body.consumptionDate, new Date()),
        workOrderId: emptyToNull(body.workOrderId),
        notes: emptyToNull(body.notes)
      };
    }
  },
  wip: {
    model: 'manufacturingWIP',
    search: ['productName', 'currentOperation'],
    hasLocation: true,
    include: {
      productionOrder: { select: { id: true, orderNumber: true } },
      workCenter: { select: { id: true, name: true } }
    },
    async toCreate(body, ctx) {
      const product = await requireProduct(ctx.companyId, body.productId);
      return {
        productionOrderId: body.productionOrderId,
        productId: product.id,
        productName: product.name,
        quantity: toNum(body.quantity),
        currentOperation: emptyToNull(body.currentOperation),
        workCenterId: emptyToNull(body.workCenterId),
        locationId: emptyToNull(body.locationId) || ctx.locationId,
        startTime: toDate(body.startTime, new Date()),
        expectedCompletion: toDate(body.expectedCompletion),
        status: body.status || 'InProgress',
        notes: emptyToNull(body.notes)
      };
    }
  },
  scrap: {
    model: 'manufacturingScrap',
    search: ['scrapNumber', 'productName', 'materialName', 'reason'],
    include: {
      productionOrder: { select: { id: true, orderNumber: true } },
      workCenter: { select: { id: true, name: true } }
    },
    numberField: 'scrapNumber',
    prefix: 'SCR',
    async toCreate(body, ctx) {
      const product = await requireProduct(ctx.companyId, body.productId || body.materialId);
      return {
        scrapNumber: emptyToNull(body.scrapNumber) || (await nextNumber(prisma.manufacturingScrap, 'scrapNumber', 'SCR', ctx.companyId)),
        productionOrderId: body.productionOrderId,
        workOrderId: emptyToNull(body.workOrderId),
        productId: product.id,
        productName: product.name,
        materialId: emptyToNull(body.materialId) || product.id,
        materialName: emptyToNull(body.materialName) || product.name,
        quantity: toNum(body.quantity),
        unitOfMeasure: body.unitOfMeasure || 'pcs',
        reason: emptyToNull(body.reason),
        workCenterId: emptyToNull(body.workCenterId),
        machineId: emptyToNull(body.machineId),
        operatorId: emptyToNull(body.operatorId),
        scrapDate: toDate(body.scrapDate, new Date()),
        cost: toNum(body.cost),
        notes: emptyToNull(body.notes)
      };
    }
  },
  'by-products': {
    model: 'manufacturingByProduct',
    search: ['productName'],
    hasLocation: true,
    include: {
      productionOrder: { select: { id: true, orderNumber: true } },
      product: { select: { id: true, name: true } }
    },
    async toCreate(body, ctx) {
      const product = await requireProduct(ctx.companyId, body.productId);
      return {
        productionOrderId: body.productionOrderId,
        productId: product.id,
        productName: product.name,
        quantity: toNum(body.quantity),
        unitOfMeasure: body.unitOfMeasure || 'pcs',
        locationId: emptyToNull(body.locationId) || emptyToNull(body.warehouseId) || ctx.locationId,
        receivedDate: toDate(body.receivedDate, new Date()),
        costAllocation: toNum(body.costAllocation),
        notes: emptyToNull(body.notes)
      };
    }
  },
  rework: {
    model: 'manufacturingRework',
    search: ['reworkNumber', 'productName', 'reason'],
    include: {
      productionOrder: { select: { id: true, orderNumber: true } },
      workCenter: { select: { id: true, name: true } }
    },
    numberField: 'reworkNumber',
    prefix: 'RW',
    async toCreate(body, ctx) {
      const product = await requireProduct(ctx.companyId, body.productId);
      return {
        reworkNumber: emptyToNull(body.reworkNumber) || (await nextNumber(prisma.manufacturingRework, 'reworkNumber', 'RW', ctx.companyId)),
        productionOrderId: body.productionOrderId,
        workOrderId: emptyToNull(body.workOrderId),
        productId: product.id,
        productName: product.name,
        quantity: toNum(body.quantity || body.reworkQty),
        unitOfMeasure: body.unitOfMeasure || 'pcs',
        reason: emptyToNull(body.reason),
        workCenterId: emptyToNull(body.workCenterId),
        operatorId: emptyToNull(body.operatorId),
        reworkDate: toDate(body.reworkDate, new Date()),
        estimatedCost: toNum(body.estimatedCost || body.cost),
        actualCost: toNum(body.actualCost || body.cost),
        status: body.status || 'Pending',
        notes: emptyToNull(body.notes)
      };
    }
  },
  inspections: {
    model: 'manufacturingQualityInspection',
    search: ['inspectionNumber', 'productName'],
    include: {
      productionOrder: { select: { id: true, orderNumber: true } },
      inspector: { select: { id: true, employeeCode: true } },
      qualityParameters: true
    },
    numberField: 'inspectionNumber',
    prefix: 'QI',
    async toCreate(body, ctx) {
      const product = await requireProduct(ctx.companyId, body.productId);
      const inspectorId = emptyToNull(body.inspectorId) || emptyToNull(body.inspector) || (await firstEmployeeId(ctx.companyId));
      if (!inspectorId) {
        const err = new Error('An HR employee is required as inspector. Create an employee first.');
        err.status = 400;
        throw err;
      }
      return {
        inspectionNumber: emptyToNull(body.inspectionNumber) || (await nextNumber(prisma.manufacturingQualityInspection, 'inspectionNumber', 'QI', ctx.companyId)),
        productionOrderId: body.productionOrderId,
        workOrderId: emptyToNull(body.workOrderId),
        productId: product.id,
        productName: product.name,
        operationName: emptyToNull(body.operationName),
        inspectorId,
        inspectionDate: toDate(body.inspectionDate, new Date()),
        inspectionType: body.inspectionType === 'In-Process' ? 'InProcess' : (body.inspectionType || 'Final'),
        result: body.result || 'Pending',
        parameters: body.parameters || null,
        notes: emptyToNull(body.notes)
      };
    }
  },
  'maintenance-requests': {
    model: 'manufacturingMaintenanceRequest',
    search: ['requestNumber', 'description'],
    include: { machine: { select: { id: true, name: true, machineCode: true } } },
    numberField: 'requestNumber',
    prefix: 'MR',
    async toCreate(body, ctx) {
      const machineId = emptyToNull(body.machineId);
      if (!machineId) {
        const err = new Error('Machine is required');
        err.status = 400;
        throw err;
      }
      return {
        requestNumber: emptyToNull(body.requestNumber) || (await nextNumber(prisma.manufacturingMaintenanceRequest, 'requestNumber', 'MR', ctx.companyId)),
        machineId,
        requestType: body.requestType || body.type || 'Corrective',
        priority: body.priority === 'Medium' ? 'Normal' : (body.priority || 'Normal'),
        description: emptyToNull(body.description),
        requestedDate: toDate(body.requestedDate, new Date()),
        requestedBy: ctx.userId,
        status: body.status === 'Open' ? 'Pending' : (body.status || 'Pending'),
        notes: emptyToNull(body.notes)
      };
    }
  },
  'maintenance-orders': {
    model: 'manufacturingMaintenanceOrder',
    search: ['orderNumber', 'description'],
    include: { machine: { select: { id: true, name: true, machineCode: true } } },
    numberField: 'orderNumber',
    prefix: 'MNT',
    async toCreate(body, ctx) {
      const machineId = emptyToNull(body.machineId);
      if (!machineId) {
        const err = new Error('Machine is required');
        err.status = 400;
        throw err;
      }
      return {
        orderNumber: emptyToNull(body.orderNumber) || (await nextNumber(prisma.manufacturingMaintenanceOrder, 'orderNumber', 'MNT', ctx.companyId)),
        requestId: emptyToNull(body.requestId),
        machineId,
        technicianId: emptyToNull(body.technicianId) || emptyToNull(body.technician),
        description: emptyToNull(body.description),
        scheduledStart: toDate(body.scheduledStart || body.startTime),
        scheduledEnd: toDate(body.scheduledEnd || body.endTime),
        actualStart: toDate(body.actualStart),
        actualEnd: toDate(body.actualEnd),
        downtime: toNum(body.downtime),
        status: body.status === 'Open' ? 'Scheduled' : (body.status || 'Scheduled'),
        cost: toNum(body.cost),
        notes: emptyToNull(body.notes)
      };
    }
  },
  'subcontract-vendors': {
    model: 'manufacturingSubcontractVendor',
    search: ['vendorCode', 'name', 'email', 'phone'],
    numberField: 'vendorCode',
    prefix: 'SCV',
    async toCreate(body, ctx) {
      return {
        vendorCode: emptyToNull(body.vendorCode) || (await nextNumber(prisma.manufacturingSubcontractVendor, 'vendorCode', 'SCV', ctx.companyId)),
        name: body.name || body.vendorName,
        contactPerson: emptyToNull(body.contactPerson),
        email: emptyToNull(body.email),
        phone: emptyToNull(body.phone),
        address: emptyToNull(body.address),
        services: Array.isArray(body.services) ? body.services : [],
        capacity: toNum(body.capacity),
        leadTimeDays: toNum(body.leadTimeDays),
        qualityRating: toNum(body.qualityRating),
        costRating: toNum(body.costRating),
        deliveryRating: toNum(body.deliveryRating),
        status: body.status || 'Active',
        notes: emptyToNull(body.notes)
      };
    }
  },
  'subcontract-orders': {
    model: 'manufacturingSubcontractOrder',
    search: ['orderNumber', 'productName'],
    include: {
      vendor: { select: { id: true, name: true, vendorCode: true } },
      productionOrder: { select: { id: true, orderNumber: true } },
      materialsSent: true,
      materialsReceived: true
    },
    numberField: 'orderNumber',
    prefix: 'SCO',
    async toCreate(body, ctx) {
      const product = await requireProduct(ctx.companyId, body.productId);
      const qty = toNum(body.quantity, 1);
      const unitCost = toNum(body.unitCost);
      const orderDate = toDate(body.orderDate, new Date());
      return {
        orderNumber: emptyToNull(body.orderNumber) || (await nextNumber(prisma.manufacturingSubcontractOrder, 'orderNumber', 'SCO', ctx.companyId)),
        vendorId: body.vendorId,
        productionOrderId: emptyToNull(body.productionOrderId),
        productId: product.id,
        productName: product.name,
        quantity: qty,
        unitOfMeasure: body.unitOfMeasure || 'pcs',
        unitCost,
        totalCost: toNum(body.totalCost, qty * unitCost),
        orderDate,
        expectedDeliveryDate: toDate(body.expectedDeliveryDate || body.dueDate, addDays(orderDate, 7)),
        actualDeliveryDate: toDate(body.actualDeliveryDate),
        status: body.status || 'Pending',
        notes: emptyToNull(body.notes) || emptyToNull(body.operationName)
      };
    }
  },
  'demand-planning': {
    model: 'manufacturingDemand',
    search: ['demandNumber', 'productName'],
    include: { product: { select: { id: true, name: true, sku: true } } },
    numberField: 'demandNumber',
    prefix: 'DEM',
    async toCreate(body, ctx) {
      const product = await requireProduct(ctx.companyId, body.productId);
      const demandType = String(body.demandType || 'Manual').replace(/\s+/g, '');
      return {
        demandNumber: emptyToNull(body.demandNumber) || (await nextNumber(prisma.manufacturingDemand, 'demandNumber', 'DEM', ctx.companyId)),
        productId: product.id,
        productName: product.name,
        demandType: ['SalesOrder', 'Forecast', 'Manual'].includes(demandType) ? demandType : 'Manual',
        sourceType: body.sourceType || (['SalesOrder', 'Forecast', 'Manual'].includes(demandType) ? demandType : 'Manual'),
        sourceId: emptyToNull(body.sourceId),
        quantity: toNum(body.quantity),
        requiredDate: toDate(body.requiredDate || body.period, new Date()),
        priority: body.priority === 'Medium' ? 'Normal' : (body.priority || 'Normal'),
        status: body.status || 'Open',
        notes: emptyToNull(body.notes)
      };
    }
  },
  mps: {
    model: 'manufacturingMPS',
    search: ['mpsNumber', 'productName', 'week', 'month'],
    include: { product: { select: { id: true, name: true, sku: true } } },
    numberField: 'mpsNumber',
    prefix: 'MPS',
    hasLocation: true,
    async toCreate(body, ctx) {
      const product = await requireProduct(ctx.companyId, body.productId);
      const now = isoWeek();
      return {
        mpsNumber: emptyToNull(body.mpsNumber) || (await nextNumber(prisma.manufacturingMPS, 'mpsNumber', 'MPS', ctx.companyId)),
        productId: product.id,
        productName: product.name,
        week: body.week || now.week,
        month: emptyToNull(body.month) || (body.period === 'month' ? String(new Date().getMonth() + 1) : null),
        year: toNum(body.year, now.year),
        plannedQuantity: toNum(body.plannedQuantity || body.quantity),
        actualQuantity: toNum(body.actualQuantity),
        locationId: emptyToNull(body.locationId) || ctx.locationId,
        status: body.status || 'Planned',
        notes: emptyToNull(body.notes)
      };
    }
  }
};

function serializeRow(resourceKey, row) {
  if (!row) return row;
  const extra = {};
  if (row.productionOrder) {
    extra.productionOrderNumber = row.productionOrder.orderNumber;
  }
  if (row.workCenter) extra.workCenterName = row.workCenter.name;
  if (row.machine) extra.machineName = row.machine.name;
  if (row.vendor) extra.vendorName = row.vendor.name;
  if (row.component) extra.productName = extra.productName || row.component.name;
  if (row.currentStatus && !row.status) extra.status = row.currentStatus;
  if (row.workCenterCode && !row.code) extra.code = row.workCenterCode;
  if (row.machineCode && !row.code) extra.code = row.machineCode;
  if (row.name && resourceKey === 'machines') extra.machineName = row.name;
  if (row.requestType) extra.type = row.requestType;
  if (row.issuedQuantity != null && row.quantity == null) extra.quantity = row.issuedQuantity;
  if (row.requiredQuantity != null) extra.requiredQty = row.requiredQuantity;
  if (row.reservedQuantity != null) extra.reservedQty = row.reservedQuantity;
  if (row.completedQuantity != null) extra.completedQty = row.completedQuantity;
  if (row.plannedQuantity != null) extra.plannedQty = row.plannedQuantity;
  if (row.quantity != null && resourceKey === 'rework') extra.reworkQty = row.quantity;
  if (row.inspector) extra.inspector = row.inspector.employeeCode || row.inspector.id;
  if (row.overheadCost != null) extra.overhead = row.overheadCost;
  if (row.hourlyOperatingCost != null) extra.hourlyCost = row.hourlyOperatingCost;
  if (row.components) extra.components = row.components;
  if (row.week || row.month) extra.period = row.month || row.week;
  return { ...row, ...extra };
}

function delegateOf(key) {
  const spec = RESOURCES[key];
  if (!spec) return null;
  return prisma[spec.model];
}

function locationScope(req, spec) {
  const locationId = emptyToNull(req.query.locationId) || emptyToNull(req.body?.locationId);
  return locationId;
}

const listResource = wrap(async (req, res) => {
  const key = req.mfgResource || req.params.resource;
  const spec = RESOURCES[key];
  const delegate = delegateOf(key);
  if (!spec || !delegate) return fail(res, 404, 'Unknown manufacturing resource');
  const { companyId } = req.mfg;
  const { page, limit, skip } = paginationParams(req);
  const where = { companyId, ...searchOr(spec.search || [], req.query.search) };
  if (req.query.status && req.query.status !== 'All') {
    if (key === 'machines') where.currentStatus = req.query.status;
    else where.status = req.query.status;
  }
  const locationId = locationScope(req, spec);
  if (locationId && spec.hasLocation) where.locationId = locationId;
  if (req.query.productId && (spec.search || []).includes('productName')) {
    where.productId = req.query.productId;
  }
  const [data, total] = await Promise.all([
    delegate.findMany({
      where,
      include: spec.include,
      orderBy: { createdAt: 'desc' },
      skip,
      take: limit
    }),
    delegate.count({ where })
  ]);
  return ok(res, data.map((row) => serializeRow(key, row)), {
    pagination: paginationMeta(page, limit, total)
  });
});

const getResource = wrap(async (req, res) => {
  const key = req.mfgResource || req.params.resource;
  const spec = RESOURCES[key];
  const delegate = delegateOf(key);
  if (!spec || !delegate) return fail(res, 404, 'Unknown manufacturing resource');
  const row = await delegate.findFirst({
    where: { id: req.params.id, companyId: req.mfg.companyId },
    include: spec.include
  });
  if (!row) return fail(res, 404, 'Record not found');
  return ok(res, serializeRow(key, row));
});

const createResource = wrap(async (req, res) => {
  const key = req.mfgResource || req.params.resource;
  const spec = RESOURCES[key];
  const delegate = delegateOf(key);
  if (!spec || !delegate || !spec.toCreate) return fail(res, 404, 'Unknown manufacturing resource');
  const locationId = emptyToNull(req.body?.locationId) || emptyToNull(req.query.locationId);
  const payload = await spec.toCreate(req.body || {}, {
    companyId: req.mfg.companyId,
    userId: req.mfg.userId,
    locationId
  });
  if (!payload.name && spec.model === 'manufacturingWorkCenter') {
    return fail(res, 400, 'Name is required');
  }
  const NO_UPDATED_BY = new Set([
    'manufacturingMaterialConsumption',
    'manufacturingScrap',
    'manufacturingByProduct',
    'manufacturingQualityInspection',
    'manufacturingMRP'
  ]);
  const data = {
    ...payload,
    companyId: req.mfg.companyId,
    createdBy: req.mfg.userId
  };
  if (!NO_UPDATED_BY.has(spec.model)) data.updatedBy = req.mfg.userId;
  const created = await delegate.create({
    data,
    include: spec.include
  });
  return ok(res, serializeRow(key, created));
});

const updateResource = wrap(async (req, res) => {
  const key = req.mfgResource || req.params.resource;
  const spec = RESOURCES[key];
  const delegate = delegateOf(key);
  if (!spec || !delegate) return fail(res, 404, 'Unknown manufacturing resource');
  const existing = await delegate.findFirst({
    where: { id: req.params.id, companyId: req.mfg.companyId }
  });
  if (!existing) return fail(res, 404, 'Record not found');
  const body = req.body || {};
  const NO_UPDATED_BY = new Set([
    'manufacturingMaterialConsumption',
    'manufacturingScrap',
    'manufacturingByProduct',
    'manufacturingQualityInspection',
    'manufacturingMRP'
  ]);
  const data = NO_UPDATED_BY.has(spec.model) ? {} : { updatedBy: req.mfg.userId };
  const assign = (from, to = from) => {
    if (body[from] !== undefined) data[to] = body[from];
  };
  ['status', 'notes', 'description', 'priority', 'version'].forEach((f) => assign(f));
  if (body.name !== undefined) data.name = body.name;
  if (body.machineName !== undefined) data.name = body.machineName;
  if (body.currentStatus !== undefined || body.status !== undefined) {
    if (key === 'machines') data.currentStatus = body.currentStatus || body.status;
  }
  if (body.plannedQuantity !== undefined) data.plannedQuantity = toNum(body.plannedQuantity);
  if (body.quantity !== undefined && existing.quantity !== undefined) data.quantity = toNum(body.quantity);
  if (key === 'boms' && Array.isArray(body.components)) {
    const components = await mapBomComponents(req.mfg.companyId, body.components);
    data.components = { deleteMany: {}, create: components };
    data.totalEstimatedCost = components.reduce((s, c) => s + Number(c.estimatedCost || 0), 0);
  }
  if (body.productId && (spec.search || []).includes('productName')) {
    const product = await requireProduct(req.mfg.companyId, body.productId);
    data.productId = product.id;
    data.productName = product.name;
  }
  const updated = await delegate.update({
    where: { id: existing.id },
    data,
    include: spec.include
  });
  return ok(res, serializeRow(key, updated));
});

const removeResource = wrap(async (req, res) => {
  const key = req.mfgResource || req.params.resource;
  const spec = RESOURCES[key];
  const delegate = delegateOf(key);
  if (!spec || !delegate) return fail(res, 404, 'Unknown manufacturing resource');
  const existing = await delegate.findFirst({
    where: { id: req.params.id, companyId: req.mfg.companyId },
    select: { id: true }
  });
  if (!existing) return fail(res, 404, 'Record not found');
  await delegate.delete({ where: { id: existing.id } });
  return ok(res, { id: existing.id });
});

async function loadOrder(companyId, id) {
  const order = await prisma.manufacturingProductionOrder.findFirst({
    where: { id, companyId },
    include: {
      bom: { include: { components: true } },
      routing: { include: { operations: { include: { workCenter: true } } } },
      workOrders: { include: { workCenter: true } },
      materialReservations: true,
      materialIssues: true,
      scraps: true,
      reworks: true
    }
  });
  if (!order) {
    const err = new Error('Production order not found');
    err.status = 404;
    throw err;
  }
  return order;
}

const getProductionOrder = wrap(async (req, res) => {
  const order = await loadOrder(req.mfg.companyId, req.params.id);
  return ok(res, serializeRow('production-orders', {
    ...order,
    goodQuantity: order.producedQuantity,
    scrappedQuantity: order.scrapQuantity
  }));
});

const releaseOrder = wrap(async (req, res) => {
  const { companyId, userId } = req.mfg;
  const order = await loadOrder(companyId, req.params.id);
  if (!['Draft', 'Planned'].includes(order.status)) {
    return fail(res, 400, `Cannot release an order in ${order.status} status`);
  }
  const stocks = await stockMap(companyId, order.sourceWarehouseId || order.locationId);
  await prisma.$transaction(async (tx) => {
    if (order.bom?.components?.length && order.materialReservations.length === 0) {
      for (const comp of order.bom.components) {
        const required = Number(comp.quantity) * Number(order.plannedQuantity) * (1 + Number(comp.scrapPercentage || 0) / 100);
        const stock = stocks.get(comp.componentId) || { available: 0 };
        const reserved = Math.min(stock.available, required);
        await tx.manufacturingMaterialReservation.create({
          data: {
            reservationNumber: await nextNumber(tx.manufacturingMaterialReservation, 'reservationNumber', 'RES', companyId),
            productionOrderId: order.id,
            componentId: comp.componentId,
            componentName: comp.componentName,
            requiredQuantity: required,
            availableQuantity: stock.available,
            reservedQuantity: reserved,
            shortageQuantity: Math.max(0, required - reserved),
            locationId: order.sourceWarehouseId || order.locationId,
            status: reserved >= required ? 'Reserved' : reserved > 0 ? 'PartiallyReserved' : 'Pending',
            createdBy: userId,
            companyId
          }
        });
      }
    }
    if (order.routing?.operations?.length && order.workOrders.length === 0) {
      for (const op of order.routing.operations) {
        await tx.manufacturingWorkOrder.create({
          data: {
            workOrderNumber: await nextNumber(tx.manufacturingWorkOrder, 'workOrderNumber', 'WO', companyId),
            productionOrderId: order.id,
            operationName: op.operationName,
            sequence: op.sequence,
            workCenterId: op.workCenterId,
            machineId: op.machineId,
            plannedQuantity: order.plannedQuantity,
            status: 'Pending',
            createdBy: userId,
            companyId
          }
        });
      }
    }
    await tx.manufacturingWIP.create({
      data: {
        productionOrderId: order.id,
        productId: order.productId,
        productName: order.productName,
        quantity: order.plannedQuantity,
        currentOperation: order.routing?.operations?.[0]?.operationName || null,
        workCenterId: order.routing?.operations?.[0]?.workCenterId || null,
        locationId: order.wipWarehouseId || order.locationId,
        startTime: new Date(),
        expectedCompletion: order.dueDate,
        status: 'InProgress',
        createdBy: userId,
        companyId
      }
    });
    await tx.manufacturingProductionOrder.update({
      where: { id: order.id },
      data: { status: 'Released', actualStartDate: new Date(), updatedBy: userId }
    });
  });
  const updated = await loadOrder(companyId, order.id);
  return ok(res, serializeRow('production-orders', updated));
});

const setOrderStatus = (nextStatus, extra = {}) =>
  wrap(async (req, res) => {
    const order = await loadOrder(req.mfg.companyId, req.params.id);
    const updated = await prisma.manufacturingProductionOrder.update({
      where: { id: order.id },
      data: {
        status: nextStatus,
        updatedBy: req.mfg.userId,
        notes: req.body?.reason ? `${order.notes || ''}\n${req.body.reason}`.trim() : order.notes,
        ...extra(order, req)
      }
    });
    return ok(res, serializeRow('production-orders', updated));
  });

const pauseOrder = setOrderStatus('Paused', () => ({}));
const resumeOrder = setOrderStatus('In Progress', () => ({}));
const closeOrder = setOrderStatus('Closed', () => ({}));
const cancelOrder = setOrderStatus('Cancelled', () => ({}));

const completeOrder = wrap(async (req, res) => {
  const order = await loadOrder(req.mfg.companyId, req.params.id);
  const produced = toNum(req.body?.producedQuantity ?? req.body?.goodQuantity, order.producedQuantity || order.plannedQuantity);
  const scrap = toNum(req.body?.scrapQuantity, order.scrapQuantity);
  const remaining = Math.max(0, Number(order.plannedQuantity) - produced);
  const updated = await prisma.manufacturingProductionOrder.update({
    where: { id: order.id },
    data: {
      status: 'Completed',
      producedQuantity: produced,
      scrapQuantity: scrap,
      remainingQuantity: remaining,
      progress: 100,
      actualEndDate: new Date(),
      updatedBy: req.mfg.userId
    }
  });
  await prisma.manufacturingWIP.updateMany({
    where: { productionOrderId: order.id, status: 'InProgress' },
    data: { status: 'Completed', updatedBy: req.mfg.userId }
  });
  return ok(res, serializeRow('production-orders', updated));
});

const orderMaterials = wrap(async (req, res) => {
  const rows = await prisma.manufacturingMaterialReservation.findMany({
    where: { productionOrderId: req.params.id, companyId: req.mfg.companyId },
    include: { materialIssues: true }
  });
  const data = rows.map((r) => {
    const issued = r.materialIssues.reduce((s, i) => s + Number(i.issuedQuantity || 0), 0);
    return {
      productId: r.componentId,
      productName: r.componentName,
      requiredQty: r.requiredQuantity,
      reservedQty: r.reservedQuantity,
      issuedQty: issued,
      consumedQty: issued,
      remainingQty: Math.max(0, Number(r.requiredQuantity) - issued),
      availableQty: r.availableQuantity,
      shortageQty: r.shortageQuantity
    };
  });
  return ok(res, data);
});

const orderOperations = wrap(async (req, res) => {
  const rows = await prisma.manufacturingWorkOrder.findMany({
    where: { productionOrderId: req.params.id, companyId: req.mfg.companyId },
    include: { workCenter: true },
    orderBy: { sequence: 'asc' }
  });
  return ok(
    res,
    rows.map((r) => ({
      id: r.id,
      sequence: r.sequence,
      name: r.operationName,
      operationName: r.operationName,
      workCenterName: r.workCenter?.name,
      status: r.status,
      plannedQuantity: r.plannedQuantity,
      completedQuantity: r.completedQuantity
    }))
  );
});

const orderCosting = wrap(async (req, res) => {
  const order = await loadOrder(req.mfg.companyId, req.params.id);
  const materialCost = (order.bom?.components || []).reduce(
    (s, c) => s + Number(c.estimatedCost || 0) * Number(order.plannedQuantity || 1),
    0
  );
  const laborCost = (order.routing?.operations || []).reduce((s, op) => s + Number(op.estimatedCost || 0), 0);
  const data = {
    materialCost,
    laborCost,
    machineCost: 0,
    overhead: 0,
    totalCost: materialCost + laborCost
  };
  return ok(res, data);
});

const workOrderAction = (action) =>
  wrap(async (req, res) => {
    const wo = await prisma.manufacturingWorkOrder.findFirst({
      where: { id: req.params.id, companyId: req.mfg.companyId }
    });
    if (!wo) return fail(res, 404, 'Work order not found');
    const data = { updatedBy: req.mfg.userId };
    if (action === 'start' || action === 'resume') {
      data.status = 'In Progress';
      data.startTime = wo.startTime || new Date();
    } else if (action === 'pause') {
      data.status = 'Paused';
      data.notes = req.body?.reason || wo.notes;
    } else if (action === 'complete') {
      data.status = 'Completed';
      data.endTime = new Date();
      data.completedQuantity = toNum(req.body?.completedQuantity, wo.plannedQuantity);
    } else if (action === 'report') {
      data.completedQuantity = toNum(req.body?.goodQuantity ?? req.body?.completedQuantity, wo.completedQuantity);
      data.scrapQuantity = toNum(req.body?.scrapQuantity, wo.scrapQuantity);
      if (data.completedQuantity >= Number(wo.plannedQuantity)) {
        data.status = 'Completed';
        data.endTime = new Date();
      } else {
        data.status = 'In Progress';
      }
    }
    const updated = await prisma.manufacturingWorkOrder.update({
      where: { id: wo.id },
      data,
      include: {
        productionOrder: { select: { id: true, orderNumber: true } },
        workCenter: { select: { id: true, name: true } }
      }
    });
    if (updated.productionOrderId && (action === 'start' || action === 'complete' || action === 'report')) {
      const siblings = await prisma.manufacturingWorkOrder.findMany({
        where: { productionOrderId: updated.productionOrderId }
      });
      const done = siblings.filter((s) => s.status === 'Completed').length;
      const anyRunning = siblings.some((s) => s.status === 'In Progress');
      await prisma.manufacturingProductionOrder.update({
        where: { id: updated.productionOrderId },
        data: {
          status: done === siblings.length && siblings.length ? 'Completed' : anyRunning ? 'In Progress' : undefined,
          producedQuantity: siblings.reduce((s, w) => s + Number(w.completedQuantity || 0), 0) / Math.max(1, siblings.length),
          progress: siblings.length ? (done / siblings.length) * 100 : 0,
          updatedBy: req.mfg.userId
        }
      });
    }
    return ok(res, serializeRow('work-orders', updated));
  });

const dashboard = wrap(async (req, res) => {
  const { companyId } = req.mfg;
  const locationId = emptyToNull(req.query.locationId);
  const where = { companyId };
  if (locationId) where.locationId = locationId;
  const now = new Date();
  const startOfDay = new Date(now);
  startOfDay.setHours(0, 0, 0, 0);
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

  const [orders, todayOrders, monthOrders, scraps, reworks, inspections, machines, shortages] = await Promise.all([
    prisma.manufacturingProductionOrder.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: 20
    }),
    prisma.manufacturingProductionOrder.aggregate({
      where: { ...where, actualEndDate: { gte: startOfDay } },
      _sum: { producedQuantity: true }
    }),
    prisma.manufacturingProductionOrder.aggregate({
      where: { ...where, actualEndDate: { gte: startOfMonth } },
      _sum: { producedQuantity: true }
    }),
    prisma.manufacturingScrap.aggregate({ where: { companyId }, _sum: { quantity: true } }),
    prisma.manufacturingRework.aggregate({ where: { companyId }, _sum: { quantity: true } }),
    prisma.manufacturingQualityInspection.groupBy({
      by: ['result'],
      where: { companyId },
      _count: { _all: true }
    }),
    prisma.manufacturingMachine.findMany({ where: { companyId } }),
    prisma.manufacturingMaterialReservation.aggregate({
      where: { companyId, shortageQuantity: { gt: 0 } },
      _sum: { shortageQuantity: true },
      _count: { _all: true }
    })
  ]);

  const countBy = (status) => orders.filter((o) => o.status === status).length;
  const inspectionCount = (result) => inspections.find((i) => i.result === result)?._count?._all || 0;
  const machineStatus = (status) => machines.filter((m) => m.currentStatus === status).length;
  const planned = orders.reduce((s, o) => s + Number(o.plannedQuantity || 0), 0);
  const actual = orders.reduce((s, o) => s + Number(o.producedQuantity || 0), 0);

  return ok(res, {
    kpis: {
      productionToday: todayOrders._sum.producedQuantity || 0,
      productionMonth: monthOrders._sum.producedQuantity || 0,
      plannedProduction: planned,
      actualProduction: actual,
      pendingOrders: countBy('Draft') + countBy('Planned') + countBy('Released'),
      inProgress: countBy('In Progress') + countBy('Released'),
      completed: countBy('Completed') + countBy('Closed'),
      delayed: orders.filter((o) => o.dueDate && o.dueDate < now && !['Completed', 'Closed', 'Cancelled'].includes(o.status)).length,
      cancelled: countBy('Cancelled'),
      materialShortage: shortages._count?._all || 0,
      wipQty: orders.filter((o) => ['Released', 'In Progress', 'Paused'].includes(o.status)).reduce((s, o) => s + Number(o.remainingQuantity || 0), 0),
      finishedGoods: actual,
      scrap: scraps._sum.quantity || 0,
      rework: reworks._sum.quantity || 0,
      qualityRejections: inspectionCount('Failed') + inspectionCount('Scrap'),
      machineDowntime: 0,
      productionEfficiency: planned ? (actual / planned) * 100 : 0,
      capacityUtilization: machines.length ? (machineStatus('Running') / machines.length) * 100 : 0,
      yield: planned ? (actual / planned) * 100 : 0,
      oee: planned ? (actual / planned) * 100 : 0
    },
    production: {
      plannedVsActual: [{ label: 'This month', planned, actual }],
      daily: [],
      monthly: [],
      byProduct: [],
      byBranch: []
    },
    materials: {
      consumption: [],
      shortage: [],
      rawAvailability: [],
      wip: [],
      finishedGoods: []
    },
    quality: {
      passed: inspectionCount('Passed'),
      failed: inspectionCount('Failed'),
      rework: inspectionCount('Rework'),
      scrap: inspectionCount('Scrap'),
      rejectionRate: 0,
      byStatus: inspections.map((i) => ({ label: i.result, value: i._count._all }))
    },
    machines: {
      utilization: machines.length ? (machineStatus('Running') / machines.length) * 100 : 0,
      downtime: 0,
      machinesRunning: machineStatus('Running'),
      machinesIdle: machineStatus('Idle'),
      machinesMaintenance: machineStatus('Maintenance'),
      statusChart: ['Running', 'Idle', 'Maintenance', 'Breakdown', 'Offline'].map((label) => ({
        label,
        value: machineStatus(label)
      }))
    },
    productionOrders: orders.map((o) => serializeRow('production-orders', { ...o, goodQuantity: o.producedQuantity }))
  });
});

async function explodeRequirements(companyId, locationId) {
  const [orders, demands] = await Promise.all([
    prisma.manufacturingProductionOrder.findMany({
      where: {
        companyId,
        status: { in: ['Draft', 'Planned', 'Released', 'In Progress', 'Paused'] }
      },
      include: { bom: { include: { components: true } } }
    }),
    prisma.manufacturingDemand.findMany({
      where: { companyId, status: { in: ['Open', 'Planned'] } }
    })
  ]);
  const required = new Map();
  const add = (productId, name, qty) => {
    const prev = required.get(productId) || { productId, productName: name, materialName: name, required: 0 };
    prev.required += qty;
    required.set(productId, prev);
  };
  orders.forEach((order) => {
    (order.bom?.components || []).forEach((c) => {
      add(c.componentId, c.componentName, Number(c.quantity) * Number(order.plannedQuantity) * (1 + Number(c.scrapPercentage || 0) / 100));
    });
  });
  demands.forEach((d) => add(d.productId, d.productName, Number(d.quantity)));
  const stocks = await stockMap(companyId, locationId);
  return [...required.values()].map((row) => {
    const st = stocks.get(row.productId) || { available: 0, reserved: 0 };
    const shortage = Math.max(0, row.required - st.available);
    return {
      ...row,
      materialId: row.productId,
      requiredQty: row.required,
      available: st.available,
      availableQty: st.available,
      reserved: st.reserved,
      reservedQty: st.reserved,
      incoming: 0,
      incomingQty: 0,
      shortage,
      shortageQty: shortage,
      suggestedPurchaseQty: shortage,
      suggestedProductionQty: 0
    };
  });
}

const runMrp = wrap(async (req, res) => {
  const items = await explodeRequirements(req.mfg.companyId, emptyToNull(req.query.locationId));
  const run = await prisma.manufacturingMRP.create({
    data: {
      mrpNumber: await nextNumber(prisma.manufacturingMRP, 'mrpNumber', 'MRP', req.mfg.companyId),
      runDate: new Date(),
      periodStart: new Date(),
      periodEnd: addDays(new Date(), 30),
      status: 'Calculated',
      createdBy: req.mfg.userId,
      companyId: req.mfg.companyId,
      mrpItems: {
        create: items.map((i) => ({
          materialId: i.productId,
          materialName: i.productName,
          requiredQuantity: i.required,
          availableQuantity: i.available,
          reservedQuantity: i.reserved,
          incomingQuantity: 0,
          shortageQuantity: i.shortage,
          suggestedPurchaseQuantity: i.suggestedPurchaseQty,
          suggestedProductionQuantity: 0
        }))
      }
    },
    include: { mrpItems: true }
  });
  return ok(res, {
    id: run.id,
    mrpNumber: run.mrpNumber,
    items: run.mrpItems.map((i) => ({
      productId: i.materialId,
      productName: i.materialName,
      materialName: i.materialName,
      required: i.requiredQuantity,
      requiredQty: i.requiredQuantity,
      available: i.availableQuantity,
      availableQty: i.availableQuantity,
      reserved: i.reservedQuantity,
      reservedQty: i.reservedQuantity,
      incoming: i.incomingQuantity,
      shortage: i.shortageQuantity,
      shortageQty: i.shortageQuantity,
      suggestedPurchaseQty: i.suggestedPurchaseQuantity,
      suggestedProductionQty: i.suggestedProductionQuantity
    }))
  });
});

const materialShortage = wrap(async (req, res) => {
  const items = (await explodeRequirements(req.mfg.companyId, emptyToNull(req.query.locationId))).filter(
    (i) => i.shortage > 0
  );
  return ok(res, items, {
    summary: {
      shortageCount: items.length,
      shortageQty: items.reduce((s, i) => s + Number(i.shortage || 0), 0)
    }
  });
});

const mpsExplode = wrap(async (req, res) => {
  const items = await explodeRequirements(req.mfg.companyId, emptyToNull(req.query.locationId));
  return ok(res, items);
});

const settingsGet = wrap(async (req, res) => {
  const row = await prisma.manufacturingSetting.findUnique({
    where: { companyId: req.mfg.companyId }
  });
  return ok(res, row?.settings || {
    productionOrderPrefix: 'MO-',
    workOrderPrefix: 'WO-',
    bomPrefix: 'BOM-',
    nextNumber: 1,
    allowNegativeInventory: false,
    autoCreatePurchaseOrders: false,
    wipWarehouseId: '',
    finishedGoodsWarehouseId: ''
  });
});

const settingsUpdate = wrap(async (req, res) => {
  const row = await prisma.manufacturingSetting.upsert({
    where: { companyId: req.mfg.companyId },
    update: { settings: req.body || {} },
    create: { companyId: req.mfg.companyId, settings: req.body || {} }
  });
  return ok(res, row.settings);
});

const productCost = wrap(async (req, res) => {
  const product = await findProduct(req.mfg.companyId, req.params.productId);
  if (!product) return fail(res, 404, 'Product not found');
  const bom = await prisma.manufacturingBOM.findFirst({
    where: { companyId: req.mfg.companyId, productId: product.id },
    include: { components: true },
    orderBy: { updatedAt: 'desc' }
  });
  const routing = await prisma.manufacturingRouting.findFirst({
    where: { companyId: req.mfg.companyId, productId: product.id },
    include: { operations: true },
    orderBy: { updatedAt: 'desc' }
  });
  const materialCost = (bom?.components || []).reduce((s, c) => s + Number(c.estimatedCost || 0), 0);
  const laborCost = (routing?.operations || []).reduce((s, o) => s + Number(o.estimatedCost || 0), 0);
  return ok(res, {
    productId: product.id,
    productName: product.name,
    materialCost,
    laborCost,
    machineCost: 0,
    overhead: 0,
    subcontractingCost: 0,
    totalCost: materialCost + laborCost
  });
});

const costList = (costType) =>
  wrap(async (req, res) => {
    const rows = await prisma.manufacturingProductCost.findMany({
      where: { companyId: req.mfg.companyId, ...(costType ? { costType } : {}) },
      orderBy: { updatedAt: 'desc' }
    });
    if (rows.length) return ok(res, rows.map((r) => ({ ...r, overhead: r.overheadCost })));
    const boms = await prisma.manufacturingBOM.findMany({
      where: { companyId: req.mfg.companyId },
      include: { components: true },
      take: 50
    });
    return ok(
      res,
      boms.map((b) => ({
        productId: b.productId,
        productName: b.productName,
        materialCost: b.totalEstimatedCost,
        laborCost: 0,
        machineCost: 0,
        overhead: 0,
        totalCost: b.totalEstimatedCost
      }))
    );
  });

const actualCost = wrap(async (req, res) => {
  const rows = await prisma.manufacturingProductCost.findMany({
    where: { companyId: req.mfg.companyId, costType: 'Actual' }
  });
  if (rows.length) return ok(res, rows.map((r) => ({ ...r, overhead: r.overheadCost })));
  const orders = await prisma.manufacturingProductionOrder.findMany({
    where: { companyId: req.mfg.companyId, status: { in: ['Completed', 'Closed'] } },
    include: { bom: { include: { components: true } } },
    take: 50
  });
  return ok(
    res,
    orders.map((o) => ({
      productionOrderId: o.id,
      productionOrderNumber: o.orderNumber,
      productName: o.productName,
      materialCost: o.bom?.totalEstimatedCost || 0,
      laborCost: 0,
      machineCost: 0,
      overhead: 0,
      totalCost: o.bom?.totalEstimatedCost || 0
    }))
  );
});

const costVariance = wrap(async (req, res) => {
  const rows = await prisma.manufacturingCostVariance.findMany({
    where: { productCost: { companyId: req.mfg.companyId } },
    include: { productCost: true }
  });
  return ok(
    res,
    rows.map((r) => ({
      productId: r.productCost.productId,
      productName: r.productCost.productName,
      standardCost: r.standardCost,
      actualCost: r.actualCost,
      variance: r.varianceAmount,
      materialVariance: r.varianceType === 'Material' ? r.varianceAmount : 0,
      laborVariance: r.varianceType === 'Labor' ? r.varianceAmount : 0,
      machineVariance: r.varianceType === 'Machine' ? r.varianceAmount : 0,
      overheadVariance: r.varianceType === 'Overhead' ? r.varianceAmount : 0
    }))
  );
});

const report = (kind) =>
  wrap(async (req, res) => {
    const { companyId } = req.mfg;
    if (kind === 'production') {
      const orders = await prisma.manufacturingProductionOrder.findMany({ where: { companyId } });
      const good = orders.reduce((s, o) => s + Number(o.producedQuantity || 0), 0);
      const planned = orders.reduce((s, o) => s + Number(o.plannedQuantity || 0), 0);
      const scrap = orders.reduce((s, o) => s + Number(o.scrapQuantity || 0), 0);
      return ok(res, {
        totalOrders: orders.length,
        goodQuantity: good,
        scrapQty: scrap,
        completionRate: planned ? Math.round((good / planned) * 100) : 0
      });
    }
    if (kind === 'material') {
      const [consumed, shortages, wip] = await Promise.all([
        prisma.manufacturingMaterialIssue.aggregate({ where: { companyId }, _sum: { issuedQuantity: true } }),
        prisma.manufacturingMaterialReservation.aggregate({ where: { companyId }, _sum: { shortageQuantity: true } }),
        prisma.manufacturingWIP.aggregate({ where: { companyId, status: 'InProgress' }, _sum: { quantity: true } })
      ]);
      return ok(res, {
        consumedQty: consumed._sum.issuedQuantity || 0,
        variance: 0,
        shortage: shortages._sum.shortageQuantity || 0,
        wipQty: wip._sum.quantity || 0
      });
    }
    if (kind === 'quality') {
      const groups = await prisma.manufacturingQualityInspection.groupBy({
        by: ['result'],
        where: { companyId },
        _count: { _all: true }
      });
      const pick = (r) => groups.find((g) => g.result === r)?._count?._all || 0;
      const total = groups.reduce((s, g) => s + g._count._all, 0);
      const failed = pick('Failed') + pick('Scrap');
      const scrapAgg = await prisma.manufacturingScrap.aggregate({ where: { companyId }, _sum: { quantity: true } });
      const reworkAgg = await prisma.manufacturingRework.aggregate({ where: { companyId }, _sum: { quantity: true } });
      return ok(res, {
        total,
        passed: pick('Passed'),
        failed,
        rework: pick('Rework'),
        scrap: pick('Scrap'),
        scrapQty: scrapAgg._sum.quantity || 0,
        reworkQty: reworkAgg._sum.quantity || 0,
        rejectionRate: total ? Math.round((failed / total) * 100) : 0
      });
    }
    if (kind === 'machine') {
      const machines = await prisma.manufacturingMachine.findMany({ where: { companyId } });
      const maint = await prisma.manufacturingMaintenanceOrder.aggregate({
        where: { companyId },
        _sum: { cost: true, downtime: true }
      });
      return ok(res, {
        total: machines.length,
        running: machines.filter((m) => m.currentStatus === 'Running').length,
        downtime: Number(((maint._sum.downtime || 0) / 60).toFixed(1)),
        maintenanceCost: maint._sum.cost || 0
      });
    }
    if (kind === 'efficiency') {
      const orders = await prisma.manufacturingProductionOrder.findMany({ where: { companyId } });
      const planned = orders.reduce((s, o) => s + Number(o.plannedQuantity || 0), 0);
      const actual = orders.reduce((s, o) => s + Number(o.producedQuantity || 0), 0);
      const pct = planned ? Math.round((actual / planned) * 100) : 0;
      return ok(res, { efficiency: pct, yield: pct, capacityUtilization: pct, oee: pct });
    }
    const standard = await prisma.manufacturingProductCost.aggregate({
      where: { companyId, costType: 'Standard' },
      _sum: { totalCost: true, laborCost: true }
    });
    const actualC = await prisma.manufacturingProductCost.aggregate({
      where: { companyId, costType: 'Actual' },
      _sum: { totalCost: true }
    });
    return ok(res, {
      standardCost: standard._sum.totalCost || 0,
      actualCost: actualC._sum.totalCost || 0,
      variance: Number(actualC._sum.totalCost || 0) - Number(standard._sum.totalCost || 0),
      laborCost: standard._sum.laborCost || 0
    });
  });

const emptyList = wrap(async (_req, res) => {
  return ok(res, [], { pagination: paginationMeta(1, 20, 0) });
});

const listOperations = wrap(async (req, res) => {
  const { page, limit, skip } = paginationParams(req);
  const where = {
    routing: { companyId: req.mfg.companyId },
    ...searchOr(['operationName'], req.query.search)
  };
  const [data, total] = await Promise.all([
    prisma.manufacturingRoutingOperation.findMany({
      where,
      include: { workCenter: true, routing: { select: { routingNumber: true, productName: true } } },
      skip,
      take: limit,
      orderBy: { sequence: 'asc' }
    }),
    prisma.manufacturingRoutingOperation.count({ where })
  ]);
  return ok(
    res,
    data.map((op) => ({
      id: op.id,
      name: op.operationName,
      operationName: op.operationName,
      code: op.routing?.routingNumber,
      workCenterName: op.workCenter?.name,
      setupTime: op.setupTime,
      runTime: op.runTime,
      cost: op.estimatedCost
    })),
    { pagination: paginationMeta(page, limit, total) }
  );
});

const listTracking = wrap(async (req, res) => {
  const { page, limit, skip } = paginationParams(req);
  const where = { companyId: req.mfg.companyId };
  const [data, total] = await Promise.all([
    prisma.manufacturingProductionOrder.findMany({
      where,
      skip,
      take: limit,
      orderBy: { updatedAt: 'desc' }
    }),
    prisma.manufacturingProductionOrder.count({ where })
  ]);
  return ok(
    res,
    data.map((o) => ({
      ...serializeRow('production-orders', o),
      productionOrderNumber: o.orderNumber,
      planned: o.plannedQuantity,
      goodQuantity: o.producedQuantity,
      scrapQuantity: o.scrapQuantity
    })),
    { pagination: paginationMeta(page, limit, total) }
  );
});

const filteredRequests = (type) =>
  wrap(async (req, res) => {
    const { page, limit, skip } = paginationParams(req);
    const where = { companyId: req.mfg.companyId, requestType: type };
    const [data, total] = await Promise.all([
      prisma.manufacturingMaintenanceRequest.findMany({
        where,
        include: { machine: true },
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' }
      }),
      prisma.manufacturingMaintenanceRequest.count({ where })
    ]);
    return ok(res, data.map((r) => serializeRow('maintenance-requests', r)), {
      pagination: paginationMeta(page, limit, total)
    });
  });

module.exports = {
  wrap,
  listResource,
  getResource,
  createResource,
  updateResource,
  removeResource,
  getProductionOrder,
  releaseOrder,
  pauseOrder,
  resumeOrder,
  completeOrder,
  closeOrder,
  cancelOrder,
  orderMaterials,
  orderOperations,
  orderCosting,
  workOrderAction,
  dashboard,
  runMrp,
  materialShortage,
  mpsExplode,
  settingsGet,
  settingsUpdate,
  productCost,
  costList,
  actualCost,
  costVariance,
  report,
  emptyList,
  listOperations,
  listTracking,
  filteredRequests,
  RESOURCES
};
