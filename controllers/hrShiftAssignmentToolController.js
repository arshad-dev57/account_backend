'use strict';

/**
 * ERPNext Shift Assignment Tool (Single DocType).
 * Actions: Assign Shift | Assign Shift Schedule | Process Shift Requests.
 * Source: frappe/hrms shift_assignment_tool.py + .js
 */

const prisma = require('../prisma/client');
const { requireCompany, isHrAdminRole, workDateKey } = require('../utils/hrAccess');
const docs = require('../services/hrDocumentService');
const { writeAudit } = require('../utils/hrAudit');

function wrap(handler) {
  return async (req, res) => {
    const companyId = requireCompany(req, res);
    if (!companyId) return undefined;
    try {
      if (!isHrAdminRole(req.user?.role) && !req.hrIsAdmin) {
        const grants = req.hrPermissions instanceof Set ? req.hrPermissions : new Set(req.hrPermissions || []);
        const ok = [...grants].some((p) => p.startsWith('hr.') && !p.endsWith('.view'));
        if (!ok) {
          return res.status(403).json({ success: false, message: 'Shift Assignment Tool is restricted to HR' });
        }
      }
      const payload = await handler(req, res, companyId);
      if (!res.headersSent) res.json({ success: true, data: payload });
      return undefined;
    } catch (error) {
      const status = error instanceof docs.HttpError ? error.status : error.status || 500;
      if (status >= 500) console.error('[hr-shift-tool]', error);
      return res.status(status).json({
        success: false,
        message: error.message || 'Something went wrong',
        errors: error.extra?.errors
      });
    }
  };
}

function dayStart(value) {
  if (!value) return null;
  return workDateKey(new Date(value));
}

function eachDate(from, to) {
  const out = [];
  const start = dayStart(from);
  const end = dayStart(to || from);
  if (!start || !end) return out;
  for (let d = new Date(start); d <= end; d.setUTCDate(d.getUTCDate() + 1)) {
    out.push(new Date(d));
  }
  return out;
}

function ymd(date) {
  if (!date) return '';
  return new Date(date).toISOString().slice(0, 10);
}

function buildEmployeeWhere(companyId, body, { startDate, endDate } = {}) {
  const and = [{ OR: [{ status: 'Active' }, { status: 'active' }] }];
  if (startDate) {
    const start = dayStart(startDate);
    and.push({ OR: [{ joiningDate: null }, { joiningDate: { lte: start } }] });
    and.push({ OR: [{ relievingDate: null }, { relievingDate: { gte: start } }] });
  }
  if (endDate) {
    const end = dayStart(endDate);
    and.push({ OR: [{ relievingDate: null }, { relievingDate: { gte: end } }] });
  }
  if (body.branchId || body.branch) and.push({ officeId: String(body.branchId || body.branch) });
  if (body.departmentId || body.department) {
    const dept = String(body.departmentId || body.department);
    and.push({ OR: [{ departmentId: dept }, { department: dept }] });
  }
  if (body.designationId || body.designation) {
    const des = String(body.designationId || body.designation);
    and.push({ OR: [{ designationId: des }, { designation: des }] });
  }
  if (body.gradeId || body.grade) and.push({ employeeGradeId: String(body.gradeId || body.grade) });
  if (body.employmentTypeId || body.employmentType) {
    const et = String(body.employmentTypeId || body.employmentType);
    and.push({ OR: [{ employmentTypeId: et }, { employmentType: et }] });
  }
  if (body.search) {
    const q = String(body.search).trim();
    if (q) {
      and.push({
        OR: [
          { employeeName: { contains: q, mode: 'insensitive' } },
          { employeeCode: { contains: q, mode: 'insensitive' } },
          { firstName: { contains: q, mode: 'insensitive' } },
          { lastName: { contains: q, mode: 'insensitive' } }
        ]
      });
    }
  }
  return { companyId, AND: and };
}

async function decorateEmployees(rows) {
  const officeIds = [...new Set(rows.map((r) => r.officeId).filter(Boolean))];
  const shiftIds = [...new Set(rows.map((r) => r.defaultShiftId).filter(Boolean))];
  const [offices, shifts] = await Promise.all([
    officeIds.length
      ? prisma.hrOffice.findMany({ where: { id: { in: officeIds } }, select: { id: true, name: true } })
      : [],
    shiftIds.length
      ? prisma.hrShift.findMany({ where: { id: { in: shiftIds } }, select: { id: true, name: true } })
      : []
  ]);
  const officeMap = new Map(offices.map((o) => [o.id, o.name]));
  const shiftMap = new Map(shifts.map((s) => [s.id, s.name]));
  return rows.map((r) => ({
    id: r.id,
    employee: r.employeeCode || r.id,
    employeeId: r.id,
    employeeName: r.employeeName || `${r.firstName || ''} ${r.lastName || ''}`.trim() || r.employeeCode,
    branch: officeMap.get(r.officeId) || '',
    department: r.department || '',
    defaultShift: shiftMap.get(r.defaultShiftId) || r.shiftLabel || ''
  }));
}

