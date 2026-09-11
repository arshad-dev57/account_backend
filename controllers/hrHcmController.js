'use strict';

const prisma = require('../prisma/client');
const {
  requireCompany,
  requireHrManager,
  canManageHr,
  canViewSalary,
  workDateKey
} = require('../utils/hrAccess');
const { writeAudit } = require('../utils/hrAudit');

const EMP = { user: { select: { firstName: true, lastName: true, email: true } } };

function fullName(user) {
  return [user?.firstName, user?.lastName].filter(Boolean).join(' ').trim() || 'Employee';
}

function ymd(value) {
  if (!value) return '';
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}/.test(value)) return value.slice(0, 10);
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? '' : d.toISOString().slice(0, 10);
}

function asDate(value) {
  const key = ymd(value);
  return key ? new Date(`${key}T00:00:00.000Z`) : null;
}

async function findMine(req, companyId) {
  return prisma.hrEmployee.findFirst({
    where: { userId: String(req.user.id || req.user._id), companyId },
    include: { manager: { include: EMP }, reports: { include: EMP } }
  });
}

function wrap(fn) {
  return async (req, res) => {
    try {
      const companyId = requireCompany(req, res);
      if (!companyId) return;
      await fn(req, res, companyId);
    } catch (error) {
      console.error('[hr-hcm]', error);
      res.status(500).json({ success: false, message: error.message });
    }
  };
}

const DEFAULT_LEAVE_TYPES = [
  { name: 'Casual Leave', paid: true, annualQuota: 10, carryForward: false, encashable: false, unit: 'day' },
  { name: 'Sick Leave', paid: true, annualQuota: 8, carryForward: false, encashable: false, unit: 'day' },
  { name: 'Annual Leave', paid: true, annualQuota: 14, carryForward: true, encashable: true, unit: 'day' },
  { name: 'Emergency Leave', paid: false, annualQuota: 3, carryForward: false, encashable: false, unit: 'day' }
];

async function ensureLeaveTypes(companyId) {
  const count = await prisma.hrLeaveType.count({ where: { companyId } });
  if (count > 0) return prisma.hrLeaveType.findMany({ where: { companyId }, orderBy: { name: 'asc' } });
  await prisma.hrLeaveType.createMany({
    data: DEFAULT_LEAVE_TYPES.map((t) => ({ companyId, ...t }))
  });
  return prisma.hrLeaveType.findMany({ where: { companyId }, orderBy: { name: 'asc' } });
}

exports.bootstrap = wrap(async (req, res, companyId) => {
  if (!requireHrManager(req, res)) return;
  const types = await ensureLeaveTypes(companyId);
  res.json({ success: true, data: { leaveTypes: types.length } });
});

exports.listDepartments = wrap(async (req, res, companyId) => {
  if (!requireHrManager(req, res)) return;
  const rows = await prisma.hrDepartment.findMany({
    where: { companyId },
    orderBy: { name: 'asc' }
  });
  const employees = await prisma.hrEmployee.groupBy({
    by: ['department'],
    where: { companyId, status: { not: 'terminated' } },
    _count: { _all: true }
  });
  const counts = Object.fromEntries(employees.map((e) => [e.department || 'Unassigned', e._count._all]));
  res.json({
    success: true,
    data: rows.map((r) => ({ ...r, headcount: counts[r.name] || 0 }))
  });
});

exports.saveDepartment = wrap(async (req, res, companyId) => {
  if (!requireHrManager(req, res)) return;
  const data = {
    companyId,
    name: String(req.body.name || '').trim(),
    parentId: req.body.parentId || null,
    costCenter: String(req.body.costCenter || ''),
    managerEmployeeId: req.body.managerEmployeeId || null
  };
  if (!data.name) return res.status(400).json({ success: false, message: 'Department name is required' });
  const row = req.body.id
    ? await prisma.hrDepartment.update({ where: { id: req.body.id }, data })
    : await prisma.hrDepartment.create({ data });
  await writeAudit(companyId, req.user.id, req.body.id ? 'update' : 'create', 'department', row.id, row.name);
  res.json({ success: true, data: row });
});

exports.listDesignations = wrap(async (req, res, companyId) => {
  if (!requireHrManager(req, res)) return;
  const rows = await prisma.hrDesignation.findMany({ where: { companyId }, orderBy: [{ level: 'asc' }, { name: 'asc' }] });
  res.json({ success: true, data: rows });
});

exports.saveDesignation = wrap(async (req, res, companyId) => {
  if (!requireHrManager(req, res)) return;
  const data = { companyId, name: String(req.body.name || '').trim(), level: Number(req.body.level || 0) };
  if (!data.name) return res.status(400).json({ success: false, message: 'Designation name is required' });
  const row = req.body.id
    ? await prisma.hrDesignation.update({ where: { id: req.body.id }, data })
    : await prisma.hrDesignation.create({ data });
  res.json({ success: true, data: row });
});

