'use strict';

const { randomUUID } = require('crypto');
const prisma = require('../prisma/client');
const { registry } = require('./mfgDocumentRegistry');

class HttpError extends Error {
  constructor(status, message, extra) {
    super(message);
    this.status = status;
    this.extra = extra || {};
  }
}

const COLUMN_INDEX = (() => {
  const fs = require('fs');
  const path = require('path');
  const index = {};
  try {
    const src = fs.readFileSync(path.join(__dirname, '..', 'prisma', 'schema.prisma'), 'utf8');
    for (const match of src.matchAll(/^model (Manufacturing[A-Za-z]+) \{([\s\S]*?)^\}/gm)) {
      const [, model, body] = match;
      const columns = new Set();
      const scalars = new Set(['String', 'Int', 'Float', 'Boolean', 'DateTime', 'Json', 'Decimal', 'BigInt']);
      for (const line of body.split('\n')) {
        const parts = line.trim().split(/\s+/);
        if (parts.length < 2) continue;
        if (parts[0].startsWith('@') || parts[0].startsWith('//')) continue;
        const type = String(parts[1]).replace(/[?[\]]/g, '');
        if (scalars.has(type)) columns.add(parts[0]);
      }
      index[model] = { columns };
    }
  } catch (error) {
    console.error('[mfg-docs] schema index unavailable', error.message);
  }
  return index;
})();

function modelHasColumn(model, name) {
  const pascal = model[0].toUpperCase() + model.slice(1);
  return Boolean(COLUMN_INDEX[pascal]?.columns.has(name));
}

function definition(resource) {
  const def = registry[resource];
  if (!def) throw new HttpError(404, `Unknown Manufacturing document: ${resource}`);
  if (def.available === false) throw new HttpError(404, `${def.doctype} is not available yet`);
  return def;
}

function modelClient(def) {
  if (!def.model) throw new HttpError(404, `${def.doctype} is not available yet`);
  const client = prisma[def.model];
  if (!client) throw new HttpError(500, `Manufacturing model not wired: ${def.model}`);
  return client;
}

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

function ymd(value) {
  if (!value) return '';
  if (typeof value === 'string' && DATE_ONLY.test(value)) return value.slice(0, 10);
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? '' : d.toISOString().slice(0, 10);
}

function toDate(value) {
  if (value === 'today') return new Date(`${ymd(new Date())}T00:00:00.000Z`);
  const key = ymd(value);
  return key ? new Date(`${key}T00:00:00.000Z`) : null;
}

