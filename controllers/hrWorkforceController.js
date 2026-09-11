'use strict';

const prisma = require('../prisma/client');
const {
  requireCompany,
  requireHrManager,
  canManageHr,
  workDateKey
} = require('../utils/hrAccess');
const payrollEngine = require('../services/hrPayrollEngine');

const EMP_MIN = {
  user: { select: { firstName: true, lastName: true, email: true } }
};

const PAYROLL_INCLUDE = {
  employee: {
    include: {
      user: { select: { firstName: true, lastName: true, email: true } },
      office: { select: { name: true } }
    }
  }
};

function fullName(user) {
  return [user?.firstName, user?.lastName].filter(Boolean).join(' ').trim() || 'Employee';
}

function ymd(value) {
  if (!value) return '';
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}/.test(value)) {
    return value.slice(0, 10);
  }
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  return d.toISOString().slice(0, 10);
}

function asDate(value) {
  const key = ymd(value);
  return key ? new Date(`${key}T00:00:00.000Z`) : null;
}

function daysBetween(from, to) {
  const a = asDate(from);
  const b = asDate(to);
  if (!a || !b) return 1;
  return Math.max(1, Math.round((b.getTime() - a.getTime()) / 86400000) + 1);
}

function money(n) {
  return Math.round(Number(n || 0) * 100) / 100;
}

const DEFAULT_SETTINGS = {
  geofence: true,
  autoCheckout: true,
  lateAlerts: true,
  faceId: false,
  weeklyReports: false,
  workHoursPerDay: 8,
  workDaysPerWeek: 6,
  overtimeMultiplier: 1.5,
  annualLeaveQuota: 14,
  basicPct: 60,
  housePct: 25,
  transportPct: 10,
  medicalPct: 5,
  taxPct: 0,
  eobiPct: 1,
  pfPct: 0,
  /** Rs deducted per late day (auto on Salary build) */
  lateDeductionPerDay: 0,
  /**
   * Absent / unpaid day cut:
   * - daily_rate: package / workingDays × absent days
   * - fixed: absentDeductionPerDay × absent days
   */
  absentDeductionMode: 'daily_rate',
  absentDeductionPerDay: 0,
  /** Half-day counts as this fraction of a full-day cut (0–100) */
  halfDayDeductionPct: 50,
  graceMinutes: 15,
  lateThresholdMinutes: 15,
  earlyCheckoutMinutes: 30,
  minimumWorkingHours: 8,
  halfDayHours: 4,
  overtimeEligibility: true,
  /** % of employee sales → payroll commission */
  salesCommissionPct: 5,
  /** If sales staff has 0 sales in period, deduct this (Rs) */
  noSaleCutAmount: 0,
  /** Apply no-sale cut only to these employee types (comma / any match) */
  noSaleCutRoles: 'Salesman,sales,Field Employee'
};

async function findEmployeeForUser(userId, companyId) {
  if (!userId) return null;
  return prisma.hrEmployee.findFirst({
    where: { userId: String(userId), companyId },
    include: EMP_MIN
  });
}

function serializeLeave(row) {
  return {
    id: row.id,
    employeeId: row.employeeId,
    employee: fullName(row.employee?.user),
    employeeCode: row.employee?.employeeCode || '',
    type: row.type,
    from: ymd(row.fromDate),
    to: ymd(row.toDate),
    days: row.days,
    reason: row.reason,
    status: row.status,
    createdAt: row.createdAt
  };
}

function serializeOvertime(row) {
  return {
    id: row.id,
    employeeId: row.employeeId,
    employee: fullName(row.employee?.user),
    date: ymd(row.workDate),
    hours: row.hours,
    rate: row.rate,
    amount: row.amount,
    reason: row.reason,
    status: row.status
  };
}

function serializeTask(row) {
  return {
    id: row.id,
    employeeId: row.employeeId,
    title: row.title,
    assignedTo: row.employee ? fullName(row.employee.user) : 'Unassigned',
    due: ymd(row.dueDate) || '',
    priority: row.priority,
    status: row.status
  };
}

function serializeReview(row) {
  return {
    id: row.id,
    employeeId: row.employeeId,
    employee: fullName(row.employee?.user),
    period: row.period,
    rating: row.rating,
    goals: row.goals,
    reviewer: row.reviewer,
    status: row.status
  };
}

function serializePayroll(row) {
  return payrollEngine.serializePayslip(row);
}