exports.listShifts = wrap(async (req, res, companyId) => {
  const rows = await prisma.hrShift.findMany({ where: { companyId }, orderBy: { name: 'asc' } });
  res.json({ success: true, data: rows });
});

exports.saveShift = wrap(async (req, res, companyId) => {
  if (!requireHrManager(req, res)) return;
  const data = {
    companyId,
    name: String(req.body.name || '').trim(),
    startTime: String(req.body.startTime || '09:00'),
    endTime: String(req.body.endTime || '18:00'),
    breakMinutes: Number(req.body.breakMinutes || 60),
    graceMinutes: Number(req.body.graceMinutes || 15),
    workingDays: req.body.workingDays || ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'],
    isNight: Boolean(req.body.isNight),
    isFlexible: Boolean(req.body.isFlexible),
    overtimeAfterHours: Number(req.body.overtimeAfterHours || 8)
  };
  if (!data.name) return res.status(400).json({ success: false, message: 'Shift name is required' });
  const row = req.body.id
    ? await prisma.hrShift.update({ where: { id: req.body.id }, data })
    : await prisma.hrShift.create({ data });
  res.json({ success: true, data: row });
});

exports.listHolidays = wrap(async (req, res, companyId) => {
  const year = Number(req.query.year || new Date().getFullYear());
  const start = new Date(`${year}-01-01T00:00:00.000Z`);
  const end = new Date(`${year + 1}-01-01T00:00:00.000Z`);
  const rows = await prisma.hrHoliday.findMany({
    where: { companyId, date: { gte: start, lt: end } },
    orderBy: { date: 'asc' }
  });
  res.json({ success: true, data: rows.map((r) => ({ ...r, date: ymd(r.date) })) });
});

exports.saveHoliday = wrap(async (req, res, companyId) => {
  if (!requireHrManager(req, res)) return;
  const date = asDate(req.body.date);
  if (!req.body.name || !date) {
    return res.status(400).json({ success: false, message: 'Holiday name and date are required' });
  }
  const data = {
    companyId,
    name: String(req.body.name),
    date,
    type: String(req.body.type || 'Public'),
    officeId: req.body.officeId || null,
    optional: Boolean(req.body.optional)
  };
  const row = req.body.id
    ? await prisma.hrHoliday.update({ where: { id: req.body.id }, data })
    : await prisma.hrHoliday.create({ data });
  res.json({ success: true, data: { ...row, date: ymd(row.date) } });
});

exports.listLeaveTypes = wrap(async (req, res, companyId) => {
  const rows = await ensureLeaveTypes(companyId);
  res.json({ success: true, data: rows });
});

exports.saveLeaveType = wrap(async (req, res, companyId) => {
  if (!requireHrManager(req, res)) return;
  const data = {
    companyId,
    name: String(req.body.name || '').trim(),
    paid: req.body.paid !== false,
    annualQuota: Number(req.body.annualQuota || 14),
    carryForward: Boolean(req.body.carryForward),
    encashable: Boolean(req.body.encashable),
    unit: String(req.body.unit || 'day')
  };
  if (!data.name) return res.status(400).json({ success: false, message: 'Leave type name is required' });
  const row = req.body.id
    ? await prisma.hrLeaveType.update({ where: { id: req.body.id }, data })
    : await prisma.hrLeaveType.create({ data });
  res.json({ success: true, data: row });
});

async function balancesFor(companyId, employeeId) {
  const year = new Date().getFullYear();
  const types = await ensureLeaveTypes(companyId);
  const existing = await prisma.hrLeaveBalance.findMany({ where: { companyId, employeeId, year } });
  const byType = new Map(existing.map((r) => [r.leaveTypeId, r]));
  const out = [];
  for (const type of types) {
    let row = byType.get(type.id);
    if (!row) {
      row = await prisma.hrLeaveBalance.create({
        data: {
          companyId,
          employeeId,
          leaveTypeId: type.id,
          year,
          accrued: type.annualQuota,
          used: 0,
          carried: 0,
          encashed: 0
        }
      });
    }
    out.push({
      ...row,
      type: type.name,
      paid: type.paid,
      remaining: Math.max(0, Number(row.accrued) + Number(row.carried) - Number(row.used) - Number(row.encashed))
    });
  }
  return out;
}

exports.leaveBalances = wrap(async (req, res, companyId) => {
  let employeeId = req.query.employeeId;
  if (!employeeId) {
    const mine = await findMine(req, companyId);
    if (!mine) return res.status(404).json({ success: false, message: 'Employee profile not found' });
    employeeId = mine.id;
  } else if (!requireHrManager(req, res)) {
    return;
  }
  res.json({ success: true, data: await balancesFor(companyId, employeeId) });
});

