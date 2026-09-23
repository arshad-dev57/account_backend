'use strict';

const prisma = require('../prisma/client');
const payrollEngine = require('./hrPayrollEngine');
const { validatePayPeriod } = require('./hrPayrollValidation');
const { registerRowFromItem, registerTotals } = require('./hrPayrollRegister');
const { sumLoanDeduction } = require('./hrPayrollLoanHelper');
const {
  resolveEmployeeCommissionInputs,
  resolveEmployeeBonusInputs
} = require('./hrPayrollCommission');
const {
  assertPeriodTransition,
  canRecalculatePeriod,
  isItemLocked,
  isPeriodLocked
} = require('./hrPayrollStatus');
const { resolveEmployeeCostCenter, snapshotCostCenter } = require('./costCenterHelper');

const PAYROLL_INCLUDE = {
  employee: {
    include: {
      user: { select: { firstName: true, lastName: true, email: true } },
      office: { select: { name: true } }
    }
  }
};

function periodDatesFromKey(periodKey) {
  const { start, endExclusive } = payrollEngine.periodBounds(periodKey);
  const endDate = endExclusive ? new Date(endExclusive.getTime() - 86400000) : start;
  return { startDate: start, endDate };
}

function serializePayPeriod(row) {
  return {
    id: row.id,
    companyId: row.companyId,
    periodKey: row.periodKey,
    name: row.name,
    startDate: row.startDate,
    endDate: row.endDate,
    payDate: row.payDate,
    frequency: row.frequency,
    branchId: row.branchId,
    status: row.status,
    openedAt: row.openedAt,
    calculatedAt: row.calculatedAt,
    approvedAt: row.approvedAt,
    finalizedAt: row.finalizedAt,
    paidAt: row.paidAt,
    closedAt: row.closedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    runs: row.runs || undefined
  };
}

async function loadSettings(companyId) {
  const row = await prisma.hrSetting.findUnique({ where: { companyId } });
  const payload = row?.payload && typeof row.payload === 'object' ? row.payload : {};
  return payrollEngine.paySettings(payload);
}

/**
 * Ensure HrPayPeriod exists for YYYY-MM key (backward compat bridge).
 */
async function ensurePayPeriod(companyId, periodKey, opts = {}) {
  const key = String(periodKey || payrollEngine.currentPeriod());
  let row = await prisma.hrPayPeriod.findUnique({
    where: { companyId_periodKey: { companyId, periodKey: key } }
  });
  if (row) return row;

  const { startDate, endDate } = periodDatesFromKey(key);
  row = await prisma.hrPayPeriod.create({
    data: {
      companyId,
      periodKey: key,
      name: payrollEngine.periodLabel(key),
      startDate,
      endDate,
      payDate: opts.payDate ? new Date(`${opts.payDate}T00:00:00.000Z`) : null,
      frequency: opts.frequency || 'monthly',
      branchId: opts.branchId || null,
      status: 'OPEN',
      openedAt: new Date()
    }
  });
  return row;
}

async function listPayPeriods(companyId, { limit = 24 } = {}) {
  const rows = await prisma.hrPayPeriod.findMany({
    where: { companyId },
    orderBy: { periodKey: 'desc' },
    take: limit,
    include: {
      runs: { orderBy: { startedAt: 'desc' }, take: 1 }
    }
  });
  return rows.map(serializePayPeriod);
}

async function getPayPeriod(companyId, idOrKey) {
  const row = await prisma.hrPayPeriod.findFirst({
    where: {
      companyId,
      OR: [{ id: idOrKey }, { periodKey: String(idOrKey) }]
    },
    include: {
      runs: { orderBy: { startedAt: 'desc' }, take: 5 },
      branch: { select: { id: true, name: true } }
    }
  });
  if (!row) return null;
  return serializePayPeriod(row);
}

