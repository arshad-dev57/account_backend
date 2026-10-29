'use strict';

const prisma = require('../prisma/client');
const { registry, MANAGER_ONLY, LEGACY_STATUS_ALIASES } = require('./hrDocumentRegistry');
const conditions = require('./hrFieldConditions');
const fixtures = require('./hrMasterFixtures');
const { isHrAdminRole, canViewSalary } = require('../utils/hrAccess');
const { normalizeClock } = require('../utils/clock');
const { writeAudit } = require('../utils/hrAudit');

const PERMISSION_KEYS = {
  'salary-component': 'hr.salary_structures',
  'salary-structure': 'hr.salary_structures',
  'salary-structure-assignment': 'hr.salary',
  'additional-salary': 'hr.bonuses',
  'income-tax-slab': 'hr.salary',
  'exemption-category': 'hr.salary',
  'exemption-declaration': 'hr.salary',
  'exemption-proof-submission': 'hr.salary',
  'employee-benefit': 'hr.salary',
  'benefit-application': 'hr.salary',
  'benefit-claim': 'hr.salary',
  'leave-type': 'hr.leave_policies',
  'leave-period': 'hr.leave_policies',
  'leave-policy': 'hr.leave_policies',
  'leave-policy-assignment': 'hr.leave_policies',
  'leave-allocation': 'hr.leave_policies',
  'leave-block-list': 'hr.leave_policies',
  'leave-application': 'hr.leaves',
  'leave-encashment': 'hr.leaves',
  'holiday-list': 'hr.holidays',
  employee: 'hr.employees',
  department: 'hr.departments',
  designation: 'hr.departments',
  branch: 'hr.departments',
  gender: 'hr.departments',
  salutation: 'hr.departments',
  'shift-type': 'hr.shifts',
  'shift-location': 'hr.shifts',
  'shift-assignment': 'hr.roster',
  'shift-request': 'hr.attendance',
  'attendance-request': 'hr.attendance',
  'employee-checkin': 'hr.attendance',
  'overtime-type': 'hr.overtime',
  'overtime-slip': 'hr.overtime',
  'expense-claim-type': 'hr.expenses',
  'expense-claim': 'hr.expenses',
  'employee-advance': 'hr.loans',
  'employee-onboarding': 'hr.lifecycle',
  'employee-separation': 'hr.lifecycle',
  'grievance-type': 'hr.performance',
  'employee-grievance': 'hr.performance',
  'employee-transfer': 'hr.employees',
  'employee-promotion': 'hr.employees',
  'employee-skill-map': 'hr.employees',
  'training-program': 'hr.performance',
  'training-event': 'hr.performance',
  'job-opening': 'hr.recruitment',
  'job-applicant': 'hr.recruitment',
  'interview-type': 'hr.recruitment',
  'interview': 'hr.recruitment',
  'job-offer': 'hr.recruitment',
  'job-requisition': 'hr.recruitment',
  kra: 'hr.performance',
  'appraisal-template': 'hr.performance',
  'appraisal-cycle': 'hr.performance',
  appraisal: 'hr.performance',
  goal: 'hr.performance',
  'performance-feedback': 'hr.performance',
  'employee-grade': 'hr.departments',
  'employee-group': 'hr.departments',
  'employment-type': 'hr.departments',
  'holiday-list-assignment': 'hr.holidays',
  skill: 'hr.recruitment',
  'offer-term': 'hr.recruitment',
  'job-opening-template': 'hr.recruitment',
  'job-offer-term-template': 'hr.recruitment',
  'appointment-letter-template': 'hr.recruitment',
  'appointment-letter': 'hr.recruitment',
  'staffing-plan': 'hr.recruitment',
  'employee-referral': 'hr.recruitment',
  'employee-onboarding-template': 'hr.lifecycle',
  'employee-separation-template': 'hr.lifecycle',
  'training-feedback': 'hr.performance',
  'training-result': 'hr.performance',
  'employee-feedback-criteria': 'hr.performance',
  attendance: 'hr.attendance',
  'shift-schedule': 'hr.shifts',
  'shift-schedule-assignment': 'hr.roster',
  'purpose-of-travel': 'hr.expenses',
  'travel-request': 'hr.expenses',
  vehicle: 'hr.expenses',
  driver: 'hr.expenses',
  'vehicle-log': 'hr.expenses',
  'salary-withholding': 'hr.salary',
  'employee-benefit-ledger': 'hr.salary',
  'gratuity-rule': 'hr.salary',
  gratuity: 'hr.salary',
  'exit-interview': 'hr.lifecycle',
  'full-and-final-statement': 'hr.lifecycle',
  'compensatory-leave-request': 'hr.leaves',
  'leave-adjustment': 'hr.leaves',
  'daily-work-summary-group': 'hr.employees',
  'daily-work-summary': 'hr.employees',
  'hr-settings': 'hr.settings',
  'payroll-settings': 'hr.settings',
  'activity-type': 'hr.attendance',
  timesheet: 'hr.attendance',
  'payroll-entry': 'hr.payroll',
  'salary-slip': 'hr.payroll'
};

const COLUMN_INDEX = (() => {
  const fs = require('fs');
  const path = require('path');
  const index = {};
  try {
    const src = fs.readFileSync(path.join(__dirname, '..', 'prisma', 'schema.prisma'), 'utf8');
    for (const match of src.matchAll(/^model (Hr[A-Za-z]+) \{([\s\S]*?)^\}/gm)) {
      const [, model, body] = match;
      const columns = new Set();
      const scalars = new Set(['String', 'Int', 'Float', 'Boolean', 'DateTime', 'Json', 'Decimal', 'BigInt']);
      let table = null;
      for (const line of body.split('\n')) {
        const tableMatch = line.match(/^\s*@@map\("([^"]+)"\)/);
        if (tableMatch) table = tableMatch[1];
        const parts = line.trim().split(/\s+/);
        if (parts.length < 2) continue;
        if (parts[0].startsWith('@') || parts[0].startsWith('//')) continue;
        const type = String(parts[1]).replace(/[?[\]]/g, '');
        if (scalars.has(type)) columns.add(parts[0]);
      }
      index[model] = { table: table || model.toLowerCase(), columns };
    }
  } catch (error) {
    console.error('[hr-docs] schema index unavailable', error.message);
  }
  return index;
})();