exports.attendanceSummary = wrap(async (req, res, companyId) => {
  if (!requireHrManager(req, res)) return;
  const date = req.query.date ? workDateKey(new Date(req.query.date)) : workDateKey();
  const [employees, rows, leaves, holidays] = await Promise.all([
    prisma.hrEmployee.findMany({
      where: { companyId, status: { not: 'terminated' } },
      include: EMP
    }),
    prisma.hrAttendance.findMany({ where: { companyId, workDate: date } }),
    prisma.hrLeave.findMany({
      where: { companyId, status: 'Approved', fromDate: { lte: date }, toDate: { gte: date } }
    }),
    prisma.hrHoliday.findFirst({ where: { companyId, date } })
  ]);
  const att = new Map(rows.map((r) => [r.employeeId, r]));
  const onLeave = new Set(leaves.map((r) => r.employeeId));
  const weekend = date.getUTCDay() === 0;
  const classified = employees.map((emp) => {
    const a = att.get(emp.id);
    let status = 'Absent';
    if (holidays) status = 'Holiday';
    else if (weekend) status = 'Weekend';
    else if (onLeave.has(emp.id)) status = 'On leave';
    else if (a?.checkIn && a?.checkOut && Number(a.workingMinutes || 0) < 240) status = 'Half day';
    else if (a?.checkIn && !a.checkOut) status = 'Missing checkout';
    else if (String(a?.status || '').toLowerCase() === 'late') status = 'Late';
    else if (a?.checkIn) status = 'Present';
    return {
      employeeId: emp.id,
      employee: fullName(emp.user),
      department: emp.department,
      status,
      checkIn: a?.checkIn || null,
      checkOut: a?.checkOut || null,
      workingMinutes: a?.workingMinutes || 0,
      source: a?.source || null
    };
  });
  const count = (s) => classified.filter((r) => r.status === s).length;
  res.json({
    success: true,
    date: ymd(date),
    summary: {
      present: count('Present') + count('Late') + count('Half day') + count('Missing checkout'),
      late: count('Late'),
      absent: count('Absent'),
      onLeave: count('On leave'),
      holiday: count('Holiday'),
      weekend: count('Weekend'),
      halfDay: count('Half day'),
      missingCheckout: count('Missing checkout'),
      headcount: employees.length
    },
    data: classified
  });
});

exports.listCorrections = wrap(async (req, res, companyId) => {
  const mine = await findMine(req, companyId);
  const where = { companyId };
  if (!canManageHr(req.user)) {
    if (!mine) return res.status(404).json({ success: false, message: 'Employee profile not found' });
    where.employeeId = mine.id;
  }
  const rows = await prisma.hrAttendanceCorrection.findMany({
    where,
    include: { employee: { include: EMP } },
    orderBy: { createdAt: 'desc' }
  });
  res.json({
    success: true,
    data: rows.map((r) => ({
      ...r,
      workDate: ymd(r.workDate),
      employee: fullName(r.employee?.user)
    }))
  });
});

exports.createCorrection = wrap(async (req, res, companyId) => {
  const mine = await findMine(req, companyId);
  const employeeId = canManageHr(req.user) && req.body.employeeId ? req.body.employeeId : mine?.id;
  if (!employeeId) return res.status(404).json({ success: false, message: 'Employee profile not found' });
  const workDate = asDate(req.body.workDate || req.body.date) || workDateKey();
  const row = await prisma.hrAttendanceCorrection.create({
    data: {
      companyId,
      employeeId,
      workDate,
      requestType: String(req.body.requestType || 'regularization'),
      reason: String(req.body.reason || ''),
      proposedIn: req.body.proposedIn || null,
      proposedOut: req.body.proposedOut || null,
      status: 'Pending'
    }
  });
  await prisma.hrApproval.create({
    data: {
      companyId,
      module: 'attendance',
      recordId: row.id,
      title: `Attendance correction · ${ymd(workDate)}`,
      requestedBy: String(req.user.id || ''),
      status: 'Pending'
    }
  });
  res.json({ success: true, data: { ...row, workDate: ymd(row.workDate) } });
});

exports.updateCorrection = wrap(async (req, res, companyId) => {
  if (!requireHrManager(req, res)) return;
  const row = await prisma.hrAttendanceCorrection.update({
    where: { id: req.params.id },
    data: { status: String(req.body.status || 'Pending') }
  });
  await writeAudit(companyId, req.user.id, 'correction', 'attendance', row.id, row.status);
  res.json({ success: true, data: row });
});

