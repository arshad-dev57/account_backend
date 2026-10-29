'use strict';

/**
 * ERPNext Manufacturing sidebar reports.
 * Each report reads company-scoped manufacturing tables (same data the DocTypes write).
 */

const prisma = require('../prisma/client');

function badRequest(message) {
  const error = new Error(message);
  error.status = 400;
  return error;
}

function range(query, fallbackDays = 30) {
  const to = query.to ? new Date(`${String(query.to).slice(0, 10)}T00:00:00.000Z`) : null;
  const from = query.from ? new Date(`${String(query.from).slice(0, 10)}T00:00:00.000Z`) : null;
  if (to && Number.isNaN(to.getTime())) throw badRequest('Invalid "to" date');
  if (from && Number.isNaN(from.getTime())) throw badRequest('Invalid "from" date');
  if (from && to && from > to) throw badRequest('Start date must be before end date');
  const end = to || new Date();
  if (!to && !from) {
    const start = new Date(end);
    start.setUTCDate(start.getUTCDate() - fallbackDays);
    return { from: start, to: end };
  }
  return { from: from || end, to: end };
}

function dateFilters() {
  return [
    { key: 'from', label: 'From Date', type: 'date' },
    { key: 'to', label: 'To Date', type: 'date' }
  ];
}

function pack(report, doctype, columns, filterDefs, query, rows) {
  const { from, to } = range(query);
  return {
    report,
    doctype,
    columns,
    filterDefs: filterDefs || dateFilters(),
    filters: {
      available: ['date'],
      values: query,
      date: true,
      from: from.toISOString().slice(0, 10),
      to: to.toISOString().slice(0, 10),
      employeeId: null,
      department: null
    },
    total: rows.length,
    rows
  };
}

const OPEN_STATUSES = ['Draft', 'Not Started', 'Planned', 'Released'];
const WIP_STATUSES = ['In Process', 'In Progress', 'Paused', 'Stopped'];
const DONE_STATUSES = ['Completed', 'Closed'];