function modelHasColumn(model, name) {
  const pascal = model[0].toUpperCase() + model.slice(1);
  return Boolean(COLUMN_INDEX[pascal]?.columns.has(name));
}

function hasColumn(def, name) {
  return modelHasColumn(def.model, name);
}

const WORKFLOW_HOOKS = require('./hrDocumentWorkflow');

class HttpError extends Error {
  constructor(status, message, extra) {
    super(message);
    this.status = status;
    this.extra = extra || {};
  }
}

function definition(resource) {
  const def = registry[resource];
  if (!def) throw new HttpError(404, `Unknown HR document: ${resource}`);
  return def;
}

function modelClient(def) {
  const client = prisma[def.model];
  if (!client) throw new HttpError(500, `HR model not wired: ${def.model}`);
  return client;
}

function fieldsOf(def) {
  return def.fields.filter((f) => !String(f.t).startsWith('computed'));
}

function fieldMap(def) {
  const map = {};
  for (const f of def.fields) map[f.n] = f;
  return map;
}

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

function ymd(value) {
  if (!value) return '';
  if (typeof value === 'string' && DATE_ONLY.test(value)) return value.slice(0, 10);
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? '' : d.toISOString().slice(0, 10);
}

function toDate(value) {
  const key = ymd(value);
  return key ? new Date(`${key}T00:00:00.000Z`) : null;
}