exports.listRoster = wrap(async (req, res, companyId) => {
  const start = asDate(req.query.from) || workDateKey();
  const end = asDate(req.query.to) || new Date(start.getTime() + 7 * 86400000);
  const where = { companyId, workDate: { gte: start, lte: end } };
  if (req.query.employeeId) where.employeeId = req.query.employeeId;
  const rows = await prisma.hrRoster.findMany({
    where,
    include: { employee: { include: EMP }, shift: true },
    orderBy: { workDate: 'asc' }
  });
  res.json({
    success: true,
    data: rows.map((r) => ({
      id: r.id,
      employeeId: r.employeeId,
      employee: fullName(r.employee?.user),
      shiftId: r.shiftId,
      shift: r.shift?.name,
      startTime: r.shift?.startTime,
      endTime: r.shift?.endTime,
      workDate: ymd(r.workDate),
      status: r.status
    }))
  });
});

exports.saveRoster = wrap(async (req, res, companyId) => {
  if (!requireHrManager(req, res)) return;
  const items = Array.isArray(req.body.items) ? req.body.items : [req.body];
  const saved = [];
  for (const item of items) {
    const workDate = asDate(item.workDate);
    if (!item.employeeId || !item.shiftId || !workDate) continue;
    const row = await prisma.hrRoster.upsert({
      where: { employeeId_workDate: { employeeId: item.employeeId, workDate } },
      create: { companyId, employeeId: item.employeeId, shiftId: item.shiftId, workDate, status: 'Scheduled' },
      update: { shiftId: item.shiftId, status: item.status || 'Scheduled' }
    });
    saved.push(row);
  }
  res.json({ success: true, data: saved });
});

exports.listLoans = wrap(async (req, res, companyId) => {
  const mine = await findMine(req, companyId);
  const where = { companyId };
  if (!canManageHr(req.user)) {
    if (!mine) return res.status(404).json({ success: false, message: 'Employee profile not found' });
    where.employeeId = mine.id;
  }
  const rows = await prisma.hrLoan.findMany({
    where,
    include: { employee: { include: EMP } },
    orderBy: { createdAt: 'desc' }
  });
  res.json({
    success: true,
    data: rows.map((r) => ({ ...r, employee: fullName(r.employee?.user) }))
  });
});

exports.saveLoan = wrap(async (req, res, companyId) => {
  const mine = await findMine(req, companyId);
  const employeeId = canManageHr(req.user) && req.body.employeeId ? req.body.employeeId : mine?.id;
  if (!employeeId) return res.status(404).json({ success: false, message: 'Employee profile not found' });
  const amount = Number(req.body.amount || 0);
  const installments = Math.max(1, Number(req.body.installments || 1));
  const row = await prisma.hrLoan.create({
    data: {
      companyId,
      employeeId,
      kind: String(req.body.kind || 'loan'),
      amount,
      installments,
      remaining: amount,
      monthlyDeduct: amount / installments,
      reason: String(req.body.reason || ''),
      status: 'Pending'
    }
  });
  await prisma.hrApproval.create({
    data: {
      companyId,
      module: 'loan',
      recordId: row.id,
      title: `${row.kind} request · ${amount}`,
      requestedBy: String(req.user.id || ''),
      status: 'Pending'
    }
  });
  res.json({ success: true, data: row });
});

exports.updateLoan = wrap(async (req, res, companyId) => {
  if (!requireHrManager(req, res)) return;
  const row = await prisma.hrLoan.update({
    where: { id: req.params.id },
    data: { status: String(req.body.status || 'Pending') }
  });
  await writeAudit(companyId, req.user.id, 'loan', 'loan', row.id, row.status);
  res.json({ success: true, data: row });
});

async function loadSettings(companyId) {
  const row = await prisma.hrSetting.findUnique({ where: { companyId } });
  return { salesCommissionPct: 5, noSaleCutAmount: 0, ...(row?.payload || {}) };
}

exports.listBonuses = wrap(async (req, res, companyId) => {
  if (!requireHrManager(req, res)) return;
  const rows = await prisma.hrBonus.findMany({
    where: { companyId },
    include: { employee: { include: EMP } },
    orderBy: { createdAt: 'desc' }
  });
  res.json({
    success: true,
    data: rows.map((r) => ({ ...r, employee: fullName(r.employee?.user) }))
  });
});