async function updatePayPeriodStatus(companyId, payPeriodId, nextStatus) {
  const row = await prisma.hrPayPeriod.findFirst({
    where: { id: payPeriodId, companyId }
  });
  if (!row) {
    const err = new Error('Pay period not found');
    err.status = 404;
    throw err;
  }
  assertPeriodTransition(row.status, nextStatus);
  const now = new Date();
  const data = { status: nextStatus };
  const s = String(nextStatus).toUpperCase();
  if (s === 'CALCULATED') data.calculatedAt = now;
  if (s === 'APPROVED') data.approvedAt = now;
  if (s === 'FINALIZED') data.finalizedAt = now;
  if (s === 'PAID') data.paidAt = now;
  if (s === 'CLOSED') data.closedAt = now;
  const updated = await prisma.hrPayPeriod.update({ where: { id: row.id }, data });
  return serializePayPeriod(updated);
}

async function gatherPayrollInputs(companyId, periodKey, employees, settings) {
  const { start, endExclusive } = payrollEngine.periodBounds(periodKey);
  const employeeIds = employees.map((e) => e.id);

  const [overtime, attendance, leaves, existing, loans, bonuses] = await Promise.all([
    prisma.hrOvertime.findMany({
      where: { companyId, status: 'Approved', workDate: { gte: start, lt: endExclusive } }
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
    prisma.hrPayrollItem.findMany({ where: { companyId, period: periodKey } }),
    prisma.hrLoan.findMany({ where: { companyId, status: 'Approved', employeeId: { in: employeeIds } } }),
    prisma.hrBonus.findMany({
      where: { companyId, status: 'Approved', period: periodKey, employeeId: { in: employeeIds } }
    })
  ]);

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
    if (!loanByEmp.has(row.employeeId)) loanByEmp.set(row.employeeId, []);
    loanByEmp.get(row.employeeId).push(row);
  });
  const bonusByEmp = new Map();
  bonuses.forEach((row) => {
    if (!bonusByEmp.has(row.employeeId)) bonusByEmp.set(row.employeeId, []);
    bonusByEmp.get(row.employeeId).push(row);
  });

  const orderSalesByEmp = new Map();
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
        orderSalesByEmp.set(empId, (orderSalesByEmp.get(empId) || 0) + Number(o.grandTotal || 0));
      });
    }
  } catch {
    /* optional */
  }

  const existingByEmp = new Map(existing.map((r) => [r.employeeId, r]));

  return {
    otAmount,
    otHours,
    attByEmp,
    leaveByEmp,
    loanByEmp,
    bonusByEmp,
    orderSalesByEmp,
    existingByEmp
  };
}

