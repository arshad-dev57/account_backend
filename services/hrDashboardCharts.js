'use strict';

/**
 * The Dashboard tab of each HR workspace. ERPNext builds these from the
 * dashboard_chart documents shipped with Frappe HR; each entry below is the
 * same chart (same doctype, same grouping, same measure) computed against the
 * company's own rows. Charts whose ERPNext source doctype has no equivalent
 * table here (Timesheet, Training Result, …) are deliberately left out rather
 * than replaced with something invented.
 *
 *   chart 'group'  → document_type grouped by a field (ERPNext "Group By")
 *   chart 'series' → document count bucketed by month on based_on
 *   chart 'custom' → the two custom chart sources Frappe HR ships
 */

const prisma = require('../prisma/client');

const MONTHS = 12;

function monthsBack(now = new Date()) {
  const out = [];
  for (let i = MONTHS - 1; i >= 0; i -= 1) {
    const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
    const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i + 1, 1));
    out.push({ key: `${start.getUTCFullYear()}-${String(start.getUTCMonth() + 1).padStart(2, '0')}`, start, end });
  }
  return out;
}

function windowFieldDate(model, field) {
  if (!field) return {};
  const first = monthsBack()[0];
  const last = monthsBack()[MONTHS - 1];
  return { [field]: { gte: first.start, lt: last.end } };
}

async function groupCount({ model, by, fn, field, where, dateField, ref }) {
  const client = prisma[model];
  if (!client || !client.groupBy) return [];
  const rows = await client.groupBy({
    by: [by],
    where: { ...where, ...windowFieldDate(model, dateField) },
    _count: { _all: true },
    ...(fn === 'sum' ? { _sum: { [field]: true } } : {})
  });
  let labels = {};
  if (ref) {
    const ids = [...new Set(rows.map((r) => String(r[by])).filter(Boolean))];
    if (ids.length) {
      const found = await prisma[ref.model].findMany({ where: { id: { in: ids } }, select: { id: true, [ref.column]: true } });
      labels = Object.fromEntries(found.map((f) => [f.id, f[ref.column]]));
    }
  }
  return rows
    .map((r) => ({
      label: labels[String(r[by])] || String(r[by] || '—'),
      value: Number(fn === 'sum' ? (r._sum[field] || 0) : r._count._all)
    }))
    .filter((p) => p.value > 0 || p.label !== '—')
    .sort((a, b) => b.value - a.value)
    .slice(0, 12);
}

async function monthSeries({ model, dateField, where, field, fn }) {
  const client = prisma[model];
  if (!client) return [];
  const rows = await client.findMany({
    where: { ...where, ...windowFieldDate(model, dateField) },
    select: { [dateField]: true, ...(field ? { [field]: true } : {}) }
  });
  const buckets = new Map(monthsBack().map((m) => [m.key, 0]));
  for (const row of rows) {
    const d = row[dateField];
    if (!d) continue;
    const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
    if (!buckets.has(key)) continue;
    buckets.set(key, (buckets.get(key) || 0) + (fn === 'sum' ? Number(row[field] || 0) : 1));
  }
  return [...buckets.entries()].map(([label, value]) => ({ label, value: fn === 'sum' ? Math.round(value * 100) / 100 : value }));
}

async function hiringVsAttrition(companyId) {
  const buckets = monthsBack();
  const joined = await prisma.hrEmployee.findMany({ where: { companyId, joiningDate: { gte: buckets[0].start } }, select: { joiningDate: true } });
  const left = await prisma.hrEmployeeSeparation.findMany({ where: { companyId, separationDate: { gte: buckets[0].start } }, select: { separationDate: true } });
  const count = (rows, field) => {
    const map = new Map(buckets.map((m) => [m.key, 0]));
    for (const row of rows) {
      const d = row[field];
      if (!d) continue;
      const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
      if (map.has(key)) map.set(key, map.get(key) + 1);
    }
    return map;
  };
  const hiredMap = count(joined, 'joiningDate');
  const leftMap = count(left, 'separationDate');
  return buckets.map((m) => ({ label: m.key, value: hiredMap.get(m.key), secondary: leftMap.get(m.key) }));
}