exports.saveBonus = wrap(async (req, res, companyId) => {
  if (!requireHrManager(req, res)) return;
  if (!req.body.employeeId) return res.status(400).json({ success: false, message: 'Employee is required' });
  const kind = String(req.body.kind || 'performance');
  const salesAmount = Number(req.body.salesAmount || 0);
  let amount = Number(req.body.amount || 0);
  let reason = String(req.body.reason || '');

  // Sales flow: enter sales total → commission = sales × settings %
  if ((kind === 'sales' || kind === 'commission') && salesAmount > 0) {
    const settings = await loadSettings(companyId);
    const pct = Number(settings.salesCommissionPct || 5);
    if (!(amount > 0)) amount = Math.round(((salesAmount * pct) / 100) * 100) / 100;
    reason = JSON.stringify({
      salesAmount,
      commissionPct: pct,
      note: reason || ''
    });
  }

  const row = await prisma.hrBonus.create({
    data: {
      companyId,
      employeeId: req.body.employeeId,
      kind,
      amount,
      period: String(req.body.period || ''),
      reason,
      status: 'Pending'
    }
  });
  res.json({ success: true, data: row });
});

exports.updateBonus = wrap(async (req, res, companyId) => {
  if (!requireHrManager(req, res)) return;
  const row = await prisma.hrBonus.update({
    where: { id: req.params.id },
    data: { status: String(req.body.status || 'Pending') }
  });
  res.json({ success: true, data: row });
});

exports.listDocuments = wrap(async (req, res, companyId) => {
  const mine = await findMine(req, companyId);
  const where = { companyId };
  if (!canManageHr(req.user)) {
    if (!mine) return res.status(404).json({ success: false, message: 'Employee profile not found' });
    where.OR = [{ employeeId: mine.id }, { employeeId: null }];
  } else if (req.query.employeeId) {
    where.employeeId = req.query.employeeId;
  }
  const rows = await prisma.hrDocument.findMany({
    where,
    include: { employee: { include: EMP } },
    orderBy: { createdAt: 'desc' }
  });
  res.json({
    success: true,
    data: rows.map((r) => ({
      ...r,
      expiresAt: ymd(r.expiresAt),
      employee: r.employee ? fullName(r.employee.user) : 'Company'
    }))
  });
});

exports.saveDocument = wrap(async (req, res, companyId) => {
  if (!requireHrManager(req, res)) return;
  if (!req.body.title) return res.status(400).json({ success: false, message: 'Title is required' });
  const row = await prisma.hrDocument.create({
    data: {
      companyId,
      employeeId: req.body.employeeId || null,
      title: String(req.body.title),
      category: String(req.body.category || 'HR'),
      reference: String(req.body.reference || ''),
      expiresAt: asDate(req.body.expiresAt)
    }
  });
  res.json({ success: true, data: row });
});

exports.listLifecycle = wrap(async (req, res, companyId) => {
  if (!requireHrManager(req, res)) return;
  const where = { companyId };
  if (req.query.employeeId) where.employeeId = req.query.employeeId;
  const rows = await prisma.hrLifecycleEvent.findMany({
    where,
    include: { employee: { include: EMP } },
    orderBy: { createdAt: 'desc' },
    take: 200
  });
  res.json({
    success: true,
    data: rows.map((r) => ({
      ...r,
      effective: ymd(r.effective),
      employee: fullName(r.employee?.user)
    }))
  });
});

exports.saveLifecycle = wrap(async (req, res, companyId) => {
  if (!requireHrManager(req, res)) return;
  if (!req.body.employeeId || !req.body.type) {
    return res.status(400).json({ success: false, message: 'Employee and event type are required' });
  }
  const employee = await prisma.hrEmployee.findFirst({
    where: { id: req.body.employeeId, companyId }
  });
  if (!employee) return res.status(404).json({ success: false, message: 'Employee not found' });

  const type = String(req.body.type);
  const toValue = String(req.body.toValue || '');
  const patch = {};
  if (type === 'transfer_department' && toValue) patch.department = toValue;
  if (type === 'transfer_branch' && req.body.officeId) patch.officeId = req.body.officeId;
  if (type === 'promotion' && toValue) patch.designation = toValue;
  if (type === 'salary_revision' && req.body.salary != null) patch.salary = Number(req.body.salary);
  if (type === 'resignation' || type === 'termination') patch.status = 'terminated';
  if (type === 'onboarding') patch.status = 'active';

  const event = await prisma.$transaction(async (tx) => {
    if (Object.keys(patch).length) {
      await tx.hrEmployee.update({ where: { id: employee.id }, data: patch });
    }
    return tx.hrLifecycleEvent.create({
      data: {
        companyId,
        employeeId: employee.id,
        type,
        fromValue: String(req.body.fromValue || ''),
        toValue,
        effective: asDate(req.body.effective) || workDateKey(),
        notes: String(req.body.notes || ''),
        status: 'Completed'
      }
    });
  });
  await writeAudit(companyId, req.user.id, type, 'employee', employee.id, toValue);
  res.json({ success: true, data: event });
});