async function calculatePayPeriod({
  companyId,
  payPeriodId,
  initiatedById,
  mode = 'all',
  force = false
}) {
  const payPeriod = await prisma.hrPayPeriod.findFirst({
    where: { id: payPeriodId, companyId }
  });
  if (!payPeriod) {
    const err = new Error('Pay period not found');
    err.status = 404;
    throw err;
  }
  if (isPeriodLocked(payPeriod.status)) {
    const err = new Error(`Pay period is ${payPeriod.status} and cannot be recalculated`);
    err.status = 400;
    err.code = 'PERIOD_LOCKED';
    throw err;
  }
  if (!canRecalculatePeriod(payPeriod.status) && payPeriod.status !== 'OPEN') {
    const err = new Error(`Pay period status ${payPeriod.status} does not allow calculation`);
    err.status = 400;
    throw err;
  }

  const settings = await loadSettings(companyId);
  const validation = await validatePayPeriod({
    prisma,
    companyId,
    payPeriod,
    settings,
    mode
  });

  if (validation.errors.length && !force) {
    const err = new Error('Payroll validation failed');
    err.status = 400;
    err.code = 'VALIDATION_FAILED';
    err.validation = validation;
    throw err;
  }

  await prisma.hrPayPeriod.update({
    where: { id: payPeriod.id },
    data: { status: 'CALCULATING' }
  });

  const run = await prisma.hrPayrollRun.create({
    data: {
      companyId,
      payPeriodId: payPeriod.id,
      initiatedById: initiatedById || null,
      status: 'RUNNING',
      employeeCount: validation.summary.employeeCount,
      validationWarnings: validation.warnings,
      validationErrors: validation.errors
    }
  });

  let employees = await prisma.hrEmployee.findMany({
    where: { companyId, status: { notIn: ['terminated', 'inactive'] } },
    include: PAYROLL_INCLUDE.employee.include
  });
  if (payPeriod.branchId) {
    employees = employees.filter((e) => e.officeId === payPeriod.branchId);
  }
  if (mode === 'sales') {
    employees = employees.filter((e) => payrollEngine.isSalesRoleEmployee(e, settings));
  } else if (mode === 'office') {
    employees = employees.filter((e) => !payrollEngine.isSalesRoleEmployee(e, settings));
  }

  const eligibleIds = new Set(validation.eligibleEmployees.map((e) => e.employeeId));
  const inputs = await gatherPayrollInputs(companyId, payPeriod.periodKey, employees, settings);
  const items = [];
  let processed = 0;
  let excluded = 0;

  for (const emp of employees) {
    if (!eligibleIds.has(emp.id) && !force) {
      excluded += 1;
      continue;
    }

    const prev = inputs.existingByEmp.get(emp.id);
    if (prev && isItemLocked(prev.status) && !force) {
      items.push(payrollEngine.serializePayslip({ ...prev, employee: emp }));
      continue;
    }
    const prevBreak = prev?.breakdown && typeof prev.breakdown === 'object' ? prev.breakdown : {};
    if (prev && prevBreak.hrManual === true && !force) {
      items.push(payrollEngine.serializePayslip({ ...prev, employee: emp }));
      continue;
    }

    const empBonuses = inputs.bonusByEmp.get(emp.id) || [];
    const bonus = resolveEmployeeBonusInputs({ bonuses: empBonuses });
    const { salesAmount, commission } = resolveEmployeeCommissionInputs({
      bonuses: empBonuses,
      orderSalesAmount: inputs.orderSalesByEmp.get(emp.id) || 0
    });
    const loan = sumLoanDeduction(inputs.loanByEmp.get(emp.id) || []);

    const slip = payrollEngine.computePayslip({
      employee: emp,
      period: payPeriod.periodKey,
      settings,
      attendanceRows: inputs.attByEmp.get(emp.id) || [],
      leaveRows: inputs.leaveByEmp.get(emp.id) || [],
      overtimeAmount: inputs.otAmount.get(emp.id) || 0,
      overtimeHours: inputs.otHours.get(emp.id) || 0,
      bonus,
      commission,
      salesAmount,
      loan,
      notes: prev?.notes || ''
    });

    const cc = await resolveEmployeeCostCenter(emp, companyId);
    const ccSnap = snapshotCostCenter(cc);

    const row = await prisma.hrPayrollItem.upsert({
      where: { employeeId_period: { employeeId: emp.id, period: payPeriod.periodKey } },
      create: {
        companyId,
        employeeId: emp.id,
        payPeriodId: payPeriod.id,
        period: payPeriod.periodKey,
        base: slip.earnings.basic,
        overtime: slip.earnings.overtime,
        deductions: slip.deductions.total,
        net: slip.net,
        status: 'Calculated',
        notes: slip.notes || '',
        breakdown: slip,
        ...ccSnap
      },
      update: {
        payPeriodId: payPeriod.id,
        base: slip.earnings.basic,
        overtime: slip.earnings.overtime,
        deductions: slip.deductions.total,
        net: slip.net,
        status: prev && isItemLocked(prev.status) ? prev.status : 'Calculated',
        breakdown: slip,
        ...ccSnap
      },
      include: PAYROLL_INCLUDE
    });
    items.push(payrollEngine.serializePayslip(row));
    processed += 1;
  }

  const summary = payrollEngine.runSummary(items);
  const taxTotal = payrollEngine.money(
    items.reduce(
      (s, r) => s + Number(r.breakdown?.deductions?.incomeTax ?? r.breakdown?.deductions?.tax ?? 0),
      0
    )
  );

  await prisma.hrPayrollRun.update({
    where: { id: run.id },
    data: {
      status: 'COMPLETED',
      completedAt: new Date(),
      processedCount: processed,
      excludedCount: excluded,
      grossTotal: summary.gross,
      deductionTotal: summary.deductions,
      taxTotal,
      netTotal: summary.net,
      metadata: { mode, summary: validation.summary }
    }
  });

  await prisma.hrPayPeriod.update({
    where: { id: payPeriod.id },
    data: { status: 'CALCULATED', calculatedAt: new Date() }
  });

  return {
    payPeriod: serializePayPeriod(
      await prisma.hrPayPeriod.findUnique({ where: { id: payPeriod.id } })
    ),
    run: {
      id: run.id,
      status: 'COMPLETED',
      processedCount: processed,
      excludedCount: excluded,
      grossTotal: summary.gross,
      deductionTotal: summary.deductions,
      taxTotal,
      netTotal: summary.net
    },
    validation,
    items,
    summary
  };
}