function toDateTime(value) {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

function userIdOf(req) {
  return String(req.user?.id || req.user?._id || '');
}

async function nextNumber(delegate, field, prefix, companyId) {
  const latest = await delegate.findFirst({
    where: { companyId, [field]: { startsWith: `${prefix}-` } },
    orderBy: { createdAt: 'desc' },
    select: { [field]: true }
  });
  const raw = latest?.[field] || '';
  const match = String(raw).match(/(\d+)$/);
  const next = (match ? Number(match[1]) : 0) + 1;
  return `${prefix}-${String(next).padStart(5, '0')}`;
}

const LINK_TARGETS = {
  product: {
    model: 'product',
    column: 'name',
    extraCols: ['sku'],
    compose: (row) => (row.sku ? `${row.name} (${row.sku})` : row.name)
  },
  bom: { model: 'manufacturingBOM', column: 'bomNumber' },
  routing: { model: 'manufacturingRouting', column: 'routingNumber' },
  workstation: { model: 'manufacturingWorkCenter', column: 'name', extraCols: ['workCenterCode'] },
  'workstation-type': { model: 'manufacturingWorkstationType', column: 'name' },
  'work-order': { model: 'manufacturingProductionOrder', column: 'orderNumber' },
  'job-card': { model: 'manufacturingWorkOrder', column: 'workOrderNumber' },
  operation: { model: 'manufacturingOperation', column: 'name' },
  'plant-floor': { model: 'manufacturingPlantFloor', column: 'name' },
  employee: {
    model: 'hrEmployee',
    column: 'employeeName',
    extraCols: ['employeeCode'],
    compose: (row) =>
      row.employeeCode ? `${row.employeeName} (${row.employeeCode})` : row.employeeName
  }
};

function linkTarget(resource) {
  if (LINK_TARGETS[resource]) return { ...LINK_TARGETS[resource], resource };
  if (registry[resource]?.model) {
    const def = registry[resource];
    let column = def.titleField;
    if (!column || !modelHasColumn(def.model, column)) {
      column = modelHasColumn(def.model, 'name') ? 'name' : 'id';
    }
    return { model: def.model, column, resource };
  }
  return null;
}

function selectFor(target) {
  const select = { id: true, [target.column]: true };
  for (const col of target.extraCols || []) select[col] = true;
  if (modelHasColumn(target.model, 'disabled')) select.disabled = true;
  return select;
}

function labelOf(target, row) {
  if (!row) return '';
  return target.compose ? target.compose(row) : String(row[target.column] ?? row.id);
}

function scopeFor(target, companyId) {
  return { companyId };
}

async function findLink(companyId, target, value, byColumn = false) {
  const client = prisma[target.model];
  if (!client) return null;
  const where = scopeFor(target, companyId);
  where[byColumn ? target.column : 'id'] = String(value);
  return client.findFirst({ where, select: selectFor(target) }).catch(() => null);
}

function descriptorOf(resource) {
  const def = registry[resource];
  if (!def || def.available === false) return null;
  return {
    resource,
    doctype: def.doctype,
    workspace: def.workspace || 'manufacturing',
    section: def.section || null,
    titleField: def.titleField || null,
    statuses: def.statuses || null,
    actions: def.actions || [],
    buttons: def.buttons || [],
    columns: def.columns || [],
    search: def.search || [],
    employeeScoped: false,
    readOnly: Boolean(def.singleton),
    kanban: false,
    filters: {
      dateField: def.fields?.find((f) => f.t === 'date' || f.t === 'datetime')?.n || null,
      status: Boolean(def.statuses?.length),
      department: false
    },
    fields: def.fields || [],
    singleton: Boolean(def.singleton)
  };
}

function descriptors(workspace) {
  return Object.keys(registry)
    .filter((key) => {
      const def = registry[key];
      if (def.available === false) return false;
      if (workspace && def.workspace && def.workspace !== workspace) return false;
      return Boolean(def.model);
    })
    .map((key) => descriptorOf(key));
}

function coerce(field, raw) {
  const t = field.t;
  const empty = raw === undefined || raw === null || raw === '';
  if (t === 'table') {
    if (empty) return [];
    const rows = Array.isArray(raw) ? raw : [];
    return rows.map((row) => {
      const out = {};
      for (const rf of field.rows || []) {
        const v = coerce(rf, row?.[rf.n]);
        if (v !== undefined) out[rf.n] = v;
      }
      return out;
    });
  }
  if (t === 'bool') {
    if (empty) return field.d === undefined ? false : Boolean(field.d);
    return raw === true || raw === 'true' || Number(raw) === 1;
  }
  if (t === 'int') {
    if (empty) return field.d === undefined ? undefined : Number(field.d);
    const n = parseInt(String(raw), 10);
    if (Number.isNaN(n)) throw new HttpError(400, `${field.l} must be a number`);
    return n;
  }
  if (t === 'float' || t === 'currency') {
    if (empty) return field.d === undefined ? undefined : Number(field.d);
    const n = Number(raw);
    if (!Number.isFinite(n)) throw new HttpError(400, `${field.l} must be a number`);
    return n;
  }
  if (t === 'date') {
    if (empty) {
      if (field.d === 'today') return toDate('today');
      return field.d ? toDate(field.d) : undefined;
    }
    const d = toDate(raw);
    if (!d) throw new HttpError(400, `${field.l} must be a valid date`);
    return d;
  }
  if (t === 'datetime') {
    if (empty) return undefined;
    const d = toDateTime(raw);
    if (!d) throw new HttpError(400, `${field.l} must be a valid date and time`);
    return d;
  }
  if (t === 'select') {
    if (empty) return field.d !== undefined ? String(field.d) : undefined;
    const value = String(raw);
    if ((field.o || []).length && !(field.o || []).includes(value)) {
      throw new HttpError(400, `${field.l} must be one of: ${(field.o || []).join(', ')}`);
    }
    return value;
  }
  if (empty) return field.d === undefined ? undefined : String(field.d);
  return String(typeof raw === 'object' ? JSON.stringify(raw) : raw).trim();
}

async function resolveProductName(companyId, productId) {
  if (!productId) return '';
  const product = await prisma.product.findFirst({
    where: { id: String(productId), companyId },
    select: { id: true, name: true }
  });
  if (!product) throw new HttpError(400, 'Item was not found in this company');
  return product.name;
}

async function validateAndBuild(def, body, companyId, currentId) {
  const data = {};
  const errors = [];
  const childPayload = {};

  for (const field of def.fields || []) {
    // Hidden system fields still receive defaults on create so Prisma required
    // columns (e.g. BOM effectiveFrom) are populated without appearing on the form.
    if (field.hidden) {
      if (!currentId && field.d !== undefined && !Object.prototype.hasOwnProperty.call(body || {}, field.n)) {
        const coerced = coerce(field, field.d);
        if (coerced !== undefined && modelHasColumn(def.model, field.n)) data[field.n] = coerced;
      }
      continue;
    }
    if (field.ro && field.t !== 'table' && field.n !== 'status') continue;
    if (field.n === 'status' && def.statuses && currentId) continue;

    const supplied = Object.prototype.hasOwnProperty.call(body || {}, field.n) ? body[field.n] : undefined;
    let value = supplied === undefined ? field.d : supplied;

    if (field.r && (value === undefined || value === null || value === '')) {
      errors.push({ field: field.n, message: `${field.l} is required` });
      continue;
    }

    const coerced = coerce(field, value);
    if (coerced === undefined) continue;

    if (field.t === 'table' && def.children?.[field.n]) {
      childPayload[field.n] = coerced;
      continue;
    }

    if (modelHasColumn(def.model, field.n) || def.settingsJson) {
      data[field.n] = coerced;
    }
  }

  if (errors.length) throw new HttpError(400, errors[0].message, { errors });

  // resolve product / item name when a product link is present
  if (data.productId && modelHasColumn(def.model, 'productName')) {
    data.productName = await resolveProductName(companyId, data.productId);
  }
  if (data.itemId && modelHasColumn(def.model, 'itemName')) {
    data.itemName = await resolveProductName(companyId, data.itemId);
  }

  // ERPNext BOM "Is Active" is independent of draft/submit. We only demote
  // Active → Draft when unchecked; Submit action still promotes Draft → Active.
  if (Object.prototype.hasOwnProperty.call(body || {}, 'isActive') && modelHasColumn(def.model, 'status')) {
    const active = body.isActive === true || body.isActive === 'true' || body.isActive === 1;
    if (!active && (data.status === 'Active' || data.status === undefined)) {
      data.status = 'Draft';
    }
  }
  delete data.isActive;

  // validate link fields
  for (const field of def.fields || []) {
    if (field.t !== 'link' || data[field.n] === undefined || data[field.n] === null || data[field.n] === '') continue;
    const target = linkTarget(field.o);
    if (!target) continue;
    const found = (await findLink(companyId, target, data[field.n])) || (await findLink(companyId, target, data[field.n], true));
    if (!found) throw new HttpError(400, `${field.l}: "${data[field.n]}" was not found in this company`);
    data[field.n] = found.id;
  }

  for (const [tableName, rows] of Object.entries(childPayload)) {
    const childDef = def.children[tableName];
    const mapped = [];
    for (const row of rows) {
      if (row.componentId && !row.componentName) {
        row.componentName = await resolveProductName(companyId, row.componentId);
      }
      for (const rf of (def.fields.find((f) => f.n === tableName)?.rows || [])) {
        if (rf.t !== 'link' || !row[rf.n]) continue;
        const target = linkTarget(rf.o);
        if (!target) continue;
        const found = (await findLink(companyId, target, row[rf.n])) || (await findLink(companyId, target, row[rf.n], true));
        if (!found) throw new HttpError(400, `${rf.l}: "${row[rf.n]}" was not found`);
        row[rf.n] = found.id;
      }
      mapped.push(childDef.mapRow(row));
    }
    childPayload[tableName] = mapped;
  }

  if (def.children?.components && childPayload.components) {
    const raw = childPayload.components.reduce((s, c) => s + Number(c.estimatedCost || 0), 0);
    data.rawMaterialCost = raw;
    data.totalEstimatedCost = raw + Number(data.operatingCost || 0);
  }
  if (def.children?.operations && childPayload.operations) {
    data.totalEstimatedTime = childPayload.operations.reduce(
      (s, o) => s + Number(o.setupTime || 0) + Number(o.runTime || 0),
      0
    );
    data.totalEstimatedCost = childPayload.operations.reduce((s, o) => s + Number(o.estimatedCost || 0), 0);
  }

  if (Array.isArray(data.operations) && modelHasColumn(def.model, 'operatingCost')) {
    const opCost = data.operations.reduce((s, o) => s + Number(o.operatingCost || 0), 0);
    data.operatingCost = opCost;
    if (data.rawMaterialCost !== undefined) {
      data.totalEstimatedCost = Number(data.rawMaterialCost || 0) + opCost;
    }
  }

  if (modelHasColumn(def.model, 'processLossQty') && data.processLossPercentage !== undefined && data.quantity !== undefined) {
    data.processLossQty = (Number(data.quantity) || 0) * ((Number(data.processLossPercentage) || 0) / 100);
  }

  if (Array.isArray(data.poItems) && modelHasColumn(def.model, 'totalPlannedQty')) {
    data.totalPlannedQty = data.poItems.reduce((s, row) => s + Number(row.plannedQty || 0), 0);
  }

  if (modelHasColumn(def.model, 'remainingQuantity') && data.plannedQuantity !== undefined && data.producedQuantity === undefined) {
    data.remainingQuantity = Number(data.plannedQuantity) || 0;
  }

  return { data, childPayload };
}

async function decorate(def, rows, companyId) {
  const out = rows.map((r) => ({ ...r }));
  const linkFields = (def.fields || []).filter((f) => f.t === 'link' && String(f.n).endsWith('Id'));
  for (const field of linkFields) {
    const target = linkTarget(field.o);
    if (!target) continue;
    const ids = [...new Set(out.map((r) => r[field.n]).filter(Boolean))];
    if (!ids.length) continue;
    const client = prisma[target.model];
    if (!client) continue;
    const found = await client.findMany({ where: { id: { in: ids } }, select: selectFor(target) });
    const map = new Map(found.map((f) => [f.id, labelOf(target, f)]));
    for (const row of out) row[`${field.n}Label`] = map.get(row[field.n]) || '';
  }
  if (def.model === 'manufacturingBOM') {
    // Match ERPNext: Is Active stays checked for Draft + Active; clear only when Obsolete.
    for (const row of out) row.isActive = String(row.status || '') !== 'Obsolete';
  }
  void companyId;
  return out;
}

async function options(target, req, query = {}) {
  const companyId = req.user.companyId;
  const link = linkTarget(target);
  if (!link) return [];
  const client = prisma[link.model];
  if (!client) return [];
  const where = { companyId };
  if (query.search) {
    where.OR = [
      { [link.column]: { contains: String(query.search), mode: 'insensitive' } },
      ...(link.extraCols || []).map((col) => ({ [col]: { contains: String(query.search), mode: 'insensitive' } }))
    ];
  }
  if (modelHasColumn(link.model, 'disabled') && query.includeDisabled !== 'true') {
    where.disabled = false;
  }
  if (modelHasColumn(link.model, 'status') && target === 'bom') {
    where.status = 'Active';
  }
  const rows = await client.findMany({
    where,
    select: selectFor(link),
    take: Math.min(Number(query.limit) || 100, 500),
    orderBy: { [link.column]: 'asc' }
  });
  return rows.map((row) => ({
    id: row.id,
    label: labelOf(link, row),
    disabled: Boolean(row.disabled)
  }));
}

async function list(resource, req, query = {}) {
  const def = definition(resource);
  if (def.singleton) {
    const row = await getSingleton(def, req);
    return { rows: row ? [row] : [], total: row ? 1 : 0, limit: 1, offset: 0, doctype: def.doctype };
  }
  const companyId = req.user.companyId;
  const client = modelClient(def);
  const where = { companyId };
  if (query.status) where.status = String(query.status);
  if (query.search && (def.search || []).length) {
    where.OR = def.search.map((field) => ({
      [field]: { contains: String(query.search), mode: 'insensitive' }
    }));
  }
  const limit = Math.min(Number(query.limit) || 25, 200);
  const offset = Number(query.offset) || 0;
  const [total, rows] = await Promise.all([
    client.count({ where }),
    client.findMany({
      where,
      include: def.include || undefined,
      orderBy: { createdAt: 'desc' },
      take: limit,
      skip: offset
    })
  ]);
  const decorated = await decorate(def, rows, companyId);
  return { rows: decorated, total, limit, offset, doctype: def.doctype };
}

async function getSingleton(def, req) {
  const companyId = req.user.companyId;
  const client = modelClient(def);
  let row = await client.findFirst({ where: { companyId } });
  if (!row) {
    row = await client.create({
      data: { companyId, settings: {} }
    });
  }
  const settings = row.settings && typeof row.settings === 'object' ? row.settings : {};
  const flat = { id: row.id, companyId, ...settings };
  for (const field of def.fields || []) {
    if (flat[field.n] === undefined && field.d !== undefined) flat[field.n] = field.d;
  }
  return flat;
}

async function get(resource, id, req) {
  const def = definition(resource);
  if (def.singleton) {
    const row = await getSingleton(def, req);
    return {
      row,
      meta: {
        doctype: def.doctype,
        statuses: def.statuses || null,
        fields: def.fields || [],
        actions: [],
        buttons: def.buttons || []
      }
    };
  }
  const companyId = req.user.companyId;
  const client = modelClient(def);
  const row = await client.findFirst({
    where: { id: String(id), companyId },
    include: def.include || undefined
  });
  if (!row) throw new HttpError(404, `${def.doctype} not found`);
  const [decorated] = await decorate(def, [row], companyId);
  const status = row.status || null;
  const actions = (def.actions || []).map((action) => ({
    ...action,
    available: !status || (action.from || []).includes(status),
    allowed: true
  }));
  return {
    row: decorated,
    meta: {
      doctype: def.doctype,
      statuses: def.statuses || null,
      fields: def.fields || [],
      actions,
      buttons: def.buttons || []
    }
  };
}

async function create(resource, req, body = {}) {
  const def = definition(resource);
  if (def.singleton) return updateSingleton(def, req, body);
  const companyId = req.user.companyId;
  const client = modelClient(def);
  const { data, childPayload } = await validateAndBuild(def, body, companyId, null);

  if (def.numberField && modelHasColumn(def.model, def.numberField) && !data[def.numberField]) {
    data[def.numberField] = await nextNumber(client, def.numberField, def.numberPrefix || 'DOC', companyId);
  }
  if (def.statuses && data.status === undefined) data.status = def.statuses[0];
  data.companyId = companyId;
  if (modelHasColumn(def.model, 'createdBy')) data.createdBy = userIdOf(req) || undefined;

  const createData = { ...data };
  for (const [tableName, rows] of Object.entries(childPayload)) {
    createData[tableName] = { create: rows };
  }

  let created;
  try {
    created = await client.create({ data: createData, include: def.include || undefined });
  } catch (error) {
    if (error?.code === 'P2002') throw new HttpError(400, 'A record with this name already exists');
    throw error;
  }
  const [row] = await decorate(def, [created], companyId);
  return row;
}

async function updateSingleton(def, req, body = {}) {
  const companyId = req.user.companyId;
  const client = modelClient(def);
  let row = await client.findFirst({ where: { companyId } });
  if (!row) row = await client.create({ data: { companyId, settings: {} } });
  const current = row.settings && typeof row.settings === 'object' ? { ...row.settings } : {};
  for (const field of def.fields || []) {
    if (!Object.prototype.hasOwnProperty.call(body || {}, field.n)) continue;
    current[field.n] = coerce(field, body[field.n]);
  }
  const updated = await client.update({ where: { id: row.id }, data: { settings: current } });
  return { id: updated.id, companyId, ...current };
}

async function update(resource, id, req, body = {}) {
  const def = definition(resource);
  if (def.singleton) return updateSingleton(def, req, body);
  const companyId = req.user.companyId;
  const client = modelClient(def);
  const existing = await client.findFirst({ where: { id: String(id), companyId } });
  if (!existing) throw new HttpError(404, `${def.doctype} not found`);

  const { data, childPayload } = await validateAndBuild(def, { ...existing, ...body }, companyId, id);
  if (modelHasColumn(def.model, 'updatedBy')) data.updatedBy = userIdOf(req) || undefined;
  delete data.companyId;
  delete data.createdBy;
  if (def.numberField) delete data[def.numberField];

  await prisma.$transaction(async (tx) => {
    const txClient = tx[def.model];
    await txClient.update({ where: { id: existing.id }, data });
    for (const [tableName, rows] of Object.entries(childPayload)) {
      const child = def.children[tableName];
      const childClient = tx[child.model];
      await childClient.deleteMany({ where: { [child.foreignKey]: existing.id } });
      if (rows.length) {
        await childClient.createMany({
          data: rows.map((row) => ({ ...row, id: randomUUID(), [child.foreignKey]: existing.id }))
        });
      }
    }
  });

  return get(resource, id, req).then((r) => r.row);
}

async function remove(resource, id, req) {
  const def = definition(resource);
  if (def.singleton) throw new HttpError(400, 'Settings cannot be deleted');
  const companyId = req.user.companyId;
  const client = modelClient(def);
  const existing = await client.findFirst({ where: { id: String(id), companyId } });
  if (!existing) throw new HttpError(404, `${def.doctype} not found`);
  await client.delete({ where: { id: existing.id } });
  return { id: existing.id };
}

async function runAction(resource, id, key, req) {
  const def = definition(resource);
  const companyId = req.user.companyId;
  const client = modelClient(def);
  const row = await client.findFirst({ where: { id: String(id), companyId } });
  if (!row) throw new HttpError(404, `${def.doctype} not found`);
  const action = (def.actions || []).find((a) => a.key === key);
  if (!action) throw new HttpError(400, `${def.doctype} has no "${key}" action`);
  if (!(action.from || []).includes(row.status)) {
    throw new HttpError(400, `"${key}" is not allowed while the document is ${row.status}`);
  }
  const patch = { status: action.to };
  if (modelHasColumn(def.model, 'updatedBy')) patch.updatedBy = userIdOf(req) || undefined;
  if (action.key === 'start' && modelHasColumn(def.model, 'actualStartDate') && !row.actualStartDate) {
    patch.actualStartDate = new Date();
  }
  if (action.key === 'start' && modelHasColumn(def.model, 'startTime') && !row.startTime) {
    patch.startTime = new Date();
  }
  if (action.key === 'complete' && modelHasColumn(def.model, 'actualEndDate')) {
    patch.actualEndDate = new Date();
  }
  if (action.key === 'complete' && modelHasColumn(def.model, 'endTime')) {
    patch.endTime = new Date();
  }
  const updated = await client.update({ where: { id: row.id }, data: patch, include: def.include || undefined });
  const [decorated] = await decorate(def, [updated], companyId);
  return decorated;
}

async function counts(resources, req) {
  const companyId = req.user.companyId;
  const out = {};
  await Promise.all(
    resources.map(async (resource) => {
      const def = registry[resource];
      if (!def?.model || def.available === false) {
        out[resource] = null;
        return;
      }
      try {
        if (def.singleton) {
          out[resource] = 1;
          return;
        }
        out[resource] = await prisma[def.model].count({ where: { companyId } });
      } catch {
        out[resource] = null;
      }
    })
  );
  return out;
}

module.exports = {
  HttpError,
  registry,
  definition,
  descriptorOf,
  descriptors,
  options,
  list,
  get,
  create,
  update,
  remove,
  runAction,
  counts
};