exports.employeeDossier = wrap(async (req, res, companyId) => {
  const employee = await prisma.hrEmployee.findFirst({
    where: { id: req.params.id, companyId },
    include: {
      user: { select: { firstName: true, lastName: true, email: true, phone: true } },
      office: true,
      manager: { include: EMP }
    }
  });
  if (!employee) return res.status(404).json({ success: false, message: 'Employee not found' });
  const mine = await findMine(req, companyId);
  const isSelf = mine?.id === employee.id;
  if (!isSelf && !canManageHr(req.user)) {
    return res.status(403).json({ success: false, message: 'Not allowed' });
  }
  const [attendance, leaves, payrolls, reviews, tasks, events, goals, feedbacks, documents, balances] = await Promise.all([
    prisma.hrAttendance.findMany({ where: { employeeId: employee.id }, orderBy: { workDate: 'desc' }, take: 40 }),
    prisma.hrLeave.findMany({ where: { employeeId: employee.id }, orderBy: { createdAt: 'desc' }, take: 20 }),
    prisma.hrPayrollItem.findMany({ where: { employeeId: employee.id, status: { in: ['Approved', 'Paid'] } }, orderBy: { period: 'desc' }, take: 12 }),
    prisma.hrPerformanceReview.findMany({ where: { employeeId: employee.id }, orderBy: { createdAt: 'desc' }, take: 10 }),
    prisma.hrTask.findMany({ where: { employeeId: employee.id }, orderBy: { createdAt: 'desc' }, take: 20 }),
    prisma.hrLifecycleEvent.findMany({ where: { employeeId: employee.id }, orderBy: { createdAt: 'desc' }, take: 20 }),
    prisma.hrGoal.findMany({ where: { employeeId: employee.id }, orderBy: { createdAt: 'desc' } }),
    prisma.hrFeedback.findMany({ where: { employeeId: employee.id }, orderBy: { createdAt: 'desc' } }),
    prisma.hrDocument.findMany({ where: { employeeId: employee.id }, orderBy: { createdAt: 'desc' } }),
    balancesFor(companyId, employee.id)
  ]);
  const salaryVisible = canViewSalary(req.user) || isSelf;
  res.json({
    success: true,
    data: {
      id: employee.id,
      employeeCode: employee.employeeCode,
      name: fullName(employee.user),
      email: employee.user?.email,
      phone: employee.phone,
      department: employee.department,
      designation: employee.designation,
      position: employee.position,
      costCenter: employee.costCenter,
      office: employee.office?.name,
      officeId: employee.officeId,
      managerId: employee.managerId,
      manager: employee.manager ? fullName(employee.manager.user) : '',
      employmentType: employee.employmentType,
      employeeType: employee.employeeType,
      shift: employee.shiftLabel,
      joiningDate: employee.joiningDate,
      status: employee.status,
      trackingEnabled: employee.trackingEnabled,
      profile: employee.profile || {},
      salary: salaryVisible ? employee.salary : null,
      payBasis:
        (employee.profile && typeof employee.profile === 'object' && employee.profile.payBasis) ||
        'monthly',
      attendance: attendance.map((r) => ({ ...r, workDate: ymd(r.workDate) })),
      leaves: leaves.map((r) => ({ ...r, from: ymd(r.fromDate), to: ymd(r.toDate) })),
      payrolls: salaryVisible ? payrolls : [],
      reviews,
      tasks,
      lifecycle: events.map((r) => ({ ...r, effective: ymd(r.effective) })),
      goals,
      feedbacks,
      documents: documents.map((r) => ({ ...r, expiresAt: ymd(r.expiresAt) })),
      leaveBalances: balances
    }
  });
});

exports.updateProfile = wrap(async (req, res, companyId) => {
  const employee = await prisma.hrEmployee.findFirst({ where: { id: req.params.id, companyId } });
  if (!employee) return res.status(404).json({ success: false, message: 'Employee not found' });
  const mine = await findMine(req, companyId);
  const isSelf = mine?.id === employee.id;
  if (!isSelf && !requireHrManager(req, res)) return;
  const data = {};
  if (canManageHr(req.user)) {
    ['department', 'designation', 'position', 'costCenter', 'shiftLabel', 'employmentType', 'employeeType', 'phone', 'managerId'].forEach((k) => {
      if (req.body[k] !== undefined) data[k] = req.body[k];
    });
    if (req.body.trackingEnabled != null) data.trackingEnabled = Boolean(req.body.trackingEnabled);
    if (req.body.officeId !== undefined) data.officeId = req.body.officeId || null;
    if (req.body.salary != null && canViewSalary(req.user)) data.salary = Number(req.body.salary);
  }
  if (req.body.profile && typeof req.body.profile === 'object') {
    data.profile = { ...(employee.profile && typeof employee.profile === 'object' ? employee.profile : {}), ...req.body.profile };
  }
  const row = await prisma.hrEmployee.update({ where: { id: employee.id }, data });
  await writeAudit(companyId, req.user.id, 'update', 'employee', row.id, 'profile');
  res.json({ success: true, data: { id: row.id } });
});