async function getPayrollReview(companyId, payPeriodId) {
  const payPeriod = await prisma.hrPayPeriod.findFirst({
    where: { id: payPeriodId, companyId }
  });
  if (!payPeriod) {
    const err = new Error('Pay period not found');
    err.status = 404;
    throw err;
  }

  const rows = await prisma.hrPayrollItem.findMany({
    where: { companyId, period: payPeriod.periodKey },
    include: PAYROLL_INCLUDE,
    orderBy: { employee: { employeeCode: 'asc' } }
  });

  const items = rows.map((row) => {
    const serialized = payrollEngine.serializePayslip(row);
    const b = row.breakdown || {};
    return {
      ...serialized,
      review: {
        attendance: {
          workingDays: b.workingDays,
          presentDays: b.presentDays,
          halfDays: b.halfDays,
          paidLeaveDays: b.paidLeaveDays,
          unpaidLeaveDays: b.unpaidLeaveDays,
          lateDays: b.lateDays,
          overtimeHours: b.overtimeHours
        },
        earnings: b.earnings || {},
        deductions: b.deductions || {},
        provisions: b.provisions || {},
        exceptions: b.exceptions || [],
        gross: b.earnings?.gross ?? row.base,
        net: row.net,
        tax: b.deductions?.incomeTax ?? b.deductions?.tax ?? 0
      }
    };
  });

  return {
    payPeriod: serializePayPeriod(payPeriod),
    items,
    summary: payrollEngine.runSummary(items)
  };
}

async function getPayRegister(companyId, payPeriodId) {
  const payPeriod = await prisma.hrPayPeriod.findFirst({
    where: { id: payPeriodId, companyId }
  });
  if (!payPeriod) {
    const err = new Error('Pay period not found');
    err.status = 404;
    throw err;
  }

  const rows = await prisma.hrPayrollItem.findMany({
    where: { companyId, period: payPeriod.periodKey },
    include: PAYROLL_INCLUDE,
    orderBy: { employee: { employeeCode: 'asc' } }
  });

  const registerRows = rows.map(registerRowFromItem);
  return {
    payPeriod: serializePayPeriod(payPeriod),
    rows: registerRows,
    totals: registerTotals(registerRows)
  };
}

module.exports = {
  PAYROLL_INCLUDE,
  ensurePayPeriod,
  listPayPeriods,
  getPayPeriod,
  updatePayPeriodStatus,
  validatePayPeriodForPeriod: async (companyId, payPeriodId, mode) => {
    const payPeriod = await prisma.hrPayPeriod.findFirst({
      where: { id: payPeriodId, companyId }
    });
    if (!payPeriod) {
      const err = new Error('Pay period not found');
      err.status = 404;
      throw err;
    }
    const settings = await loadSettings(companyId);
    return validatePayPeriod({ prisma, companyId, payPeriod, settings, mode });
  },
  calculatePayPeriod,
  getPayrollReview,
  getPayRegister,
  loadSettings
};