async function genderDiversity(companyId) {
  const rows = await prisma.hrEmployee.findMany({ where: { companyId, status: 'active' }, select: { profile: true } });
  const map = new Map();
  for (const row of rows) {
    const gender = String(row.profile?.gender || 'Not set');
    map.set(gender, (map.get(gender) || 0) + 1);
  }
  return [...map.entries()].map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value);
}

async function claimTypeBreakup(companyId) {
  const claims = await prisma.hrExpenseClaim.findMany({ where: { companyId }, select: { expenses: true } });
  const map = new Map();
  for (const claim of claims) {
    for (const line of Array.isArray(claim.expenses) ? claim.expenses : []) {
      const key = String(line?.expenseTypeId || line?.type || line?.description || 'Unlabelled');
      map.set(key, (map.get(key) || 0) + 1);
    }
  }
  return [...map.entries()].map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value).slice(0, 12);
}

async function salaryByEmployeeField(companyId, field) {
  const items = await prisma.hrPayrollItem.findMany({
    where: { companyId, period: { in: monthsBack().slice(-1).map((m) => m.key) } },
    select: { employeeId: true, net: true }
  });
  const ids = [...new Set(items.map((i) => i.employeeId).filter(Boolean))];
  const employees = ids.length
    ? await prisma.hrEmployee.findMany({ where: { id: { in: ids } }, select: { id: true, [field]: true } })
    : [];
  const labelFor = new Map(employees.map((e) => [e.id, String(e[field] || '—')]));
  const map = new Map();
  for (const item of items) {
    const key = labelFor.get(item.employeeId) || '—';
    map.set(key, (map.get(key) || 0) + Number(item.net || 0));
  }
  return [...map.entries()]
    .map(([label, value]) => ({ label, value: Math.round(value * 100) / 100 }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 12);
}

const active = (companyId) => ({ companyId });

const dashboards = {
  'hr-setup': [
    { label: 'Department Wise Employee Count', chart: 'group', model: 'hrEmployee', by: 'department', where: active, dateField: null },
    { label: 'Designation Wise Employee Count', chart: 'group', model: 'hrEmployee', by: 'designation', where: active },
    { label: 'Employees By Branch', chart: 'group', model: 'hrEmployee', by: 'officeId', where: active, ref: { model: 'hrOffice', column: 'name' } },
    { label: 'Employees By Grade', chart: 'group', model: 'hrEmployee', by: 'employeeGradeId', where: active, ref: { model: 'hrEmployeeGrade', column: 'name' } },
    { label: 'Employees By Type', chart: 'group', model: 'hrEmployee', by: 'employmentType', where: active },
    { label: 'Gender Diversity Ratio', chart: 'custom', run: genderDiversity }
  ],
  tenure: [
    { label: 'Hiring vs Attrition Count', chart: 'custom', run: hiringVsAttrition },
    { label: 'Year on Year Promotions', chart: 'series', model: 'hrEmployeePromotion', dateField: 'promotionDate', where: active },
    { label: 'Year on Year Transfers', chart: 'series', model: 'hrEmployeeTransfer', dateField: 'transferDate', where: active }
  ],
  recruitment: [
    { label: 'Designation Wise Openings', chart: 'group', model: 'hrJobOpening', by: 'designation', where: active },
    { label: 'Department Wise Openings', chart: 'group', model: 'hrJobOpening', by: 'department', where: active },
    { label: 'Job Applicant Pipeline', chart: 'group', model: 'hrJobApplicant', by: 'status', where: active },
    { label: 'Job Applicant Source', chart: 'group', model: 'hrJobApplicant', by: 'source', where: active },
    { label: 'Job Applicants By Country', chart: 'group', model: 'hrJobApplicant', by: 'country', where: active },
    { label: 'Job Offer Status', chart: 'group', model: 'hrJobOffer', by: 'status', where: active },
    { label: 'Interview Status', chart: 'group', model: 'hrInterview', by: 'status', where: active },
    { label: 'Job Application Frequency', chart: 'series', model: 'hrJobApplicant', dateField: 'createdAt', where: active }
  ],
  'shift-and-attendance': [
    { label: 'Attendance Count', chart: 'group', model: 'hrAttendance', by: 'status', where: active, dateField: 'workDate' },
    { label: 'Shift Assignment Breakup', chart: 'group', model: 'hrRoster', by: 'shiftId', where: active, dateField: 'workDate', ref: { model: 'hrShift', column: 'name' } },
    { label: 'Overtime Hours', chart: 'series', model: 'hrOvertime', dateField: 'workDate', where: active, field: 'hours', fn: 'sum' }
  ],
  leaves: [
    { label: 'Leave Applications by Type', chart: 'group', model: 'hrLeave', by: 'leaveTypeId', where: active, dateField: 'fromDate', ref: { model: 'hrLeaveType', column: 'name' } },
    { label: 'Leave Applications by Status', chart: 'group', model: 'hrLeave', by: 'status', where: active, dateField: 'fromDate' },
    { label: 'Days On Leave', chart: 'series', model: 'hrLeave', dateField: 'fromDate', where: active, field: 'days', fn: 'sum' }
  ],
  expenses: [
    { label: 'Expense Claims', chart: 'series', model: 'hrExpenseClaim', dateField: 'claimDate', where: active },
    { label: 'Department Wise Expense Claims', chart: 'group', model: 'hrExpenseClaim', by: 'costCenter', where: active },
    { label: 'Claims By Type', chart: 'custom', run: claimTypeBreakup },
    { label: 'Employee Advance Status', chart: 'group', model: 'hrLoan', by: 'status', where: active }
  ],
  performance: [
    { label: 'Appraisal Overview', chart: 'group', model: 'hrPerformanceReview', by: 'status', where: active },
    { label: 'Goals By Status', chart: 'group', model: 'hrGoal', by: 'status', where: active }
  ],
  'tax-and-benefits': [
    { label: 'Benefit Claims', chart: 'group', model: 'hrEmployeeBenefitClaim', by: 'status', where: active, fn: 'sum', field: 'amount' },
    { label: 'Tax Exemption Declarations', chart: 'group', model: 'hrTaxExemptionDeclaration', by: 'status', where: active }
  ],
  payroll: [
    { label: 'Outgoing Salary', chart: 'series', model: 'hrPayrollItem', dateField: 'createdAt', where: active, field: 'net', fn: 'sum' },
    { label: 'Department Wise Salary (Last Month)', chart: 'custom', run: (companyId) => salaryByEmployeeField(companyId, 'department') },
    { label: 'Designation Wise Salary (Last Month)', chart: 'custom', run: (companyId) => salaryByEmployeeField(companyId, 'designation') }
  ]
};

async function computeChart(spec, companyId) {
  const where = spec.where ? spec.where(companyId) : { companyId };
  if (spec.chart === 'custom') return { label: spec.label, chartType: 'bar', points: await spec.run(companyId) };
  if (spec.chart === 'series') {
    return { label: spec.label, chartType: 'line', points: await monthSeries({ ...spec, where }) };
  }
  return { label: spec.label, chartType: 'bar', points: await groupCount({ ...spec, where }) };
}

async function chartsFor(slug, companyId) {
  const specs = dashboards[slug];
  if (!specs) return [];
  const out = [];
  for (const spec of specs) {
    try {
      out.push(await computeChart(spec, companyId));
    } catch (error) {
      console.error('[hr-dashboard] chart failed', slug, spec.label, error.message);
    }
  }
  return out;
}

module.exports = { chartsFor, dashboards, monthsBack };