exports.listApprovals = wrap(async (req, res, companyId) => {
  if (!requireHrManager(req, res)) return;
  const rows = await prisma.hrApproval.findMany({
    where: { companyId, ...(req.query.status ? { status: String(req.query.status) } : {}) },
    orderBy: { createdAt: 'desc' },
    take: 200
  });
  res.json({
    success: true,
    data: rows.map((r) => ({
      ...r,
      module: r.module || 'HR',
      title: r.title || 'Approval request',
      employee: r.requestedBy || '',
      createdAt: r.createdAt
    }))
  });
});

exports.updateApproval = wrap(async (req, res, companyId) => {
  if (!requireHrManager(req, res)) return;
  const row = await prisma.hrApproval.update({
    where: { id: req.params.id },
    data: { status: String(req.body.status || 'Pending') }
  });
  res.json({ success: true, data: row });
});

exports.listGoals = wrap(async (req, res, companyId) => {
  const mine = await findMine(req, companyId);
  const where = { companyId };
  if (!canManageHr(req.user)) {
    if (!mine) return res.status(404).json({ success: false, message: 'Employee profile not found' });
    where.employeeId = mine.id;
  } else if (req.query.employeeId) where.employeeId = req.query.employeeId;
  const rows = await prisma.hrGoal.findMany({ where, include: { employee: { include: EMP } }, orderBy: { createdAt: 'desc' } });
  res.json({ success: true, data: rows.map((r) => ({ ...r, employee: fullName(r.employee?.user) })) });
});

exports.saveGoal = wrap(async (req, res, companyId) => {
  if (!requireHrManager(req, res)) return;
  const row = await prisma.hrGoal.create({
    data: {
      companyId,
      employeeId: req.body.employeeId,
      title: String(req.body.title || ''),
      kpi: String(req.body.kpi || ''),
      weight: Number(req.body.weight || 0),
      target: String(req.body.target || ''),
      cycle: String(req.body.cycle || ''),
      status: 'Open'
    }
  });
  res.json({ success: true, data: row });
});

exports.listFeedback = wrap(async (req, res, companyId) => {
  const mine = await findMine(req, companyId);
  const where = { companyId };
  if (!canManageHr(req.user)) {
    if (!mine) return res.status(404).json({ success: false, message: 'Employee profile not found' });
    where.employeeId = mine.id;
  } else if (req.query.employeeId) where.employeeId = req.query.employeeId;
  const rows = await prisma.hrFeedback.findMany({ where, orderBy: { createdAt: 'desc' } });
  res.json({ success: true, data: rows });
});

exports.saveFeedback = wrap(async (req, res, companyId) => {
  const row = await prisma.hrFeedback.create({
    data: {
      companyId,
      employeeId: req.body.employeeId,
      reviewerName: String(req.body.reviewerName || fullName(req.user)),
      relation: String(req.body.relation || 'manager'),
      score: Number(req.body.score || 0),
      comments: String(req.body.comments || ''),
      cycle: String(req.body.cycle || '')
    }
  });
  res.json({ success: true, data: row });
});

exports.myEss = wrap(async (req, res, companyId) => {
  const mine = await findMine(req, companyId);
  if (!mine) return res.status(404).json({ success: false, message: 'Employee profile not found' });
  const today = workDateKey();
  const [attendance, leaves, balances, roster, tasks, holidays, overtime] = await Promise.all([
    prisma.hrAttendance.findUnique({ where: { employeeId_workDate: { employeeId: mine.id, workDate: today } } }),
    prisma.hrLeave.findMany({ where: { employeeId: mine.id }, orderBy: { createdAt: 'desc' }, take: 8 }),
    balancesFor(companyId, mine.id),
    prisma.hrRoster.findMany({
      where: { employeeId: mine.id, workDate: { gte: today } },
      include: { shift: true },
      take: 14,
      orderBy: { workDate: 'asc' }
    }),
    prisma.hrTask.findMany({ where: { employeeId: mine.id }, orderBy: { createdAt: 'desc' }, take: 10 }),
    prisma.hrHoliday.findMany({
      where: { companyId, date: { gte: today } },
      orderBy: { date: 'asc' },
      take: 12
    }),
    prisma.hrOvertime.findMany({ where: { employeeId: mine.id }, orderBy: { createdAt: 'desc' }, take: 8 })
  ]);
  res.json({
    success: true,
    data: {
      employee: {
        id: mine.id,
        name: fullName(mine.user),
        department: mine.department,
        designation: mine.designation,
        trackingEnabled: mine.trackingEnabled
      },
      attendance,
      leaves: leaves.map((r) => ({ ...r, from: ymd(r.fromDate), to: ymd(r.toDate) })),
      leaveBalances: balances,
      roster: roster.map((r) => ({ ...r, workDate: ymd(r.workDate), shift: r.shift?.name })),
      tasks,
      holidays: holidays.map((r) => ({ ...r, date: ymd(r.date) })),
      overtime
    }
  });
});