function toDateTime(value) {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

const EXTRA_LINKS = {
  department: { model: 'hrDepartment', column: 'name' },
  designation: { model: 'hrDesignation', column: 'name' },
  office: { model: 'hrOffice', column: 'name' },
  holiday: { model: 'hrHoliday', column: 'name' },
  employee: {
    model: 'hrEmployee',
    column: 'employeeCode',
    extraCols: ['profile', 'employeeName', 'employeeCode'],
    relationSelect: { user: { select: { firstName: true, lastName: true } } },
    compose: (row) => {
      const profile = row.profile || {};
      const name =
        String(row.employeeName || '') ||
        [row.user?.firstName, row.user?.lastName].filter(Boolean).join(' ').trim() ||
        [profile.firstName, profile.lastName].filter(Boolean).join(' ').trim() ||
        String(profile.name || '');
      return name ? `${name} (${row.employeeCode})` : String(row.employeeCode || row.id);
    }
  },
  user: {
    model: 'user',
    column: 'email',
    extraCols: ['firstName', 'lastName'],
    compose: (row) => [row.firstName, row.lastName].filter(Boolean).join(' ') || row.email
  },
  costCenter: { model: 'costCenter', column: 'name', extraCols: ['code'] },
  company: { model: 'company', column: 'name' },
  account: { model: 'chartOfAccount', column: 'name', extraCols: ['code'] },
  currency: { model: 'currency', column: 'code', extraCols: ['name'] }
};

function linkTarget(resource) {
  if (registry[resource]) {
    const def = registry[resource];
    // ERPNext documents are named by their title field; HRMS docs without one
    // fall back to the record id so link pickers never query a missing column.
    let column = def.titleField;
    if (!column || !modelHasColumn(def.model, column)) {
      column = modelHasColumn(def.model, 'name') ? 'name' : 'id';
    }
    return { ...EXTRA_LINKS[resource], model: def.model, column, resource };
  }
  const extra = EXTRA_LINKS[resource];
  if (extra) return { ...extra, resource };
  return null;
}
 

function selectFor(target) {
  const select = { id: true, [target.column]: true };
  for (const col of target.extraCols || []) select[col] = true;
  for (const [rel, cfg] of Object.entries(target.relationSelect || {})) select[rel] = cfg;
  if (modelHasColumn(target.model, 'disabled')) select.disabled = true;
  return select;
}

function labelOf(target, row) {
  if (!row) return '';
  return target.compose ? target.compose(row) : String(row[target.column] ?? row.id);
}

function scopeFor(target, companyId) {
  if (target.resource === 'company' || target.resource === 'currency') return {};
  return { companyId };
}

async function findLink(companyId, target, value, byColumn = false) {
  const client = prisma[target.model];
  if (!client) throw new HttpError(500, `Link model ${target.model} is not available`);
  const where = scopeFor(target, companyId);
  where[byColumn ? target.column : 'id'] = String(value);
  const row = await client.findFirst({ where, select: selectFor(target) }).catch(() => null);
  return row;
}

async function resolveEmployee(userId, companyId) {
  return prisma.hrEmployee.findFirst({
    where: { userId: String(userId || ''), companyId },
    select: { id: true, department: true, designation: true, joiningDate: true, officeId: true }
  });
}

function accessOf(req, employee, resource) {
  const perms = req.hrPermissions instanceof Set ? req.hrPermissions : new Set(req.hrPermissions || []);
  const key = PERMISSION_KEYS[resource];
  const grant = (action) => (key ? perms.has(`${key}.${action}`) : false);
  // an explicit catalog grant opens the document for writing; the role list is
  // checked as a whole rather than through canManageHr, which lets unknown
  // roles through
  const writes = grant('create') || grant('edit') || grant('delete') || grant('approve');
  const isHr = isHrAdminRole(req.user?.role) || writes;
  return {
    isHr,
    isPayroll: canViewSalary(req.user) || grant('pay') || grant('post'),
    employeeId: employee?.id || null,
    canSeeAll: isHr || grant('view'),
    canApprove: isHr || grant('approve'),
    // ERPNext "Create User Permission" on the employee's own record restricts
    // that login to its own documents; without it HR records stay readable
    restrictedByUserPermission: Boolean(employee?.createUserPermission),
    name: employee
      ? [employee.user?.firstName, employee.user?.lastName].filter(Boolean).join(' ')
      : ''
  };
}

async function loadEmployeeContext(req, companyId) {
  const emp = await prisma.hrEmployee.findFirst({
    where: { userId: String(req.user.id || req.user._id || ''), companyId },
    include: {
      user: { select: { firstName: true, lastName: true, email: true } },
      office: { select: { id: true, name: true } },
      departmentRef: { select: { id: true, name: true } },
      designationRef: { select: { id: true, name: true } },
      gradeRef: { select: { id: true, name: true } },
      defaultShift: { select: { id: true, name: true } }
    }
  });
  return emp;
}

function coerce(def, field, raw, ctx) {
  const t = field.t;
  const empty = raw === undefined || raw === null || raw === '';
  if (t === 'table') {
    if (empty) return [];
    const rows = Array.isArray(raw) ? raw : [];
    return rows.map((row) => {
      const out = {};
      for (const rf of field.rows || []) {
        if (String(rf.t).startsWith('computed')) continue;
        const v = coerce(def, rf, row?.[rf.n], ctx);
        if (v !== undefined) out[rf.n] = v;
      }
      return out;
    });
  }
  if (t === 'keyValue') {
    if (empty) return {};
    const src = typeof raw === 'string' ? safeParse(raw) : raw;
    const out = {};
    for (const [k, v] of Object.entries(src || {})) {
      const num = Number(v);
      out[String(k)] = Number.isFinite(num) && String(v).trim() !== '' ? num : String(v ?? '');
    }
    return out;
  }
  if (t === 'multiSelect' || t === 'multiEmployee') {
    if (empty) return [];
    const list = Array.isArray(raw) ? raw : String(raw).split(',');
    return list.map((x) => String(x).trim()).filter(Boolean);
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
    if (field.min !== undefined && n < field.min) {
      throw new HttpError(400, `${field.l} cannot be lower than ${field.min}`);
    }
    return n;
  }
  if (t === 'time') {
    if (empty) return undefined;
    const clock = normalizeClock(raw);
    if (!clock) throw new HttpError(400, `${field.l} must be a time such as 09:30 or 09:30 PM`);
    return clock;
  }
  if (t === 'date') {
    if (empty) return field.d && field.d !== 'today' ? toDate(field.d) : undefined;
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
    if (empty) return field.d ? String(field.d) : undefined;
    const value = String(raw);
    if (!(field.o || []).includes(value)) {
      throw new HttpError(400, `${field.l} must be one of: ${(field.o || []).join(', ')}`);
    }
    return value;
  }
  if (empty) return field.d === undefined ? undefined : String(field.d);
  return String(typeof raw === 'object' ? JSON.stringify(raw) : raw).trim();
}

function toArray(value) {
  return Array.isArray(value) ? value : [];
}

async function prefillFetchFrom(def, body, companyId) {
  if (!body || typeof body !== 'object') return;
  for (const field of def.fields) {
    if (!field.fetchFrom) continue;
    const current = body[field.n];
    if (current !== undefined && current !== null && current !== '') continue;
    const [linkName, column] = String(field.fetchFrom).split('.');
    const linkField = def.fields.find((candidate) => candidate.n === linkName);
    const source = body[linkName];
    if (!linkField || !column || source === undefined || source === null || source === '') continue;
    const target = linkField.t === 'employee' ? linkTarget('employee') : targetForField(linkField);
    const client = target ? prisma[target.model] : null;
    if (!client) continue;
    const where = { id: String(source) };
    if (target.resource !== 'company' && target.resource !== 'currency') where.companyId = companyId;
    const found = await client.findFirst({ where, select: { [column]: true } }).catch(() => null);
    if (found && found[column] !== undefined && found[column] !== null) {
      body[field.n] = found[column];
    }
  }
}

function safeParse(value) {
  try {
    return JSON.parse(value);
  } catch {
    return {};
  }
}

async function validateAndBuild(def, resource, body, ctx, companyId, currentId, req) {
  const data = {};
  const errors = [];
  const links = [];

  // ERPNext populates fetch_from fields as soon as the link is chosen, before
  // mandatory checks run; the API repeats that lookup so a required fetched
  // field is never reported missing when its source record exists.
  await prefillFetchFrom(def, body, companyId);

  const writable = def.fields.filter((field) => {
    const type = String(field.t);
    if (type.startsWith('computed')) return false;
    if (field.ro && type !== 'table' && type !== 'keyValue') return false;
    // the document lifecycle owns the status column for submitted documents
    if (field.n === 'status' && def.statuses) return false;
    return true;
  });

  // Conditions are evaluated against what the user actually sent (defaults
  // filled in), before coercion, so a hidden field is never demanded by the API
  // and a conditionally-required one is.
  const view = {};
  for (const field of writable) {
    const supplied = Object.prototype.hasOwnProperty.call(body || {}, field.n) ? body[field.n] : undefined;
    let raw = supplied === undefined ? field.d : supplied;
    // ERPNext Company Link on Department defaults to the active company.
    if (field.t === 'company' && (raw === undefined || raw === null || raw === '')) raw = companyId;
    view[field.n] = field.n === 'status' && typeof raw === 'string' && aliasesFor(resource)[raw]
      ? aliasesFor(resource)[raw]
      : raw;
  }
  // ERPNext conditions can test doc.__islocal (the record has not been saved yet)
  view.__islocal = !currentId;

  for (const field of writable) {
    if (!conditions.isVisible(field, view)) continue;
    const supplied = Object.prototype.hasOwnProperty.call(body || {}, field.n) ? body[field.n] : undefined;
    let value = supplied === undefined ? (field.d === undefined ? undefined : field.d) : supplied;
    if (field.t === 'company' && (value === undefined || value === null || value === '')) value = companyId;
    // a status a pre-ERPNext endpoint stored is accepted as the ERPNext word the
    // form offers; the write hook maps it back to the stored key
    if (field.n === 'status' && typeof value === 'string' && aliasesFor(resource)[value]) {
      value = aliasesFor(resource)[value];
    }

    if (conditions.isRequired(field, view) && (value === undefined || value === null || value === '')) {
      errors.push({ field: field.n, message: `${field.l} is required` });
      continue;
    }

    const coerced = coerce(def, field, value, ctx);
    if (coerced === undefined) continue;
    data[field.n] = coerced;

    const type = String(field.t);
    if (type === 'multiEmployee') {
      links.push({ field: field.n, target: linkTarget('employee'), multiple: true });
    } else if (targetForField(field)) {
      links.push({ field: field.n, target: targetForField(field), multiple: false });
    }
  }

  if (errors.length) {
    throw new HttpError(400, errors[0].message, { errors });
  }

  for (const link of links) {
    await assertLink(companyId, link, def, data);
  }

  // child-table links are validated too: an id from another company must not be
  // storable inside a Json row
  for (const field of def.fields) {
    if (field.t !== 'table') continue;
    for (const row of toArray(data[field.n])) {
      for (const rf of field.rows || []) {
        const target = targetForField(rf);
        if (!target) continue;
        const value = row[rf.n];
        if (value === undefined || value === null || value === '') continue;
        const found = (await findLink(companyId, target, value)) || (await findLink(companyId, target, value, true));
        if (!found) {
          throw new HttpError(400, `${field.l} → ${rf.l}: "${value}" was not found in this company`);
        }
        row[rf.n] = isNameStyleColumn(rf.n, target) ? labelOf(target, found) : found.id;
      }
    }
  }

  if (def.unique) {
    for (const key of def.unique) {
      if (data[key] === undefined) continue;
      const where = { companyId };
      where[key] = data[key];
      const clash = await modelClient(def).findFirst({ where, select: { id: true } });
      if (clash && clash.id !== currentId) {
        throw new HttpError(400, `${fieldMap(def)[key]?.l || key} "${data[key]}" already exists`);
      }
    }
  }

  if (def.preventDuplicate) {
    const where = { companyId };
    let complete = true;
    for (const key of def.preventDuplicate.fields) {
      if (data[key] === undefined) {
        complete = false;
        break;
      }
      where[key] = data[key];
    }
    if (complete) {
      const clash = await modelClient(def).findFirst({ where, select: { id: true } });
      if (clash && clash.id !== currentId) {
        throw new HttpError(400, def.preventDuplicate.message);
      }
    }
  }

  // field-level defaults (year, totals, balance checks) live in the workflow module
  if (def.beforeWrite) {
    await runHook(def.beforeWrite, { def, resource, data, companyId, ctx, req, currentId, action: currentId ? 'update' : 'create' });
  }
  if (def.validate) {
    await runHook(def.validate, { def, resource, data, companyId, ctx, req, currentId, action: currentId ? 'update' : 'create' });
  }
  return data;
}

function translatePrismaError(error, def) {
  if (error && error.code === 'P2002') {
    return new HttpError(400, `${(error.meta?.target || []).join(', ') || 'value'} already exists for this company`);
  }
  if (error && error.code === 'P2011') {
    return new HttpError(400, `${error.meta?.column || 'field'} is required`);
  }
  if (error && error.code === 'P2003') {
    return new HttpError(400, 'A linked record no longer exists');
  }
  if (error && error.code === 'P2025') {
    return new HttpError(404, 'Record not found');
  }
  void def;
  return error;
}

// Columns declared as String masters rather than FKs keep the readable value so
// existing screens and the payroll engine can still match them by name.
const NAME_STYLE_COLUMNS = new Set([
  'department',
  'designation',
  'office',
  'costCenter',
  'holidayList',
  'company',
  'currency',
  'salaryCurrency'
]);

function isNameStyleColumn(field, target) {
  if (NAME_STYLE_COLUMNS.has(field) || /Account$/.test(String(field))) return true;
  if (target.model === 'hrEmployee') return !String(field).endsWith('Id');
  return false;
}

async function assertLink(companyId, link, def, data) {
  const { target, field } = link;
  const value = data[field];
  if (!target) return;
  const label = fieldMap(def)[field]?.l || field;

  const list = link.multiple ? value : [value];
  for (const item of list) {
    if (item === undefined || item === null || item === '') continue;
    if (target.resource === 'company') {
      if (String(item) !== companyId) throw new HttpError(400, `${label}: records can only belong to your own company`);
      data[field] = companyId;
      continue;
    }
    let found = await findLink(companyId, target, item);
    if (!found) found = await findLink(companyId, target, item, true);
    if (!found) throw new HttpError(400, `${label}: "${item}" was not found in this company`);
    data[field] = isNameStyleColumn(field, target) ? labelOf(target, found) : found.id;
  }
}

function targetForField(field) {
  if (field.t === 'link') return linkTarget(field.o);
  if (field.t === 'employee') return linkTarget('employee');
  if (field.t === 'userLink') return linkTarget('user');
  if (field.t === 'account') return linkTarget('account');
  if (field.t === 'currencyCode') return linkTarget('currency');
  if (['costCenter', 'department', 'designation', 'office', 'holiday', 'company'].includes(field.t)) {
    return linkTarget(field.t);
  }
  return null;
}

function aliasesFor(resource) {
  return LEGACY_STATUS_ALIASES[resource] || {};
}

function statusFor(def, resource, requested, fallbackIndex = 0) {
  const first = (def.statuses || [])[fallbackIndex];
  if (!def.statuses) return undefined;
  const value = requested ? String(requested) : first;
  if (def.statuses.includes(value)) return value;
  const aliases = aliasesFor(resource);
  if (aliases[value]) return aliases[value];
  throw new HttpError(400, `Status must be one of: ${def.statuses.join(', ')}`);
}

function rowStatus(def, resource, row) {
  const aliases = aliasesFor(resource);
  return aliases[row.status] || row.status;
}

function docStatusFor(status) {
  if (!status) return 0;
  if (['Cancelled', 'Rejected'].includes(status)) return 2;
  if (['Draft', 'Open', 'Pending', 'Not Started'].includes(status)) return 0;
  return 1;
}

function editableStatus(def, status) {
  if (!def.statuses) return true;
  return ['Draft', 'Open', 'Pending', 'Not Started'].includes(status);
}

function serializeRow(def, resource, row) {
  const out = { ...row };
  for (const field of def.fields) {
    if (field.t === 'date' && out[field.n]) out[field.n] = ymd(out[field.n]);
    if (field.t === 'datetime' && out[field.n] instanceof Date) out[field.n] = out[field.n].toISOString();
  }
  // legacy rows keep the status words the pre-ERPNext endpoints wrote; both the
  // lifecycle states and plain status fields are shown in ERPNext vocabulary
  if (def.statuses || Object.keys(aliasesFor(resource)).length) {
    out.status = rowStatus(def, resource, row);
  }
  return out;
}

// The list screens offer a date range; this is the column that range filters on.
const DATE_FILTER_NAMES = ['fromDate', 'claimDate', 'workDate', 'date', 'appliedOn', 'startDate', 'effectiveDate', 'separationDate', 'scheduledDate', 'postingDate', 'salarySlipDate'];

function dateFilterField(def) {
  return def.fields.find((f) => DATE_FILTER_NAMES.includes(f.n) && (f.t === 'date' || f.t === 'datetime')) || null;
}

function scopeWhere(def, ctx, query, companyId) {
  const where = { companyId };
  if (def.employeeScoped && !ctx.canSeeAll) {
    if (!ctx.employeeId) throw new HttpError(404, 'Employee profile not found');
    where.employeeId = ctx.employeeId;
  }
  // ERPNext restricts a login that has "Create User Permission" to its own
  // Employee record; the document itself is the record, so the filter is on id
  if (def.selfScoped && !ctx.isHr && ctx.restrictedByUserPermission) {
    where.id = ctx.employeeId || '';
  }
  if (query.employeeId && ctx.canSeeAll) where.employeeId = String(query.employeeId);
  if (query.status) where.status = String(query.status);
  if (query.department && ctx.canSeeAll) where.department = String(query.department);

  const dateField = dateFilterField(def);
  if (dateField) {
    const range = {};
    if (query.from) range.gte = dateField.t === 'datetime' ? new Date(`${ymd(query.from)}T00:00:00.000Z`) : toDate(query.from);
    if (query.to) {
      const end = toDate(query.to);
      range.lt = dateField.t === 'datetime' ? new Date(end.getTime() + 86400000) : new Date(end.getTime() + 86400000);
    }
    if (Object.keys(range).length) where[dateField.n] = range;
  }
  const search = String(query.search || query.q || '').trim();
  if (search && (def.search || []).length) {
    where.OR = def.search
      .filter((key) => fieldsOf(def).some((f) => f.n === key))
      .map((key) => ({ [key]: { contains: search, mode: 'insensitive' } }));
    if (!where.OR.length) delete where.OR;
  }
  return where;
}

function assertCanRead(def, resource, ctx) {
  if (MANAGER_ONLY.has(resource) && !ctx.isHr) {
    throw new HttpError(403, `${def.doctype} is restricted to HR`);
  }
  if (def.model === 'hrPayrollItem' && !ctx.isPayroll && !ctx.isHr) {
    throw new HttpError(403, 'Salary data is restricted');
  }
}

function assertCanWrite(def, resource, ctx, body, companyId) {
  if (MANAGER_ONLY.has(resource) && !ctx.isHr) {
    throw new HttpError(403, `${def.doctype} can only be managed by HR`);
  }
  if (def.hrWriteOnly && !ctx.isHr) {
    throw new HttpError(403, `${def.doctype} can only be managed by HR`);
  }
  if (def.employeeScoped && !ctx.canSeeAll) {
    if (!ctx.employeeId) throw new HttpError(403, 'Employee profile not found');
    const target = String(body?.employeeId || ctx.employeeId);
    if (target !== ctx.employeeId) throw new HttpError(403, 'You can only create records for yourself');
  }
  if (def.workspace === 'payroll' && !ctx.isHr && !ctx.isPayroll && MANAGER_ONLY.has(resource)) {
    throw new HttpError(403, 'Payroll setup is restricted');
  }
}

async function loadRow(model, id, companyId) {
  const row = await model.findFirst({ where: { id, companyId } });
  if (!row) throw new HttpError(404, 'Record not found');
  return row;
}

async function assertReadable(def, row, ctx) {
  if (def.employeeScoped && !ctx.canSeeAll && row.employeeId !== ctx.employeeId) {
    throw new HttpError(403, 'You can only view your own records');
  }
  if (def.selfScoped && !ctx.isHr && ctx.restrictedByUserPermission && row.id !== ctx.employeeId) {
    throw new HttpError(403, 'This login is restricted to its own employee record');
  }
  if (def.workspace === 'payroll' && !ctx.isHr && !ctx.isPayroll && def.model === 'hrPayrollItem') {
    throw new HttpError(403, 'Salary data is restricted');
  }
}


async function list(resource, req, params = {}) {
  const def = definition(resource);
  const companyId = req.user.companyId;
  const employee = await loadEmployeeContext(req, companyId);
  const ctx = accessOf(req, employee, resource);
  assertCanRead(def, resource, ctx);

  // ERPNext auto-creates Department / Designation (and related) masters on
  // company setup; for existing tenants we backfill the first time the list opens.
  if (fixtures.resourceNeedsFixtures(resource)) {
    try {
      await fixtures.ensureHrMasterFixtures(companyId);
    } catch (error) {
      console.error('[hr-docs] master fixtures', resource, error.message);
    }
  }

  const where = scopeWhere(def, ctx, params, companyId);
  const client = modelClient(def);
  const limit = Math.min(500, Math.max(1, Number(params.limit || 200)));
  const offset = Math.max(0, Number(params.offset || 0));

  const sortField = String(params.sort || 'createdAt');
  const known = fieldsOf(def).some((f) => f.n === sortField) ||
    ['createdAt', 'updatedAt', 'status', 'id'].includes(sortField);
  const orderBy = known ? { [sortField]: params.dir === 'asc' ? 'asc' : 'desc' } : { createdAt: 'desc' };

  const [rows, total] = await Promise.all([
    client.findMany({ where, orderBy, take: limit, skip: offset }),
    client.count({ where })
  ]);

  const decorated = await decorate(def, resource, rows, companyId);
  return { rows: decorated, total, limit, offset, doctype: def.doctype };
}

async function get(resource, id, req) {
  const def = definition(resource);
  const companyId = req.user.companyId;
  const employee = await loadEmployeeContext(req, companyId);
  const ctx = accessOf(req, employee, resource);
  assertCanRead(def, resource, ctx);
  const row = await loadRow(modelClient(def), id, companyId);
  await assertReadable(def, row, ctx);
  const [one] = await decorate(def, resource, [row], companyId);
  const meta = {
    doctype: def.doctype,
    statuses: def.statuses || null,
    fields: descriptorFields(def),
    buttons: (def.buttons || []).map((b) => ({ key: b.key, label: b.label })),
    actions: (def.actions || []).map((a) => ({
      ...a,
      available: (a.from || []).includes(one.status) && canRunAction(def, a, ctx, one),
      allowed: canRunAction(def, a, ctx, one)
    }))
  };
  return { row: one, meta };
}

// ERPNext form sidebar: Comments + Activity (create/edit/comment audit trail).
async function timeline(resource, id, req) {
  const { row } = await get(resource, id, req);
  const companyId = req.user.companyId;
  const logs = await prisma.hrAuditLog.findMany({
    where: { companyId, entity: resource, entityId: String(id) },
    orderBy: { createdAt: 'desc' },
    take: 100
  });
  const actorIds = [...new Set(logs.map((l) => l.actorId).filter(Boolean))];
  const users = actorIds.length
    ? await prisma.user.findMany({
        where: { id: { in: actorIds } },
        select: { id: true, firstName: true, lastName: true, email: true }
      })
    : [];
  const names = new Map(
    users.map((u) => [u.id, `${u.firstName || ''} ${u.lastName || ''}`.trim() || u.email || 'User'])
  );
  const items = logs.map((log) => ({
    id: log.id,
    action: log.action,
    detail: log.detail,
    actorId: log.actorId,
    actorName: names.get(log.actorId) || 'User',
    createdAt: log.createdAt
  }));
  // Seed create/edit lines when older rows have no audit yet.
  if (!items.some((i) => i.action === 'create') && row.createdAt) {
    items.push({
      id: `created-${row.id}`,
      action: 'create',
      detail: '',
      actorId: '',
      actorName: 'System',
      createdAt: row.createdAt
    });
  }
  items.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  return {
    comments: items.filter((i) => i.action === 'comment'),
    activity: items,
    createdAt: row.createdAt || null,
    updatedAt: row.updatedAt || null
  };
}

async function addComment(resource, id, req, body = {}) {
  await get(resource, id, req);
  const text = String(body.comment || body.content || body.text || '').trim();
  if (!text) throw new HttpError(400, 'Comment is required');
  await writeAudit(req.user.companyId, req.user.id, 'comment', resource, id, text);
  return timeline(resource, id, req);
}

function canRunAction(def, action, ctx, row) {
  if (action.action === 'approve' && !ctx.canApprove) return false;
  if (action.action === 'pay' && !ctx.isPayroll && !ctx.canApprove) return false;
  if (String(action.action) === 'edit' && !ctx.canSeeAll && row.employeeId !== ctx.employeeId) return false;
  return true;
}

async function decorate(def, resource, rows, companyId) {
  if (!rows.length) return [];
  const out = rows.map((r) => serializeRow(def, resource, r));

  const employeeIds = [...new Set(out.map((r) => r.employeeId).filter(Boolean))];
  const employees = employeeIds.length
    ? await prisma.hrEmployee.findMany({
        where: { id: { in: employeeIds }, companyId },
        select: {
          id: true,
          employeeCode: true,
          department: true,
          designation: true,
          profile: true,
          user: { select: { firstName: true, lastName: true } },
          departmentRef: { select: { name: true } },
          designationRef: { select: { name: true } },
          gradeRef: { select: { name: true } },
          office: { select: { name: true } },
          defaultShift: { select: { name: true } }
        }
      })
    : [];
  const empById = new Map(employees.map((e) => [e.id, e]));
  const empName = (e) =>
    [e?.user?.firstName, e?.user?.lastName].filter(Boolean).join(' ').trim() ||
    [e?.profile?.firstName, e?.profile?.lastName].filter(Boolean).join(' ').trim() ||
    String(e?.profile?.name || '');

  for (const row of out) {
    const emp = empById.get(row.employeeId);
    if (emp) {
      row.employeeName = empName(emp) || row.employeeName || '';
      row.employeeCode = emp.employeeCode || emp.employeeId || '';
      row.department = row.department || emp.departmentRef?.name || emp.department || '';
      row.designation = row.designation || emp.designationRef?.name || emp.designation || '';
      row.grade = row.grade || emp.gradeRef?.name || '';
      row.office = row.office || emp.office?.name || '';
      row.defaultShift = emp.defaultShift?.name || '';
    }
  }

  // label every id-style link column so list views stay readable
  const linkFields = def.fields.filter(
    (f) => (f.t === 'link' || f.t === 'userLink') && String(f.n).endsWith('Id')
  );
  for (const field of linkFields) {
    const target = linkTarget(field.t === 'userLink' ? 'user' : field.o);
    if (!target) continue;
    const ids = [...new Set(out.map((r) => r[field.n]).filter(Boolean))];
    if (!ids.length) continue;
    const client = prisma[target.model];
    if (!client) continue;
    const found = await client.findMany({ where: { id: { in: ids } }, select: selectFor(target) });
    const map = new Map(found.map((f) => [f.id, labelOf(target, f)]));
    for (const row of out) row[`${field.n}Label`] = map.get(row[field.n]) || '';
  }

  if (def.model === 'hrShift') {
    // ERPNext shows how many employees a shift covers; here that is the default
    // shift link plus the legacy free-text shift label on the employee.
    const [byId, byLabel] = await Promise.all([
      prisma.hrEmployee.groupBy({
        by: ['defaultShiftId'],
        where: { companyId, defaultShiftId: { in: out.map((r) => r.id) } },
        _count: { _all: true }
      }),
      prisma.hrEmployee.groupBy({
        by: ['shiftLabel'],
        where: { companyId, shiftLabel: { in: out.map((r) => r.name) } },
        _count: { _all: true }
      })
    ]);
    const counts = new Map(byId.map((g) => [g.defaultShiftId, g._count._all]));
    const labels = new Map(byLabel.map((g) => [g.shiftLabel, g._count._all]));
    for (const row of out) {
      const linked = counts.get(row.id) || 0;
      const labelled = linked ? 0 : labels.get(row.name) || 0;
      row.employeeCount = linked + labelled;
    }
  }

  if (def.model === 'hrLeave') {
    const typeIds = [...new Set(out.map((r) => r.leaveTypeId).filter(Boolean))];
    if (typeIds.length) {
      const types = await prisma.hrLeaveType.findMany({ where: { id: { in: typeIds } }, select: { id: true, name: true } });
      const map = new Map(types.map((t) => [t.id, t.name]));
      for (const row of out) row.leaveTypeIdLabel = map.get(row.leaveTypeId) || row.type || '';
    }
  }

  return out;
}

async function create(resource, req, body = {}) {
  const def = definition(resource);
  const companyId = req.user.companyId;
  const employee = await loadEmployeeContext(req, companyId);
  const ctx = accessOf(req, employee, resource);
  assertCanWrite(def, resource, ctx, body, companyId);

  const payload = { ...body };
  if (def.employeeScoped && !payload.employeeId) payload.employeeId = ctx.employeeId;
  if (!payload.employeeId && def.fields.some((f) => f.n === 'employeeId' && f.r)) {
    throw new HttpError(400, 'Employee is required');
  }

  const data = await validateAndBuild(def, resource, payload, ctx, companyId, null, req);
  if (def.statuses && data.status === undefined) data.status = def.statuses[0];
  if (hasColumn(def, 'docStatus') && data.docStatus === undefined) data.docStatus = docStatusFor(data.status);
  data.companyId = companyId;

  let created;
  try {
    created = await modelClient(def).create({ data });
  } catch (error) {
    throw translatePrismaError(error, def);
  }
  if (def.onCreated) await runHook(def.onCreated, { def, resource, row: created, companyId, ctx, req, data });
  await writeAudit(companyId, req.user.id, 'create', resource, created.id, def.doctype);
  const [row] = await decorate(def, resource, [created], companyId);
  return row;
}

async function update(resource, id, req, body = {}) {
  const def = definition(resource);
  const companyId = req.user.companyId;
  const employee = await loadEmployeeContext(req, companyId);
  const ctx = accessOf(req, employee, resource);
  const client = modelClient(def);
  const row = await loadRow(client, id, companyId);
  await assertReadable(def, row, ctx);
  assertCanWrite(def, resource, { ...ctx, canSeeAll: ctx.canSeeAll || row.employeeId === ctx.employeeId }, body, companyId);

  const status = rowStatus(def, resource, row);
  if (!editableStatus(def, status)) {
    throw new HttpError(400, `${def.doctype} is ${status} and can no longer be edited. Use Cancel or Amend.`);
  }

  const merged = { ...row, ...body };
  const data = await validateAndBuild(def, resource, merged, ctx, companyId, id, req);
  if (body.status && def.statuses) {
    if (!ctx.isHr && !def.employeeScoped) throw new HttpError(403, 'Only HR can change the status');
    data.status = statusFor(def, resource, body.status);
    if (hasColumn(def, 'docStatus')) data.docStatus = docStatusFor(data.status);
  }

  let updated;
  try {
    updated = await client.update({ where: { id: row.id }, data });
  } catch (error) {
    throw translatePrismaError(error, def);
  }
  if (def.onUpdated) await runHook(def.onUpdated, { def, resource, row: updated, previous: row, companyId, ctx, req, data });
  await writeAudit(companyId, req.user.id, 'update', resource, updated.id, def.doctype);
  const [out] = await decorate(def, resource, [updated], companyId);
  return out;
}

async function remove(resource, id, req) {
  const def = definition(resource);
  const companyId = req.user.companyId;
  const employee = await loadEmployeeContext(req, companyId);
  const ctx = accessOf(req, employee, resource);
  const client = modelClient(def);
  const row = await loadRow(client, id, companyId);
  await assertReadable(def, row, ctx);
  if (!ctx.isHr && row.employeeId !== ctx.employeeId) throw new HttpError(403, 'Not allowed');
  if (def.statuses && !editableStatus(def, rowStatus(def, resource, row))) {
    throw new HttpError(400, `${def.doctype} is ${rowStatus(def, resource, row)} and cannot be deleted`);
  }
  if (def.onDeleting) await runHook(def.onDeleting, { def, resource, row, companyId, ctx, req });
  await client.delete({ where: { id: row.id } });
  await writeAudit(companyId, req.user.id, 'delete', resource, row.id, def.doctype);
  return { id: row.id };
}

async function runAction(resource, id, key, req, body = {}) {
  const def = definition(resource);
  const companyId = req.user.companyId;
  const employee = await loadEmployeeContext(req, companyId);
  const ctx = accessOf(req, employee, resource);
  const client = modelClient(def);
  const row = await loadRow(client, id, companyId);
  await assertReadable(def, row, ctx);

  const action = (def.actions || []).find((a) => a.key === key);
  if (!action) throw new HttpError(400, `${def.doctype} has no "${key}" action`);
  const status = rowStatus(def, resource, row);
  if (!(action.from || []).includes(status)) {
    throw new HttpError(400, `"${key}" is not allowed while the document is ${status}`);
  }
  if (!canRunAction(def, action, ctx, row)) {
    throw new HttpError(403, action.action === 'approve' ? 'Approval is restricted to HR' : 'Not allowed');
  }

  const patch = { status: action.to };
  if (hasColumn(def, 'docStatus')) patch.docStatus = docStatusFor(action.to);
  if (action.action === 'approve') {
    if (hasColumn(def, 'approverId')) patch.approverId = String(req.user.id || req.user._id);
    if (hasColumn(def, 'approverName')) patch.approverName = ctx.name || '';
  }
  if (body.employeeId && hasColumn(def, 'employeeId')) patch.employeeId = String(body.employeeId);

  let updated = await client.update({ where: { id: row.id }, data: patch });

  if (action.to === 'Cancelled' && def.onCancelled) updated = await runHook(def.onCancelled, {
    def, resource, row: updated, companyId, ctx, req, body
  }) || updated;

  const transitionHook = {
    Submitted: def.onSubmitted,
    Approved: def.onApproved,
    Paid: def.onPaid,
    'In Progress': def.onStarted,
    Completed: def.onCompleted,
    Accepted: def.onAccepted,
    Rejected: def.onRejected
  }[action.to];

  if (transitionHook && transitionHook !== def.onCancelled) {
    updated = (await runHook(transitionHook, { def, resource, row: updated, companyId, ctx, req, body })) || updated;
  }
  if (action.key === 'amend') {
    const cloneData = { ...row };
    delete cloneData.id;
    delete cloneData.createdAt;
    delete cloneData.updatedAt;
    if (hasColumn(def, 'docStatus')) cloneData.docStatus = 0;
    cloneData.status = action.to;
    cloneData.companyId = companyId;
    const amended = await client.create({ data: cloneData });
    await writeAudit(companyId, req.user.id, 'amend', resource, amended.id, `from ${row.id}`);
    const [out] = await decorate(def, resource, [amended], companyId);
    return out;
  }

  await writeAudit(companyId, req.user.id, key, resource, updated.id, `${status} → ${action.to}`);
  const [out] = await decorate(def, resource, [updated], companyId);
  return out;
}

// ERPNext puts plain buttons on some forms ("Add to Holidays", "Clear Table")
// that run a controller method on the saved document instead of changing status.
async function runButton(resource, id, key, req, body = {}) {
  const def = definition(resource);
  const companyId = req.user.companyId;
  const employee = await loadEmployeeContext(req, companyId);
  const ctx = accessOf(req, employee, resource);
  const client = modelClient(def);
  const row = await loadRow(client, id, companyId);
  await assertReadable(def, row, ctx);
  assertCanWrite(def, resource, ctx, body, companyId);

  const button = (def.buttons || []).find((b) => b.key === key);
  if (!button) throw new HttpError(400, `${def.doctype} has no "${key}" button`);
  if (!button.hook) throw new HttpError(500, `Button "${key}" has no server action`);

  const updated = (await runHook(button.hook, { def, resource, row, companyId, ctx, req, body })) || row;
  await writeAudit(companyId, req.user.id, key, resource, row.id, def.doctype);
  const [out] = await decorate(def, resource, [updated], companyId);
  return out;
}

async function runHook(name, args) {
  const fn = WORKFLOW_HOOKS[name];
  if (!fn) throw new HttpError(500, `Workflow hook "${name}" is not implemented`);
  try {
    return await fn(args);
  } catch (error) {
    if (error instanceof HttpError || error.status) throw error;
    throw new HttpError(400, error.message);
  }
}

// Link-target dropdowns. Every option list is company-scoped here, so the
// frontend can never offer another company's records.
async function options(target, req, query = {}) {
  const companyId = req.user?.companyId;
  if (!companyId) throw new HttpError(400, 'Company is required to use HR');
  const link = linkTarget(target);
  if (!link) throw new HttpError(404, `Unknown link target: ${target}`);
  if (MANAGER_ONLY.has(target) && !isHrAdminRole(req.user?.role) && !req.hrIsAdmin) {
    const grants = req.hrPermissions instanceof Set ? req.hrPermissions : new Set(req.hrPermissions || []);
    const key = PERMISSION_KEYS[target];
    const writable = key && [...grants].some((p) => p.startsWith(`${key}.`) && !p.endsWith('.view'));
    if (!writable) throw new HttpError(403, `${registry[target].doctype} is restricted to HR`);
  }
  const client = prisma[link.model];
  if (!client) throw new HttpError(500, `Link model ${link.model} is not available`);

  if (target === 'company') {
    return [{ id: companyId, label: req.user?.companyName || companyId, disabled: false }];
  }

  if (fixtures.resourceNeedsFixtures(target)) {
    try {
      await fixtures.ensureHrMasterFixtures(companyId);
    } catch (error) {
      console.error('[hr-docs] master fixtures (options)', target, error.message);
    }
  }

  const where = scopeFor(link, companyId);
  const search = String(query.search || query.q || '').trim();
  if (search) where[link.column] = { contains: search, mode: 'insensitive' };
  if (modelHasColumn(link.model, 'status')) where.status = { not: 'Cancelled' };
  // ERPNext parent_department set_query: only group departments.
  if (target === 'department' && (query.isGroup === true || query.isGroup === 'true' || query.isGroup === '1')) {
    where.isGroup = true;
  }

  const rows = await client.findMany({
    where,
    select: selectFor(link),
    orderBy: { [link.column]: 'asc' },
    take: 300
  });
  return rows.map((row) => ({
    id: row.id,
    label: labelOf(link, row),
    disabled: Boolean(row.disabled)
  }));
}

// Number cards for the workspace home screens. A null count means the current
// user has no access to that document at all, which the UI renders as "—".
async function counts(resourceKeys, req) {
  const companyId = req.user?.companyId;
  const employee = await loadEmployeeContext(req, companyId);
  const out = {};
  for (const resource of resourceKeys) {
    try {
      const def = definition(resource);
      const ctx = accessOf(req, employee, resource);
      const where = scopeWhere(def, ctx, {}, companyId);
      out[resource] = await modelClient(def).count({ where });
    } catch (error) {
      out[resource] = null;
      if (!(error instanceof HttpError)) console.error('[hr-docs] count', resource, error.message);
    }
  }
  return out;
}

function descriptorOf(resource) {
  return descriptors().find((d) => d.resource === resource) || null;
}

function descriptorFields(def) {
  // A section key is set on the first field of each block; the rest of the
  // block inherits it, so the frontend can draw headings without a parallel map.
  let section = null;
  let tab = null;
  return def.fields.map((f) => {
    if (f.tab) tab = f.tab;
    // Explicit `s` (including null/'') starts or clears a section so fields after
    // an ERPNext unlabeled Section Break do not keep the previous heading.
    if (Object.prototype.hasOwnProperty.call(f, 's')) section = f.s || null;
    return {
      n: f.n,
      l: f.l,
      t: f.t,
      tab: tab,
      s: section,
      r: Boolean(f.r),
      ro: Boolean(f.ro),
      hidden: Boolean(f.hidden),
      d: f.d,
      o: f.o,
      hint: f.hint,
      min: f.min,
      rows: f.rows,
      when: conditions.normalizeCondition(f.when),
      reqWhen: conditions.normalizeCondition(f.reqWhen),
      fetchFrom: f.fetchFrom || null,
      linkQuery: f.linkQuery || null,
      sectionHint: f.sectionHint || null
    };
  });
}

function descriptors(workspace) {
  return Object.entries(registry)
    .filter(([key, def]) => !workspace || def.workspace === workspace)
    .map(([key, def]) => ({
      resource: key,
      doctype: def.doctype,
      workspace: def.workspace,
      section: def.section || null,
      titleField: def.titleField || null,
      statuses: def.statuses || null,
      actions: (def.actions || []).map((a) => ({ key: a.key, label: a.label, from: a.from, to: a.to, action: a.action })),
      buttons: (def.buttons || []).map((b) => ({ key: b.key, label: b.label })),
      columns: def.columns || [],
      search: def.search || [],
      employeeScoped: Boolean(def.employeeScoped),
      selfScoped: Boolean(def.selfScoped),
      readOnly: Boolean(def.readOnly),
      kanban: Boolean(def.kanban),
      filters: {
        dateField: dateFilterField(def)?.n || null,
        status: Boolean(def.statuses),
        department: def.fields.some((f) => f.n === 'department')
      },
      fields: descriptorFields(def)
    }));
}

module.exports = {
  registry,
  PERMISSION_KEYS,
  definition,
  descriptors,
  descriptorOf,
  counts,
  options,
  list,
  get,
  create,
  update,
  remove,
  runAction,
  runButton,
  timeline,
  addComment,
  serializeRow,
  decorate,
  normalizeClock,
  HttpError
};