const reports = {
  'work-order-summary': {
    doctype: 'Work Order Summary',
    filterDefs: dateFilters(),
    columns: [
      { key: 'orderNumber', label: 'Work Order' },
      { key: 'productName', label: 'Item' },
      { key: 'plannedQuantity', label: 'Qty To Manufacture', type: 'number' },
      { key: 'producedQuantity', label: 'Manufactured Qty', type: 'number' },
      { key: 'status', label: 'Status' },
      { key: 'startDate', label: 'Planned Start', type: 'date' },
      { key: 'dueDate', label: 'Planned End', type: 'date' }
    ],
    async build(companyId, query) {
      const { from, to } = range(query);
      const rows = await prisma.manufacturingProductionOrder.findMany({
        where: { companyId, createdAt: { gte: from, lte: to } },
        orderBy: { createdAt: 'desc' },
        take: 500
      });
      return rows.map((r) => ({
        orderNumber: r.orderNumber,
        productName: r.productName,
        plannedQuantity: r.plannedQuantity,
        producedQuantity: r.producedQuantity,
        status: r.status,
        startDate: r.startDate,
        dueDate: r.dueDate
      }));
    }
  },

  'open-work-orders': {
    doctype: 'Open Work Orders',
    filterDefs: [],
    columns: [
      { key: 'orderNumber', label: 'Work Order' },
      { key: 'productName', label: 'Item' },
      { key: 'plannedQuantity', label: 'Qty', type: 'number' },
      { key: 'status', label: 'Status' },
      { key: 'startDate', label: 'Planned Start', type: 'date' }
    ],
    async build(companyId) {
      return prisma.manufacturingProductionOrder.findMany({
        where: { companyId, status: { in: OPEN_STATUSES } },
        orderBy: { startDate: 'asc' },
        take: 500,
        select: {
          orderNumber: true,
          productName: true,
          plannedQuantity: true,
          status: true,
          startDate: true
        }
      });
    }
  },

  'work-orders-in-progress': {
    doctype: 'Work Orders in Progress',
    filterDefs: [],
    columns: [
      { key: 'orderNumber', label: 'Work Order' },
      { key: 'productName', label: 'Item' },
      { key: 'plannedQuantity', label: 'Qty', type: 'number' },
      { key: 'producedQuantity', label: 'Produced', type: 'number' },
      { key: 'status', label: 'Status' }
    ],
    async build(companyId) {
      return prisma.manufacturingProductionOrder.findMany({
        where: { companyId, status: { in: WIP_STATUSES } },
        orderBy: { updatedAt: 'desc' },
        take: 500,
        select: {
          orderNumber: true,
          productName: true,
          plannedQuantity: true,
          producedQuantity: true,
          status: true
        }
      });
    }
  },

  'completed-work-orders': {
    doctype: 'Completed Work Orders',
    filterDefs: dateFilters(),
    columns: [
      { key: 'orderNumber', label: 'Work Order' },
      { key: 'productName', label: 'Item' },
      { key: 'plannedQuantity', label: 'Qty', type: 'number' },
      { key: 'producedQuantity', label: 'Produced', type: 'number' },
      { key: 'actualEndDate', label: 'Completed On', type: 'date' }
    ],
    async build(companyId, query) {
      const { from, to } = range(query, 90);
      return prisma.manufacturingProductionOrder.findMany({
        where: {
          companyId,
          status: { in: DONE_STATUSES },
          OR: [{ actualEndDate: { gte: from, lte: to } }, { updatedAt: { gte: from, lte: to } }]
        },
        orderBy: { updatedAt: 'desc' },
        take: 500,
        select: {
          orderNumber: true,
          productName: true,
          plannedQuantity: true,
          producedQuantity: true,
          actualEndDate: true
        }
      });
    }
  },

  'job-card-summary': {
    doctype: 'Job Card Summary',
    filterDefs: dateFilters(),
    columns: [
      { key: 'workOrderNumber', label: 'Job Card' },
      { key: 'operationName', label: 'Operation' },
      { key: 'plannedQuantity', label: 'For Qty', type: 'number' },
      { key: 'completedQuantity', label: 'Completed', type: 'number' },
      { key: 'status', label: 'Status' },
      { key: 'workCenterId', label: 'Workstation' }
    ],
    async build(companyId, query) {
      const { from, to } = range(query);
      const rows = await prisma.manufacturingWorkOrder.findMany({
        where: { companyId, createdAt: { gte: from, lte: to } },
        include: { workCenter: { select: { name: true } } },
        orderBy: { createdAt: 'desc' },
        take: 500
      });
      return rows.map((r) => ({
        workOrderNumber: r.workOrderNumber,
        operationName: r.operationName,
        plannedQuantity: r.plannedQuantity,
        completedQuantity: r.completedQuantity,
        status: r.status,
        workCenterId: r.workCenter?.name || r.workCenterId
      }));
    }
  },

  'downtime-analysis': {
    doctype: 'Downtime Analysis',
    filterDefs: dateFilters(),
    columns: [
      { key: 'name', label: 'ID' },
      { key: 'workstation', label: 'Workstation' },
      { key: 'fromTime', label: 'From', type: 'date' },
      { key: 'toTime', label: 'To', type: 'date' },
      { key: 'minutes', label: 'Minutes', type: 'number' },
      { key: 'stopReason', label: 'Stop Reason' }
    ],
    async build(companyId, query) {
      const { from, to } = range(query, 90);
      const rows = await prisma.manufacturingDowntimeEntry.findMany({
        where: { companyId, fromTime: { gte: from, lte: to } },
        include: { workstation: { select: { name: true } } },
        orderBy: { fromTime: 'desc' },
        take: 500
      });
      return rows.map((r) => ({
        name: r.name,
        workstation: r.workstation?.name || r.workstationId,
        fromTime: r.fromTime,
        toTime: r.toTime,
        minutes: Math.max(0, (new Date(r.toTime) - new Date(r.fromTime)) / 60000),
        stopReason: r.stopReason || ''
      }));
    }
  },

  'bom-search': {
    doctype: 'BOM Search',
    filterDefs: [{ key: 'search', label: 'Item / BOM', type: 'data' }],
    columns: [
      { key: 'bomNumber', label: 'BOM' },
      { key: 'productName', label: 'Item' },
      { key: 'version', label: 'Version' },
      { key: 'status', label: 'Status' },
      { key: 'totalEstimatedCost', label: 'Total Cost', type: 'currency' }
    ],
    async build(companyId, query) {
      const where = { companyId };
      if (query.search) {
        where.OR = [
          { bomNumber: { contains: String(query.search), mode: 'insensitive' } },
          { productName: { contains: String(query.search), mode: 'insensitive' } }
        ];
      }
      return prisma.manufacturingBOM.findMany({
        where,
        orderBy: { updatedAt: 'desc' },
        take: 500,
        select: {
          bomNumber: true,
          productName: true,
          version: true,
          status: true,
          totalEstimatedCost: true
        }
      });
    }
  },

  'bom-operations-time': {
    doctype: 'BOM Operations Time',
    filterDefs: [],
    columns: [
      { key: 'routingNumber', label: 'Routing' },
      { key: 'productName', label: 'Item' },
      { key: 'operationName', label: 'Operation' },
      { key: 'setupTime', label: 'Setup Time', type: 'number' },
      { key: 'runTime', label: 'Operating Time', type: 'number' },
      { key: 'workstation', label: 'Workstation' }
    ],
    async build(companyId) {
      const routings = await prisma.manufacturingRouting.findMany({
        where: { companyId, status: { in: ['Active', 'Draft'] } },
        include: {
          operations: {
            include: { workCenter: { select: { name: true } } },
            orderBy: { sequence: 'asc' }
          }
        },
        take: 200
      });
      const rows = [];
      for (const routing of routings) {
        for (const op of routing.operations) {
          rows.push({
            routingNumber: routing.routingNumber,
            productName: routing.productName,
            operationName: op.operationName,
            setupTime: op.setupTime,
            runTime: op.runTime,
            workstation: op.workCenter?.name || op.workCenterId
          });
        }
      }
      return rows;
    }
  },

  'production-analytics': {
    doctype: 'Production Analytics',
    filterDefs: dateFilters(),
    columns: [
      { key: 'status', label: 'Status' },
      { key: 'count', label: 'Work Orders', type: 'number' },
      { key: 'plannedQty', label: 'Planned Qty', type: 'number' },
      { key: 'producedQty', label: 'Produced Qty', type: 'number' }
    ],
    async build(companyId, query) {
      const { from, to } = range(query, 90);
      const rows = await prisma.manufacturingProductionOrder.findMany({
        where: { companyId, createdAt: { gte: from, lte: to } },
        select: { status: true, plannedQuantity: true, producedQuantity: true }
      });
      const map = new Map();
      for (const row of rows) {
        const cur = map.get(row.status) || { status: row.status, count: 0, plannedQty: 0, producedQty: 0 };
        cur.count += 1;
        cur.plannedQty += Number(row.plannedQuantity) || 0;
        cur.producedQty += Number(row.producedQuantity) || 0;
        map.set(row.status, cur);
      }
      return [...map.values()];
    }
  },

  'production-planning-report': {
    doctype: 'Production Planning Report',
    filterDefs: dateFilters(),
    columns: [
      { key: 'name', label: 'Production Plan' },
      { key: 'postingDate', label: 'Posting Date', type: 'date' },
      { key: 'status', label: 'Status' },
      { key: 'getItemsFrom', label: 'Get Items From' }
    ],
    async build(companyId, query) {
      const { from, to } = range(query, 90);
      return prisma.manufacturingProductionPlan.findMany({
        where: { companyId, postingDate: { gte: from, lte: to } },
        orderBy: { postingDate: 'desc' },
        take: 500,
        select: { name: true, postingDate: true, status: true, getItemsFrom: true }
      });
    }
  },

  'work-order-consumed-materials': {
    doctype: 'Work Order Consumed Materials',
    filterDefs: dateFilters(),
    columns: [
      { key: 'orderNumber', label: 'Work Order' },
      { key: 'componentName', label: 'Item' },
      { key: 'consumedQuantity', label: 'Consumed Qty', type: 'number' },
      { key: 'unitOfMeasure', label: 'UOM' },
      { key: 'consumptionDate', label: 'Date', type: 'date' }
    ],
    async build(companyId, query) {
      const { from, to } = range(query, 90);
      const rows = await prisma.manufacturingMaterialConsumption.findMany({
        where: { companyId, consumptionDate: { gte: from, lte: to } },
        include: { productionOrder: { select: { orderNumber: true } } },
        orderBy: { consumptionDate: 'desc' },
        take: 500
      });
      return rows.map((r) => ({
        orderNumber: r.productionOrder?.orderNumber || '',
        componentName: r.componentName,
        consumedQuantity: r.consumedQuantity,
        unitOfMeasure: r.unitOfMeasure,
        consumptionDate: r.consumptionDate
      }));
    }
  },

  'quality-inspection-summary': {
    doctype: 'Quality Inspection Summary',
    filterDefs: dateFilters(),
    columns: [
      { key: 'inspectionNumber', label: 'Inspection' },
      { key: 'productName', label: 'Item' },
      { key: 'result', label: 'Result' },
      { key: 'inspectionDate', label: 'Date', type: 'date' }
    ],
    async build(companyId, query) {
      const { from, to } = range(query, 90);
      try {
        return await prisma.manufacturingQualityInspection.findMany({
          where: { companyId, createdAt: { gte: from, lte: to } },
          orderBy: { createdAt: 'desc' },
          take: 500,
          select: {
            inspectionNumber: true,
            productName: true,
            result: true,
            inspectionDate: true
          }
        });
      } catch {
        return [];
      }
    }
  },

  forecasting: {
    doctype: 'Exponential Smoothing Forecasting',
    filterDefs: dateFilters(),
    columns: [
      { key: 'productName', label: 'Item' },
      { key: 'period', label: 'Period' },
      { key: 'forecastQty', label: 'Forecast Qty', type: 'number' },
      { key: 'actualQty', label: 'Actual Qty', type: 'number' }
    ],
    async build(companyId) {
      const rows = await prisma.manufacturingSalesForecast.findMany({
        where: { companyId },
        orderBy: { createdAt: 'desc' },
        take: 100
      });
      return rows.flatMap((row) => {
        const items = Array.isArray(row.items) ? row.items : [];
        if (!items.length) {
          return [{ productName: row.name, period: `${row.fromDate || ''} → ${row.toDate || ''}`, forecastQty: 0, actualQty: 0 }];
        }
        return items.map((item) => ({
          productName: item.itemName || item.itemCode || row.name,
          period: `${row.fromDate || ''} → ${row.toDate || ''}`,
          forecastQty: Number(item.forecastQty || item.qty || 0),
          actualQty: Number(item.actualQty || 0)
        }));
      });
    }
  }
};

async function runReport(name, companyId, query = {}) {
  const def = reports[name];
  if (!def) {
    const error = new Error(`Unknown report: ${name}`);
    error.status = 404;
    throw error;
  }
  const rows = await def.build(companyId, query);
  return pack(name, def.doctype, def.columns, def.filterDefs, query, rows);
}

function reportNames() {
  return Object.keys(reports);
}

module.exports = { reports, runReport, reportNames };