exports.myTeam = wrap(async (req, res, companyId) => {
  if (!requireHrManager(req, res)) return;
  const mine = await findMine(req, companyId);
  const reports = mine
    ? await prisma.hrEmployee.findMany({
        where: { companyId, managerId: mine.id, status: { not: 'terminated' } },
        include: EMP
      })
    : [];
  const scope = reports.length ? reports : await prisma.hrEmployee.findMany({
    where: { companyId, status: { not: 'terminated' } },
    include: EMP,
    take: 50
  });
  const ids = scope.map((e) => e.id);
  const today = workDateKey();
  const [attendance, pendingLeaves, pendingOt, pendingCorr] = await Promise.all([
    prisma.hrAttendance.findMany({ where: { companyId, workDate: today, employeeId: { in: ids } } }),
    prisma.hrLeave.findMany({ where: { companyId, status: 'Pending', employeeId: { in: ids } }, include: { employee: { include: EMP } } }),
    prisma.hrOvertime.findMany({ where: { companyId, status: 'Pending', employeeId: { in: ids } }, include: { employee: { include: EMP } } }),
    prisma.hrAttendanceCorrection.findMany({ where: { companyId, status: 'Pending', employeeId: { in: ids } }, include: { employee: { include: EMP } } })
  ]);
  const att = new Map(attendance.map((r) => [r.employeeId, r]));
  res.json({
    success: true,
    data: {
      scopedToReports: reports.length > 0,
      members: scope.map((e) => ({
        id: e.id,
        name: fullName(e.user),
        department: e.department,
        designation: e.designation,
        attendance: att.get(e.id) || null
      })),
      approvals: {
        leaves: pendingLeaves.map((r) => ({ id: r.id, employee: fullName(r.employee?.user), type: r.type, from: ymd(r.fromDate), to: ymd(r.toDate) })),
        overtime: pendingOt.map((r) => ({ id: r.id, employee: fullName(r.employee?.user), hours: r.hours, date: ymd(r.workDate) })),
        attendance: pendingCorr.map((r) => ({ id: r.id, employee: fullName(r.employee?.user), workDate: ymd(r.workDate), reason: r.reason }))
      }
    }
  });
});

exports.analytics = wrap(async (req, res, companyId) => {
  if (!requireHrManager(req, res)) return;
  const now = new Date();
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const [employees, joiners, exits, overtime, leaves, payroll] = await Promise.all([
    prisma.hrEmployee.findMany({ where: { companyId }, select: { status: true, department: true, officeId: true, joiningDate: true } }),
    prisma.hrEmployee.count({ where: { companyId, joiningDate: { gte: monthStart } } }),
    prisma.hrLifecycleEvent.count({ where: { companyId, type: { in: ['resignation', 'termination'] }, createdAt: { gte: monthStart } } }),
    prisma.hrOvertime.aggregate({ where: { companyId, status: 'Approved', workDate: { gte: monthStart } }, _sum: { hours: true, amount: true } }),
    prisma.hrLeave.findMany({ where: { companyId, status: 'Approved', fromDate: { gte: monthStart } }, select: { days: true } }),
    prisma.hrPayrollItem.aggregate({
      where: { companyId, period: `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}` },
      _sum: { net: true }
    })
  ]);
  const active = employees.filter((e) => e.status !== 'terminated');
  const dept = {};
  active.forEach((e) => {
    const k = e.department || 'Unassigned';
    dept[k] = (dept[k] || 0) + 1;
  });
  res.json({
    success: true,
    data: {
      total: employees.length,
      active: active.length,
      newJoiners: joiners,
      exits,
      overtimeHours: overtime._sum.hours || 0,
      overtimeCost: overtime._sum.amount || 0,
      leaveDays: leaves.reduce((s, r) => s + Number(r.days || 0), 0),
      payrollCost: canViewSalary(req.user) ? payroll._sum.net || 0 : null,
      departments: Object.entries(dept).map(([name, count]) => ({ name, count }))
    }
  });
});

exports.listAudit = wrap(async (req, res, companyId) => {
  if (!requireHrManager(req, res)) return;
  const rows = await prisma.hrAuditLog.findMany({
    where: { companyId },
    orderBy: { createdAt: 'desc' },
    take: 100
  });
  res.json({ success: true, data: rows });
});