async function employeesWithOverlappingAssignments(companyId, startDate, endDate) {
  const start = dayStart(startDate);
  const end = dayStart(endDate || startDate);
  const rows = await prisma.hrRoster.findMany({
    where: {
      companyId,
      status: { in: ['Active', 'Scheduled', 'active'] },
      workDate: { gte: start, lte: end }
    },
    select: { employeeId: true },
    distinct: ['employeeId']
  });
  return new Set(rows.map((r) => r.employeeId));
}

async function employeesWithScheduleAssignments(companyId, shiftScheduleId) {
  const rows = await prisma.hrShiftScheduleAssignment.findMany({
    where: {
      companyId,
      enabled: true,
      ...(shiftScheduleId ? { shiftScheduleId } : {})
    },
    select: { employeeId: true },
    distinct: ['employeeId']
  });
  return new Set(rows.map((r) => r.employeeId));
}

async function getEmployees(req, _res, companyId) {
  const body = { ...(req.body || {}), ...(req.query || {}) };
  const action = String(body.action || 'Assign Shift');

  if (action === 'Process Shift Requests') {
    return getShiftRequests(companyId, body);
  }

  const startDate = body.startDate || body.start_date;
  const endDate = body.endDate || body.end_date || null;
  const status = String(body.status || 'Active');
  const shiftTypeId = body.shiftTypeId || body.shift_type || null;
  const shiftScheduleId = body.shiftScheduleId || body.shift_schedule || null;

  if (action === 'Assign Shift' && !(shiftTypeId && startDate)) return [];
  if (action === 'Assign Shift Schedule' && !(shiftScheduleId && startDate)) return [];

  const where = buildEmployeeWhere(companyId, body, { startDate, endDate });

  let rows = await prisma.hrEmployee.findMany({
    where,
    select: {
      id: true,
      employeeCode: true,
      employeeName: true,
      firstName: true,
      lastName: true,
      officeId: true,
      department: true,
      departmentId: true,
      defaultShiftId: true,
      shiftLabel: true
    },
    orderBy: { employeeName: 'asc' },
    take: 500
  });

  if (action === 'Assign Shift Schedule') {
    const blocked = await employeesWithScheduleAssignments(companyId, shiftScheduleId);
    rows = rows.filter((r) => !blocked.has(r.id));
  } else if (status === 'Active') {
    const blocked = await employeesWithOverlappingAssignments(companyId, startDate, endDate);
    rows = rows.filter((r) => !blocked.has(r.id));
  }

  return decorateEmployees(rows);
}

async function getShiftRequests(companyId, body) {
  const empWhere = buildEmployeeWhere(companyId, body, {});
  const employees = await prisma.hrEmployee.findMany({
    where: empWhere,
    select: { id: true }
  });
  const empIds = employees.map((e) => e.id);
  if (!empIds.length) return [];

  const where = {
    companyId,
    status: 'Draft',
    employeeId: { in: empIds }
  };
  if (body.shiftTypeFilter || body.shift_type_filter) {
    where.shiftId = String(body.shiftTypeFilter || body.shift_type_filter);
  }
  if (body.approverId || body.approver) {
    where.approverId = String(body.approverId || body.approver);
  }
  if (body.fromDate || body.from_date) {
    where.toDate = { gte: dayStart(body.fromDate || body.from_date) };
  }
  if (body.toDate || body.to_date) {
    where.fromDate = { lte: dayStart(body.toDate || body.to_date) };
  }

  const rows = await prisma.hrShiftRequest.findMany({
    where,
    include: {
      employee: { select: { employeeName: true, employeeCode: true, firstName: true, lastName: true } },
      shift: { select: { name: true } }
    },
    orderBy: { fromDate: 'asc' },
    take: 500
  });

  return rows.map((r) => {
    const name =
      r.employee?.employeeName ||
      `${r.employee?.firstName || ''} ${r.employee?.lastName || ''}`.trim() ||
      r.employee?.employeeCode ||
      '';
    return {
      id: r.id,
      name: r.id,
      shiftRequest: r.id,
      employeeId: r.employeeId,
      employee: r.employeeId,
      employeeName: `${r.employee?.employeeCode || r.employeeId}: ${name}`,
      shiftType: r.shift?.name || '',
      shiftId: r.shiftId,
      fromDate: ymd(r.fromDate),
      toDate: ymd(r.toDate)
    };
  });
}