exports.listLeaves = async (req, res) => {
  try {
    const companyId = requireCompany(req, res);
    if (!companyId) return;
    if (!requireHrManager(req, res)) return;
    const rows = await prisma.hrLeave.findMany({
      where: { companyId },
      include: { employee: { include: EMP_MIN } },
      orderBy: { createdAt: 'desc' }
    });
    res.json({ success: true, data: rows.map(serializeLeave) });
  } catch (error) {
    console.error('[hr] listLeaves', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.myLeaves = async (req, res) => {
  try {
    const companyId = requireCompany(req, res);
    if (!companyId) return;
    const employee = await findEmployeeForUser(req.user.id || req.user._id, companyId);
    if (!employee) {
      return res.status(404).json({ success: false, message: 'Employee profile not found' });
    }
    const rows = await prisma.hrLeave.findMany({
      where: { companyId, employeeId: employee.id },
      include: { employee: { include: EMP_MIN } },
      orderBy: { createdAt: 'desc' }
    });
    res.json({ success: true, data: rows.map(serializeLeave) });
  } catch (error) {
    console.error('[hr] myLeaves', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.createLeave = async (req, res) => {
  try {
    const companyId = requireCompany(req, res);
    if (!companyId) return;

    let employeeId = req.body.employeeId;
    if (!employeeId) {
      const mine = await findEmployeeForUser(req.user.id || req.user._id, companyId);
      if (!mine) {
        return res.status(404).json({ success: false, message: 'Employee profile not found' });
      }
      employeeId = mine.id;
    } else if (!requireHrManager(req, res)) {
      return;
    }

    const fromDate = asDate(req.body.from || req.body.fromDate);
    const toDate = asDate(req.body.to || req.body.toDate) || fromDate;
    if (!fromDate) {
      return res.status(400).json({ success: false, message: 'Leave start date is required' });
    }

    const row = await prisma.hrLeave.create({
      data: {
        companyId,
        employeeId,
        type: String(req.body.type || 'Casual Leave'),
        fromDate,
        toDate,
        days: Number(req.body.days) || daysBetween(fromDate, toDate),
        reason: String(req.body.reason || ''),
        status: 'Pending',
        halfDay: Boolean(req.body.halfDay),
        hours: Number(req.body.hours || 0),
        leaveTypeId: req.body.leaveTypeId || null
      },
      include: { employee: { include: EMP_MIN } }
    });
    res.json({ success: true, data: serializeLeave(row) });
  } catch (error) {
    console.error('[hr] createLeave', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.updateLeave = async (req, res) => {
  try {
    const companyId = requireCompany(req, res);
    if (!companyId) return;
    if (!requireHrManager(req, res)) return;
    const status = String(req.body.status || '');
    if (!['Approved', 'Rejected', 'Pending'].includes(status)) {
      return res.status(400).json({ success: false, message: 'Invalid leave status' });
    }
    const existing = await prisma.hrLeave.findFirst({
      where: { id: req.params.id, companyId }
    });
    if (!existing) {
      return res.status(404).json({ success: false, message: 'Leave request not found' });
    }
    const row = await prisma.hrLeave.update({
      where: { id: existing.id },
      data: { status },
      include: { employee: { include: EMP_MIN } }
    });
    if (status === 'Approved') {
      await prisma.hrEmployee.update({
        where: { id: row.employeeId },
        data: { status: 'on_leave' }
      }).catch(() => {});
      if (existing.leaveTypeId) {
        const year = existing.fromDate ? new Date(existing.fromDate).getUTCFullYear() : new Date().getFullYear();
        await prisma.hrLeaveBalance.updateMany({
          where: {
            employeeId: existing.employeeId,
            leaveTypeId: existing.leaveTypeId,
            year
          },
          data: { used: { increment: Number(existing.days || 0) } }
        }).catch(() => {});
      }
    }
    res.json({ success: true, data: serializeLeave(row) });
  } catch (error) {
    console.error('[hr] updateLeave', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.listOvertime = async (req, res) => {
  try {
    const companyId = requireCompany(req, res);
    if (!companyId) return;
    if (!requireHrManager(req, res)) return;
    const rows = await prisma.hrOvertime.findMany({
      where: { companyId },
      include: { employee: { include: EMP_MIN } },
      orderBy: { workDate: 'desc' }
    });
    res.json({ success: true, data: rows.map(serializeOvertime) });
  } catch (error) {
    console.error('[hr] listOvertime', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.createOvertime = async (req, res) => {
  try {
    const companyId = requireCompany(req, res);
    if (!companyId) return;
    let employeeId = String(req.body.employeeId || '');
    if (!canManageHr(req.user)) {
      const mine = await findEmployeeForUser(req.user.id || req.user._id, companyId);
      if (!mine) {
        return res.status(404).json({ success: false, message: 'Employee profile not found' });
      }
      employeeId = mine.id;
    } else if (!employeeId) {
      return res.status(400).json({ success: false, message: 'Employee and hours are required' });
    }
    const hours = Number(req.body.hours);
    if (!employeeId || !Number.isFinite(hours) || hours <= 0) {
      return res.status(400).json({ success: false, message: 'Employee and hours are required' });
    }
    const employee = await prisma.hrEmployee.findFirst({
      where: { id: employeeId, companyId }
    });
    if (!employee) {
      return res.status(404).json({ success: false, message: 'Employee not found' });
    }
    const settings = await loadSettings(companyId);
    const monthlyHours = Number(settings.workHoursPerDay || 8) * Number(settings.workDaysPerWeek || 6) * 4.33;
    const rate = employee.salary > 0
      ? money((employee.salary / Math.max(monthlyHours, 1)) * Number(settings.overtimeMultiplier || 1.5))
      : Number(req.body.rate || 0);
    const amount = money(hours * rate);
    const row = await prisma.hrOvertime.create({
      data: {
        companyId,
        employeeId,
        workDate: asDate(req.body.date || req.body.workDate) || workDateKey(),
        hours,
        rate,
        amount,
        reason: String(req.body.reason || ''),
        status: 'Pending'
      },
      include: { employee: { include: EMP_MIN } }
    });
    res.json({ success: true, data: serializeOvertime(row) });
  } catch (error) {
    console.error('[hr] createOvertime', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.updateOvertime = async (req, res) => {
  try {
    const companyId = requireCompany(req, res);
    if (!companyId) return;
    if (!requireHrManager(req, res)) return;
    const status = String(req.body.status || '');
    if (!['Approved', 'Rejected', 'Pending'].includes(status)) {
      return res.status(400).json({ success: false, message: 'Invalid overtime status' });
    }
    const existing = await prisma.hrOvertime.findFirst({
      where: { id: req.params.id, companyId }
    });
    if (!existing) {
      return res.status(404).json({ success: false, message: 'Overtime entry not found' });
    }
    const row = await prisma.hrOvertime.update({
      where: { id: existing.id },
      data: { status },
      include: { employee: { include: EMP_MIN } }
    });
    res.json({ success: true, data: serializeOvertime(row) });
  } catch (error) {
    console.error('[hr] updateOvertime', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.listTasks = async (req, res) => {
  try {
    const companyId = requireCompany(req, res);
    if (!companyId) return;
    if (!requireHrManager(req, res)) return;
    const rows = await prisma.hrTask.findMany({
      where: { companyId },
      include: { employee: { include: EMP_MIN } },
      orderBy: { createdAt: 'desc' }
    });
    res.json({ success: true, data: rows.map(serializeTask) });
  } catch (error) {
    console.error('[hr] listTasks', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.createTask = async (req, res) => {
  try {
    const companyId = requireCompany(req, res);
    if (!companyId) return;
    if (!requireHrManager(req, res)) return;
    const title = String(req.body.title || '').trim();
    if (!title) {
      return res.status(400).json({ success: false, message: 'Task title is required' });
    }
    const row = await prisma.hrTask.create({
      data: {
        companyId,
        title,
        employeeId: req.body.employeeId || null,
        dueDate: asDate(req.body.due || req.body.dueDate),
        priority: String(req.body.priority || 'Medium'),
        status: String(req.body.status || 'Pending')
      },
      include: { employee: { include: EMP_MIN } }
    });
    res.json({ success: true, data: serializeTask(row) });
  } catch (error) {
    console.error('[hr] createTask', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.updateTask = async (req, res) => {
  try {
    const companyId = requireCompany(req, res);
    if (!companyId) return;
    if (!requireHrManager(req, res)) return;
    const existing = await prisma.hrTask.findFirst({
      where: { id: req.params.id, companyId }
    });
    if (!existing) {
      return res.status(404).json({ success: false, message: 'Task not found' });
    }
    const row = await prisma.hrTask.update({
      where: { id: existing.id },
      data: {
        status: req.body.status != null ? String(req.body.status) : undefined,
        priority: req.body.priority != null ? String(req.body.priority) : undefined,
        title: req.body.title != null ? String(req.body.title) : undefined,
        employeeId: req.body.employeeId !== undefined ? req.body.employeeId || null : undefined,
        dueDate: req.body.due || req.body.dueDate ? asDate(req.body.due || req.body.dueDate) : undefined
      },
      include: { employee: { include: EMP_MIN } }
    });
    res.json({ success: true, data: serializeTask(row) });
  } catch (error) {
    console.error('[hr] updateTask', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.listReviews = async (req, res) => {
  try {
    const companyId = requireCompany(req, res);
    if (!companyId) return;
    if (!requireHrManager(req, res)) return;
    const rows = await prisma.hrPerformanceReview.findMany({
      where: { companyId },
      include: { employee: { include: EMP_MIN } },
      orderBy: { createdAt: 'desc' }
    });
    res.json({ success: true, data: rows.map(serializeReview) });
  } catch (error) {
    console.error('[hr] listReviews', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.createReview = async (req, res) => {
  try {
    const companyId = requireCompany(req, res);
    if (!companyId) return;
    if (!requireHrManager(req, res)) return;
    const employeeId = String(req.body.employeeId || '');
    if (!employeeId) {
      return res.status(400).json({ success: false, message: 'Employee is required' });
    }
    const now = new Date();
    const period = String(req.body.period || `${now.getFullYear()}-H${now.getMonth() < 6 ? 1 : 2}`);
    const row = await prisma.hrPerformanceReview.create({
      data: {
        companyId,
        employeeId,
        period,
        rating: Number(req.body.rating || 0),
        goals: String(req.body.goals || ''),
        reviewer: String(req.body.reviewer || req.user?.firstName || 'HR'),
        status: String(req.body.status || 'Pending')
      },
      include: { employee: { include: EMP_MIN } }
    });
    res.json({ success: true, data: serializeReview(row) });
  } catch (error) {
    console.error('[hr] createReview', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.updateReview = async (req, res) => {
  try {
    const companyId = requireCompany(req, res);
    if (!companyId) return;
    if (!requireHrManager(req, res)) return;
    const existing = await prisma.hrPerformanceReview.findFirst({
      where: { id: req.params.id, companyId }
    });
    if (!existing) {
      return res.status(404).json({ success: false, message: 'Review not found' });
    }
    const row = await prisma.hrPerformanceReview.update({
      where: { id: existing.id },
      data: {
        rating: req.body.rating != null ? Number(req.body.rating) : undefined,
        goals: req.body.goals != null ? String(req.body.goals) : undefined,
        reviewer: req.body.reviewer != null ? String(req.body.reviewer) : undefined,
        status: req.body.status != null ? String(req.body.status) : undefined
      },
      include: { employee: { include: EMP_MIN } }
    });
    res.json({ success: true, data: serializeReview(row) });
  } catch (error) {
    console.error('[hr] updateReview', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.listPayroll = async (req, res) => {
  try {
    const companyId = requireCompany(req, res);
    if (!companyId) return;
    if (!requireHrManager(req, res)) return;
    const period = String(req.query.period || payrollEngine.currentPeriod());
    const rows = await prisma.hrPayrollItem.findMany({
      where: { companyId, period },
      include: PAYROLL_INCLUDE,
      orderBy: { createdAt: 'desc' }
    });
    const data = rows.map(serializePayroll);
    const summary = payrollEngine.runSummary(data);
    const prevPeriod = payrollEngine.previousPeriod(period);
    const prevRows = await prisma.hrPayrollItem.findMany({
      where: { companyId, period: prevPeriod }
    });
    const previousNet = payrollEngine.money(prevRows.reduce((s, r) => s + Number(r.net || 0), 0));
    res.json({
      success: true,
      data,
      period,
      periodLabel: payrollEngine.periodLabel(period),
      summary: {
        ...summary,
        previousPeriod: prevPeriod,
        previousNet,
        variance: payrollEngine.money(summary.net - previousNet)
      }
    });
  } catch (error) {
    console.error('[hr] listPayroll', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.myPayroll = async (req, res) => {
  try {
    const companyId = requireCompany(req, res);
    if (!companyId) return;
    const employee = await findEmployeeForUser(req.user.id || req.user._id, companyId);
    if (!employee) {
      return res.status(404).json({ success: false, message: 'Employee profile not found' });
    }
    const rows = await prisma.hrPayrollItem.findMany({
      where: {
        companyId,
        employeeId: employee.id,
        status: { in: ['Approved', 'Paid'] }
      },
      include: PAYROLL_INCLUDE,
      orderBy: { period: 'desc' }
    });
    const data = rows.map(serializePayroll);
    const year = String(new Date().getFullYear());
    const settings = await loadSettings(companyId);
    const ytd = payrollEngine.ytdFromSlips(data, year);
    res.json({
      success: true,
      data,
      year,
      ytd,
      ytdNet: ytd.net,
      compensation: payrollEngine.compensationPreview(employee, settings)
    });
  } catch (error) {
    console.error('[hr] myPayroll', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.getPayroll = async (req, res) => {
  try {
    const companyId = requireCompany(req, res);
    if (!companyId) return;
    const row = await prisma.hrPayrollItem.findFirst({
      where: { id: req.params.id, companyId },
      include: PAYROLL_INCLUDE
    });
    if (!row) {
      return res.status(404).json({ success: false, message: 'Payslip not found' });
    }
    const mine = await findEmployeeForUser(req.user.id || req.user._id, companyId);
    const isHr = canManageHr(req.user);
    if (!isHr) {
      if (!mine || mine.id !== row.employeeId || !['Approved', 'Paid'].includes(row.status)) {
        return res.status(403).json({ success: false, message: 'Payslip is not available' });
      }
    }
    res.json({ success: true, data: serializePayroll(row) });
  } catch (error) {
    console.error('[hr] getPayroll', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.generatePayroll = async (req, res) => {
  try {
    const companyId = requireCompany(req, res);
    if (!companyId) return;
    if (!requireHrManager(req, res)) return;
    const period = String(req.body.period || payrollEngine.currentPeriod());
    const { start, endExclusive } = payrollEngine.periodBounds(period);
    const settings = await loadSettings(companyId);
    let employees = await prisma.hrEmployee.findMany({
      where: {
        companyId,
        status: { notIn: ['terminated', 'inactive'] }
      },
      include: {
        user: { select: { firstName: true, lastName: true, email: true } },
        office: { select: { name: true } }
      }
    });
    const mode = String(req.body.mode || 'all').toLowerCase(); // all | sales | office
    if (mode === 'sales') {
      employees = employees.filter((e) => payrollEngine.isSalesRoleEmployee(e, settings));
    } else if (mode === 'office') {
      employees = employees.filter((e) => !payrollEngine.isSalesRoleEmployee(e, settings));
    }
    if (!employees.length) {
      return res.status(400).json({
        success: false,
        message:
          mode === 'sales'
            ? 'No sales staff found. Set employee type to Salesman / Field Employee first.'
            : 'No active employees found. Add employees first.'
      });
    }
    const [overtime, attendance, leaves, existing, loans, bonuses] = await Promise.all([
      prisma.hrOvertime.findMany({
        where: {
          companyId,
          status: 'Approved',
          workDate: { gte: start, lt: endExclusive }
        }
      }),
      prisma.hrAttendance.findMany({
        where: { companyId, workDate: { gte: start, lt: endExclusive } }
      }),
      prisma.hrLeave.findMany({
        where: {
          companyId,
          status: 'Approved',
          fromDate: { lte: endExclusive },
          toDate: { gte: start }
        }
      }),
      prisma.hrPayrollItem.findMany({ where: { companyId, period } }),
      prisma.hrLoan.findMany({ where: { companyId, status: 'Approved' } }),
      prisma.hrBonus.findMany({ where: { companyId, status: 'Approved', period } })
    ]);

    const existingByEmp = new Map(existing.map((r) => [r.employeeId, r]));
    const otAmount = new Map();
    const otHours = new Map();
    overtime.forEach((row) => {
      otAmount.set(row.employeeId, (otAmount.get(row.employeeId) || 0) + Number(row.amount || 0));
      otHours.set(row.employeeId, (otHours.get(row.employeeId) || 0) + Number(row.hours || 0));
    });
    const attByEmp = new Map();
    attendance.forEach((row) => {
      if (!attByEmp.has(row.employeeId)) attByEmp.set(row.employeeId, []);
      attByEmp.get(row.employeeId).push(row);
    });
    const leaveByEmp = new Map();
    leaves.forEach((row) => {
      if (!leaveByEmp.has(row.employeeId)) leaveByEmp.set(row.employeeId, []);
      leaveByEmp.get(row.employeeId).push(row);
    });
    const loanByEmp = new Map();
    loans.forEach((row) => {
      // Only deduct if loan has remaining balance > 0
      if (Number(row.remaining || 0) > 0) {
        const installment = Math.min(Number(row.monthlyDeduct || 0), Number(row.remaining || 0));
        loanByEmp.set(row.employeeId, (loanByEmp.get(row.employeeId) || 0) + installment);
      }
    });
    const bonusByEmp = new Map();
    const commissionByEmp = new Map();
    const salesByEmp = new Map();

    const parseSalesFromReason = (reason) => {
      const raw = String(reason || '');
      try {
        const j = JSON.parse(raw);
        if (j && j.salesAmount != null) return Number(j.salesAmount) || 0;
      } catch {
        /* plain text */
      }
      const m = raw.match(/sales\s*[:=]\s*([\d.]+)/i);
      return m ? Number(m[1]) || 0 : 0;
    };

    bonuses.forEach((row) => {
      const kind = String(row.kind || '').toLowerCase();
      const amt = Number(row.amount || 0);
      const salesPart = parseSalesFromReason(row.reason);
      if (salesPart > 0) {
        salesByEmp.set(row.employeeId, (salesByEmp.get(row.employeeId) || 0) + salesPart);
      }
      if (kind === 'sales' || kind === 'commission' || kind.includes('commission')) {
        // amount = commission; if only sales logged with amount 0, engine will derive from %
        if (amt > 0) {
          commissionByEmp.set(row.employeeId, (commissionByEmp.get(row.employeeId) || 0) + amt);
        }
      } else {
        bonusByEmp.set(row.employeeId, (bonusByEmp.get(row.employeeId) || 0) + amt);
      }
    });

    // Auto sales from Orders linked to employee userId / name
    try {
      const userIds = employees.map((e) => e.userId).filter(Boolean);
      if (userIds.length && prisma.order) {
        const orders = await prisma.order.findMany({
          where: {
            companyId,
            orderDate: { gte: start, lt: endExclusive },
            salesPersonId: { in: userIds },
            orderStatus: { notIn: ['Cancelled', 'canceled', 'Void'] },
            isDeleted: false
          },
          select: { salesPersonId: true, grandTotal: true }
        });
        const empByUser = new Map(employees.map((e) => [e.userId, e.id]));
        orders.forEach((o) => {
          const empId = empByUser.get(o.salesPersonId);
          if (!empId) return;
          salesByEmp.set(empId, (salesByEmp.get(empId) || 0) + Number(o.grandTotal || 0));
        });
      }
    } catch (e) {
      console.warn('[hr] sales orders lookup skipped', e.message);
    }

    const items = [];
    for (const emp of employees) {
      const prev = existingByEmp.get(emp.id);
      if (prev && ['Paid', 'Approved', 'Held'].includes(prev.status) && req.body.force !== true) {
        items.push(serializePayroll({ ...prev, employee: emp }));
        continue;
      }
      const prevBreak = prev?.breakdown && typeof prev.breakdown === 'object' ? prev.breakdown : {};
      // Keep HR full-manual slips intact on bulk recalculate (unless force)
      if (prev && prevBreak.hrManual === true && req.body.force !== true && req.body.keepManual !== false) {
        items.push(serializePayroll({ ...prev, employee: emp }));
        continue;
      }
      const keep = req.body.keepAdjustments !== false;
      const salesAmount = Number(
        keep && prevBreak.salesAmount != null && prevBreak.hrManual
          ? prevBreak.salesAmount
          : salesByEmp.get(emp.id) || prevBreak.salesAmount || 0
      );
      const slip = payrollEngine.computePayslip({
        employee: emp,
        period,
        settings,
        attendanceRows: attByEmp.get(emp.id) || [],
        leaveRows: leaveByEmp.get(emp.id) || [],
        overtimeAmount: otAmount.get(emp.id) || 0,
        overtimeHours: otHours.get(emp.id) || 0,
        bonus: Number(keep ? (prevBreak.earnings?.bonus ?? bonusByEmp.get(emp.id) ?? 0) : (bonusByEmp.get(emp.id) || 0)),
        commission: Number(
          keep && prevBreak.earnings?.commission != null && prevBreak.hrManual
            ? prevBreak.earnings.commission
            : commissionByEmp.get(emp.id) || 0
        ),
        salesAmount,
        loan: Number(keep ? (prevBreak.deductions?.loan ?? loanByEmp.get(emp.id) ?? 0) : (loanByEmp.get(emp.id) || 0)),
        attendanceCut: keep && prevBreak.attendanceCutManual ? prevBreak.deductions?.attendanceCut : null,
        otherCut: Number(keep ? (prevBreak.deductions?.otherCut || 0) : 0),
        noSaleCut: keep && prevBreak.hrManual ? Number(prevBreak.deductions?.noSaleCut || 0) : null,
        notes: prev?.notes || ''
      });
      const row = await prisma.hrPayrollItem.upsert({
        where: { employeeId_period: { employeeId: emp.id, period } },
        create: {
          companyId,
          employeeId: emp.id,
          period,
          base: slip.earnings.basic,
          overtime: slip.earnings.overtime,
          deductions: slip.deductions.total,
          net: slip.net,
          status: 'Draft',
          notes: slip.notes || '',
          breakdown: slip
        },
        update: {
          base: slip.earnings.basic,
          overtime: slip.earnings.overtime,
          deductions: slip.deductions.total,
          net: slip.net,
          status: prev && ['Paid', 'Approved', 'Held'].includes(prev.status) ? prev.status : 'Draft',
          breakdown: slip
        },
        include: PAYROLL_INCLUDE
      });
      items.push(serializePayroll(row));
    }

    const data = items;
    const summary = payrollEngine.runSummary(data);
    const prevPeriod = payrollEngine.previousPeriod(period);
    const prevRows = await prisma.hrPayrollItem.findMany({
      where: { companyId, period: prevPeriod }
    });
    const previousNet = payrollEngine.money(prevRows.reduce((s, r) => s + Number(r.net || 0), 0));
    res.json({
      success: true,
      data,
      period,
      periodLabel: payrollEngine.periodLabel(period),
      summary: {
        ...summary,
        previousPeriod: prevPeriod,
        previousNet,
        variance: payrollEngine.money(summary.net - previousNet)
      }
    });
  } catch (error) {
    console.error('[hr] generatePayroll', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.updatePayroll = async (req, res) => {
  try {
    const companyId = requireCompany(req, res);
    if (!companyId) return;
    if (!requireHrManager(req, res)) return;
    const existing = await prisma.hrPayrollItem.findFirst({
      where: { id: req.params.id, companyId },
      include: PAYROLL_INCLUDE
    });
    if (!existing) {
      return res.status(404).json({ success: false, message: 'Payroll item not found' });
    }
    if (existing.status === 'Paid' && req.body.status && req.body.status !== 'Paid') {
      return res.status(400).json({ success: false, message: 'Paid payslips are locked' });
    }

    const moneyFields = [
      'basic',
      'houseAllowance',
      'transportAllowance',
      'medicalAllowance',
      'allowances',
      'overtime',
      'bonus',
      'commission',
      'attendanceCut',
      'tax',
      'incomeTax',
      'eobi',
      'providentFund',
      'loan',
      'otherCut',
      'salesAmount',
      'noSaleCut'
    ];
    const editingMoney = moneyFields.some((k) => req.body[k] != null) || req.body.manual === true;
    if (
      existing.status === 'Paid' &&
      (editingMoney || req.body.notes != null || req.body.resetAttendanceCut === true)
    ) {
      return res.status(400).json({ success: false, message: 'Paid payslips are locked' });
    }

    const breakdown = {
      ...(existing.breakdown && typeof existing.breakdown === 'object' ? existing.breakdown : {}),
    };
    const needsRecalc =
      editingMoney ||
      req.body.notes != null ||
      req.body.resetAttendanceCut === true;

    if (needsRecalc) {
      const earn = breakdown.earnings || {};
      const ded = breakdown.deductions || {};
      const settings = await loadSettings(companyId);

      // Full HR control: send `manual: true` (or any line field) → rebuild from posted lines
      if (req.body.manual === true || req.body.basic != null || req.body.overtime != null || req.body.allowances != null || req.body.tax != null || req.body.incomeTax != null || req.body.eobi != null || req.body.providentFund != null || req.body.salesAmount != null || req.body.noSaleCut != null) {
        const salesAmount =
          req.body.salesAmount != null ? Number(req.body.salesAmount) : Number(breakdown.salesAmount || 0);
        const commissionPct = Number(settings.salesCommissionPct ?? breakdown.salesCommissionPct ?? 5);
        let commission =
          req.body.commission != null ? Number(req.body.commission) : Number(earn.commission || 0);
        // If HR entered sales and didn't send commission, auto from %
        if (req.body.salesAmount != null && (req.body.commission == null || req.body.autoCommission === true)) {
          commission = payrollEngine.money((salesAmount * commissionPct) / 100);
        }
        let noSaleCut =
          req.body.noSaleCut != null ? Number(req.body.noSaleCut) : Number(ded.noSaleCut || 0);
        if (req.body.salesAmount != null && req.body.noSaleCut == null && req.body.autoCommission === true) {
          noSaleCut = salesAmount > 0 || commission > 0 ? 0 : Number(settings.noSaleCutAmount || 0);
        }
        const slip = payrollEngine.buildManualPayslip({
          period: existing.period,
          base: { ...breakdown, salesCommissionPct: commissionPct },
          lines: {
            basic: req.body.basic != null ? req.body.basic : earn.basic,
            houseAllowance: req.body.houseAllowance != null ? req.body.houseAllowance : earn.houseAllowance,
            transportAllowance:
              req.body.transportAllowance != null ? req.body.transportAllowance : earn.transportAllowance,
            medicalAllowance:
              req.body.medicalAllowance != null ? req.body.medicalAllowance : earn.medicalAllowance,
            allowances: req.body.allowances != null ? req.body.allowances : earn.allowances,
            overtime: req.body.overtime != null ? req.body.overtime : earn.overtime,
            bonus: req.body.bonus != null ? req.body.bonus : earn.bonus,
            commission,
            salesAmount,
            attendanceCut:
              req.body.resetAttendanceCut === true
                ? 0
                : req.body.attendanceCut != null
                  ? req.body.attendanceCut
                  : ded.attendanceCut,
            tax: req.body.incomeTax != null ? req.body.incomeTax : req.body.tax != null ? req.body.tax : (ded.incomeTax ?? ded.tax),
            eobi: req.body.eobi != null ? req.body.eobi : ded.eobi,
            providentFund: req.body.providentFund != null ? req.body.providentFund : ded.providentFund,
            loan: req.body.loan != null ? req.body.loan : ded.loan,
            otherCut: req.body.otherCut != null ? req.body.otherCut : ded.otherCut,
            noSaleCut,
            package: breakdown.package
          },
          notes: req.body.notes != null ? String(req.body.notes) : existing.notes
        });
        Object.assign(breakdown, slip);
      } else {
        // Light adjust path (commission / cuts only) — still recompute structure from attendance
        const period = existing.period;
        const { start, endExclusive } = payrollEngine.periodBounds(period);
        const [attendanceRows, leaveRows, otRows] = await Promise.all([
          prisma.hrAttendance.findMany({
            where: { companyId, employeeId: existing.employeeId, workDate: { gte: start, lt: endExclusive } }
          }),
          prisma.hrLeave.findMany({
            where: {
              companyId,
              employeeId: existing.employeeId,
              status: 'Approved',
              fromDate: { lte: endExclusive },
              toDate: { gte: start }
            }
          }),
          prisma.hrOvertime.findMany({
            where: {
              companyId,
              employeeId: existing.employeeId,
              status: 'Approved',
              workDate: { gte: start, lt: endExclusive }
            }
          })
        ]);
        let attendanceCutArg = null;
        if (req.body.resetAttendanceCut === true) {
          attendanceCutArg = null;
        } else if (req.body.attendanceCut != null) {
          attendanceCutArg = Number(req.body.attendanceCut);
        } else if (breakdown.attendanceCutManual) {
          attendanceCutArg = Number(breakdown.deductions?.attendanceCut ?? 0);
        }
        const slip = payrollEngine.computePayslip({
          employee: existing.employee,
          period,
          settings,
          attendanceRows,
          leaveRows,
          overtimeAmount: otRows.reduce((s, r) => s + Number(r.amount || 0), 0),
          overtimeHours: otRows.reduce((s, r) => s + Number(r.hours || 0), 0),
          bonus: req.body.bonus != null ? Number(req.body.bonus) : Number(breakdown.earnings?.bonus || 0),
          commission:
            req.body.commission != null
              ? Number(req.body.commission)
              : Number(breakdown.earnings?.commission || 0),
          salesAmount: Number(breakdown.salesAmount || 0),
          loan: req.body.loan != null ? Number(req.body.loan) : Number(breakdown.deductions?.loan || 0),
          attendanceCut: attendanceCutArg,
          otherCut:
            req.body.otherCut != null
              ? Number(req.body.otherCut)
              : Number(breakdown.deductions?.otherCut || 0),
          noSaleCut:
            req.body.noSaleCut != null
              ? Number(req.body.noSaleCut)
              : breakdown.deductions?.noSaleCut != null
                ? Number(breakdown.deductions.noSaleCut)
                : null,
          notes: req.body.notes != null ? String(req.body.notes) : existing.notes
        });
        Object.assign(breakdown, slip);
      }
    }

    const nextStatus = req.body.status != null ? String(req.body.status) : existing.status;
    const row = await prisma.hrPayrollItem.update({
      where: { id: existing.id },
      data: {
        status: nextStatus,
        notes: req.body.notes != null ? String(req.body.notes) : undefined,
        paidAt: nextStatus === 'Paid' ? new Date() : existing.paidAt,
        base: breakdown.earnings?.basic ?? existing.base,
        overtime: breakdown.earnings?.overtime ?? existing.overtime,
        deductions: breakdown.deductions?.total ?? existing.deductions,
        net: breakdown.net ?? existing.net,
        breakdown
      },
      include: PAYROLL_INCLUDE
    });
    res.json({ success: true, data: serializePayroll(row) });
  } catch (error) {
    console.error('[hr] updatePayroll', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

/** Create (or refresh Draft) payslip for one employee in a period — HR can start from blank/auto. */
exports.createPayrollItem = async (req, res) => {
  try {
    const companyId = requireCompany(req, res);
    if (!companyId) return;
    if (!requireHrManager(req, res)) return;
    const employeeId = String(req.body.employeeId || '');
    const period = String(req.body.period || payrollEngine.currentPeriod());
    if (!employeeId) {
      return res.status(400).json({ success: false, message: 'employeeId required' });
    }
    const employee = await prisma.hrEmployee.findFirst({
      where: { id: employeeId, companyId, status: { not: 'terminated' } },
      include: PAYROLL_INCLUDE.employee.include
    });
    if (!employee) {
      return res.status(404).json({ success: false, message: 'Employee not found' });
    }

    const existing = await prisma.hrPayrollItem.findFirst({
      where: { companyId, employeeId, period },
      include: PAYROLL_INCLUDE
    });
    if (existing && ['Paid', 'Approved', 'Held'].includes(existing.status) && req.body.force !== true) {
      return res.status(400).json({
        success: false,
        message: `Payslip already ${existing.status} for this month`
      });
    }

    const settings = await loadSettings(companyId);
    const { start, endExclusive } = payrollEngine.periodBounds(period);
    const [attendanceRows, leaveRows, otRows, loans, bonuses] = await Promise.all([
      prisma.hrAttendance.findMany({
        where: { companyId, employeeId, workDate: { gte: start, lt: endExclusive } }
      }),
      prisma.hrLeave.findMany({
        where: {
          companyId,
          employeeId,
          status: 'Approved',
          fromDate: { lte: endExclusive },
          toDate: { gte: start }
        }
      }),
      prisma.hrOvertime.findMany({
        where: {
          companyId,
          employeeId,
          status: 'Approved',
          workDate: { gte: start, lt: endExclusive }
        }
      }),
      prisma.hrLoan.findMany({ where: { companyId, employeeId, status: 'Approved' } }),
      prisma.hrBonus.findMany({ where: { companyId, employeeId, status: 'Approved', period } })
    ]);

    let bonus = 0;
    let commission = 0;
    bonuses.forEach((row) => {
      const kind = String(row.kind || '').toLowerCase();
      const amt = Number(row.amount || 0);
      if (kind === 'sales' || kind === 'commission' || kind.includes('commission')) commission += amt;
      else bonus += amt;
    });
    const loan = loans.reduce((s, r) => s + Number(r.monthlyDeduct || 0), 0);

    const blank = req.body.blank === true;
    let slip;
    if (blank) {
      slip = payrollEngine.buildManualPayslip({
        period,
        base: { period, periodLabel: payrollEngine.periodLabel(period), workingDays: 0, presentDays: 0 },
        lines: {
          basic: Number(req.body.basic ?? employee.salary ?? 0),
          allowances: Number(req.body.allowances ?? 0),
          overtime: 0,
          bonus: 0,
          commission: 0,
          attendanceCut: 0,
          tax: 0,
          eobi: 0,
          providentFund: 0,
          loan: 0,
          otherCut: 0
        },
        notes: req.body.notes != null ? String(req.body.notes) : 'Created manually by HR'
      });
    } else {
      slip = payrollEngine.computePayslip({
        employee,
        period,
        settings,
        attendanceRows,
        leaveRows,
        overtimeAmount: otRows.reduce((s, r) => s + Number(r.amount || 0), 0),
        overtimeHours: otRows.reduce((s, r) => s + Number(r.hours || 0), 0),
        bonus,
        commission,
        loan,
        notes: req.body.notes != null ? String(req.body.notes) : ''
      });
    }

    const row = await prisma.hrPayrollItem.upsert({
      where: { employeeId_period: { employeeId, period } },
      create: {
        companyId,
        employeeId,
        period,
        base: slip.earnings.basic,
        overtime: slip.earnings.overtime,
        deductions: slip.deductions.total,
        net: slip.net,
        status: 'Draft',
        notes: slip.notes || '',
        breakdown: slip
      },
      update: {
        base: slip.earnings.basic,
        overtime: slip.earnings.overtime,
        deductions: slip.deductions.total,
        net: slip.net,
        status: 'Draft',
        notes: slip.notes || '',
        breakdown: slip
      },
      include: PAYROLL_INCLUDE
    });
    res.json({ success: true, data: serializePayroll(row) });
  } catch (error) {
    console.error('[hr] createPayrollItem', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.bulkPayrollStatus = async (req, res) => {
  try {
    const companyId = requireCompany(req, res);
    if (!companyId) return;
    if (!requireHrManager(req, res)) return;
    const period = String(req.body.period || payrollEngine.currentPeriod());
    const status = String(req.body.status || '');
    const mode = String(req.body.mode || 'all').toLowerCase(); // all | office | sales
    const payDateRaw = req.body.payDate ? String(req.body.payDate).slice(0, 10) : null;
    const paidAt = status === 'Paid'
      ? (payDateRaw ? new Date(`${payDateRaw}T12:00:00.000Z`) : new Date())
      : undefined;
    if (!['Draft', 'Review', 'Approved', 'Paid', 'Held'].includes(status)) {
      return res.status(400).json({ success: false, message: 'Invalid payroll status' });
    }
    const where = { companyId, period };
    if (status === 'Review') where.status = 'Draft';
    else if (status === 'Approved') where.status = { in: ['Draft', 'Review'] };
    else if (status === 'Paid') where.status = { in: ['Approved', 'Review'] };
    else if (status === 'Held') where.status = { in: ['Draft', 'Review'] };
    else if (status === 'Draft') where.status = 'Held';
    else where.status = { notIn: ['Paid'] };

    // Mode filter: only affect office or sales employees
    if (mode !== 'all') {
      const settings = await loadSettings(companyId);
      const allEmps = await prisma.hrEmployee.findMany({
        where: { companyId },
        select: { id: true, employeeType: true, employmentType: true, designation: true }
      });
      const filtered = mode === 'sales'
        ? allEmps.filter((e) => payrollEngine.isSalesRoleEmployee(e, settings))
        : allEmps.filter((e) => !payrollEngine.isSalesRoleEmployee(e, settings));
      where.employeeId = { in: filtered.map((e) => e.id) };
    }

    // When marking Paid, reduce loan remaining balances for affected employees
    if (status === 'Paid') {
      const affectedItems = await prisma.hrPayrollItem.findMany({
        where,
        select: { employeeId: true, breakdown: true }
      });
      for (const item of affectedItems) {
        const bd = item.breakdown && typeof item.breakdown === 'object' ? item.breakdown : {};
        const loanDeducted = Number(bd.deductions?.loan || 0);
        if (loanDeducted > 0) {
          const empLoans = await prisma.hrLoan.findMany({
            where: { companyId, employeeId: item.employeeId, status: 'Approved', remaining: { gt: 0 } },
            orderBy: { createdAt: 'asc' }
          });
          let toDeduct = loanDeducted;
          for (const loan of empLoans) {
            if (toDeduct <= 0) break;
            const deduct = Math.min(toDeduct, Number(loan.monthlyDeduct || 0), Number(loan.remaining || 0));
            if (deduct > 0) {
              const newRemaining = Math.max(0, Number(loan.remaining) - deduct);
              await prisma.hrLoan.update({
                where: { id: loan.id },
                data: {
                  remaining: newRemaining,
                  ...(newRemaining <= 0 ? { status: 'Paid' } : {})
                }
              });
              toDeduct -= deduct;
            }
          }
        }
      }
    }

    await prisma.hrPayrollItem.updateMany({
      where,
      data: {
        status,
        ...(status === 'Paid' ? { paidAt } : {})
      }
    });

    // Persist pay-run metadata (pay date / stage) in HR settings
    if (status === 'Paid' || payDateRaw) {
      const current = await loadSettings(companyId);
      const runs = { ...(current.payrollRuns || {}) };
      const prev = runs[period] || {};
      runs[period] = {
        ...prev,
        payDate: payDateRaw || prev.payDate || null,
        locked: status === 'Paid' ? true : Boolean(prev.locked),
        paidAt: status === 'Paid' ? new Date().toISOString() : prev.paidAt || null,
        stage: status === 'Paid' ? 'Paid' : prev.stage || status
      };
      await prisma.hrSetting.upsert({
        where: { companyId },
        create: { companyId, payload: { ...current, payrollRuns: runs } },
        update: { payload: { ...current, payrollRuns: runs } }
      });
    }
    const rows = await prisma.hrPayrollItem.findMany({
      where: { companyId, period },
      include: PAYROLL_INCLUDE
    });
    const data = rows.map(serializePayroll);
    const summary = payrollEngine.runSummary(data);
    const prevPeriod = payrollEngine.previousPeriod(period);
    const prevRows = await prisma.hrPayrollItem.findMany({
      where: { companyId, period: prevPeriod }
    });
    const previousNet = payrollEngine.money(prevRows.reduce((s, r) => s + Number(r.net || 0), 0));
    let journal = null;
    if (status === 'Paid') {
      try {
        const { postPayrollJournal } = require('../services/hrPayrollAccounting');
        journal = await postPayrollJournal({
          companyId,
          userId: req.user.id || req.user._id,
          period,
          periodLabel: payrollEngine.periodLabel(period),
          netTotal: summary.net
        });
      } catch (err) {
        console.error('[hr] payroll journal', err.message);
        journal = { skipped: true, reason: err.message };
      }
    }
    res.json({
      success: true,
      data,
      period,
      journal,
      summary: {
        ...summary,
        previousPeriod: prevPeriod,
        previousNet,
        variance: payrollEngine.money(summary.net - previousNet)
      }
    });
  } catch (error) {
    console.error('[hr] bulkPayrollStatus', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.payrollReport = async (req, res) => {
  try {
    const companyId = requireCompany(req, res);
    if (!companyId) return;
    if (!requireHrManager(req, res)) return;
    const period = String(req.query.period || payrollEngine.currentPeriod());
    const rows = await prisma.hrPayrollItem.findMany({
      where: { companyId, period },
      include: PAYROLL_INCLUDE,
      orderBy: { createdAt: 'asc' }
    });
    const data = rows.map(serializePayroll);
    const summary = payrollEngine.runSummary(data);
    const previousPeriod = payrollEngine.previousPeriod(period);
    const prevRows = await prisma.hrPayrollItem.findMany({
      where: { companyId, period: previousPeriod }
    });
    const prevNet = payrollEngine.money(prevRows.reduce((s, r) => s + Number(r.net || 0), 0));
    const prevGross = payrollEngine.money(
      prevRows.reduce((s, r) => {
        const b = r.breakdown && typeof r.breakdown === 'object' ? r.breakdown : {};
        return s + Number(b.earnings?.gross ?? r.base ?? 0);
      }, 0)
    );
    res.json({
      success: true,
      period,
      periodLabel: payrollEngine.periodLabel(period),
      previousPeriod,
      previousPeriodLabel: payrollEngine.periodLabel(previousPeriod),
      register: data,
      paymentRegister: data.map((r) => ({
        employee: r.employee,
        employeeCode: r.employeeCode,
        department: r.department,
        designation: r.designation,
        net: r.net,
        status: r.status,
        paidAt: r.paidAt
      })),
      summary: {
        ...summary,
        previousNet: prevNet,
        previousGross: prevGross,
        variance: payrollEngine.money(summary.net - prevNet),
        grossVariance: payrollEngine.money(summary.gross - prevGross)
      }
    });
  } catch (error) {
    console.error('[hr] payrollReport', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.orgChart = async (req, res) => {
  try {
    const companyId = requireCompany(req, res);
    if (!companyId) return;
    if (!requireHrManager(req, res)) return;
    const employees = await prisma.hrEmployee.findMany({
      where: { companyId, status: { not: 'terminated' } },
      include: EMP_MIN,
      orderBy: [{ department: 'asc' }, { designation: 'asc' }]
    });
    const byDept = new Map();
    employees.forEach((emp) => {
      const dept = emp.department || 'Unassigned';
      if (!byDept.has(dept)) byDept.set(dept, []);
      byDept.get(dept).push({
        name: fullName(emp.user),
        role: emp.designation || 'Employee',
        department: dept,
        children: []
      });
    });
    const tree = {
      name: 'Organization',
      role: 'All departments',
      children: [...byDept.entries()].map(([dept, people]) => ({
        name: dept,
        role: `${people.length} people`,
        children: people
      }))
    };
    res.json({ success: true, data: tree });
  } catch (error) {
    console.error('[hr] orgChart', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.notifications = async (req, res) => {
  try {
    const companyId = requireCompany(req, res);
    if (!companyId) return;
    if (!requireHrManager(req, res)) return;
    const today = workDateKey();
    const [leaves, overtime, late, recent] = await Promise.all([
      prisma.hrLeave.findMany({
        where: { companyId, status: 'Pending' },
        include: { employee: { include: EMP_MIN } },
        orderBy: { createdAt: 'desc' },
        take: 10
      }),
      prisma.hrOvertime.findMany({
        where: { companyId, status: 'Pending' },
        include: { employee: { include: EMP_MIN } },
        orderBy: { createdAt: 'desc' },
        take: 10
      }),
      prisma.hrAttendance.findMany({
        where: { companyId, workDate: today, status: 'late' },
        include: { employee: { include: EMP_MIN } },
        take: 10
      }),
      prisma.hrEmployee.findMany({
        where: {
          companyId,
          createdAt: { gte: new Date(Date.now() - 7 * 86400000) }
        },
        include: EMP_MIN,
        orderBy: { createdAt: 'desc' },
        take: 5
      })
    ]);

    const items = [
      ...leaves.map((row) => ({
        title: 'Leave Request',
        body: `${fullName(row.employee.user)} requested ${row.days} day(s) ${row.type}`,
        time: row.createdAt,
        type: 'Leave',
        href: '/hr/leaves'
      })),
      ...overtime.map((row) => ({
        title: 'Overtime Request',
        body: `${fullName(row.employee.user)} requested ${row.hours}h overtime`,
        time: row.createdAt,
        type: 'Overtime',
        href: '/hr/overtime'
      })),
      ...late.map((row) => ({
        title: 'Late Check-in',
        body: `${fullName(row.employee.user)} checked in late today`,
        time: row.checkIn || row.createdAt,
        type: 'Attendance',
        href: '/hr/attendance'
      })),
      ...recent.map((row) => ({
        title: 'New Employee',
        body: `HR created ${fullName(row.user)} (${row.employeeCode})`,
        time: row.createdAt,
        type: 'Employee',
        href: '/hr/employees'
      }))
    ].sort((a, b) => new Date(b.time) - new Date(a.time));

    res.json({ success: true, data: items });
  } catch (error) {
    console.error('[hr] notifications', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.getSettings = async (req, res) => {
  try {
    const companyId = requireCompany(req, res);
    if (!companyId) return;
    if (!requireHrManager(req, res)) return;
    const payload = await loadSettings(companyId);
    res.json({ success: true, data: payload });
  } catch (error) {
    console.error('[hr] getSettings', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

/** Pay-run cockpit: period meta, pay date, checklist, derived stage */
exports.getPayrollRun = async (req, res) => {
  try {
    const companyId = requireCompany(req, res);
    if (!companyId) return;
    if (!requireHrManager(req, res)) return;

    const period = String(req.query.period || payrollEngine.currentPeriod());
    const { start, endExclusive } = payrollEngine.periodBounds(period);
    const settings = await loadSettings(companyId);
    const runMeta = (settings.payrollRuns && settings.payrollRuns[period]) || {};

    const [employees, items, pendingLeaves, pendingOt, pendingBonus] = await Promise.all([
      prisma.hrEmployee.findMany({
        where: { companyId, status: { not: 'terminated' } },
        select: { id: true, salary: true, status: true, department: true, user: { select: { firstName: true, lastName: true } } }
      }),
      prisma.hrPayrollItem.findMany({
        where: { companyId, period },
        include: PAYROLL_INCLUDE
      }),
      prisma.hrLeave.count({
        where: {
          companyId,
          status: 'Pending',
          fromDate: { lte: endExclusive },
          toDate: { gte: start }
        }
      }),
      prisma.hrOvertime.count({
        where: {
          companyId,
          status: 'Pending',
          workDate: { gte: start, lt: endExclusive }
        }
      }),
      prisma.hrBonus.count({
        where: { companyId, status: 'Pending', period }
      })
    ]);

    const active = employees.filter((e) => e.status !== 'inactive');
    const noSalary = active.filter((e) => !(Number(e.salary) > 0));
    const data = items.map(serializePayroll);
    const summary = payrollEngine.runSummary(data);
    const byStatus = summary.byStatus || {};
    const total = data.length;

    let stage = 'Open';
    if (runMeta.locked || (total > 0 && byStatus.Paid === total)) stage = 'Paid';
    else if (total === 0) stage = 'Open';
    else if ((byStatus.Approved || 0) > 0 && (byStatus.Draft || 0) === 0 && (byStatus.Review || 0) === 0) {
      stage = 'Approved';
    } else if ((byStatus.Review || 0) > 0 || ((byStatus.Approved || 0) > 0 && (byStatus.Draft || 0) > 0)) {
      stage = 'Review';
    } else if ((byStatus.Draft || 0) > 0) stage = 'Draft';

    // Default pay date: settings.defaultPayDay of next month (or stored)
    let payDate = runMeta.payDate || null;
    if (!payDate) {
      const [y, m] = period.split('-').map(Number);
      const next = m === 12 ? { y: y + 1, m: 1 } : { y, m: m + 1 };
      const day = Math.min(Number(settings.defaultPayDay || 5), 28);
      payDate = `${next.y}-${String(next.m).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    }

    res.json({
      success: true,
      data: {
        period,
        periodLabel: payrollEngine.periodLabel(period),
        payDate,
        stage,
        locked: Boolean(runMeta.locked) || stage === 'Paid',
        notes: runMeta.notes || '',
        periodStart: payrollEngine.ymd(start),
        periodEnd: payrollEngine.ymd(new Date(endExclusive.getTime() - 86400000)),
        checklist: {
          activeEmployees: active.length,
          missingSalary: noSalary.length,
          missingSalaryNames: noSalary.slice(0, 8).map((e) =>
            [e.user?.firstName, e.user?.lastName].filter(Boolean).join(' ') || 'Employee'
          ),
          pendingLeaves,
          pendingOvertime: pendingOt,
          pendingBonus,
          slips: total,
          readyToCalculate: noSalary.length === 0 && active.length > 0,
          blockers: [
            ...(noSalary.length
              ? [`${noSalary.length} employee(s) have no package salary`]
              : []),
            ...(pendingLeaves ? [`${pendingLeaves} leave request(s) still pending`] : []),
            ...(pendingOt ? [`${pendingOt} overtime request(s) still pending`] : []),
            ...(pendingBonus ? [`${pendingBonus} bonus request(s) still pending`] : [])
          ]
        },
        summary: {
          ...summary,
          byStatus
        },
        steps: [
          { id: 'period', label: 'Select month & pay date', done: true },
          { id: 'prepare', label: 'Prepare inputs', done: total > 0 || noSalary.length === 0 },
          { id: 'calculate', label: 'Calculate drafts', done: total > 0 },
          { id: 'review', label: 'HR review & edit', done: ['Review', 'Approved', 'Paid'].includes(stage) },
          { id: 'approve', label: 'Approve payslips', done: ['Approved', 'Paid'].includes(stage) },
          { id: 'pay', label: 'Mark paid & lock', done: stage === 'Paid' }
        ]
      }
    });
  } catch (error) {
    console.error('[hr] getPayrollRun', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.savePayrollRun = async (req, res) => {
  try {
    const companyId = requireCompany(req, res);
    if (!companyId) return;
    if (!requireHrManager(req, res)) return;

    const period = String(req.body.period || payrollEngine.currentPeriod());
    const current = await loadSettings(companyId);
    const runs = { ...(current.payrollRuns || {}) };
    const prev = runs[period] || {};
    if (prev.locked && req.body.unlock !== true) {
      return res.status(400).json({ success: false, message: 'This pay run is locked' });
    }

    runs[period] = {
      ...prev,
      payDate: req.body.payDate != null ? String(req.body.payDate).slice(0, 10) : prev.payDate || null,
      notes: req.body.notes != null ? String(req.body.notes) : prev.notes || '',
      locked: req.body.locked === true ? true : req.body.unlock === true ? false : Boolean(prev.locked),
      updatedAt: new Date().toISOString()
    };

    const payload = { ...current, payrollRuns: runs };
    if (req.body.defaultPayDay != null) {
      payload.defaultPayDay = Number(req.body.defaultPayDay);
    }

    await prisma.hrSetting.upsert({
      where: { companyId },
      create: { companyId, payload },
      update: { payload }
    });

    res.json({ success: true, data: runs[period], period });
  } catch (error) {
    console.error('[hr] savePayrollRun', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.saveSettings = async (req, res) => {
  try {
    const companyId = requireCompany(req, res);
    if (!companyId) return;
    if (!requireHrManager(req, res)) return;
    const current = await loadSettings(companyId);
    const payload = { ...current, ...(req.body || {}) };
    await prisma.hrSetting.upsert({
      where: { companyId },
      create: { companyId, payload },
      update: { payload }
    });
    res.json({ success: true, data: payload });
  } catch (error) {
    console.error('[hr] saveSettings', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

async function loadSettings(companyId) {
  const row = await prisma.hrSetting.findUnique({ where: { companyId } });
  return { ...DEFAULT_SETTINGS, ...(row?.payload || {}) };
}

function currentPeriod(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

function nextPeriodStart(period) {
  const [y, m] = period.split('-').map(Number);
  const next = m === 12 ? { y: y + 1, m: 1 } : { y, m: m + 1 };
  return `${next.y}-${String(next.m).padStart(2, '0')}-01`;
}