async function bulkAssign(req, _res, companyId) {
  const body = req.body || {};
  const action = String(body.action || 'Assign Shift');
  const employees = Array.isArray(body.employees) ? body.employees.map(String) : [];
  if (!employees.length) throw new docs.HttpError(400, 'Please select at least one employee');

  const startDate = body.startDate || body.start_date;
  const endDate = body.endDate || body.end_date || startDate;
  const status = String(body.status || 'Active');
  const shiftTypeId = body.shiftTypeId || body.shift_type;
  const shiftScheduleId = body.shiftScheduleId || body.shift_schedule;
  const shiftLocationId = body.shiftLocationId || body.shift_location || null;

  if (!startDate) throw new docs.HttpError(400, 'Start Date is required');

  const success = [];
  const failure = [];

  if (action === 'Assign Shift') {
    if (!shiftTypeId) throw new docs.HttpError(400, 'Shift Type is required');
    const shift = await prisma.hrShift.findFirst({ where: { id: String(shiftTypeId), companyId } });
    if (!shift) throw new docs.HttpError(400, 'Shift Type not found');
    const dates = eachDate(startDate, endDate);
    if (!dates.length) throw new docs.HttpError(400, 'Invalid date range');

    for (const employeeId of employees) {
      try {
        for (const workDate of dates) {
          await prisma.hrRoster.upsert({
            where: { employeeId_workDate: { employeeId, workDate } },
            create: {
              companyId,
              employeeId,
              shiftId: shift.id,
              workDate,
              status: status === 'Inactive' ? 'Inactive' : 'Active'
            },
            update: {
              shiftId: shift.id,
              status: status === 'Inactive' ? 'Inactive' : 'Active'
            }
          });
        }
        success.push({ employee: employeeId });
      } catch (error) {
        console.error('[hr-shift-tool] assign', employeeId, error.message);
        failure.push(employeeId);
      }
    }
    await writeAudit(companyId, req.user.id, 'bulk-assign-shift', 'shift-assignment-tool', '', `${success.length} employees`);
    return { action, success, failure, created: success.length };
  }

  if (action === 'Assign Shift Schedule') {
    if (!shiftScheduleId) throw new docs.HttpError(400, 'Shift Schedule is required');
    const schedule = await prisma.hrShiftSchedule.findFirst({
      where: { id: String(shiftScheduleId), companyId }
    });
    if (!schedule) throw new docs.HttpError(400, 'Shift Schedule not found');

    for (const employeeId of employees) {
      try {
        const emp = await prisma.hrEmployee.findFirst({
          where: { id: employeeId, companyId },
          select: { employeeName: true, firstName: true, lastName: true, employeeCode: true }
        });
        const employeeName =
          emp?.employeeName ||
          `${emp?.firstName || ''} ${emp?.lastName || ''}`.trim() ||
          emp?.employeeCode ||
          '';
        await prisma.hrShiftScheduleAssignment.create({
          data: {
            companyId,
            employeeId,
            employeeName,
            shiftScheduleId: schedule.id,
            shiftLocationId: shiftLocationId || null,
            shiftStatus: status === 'Inactive' ? 'Inactive' : 'Active',
            enabled: !endDate,
            createShiftsAfter: dayStart(startDate)
          }
        });
        // Also materialize daily assignments for the range when schedule has a shift type.
        if (schedule.shiftTypeId) {
          for (const workDate of eachDate(startDate, endDate || startDate)) {
            await prisma.hrRoster.upsert({
              where: { employeeId_workDate: { employeeId, workDate } },
              create: {
                companyId,
                employeeId,
                shiftId: schedule.shiftTypeId,
                workDate,
                status: status === 'Inactive' ? 'Inactive' : 'Active'
              },
              update: {
                shiftId: schedule.shiftTypeId,
                status: status === 'Inactive' ? 'Inactive' : 'Active'
              }
            });
          }
        }
        success.push({ employee: employeeId });
      } catch (error) {
        console.error('[hr-shift-tool] schedule', employeeId, error.message);
        failure.push(employeeId);
      }
    }
    await writeAudit(
      companyId,
      req.user.id,
      'bulk-assign-shift-schedule',
      'shift-assignment-tool',
      '',
      `${success.length} employees`
    );
    return { action, success, failure, created: success.length };
  }

  throw new docs.HttpError(400, 'Invalid Action');
}

async function processRequests(req, _res, companyId) {
  const body = req.body || {};
  const status = String(body.status || '');
  if (!['Approved', 'Rejected'].includes(status)) {
    throw new docs.HttpError(400, 'Status must be Approved or Rejected');
  }
  const requests = Array.isArray(body.shiftRequests) ? body.shiftRequests : [];
  if (!requests.length) throw new docs.HttpError(400, 'Please select at least one Shift Request');

  const success = [];
  const failure = [];
  const key = status === 'Approved' ? 'approve' : 'reject';

  for (const item of requests) {
    const id = String(item.shiftRequest || item.id || item);
    try {
      await docs.runAction('shift-request', id, key, req, {});
      success.push({ doc: id, employee: item.employee || item.employeeId || '' });
    } catch (error) {
      console.error('[hr-shift-tool] process', id, error.message);
      failure.push(item.employee || id);
    }
  }

  await writeAudit(
    companyId,
    req.user.id,
    `bulk-${key}-shift-request`,
    'shift-assignment-tool',
    '',
    `${success.length} requests`
  );
  return { status, success, failure, processed: success.length };
}

module.exports = {
  loadPermissions: require('./hrDocumentController').loadPermissions,
  getEmployees: wrap(getEmployees),
  bulkAssign: wrap(bulkAssign),
  processRequests: wrap(processRequests)
};
