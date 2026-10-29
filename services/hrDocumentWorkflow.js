'use strict';

/**
 * Business logic attached to the HR documents declared in
 * services/hrDocumentRegistry.js. Each hook reproduces what the equivalent
 * ERPNext/Frappe HR controller does on save/submit/approve/cancel, so records
 * stay related: allocations feed leave applications, approved attendance feeds
 * salary slips, journals feed accounting, and offers feed onboardings.
 *
 * Hook contract: async ({ def, resource, row, previous, data, companyId, ctx, req, body })
 *  - beforeWrite/validate hooks mutate `data` or throw a 400 error.
 *  - lifecycle hooks persist side effects and may return the updated row.
 */

const prisma = require('../prisma/client');
const { normalizeClock, minutesOfDay, minutesOfDayInZone } = require('../utils/clock');
const { attendanceStatusKey, workDateKey } = require('../utils/hrAccess');

function badRequest(message, extra) {
  const error = new Error(message);
  error.status = 400;
  error.extra = extra || {};
  throw error;
}

const DAY = 86400000;

function dayStart(value) {
  const key = value instanceof Date ? value.toISOString().slice(0, 10) : String(value || '').slice(0, 10);
  return new Date(`${key}T00:00:00.000Z`);
}

function dayKeys(from, to) {
  const start = dayStart(from);
  const end = dayStart(to || from);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return [];
  if (end < start) return [];
  const out = [];
  for (let t = start.getTime(); t <= end.getTime(); t += DAY) out.push(new Date(t));
  return out;
}

function countDays(from, to) {
  const days = dayKeys(from, to).length;
  if (!days) {
    const single = dayStart(from);
    return Number.isNaN(single.getTime()) ? 0 : 1;
  }
  return days;
}

function hhmm(value) {
  return normalizeClock(value) || '';
}

async function nextEmployeeCode(companyId) {
  const last = await prisma.hrEmployee.findFirst({
    where: { companyId },
    orderBy: { createdAt: 'desc' },
    select: { employeeCode: true }
  });
  const match = String(last?.employeeCode || '').match(/(\d+)\s*$/);
  const next = match ? Number(match[1]) + 1 : 1;
  return `EMP-${String(next).padStart(4, '0')}`;
}

async function resolveByName(model, companyId, nameOrId, label = 'name') {
  if (!nameOrId) return null;
  const client = prisma[model];
  if (!client) return null;
  const byId = await client.findFirst({ where: { id: String(nameOrId) }, select: { id: true, [label]: true } }).catch(() => null);
  if (byId) return byId;
  return client.findFirst({ where: { companyId, [label]: String(nameOrId) }, select: { id: true, [label]: true } }).catch(() => null);
}

function round2(value) {
  return Math.round(Number(value || 0) * 100) / 100;
}

// ── Leave period / policy / allocation ────────────────────────────────────

async function leavePeriodDates({ data }) {
  const start = data.startDate;
  const end = data.endDate;
  if (start && end && dayStart(end) < dayStart(start)) {
    badRequest('Leave Period end date must be after the start date');
  }
}

async function normalizeLeaveAllocation({ data, companyId, currentId }) {
  if (!data.namingSeries) data.namingSeries = 'HR-LAL-.YYYY.-';
  if (data.fromDate && data.toDate && dayStart(data.toDate) < dayStart(data.fromDate)) {
    badRequest('Leave Allocation "To Date" must be after the "From Date"');
  }
  if (!data.year) {
    const anchor = data.fromDate || new Date();
    data.year = dayStart(anchor).getUTCFullYear();
  }

  if (data.employeeId) {
    const emp = await prisma.hrEmployee.findFirst({ where: { id: data.employeeId, companyId } });
    if (emp) {
      data.employeeName = data.employeeName || emp.employeeName || '';
      data.department = data.department || emp.department || '';
    }
  }

  const newLeaves = Number(data.newLeaves || 0);
  let carryForwardLeaves = Number(data.carryForwardLeaves || 0);
  const carryForward = data.carryForward === true || data.carryForward === 1;
  data.carryForward = Boolean(carryForward);

  if (carryForward && data.employeeId && data.leaveTypeId) {
    const previous = await prisma.hrLeaveBalance.findFirst({
      where: {
        companyId,
        employeeId: data.employeeId,
        leaveTypeId: data.leaveTypeId,
        ...(currentId ? { id: { not: currentId } } : {}),
        year: { lt: Number(data.year) }
      },
      orderBy: { year: 'desc' }
    });
    if (previous) {
      const unused = Math.max(0, allocationRemaining(previous));
      data.unusedLeaves = unused;
      carryForwardLeaves = unused;
      data.carryForwardLeaves = unused;
    } else {
      data.unusedLeaves = 0;
      carryForwardLeaves = 0;
      data.carryForwardLeaves = 0;
    }
  } else if (!carryForward) {
    data.unusedLeaves = 0;
    carryForwardLeaves = 0;
    data.carryForwardLeaves = 0;
  }

  data.totalLeavesAllocated = round2(newLeaves + carryForwardLeaves);
  data.totalLeavesEncashed = Number(data.totalLeavesEncashed || data.encashed || 0);
  if (!Array.isArray(data.earnedLeaveSchedule)) data.earnedLeaveSchedule = [];

  if (data.employeeId && data.leaveTypeId) {
    const clash = await prisma.hrLeaveBalance.findFirst({
      where: {
        employeeId: data.employeeId,
        leaveTypeId: data.leaveTypeId,
        year: data.year,
        ...(currentId ? { id: { not: currentId } } : {})
      },
      select: { id: true }
    });
    if (clash) badRequest('This employee already has an allocation for that leave type and year');
  }
}

async function allocationFor(companyId, employeeId, leaveTypeId, onDate) {
  const on = dayStart(onDate || new Date());
  const period = await prisma.hrLeavePeriod.findFirst({
    where: {
      companyId,
      startDate: { lte: on },
      endDate: { gte: on }
    }
  });
  const where = { companyId, employeeId };
  if (leaveTypeId) where.leaveTypeId = leaveTypeId;
  const rows = await prisma.hrLeaveBalance.findMany({ where });
  const inPeriod = rows.filter((r) =>
    (!r.fromDate || dayStart(r.fromDate) <= on) && (!r.toDate || dayStart(r.toDate) >= on)
  );
  const pick =
    (period && inPeriod.find((r) => r.leavePeriodId === period.id)) ||
    inPeriod.sort((a, b) => b.year - a.year)[0] ||
    rows.sort((a, b) => b.year - a.year)[0];
  return { allocation: pick, leavePeriod: period };
}

function allocationRemaining(allocation) {
  if (!allocation) return null;
  return round2(
    Number(allocation.totalLeavesAllocated || allocation.accrued || 0) +
      Number(allocation.carryForwardLeaves || allocation.carried || 0) -
      Number(allocation.used || 0) -
      Number(allocation.encashed || 0)
  );
}

async function validateLeaveApplication({ data, companyId, currentId }) {
  if (!data.namingSeries) data.namingSeries = 'HR-LAP-.YYYY.-';
  if (!data.appliedOn) data.appliedOn = dayStart(new Date());
  if (data.fromDate && data.toDate && dayStart(data.toDate) < dayStart(data.fromDate)) {
    badRequest('"To Date" cannot be before "From Date"');
  }
  if (data.employeeId && data.fromDate) {
    const overlap = await prisma.hrLeave.findFirst({
      where: {
        companyId,
        employeeId: data.employeeId,
        status: { in: ['Open', 'Approved', 'Pending'] },
        id: currentId ? { not: currentId } : undefined,
        fromDate: { lte: dayStart(data.toDate || data.fromDate) },
        toDate: { gte: dayStart(data.fromDate) }
      }
    });
    if (overlap) badRequest('The employee already has a leave application covering these dates');
  }
  if (data.fromDate) {
    const sameDay =
      data.toDate && dayStart(data.fromDate).getTime() === dayStart(data.toDate).getTime();
    let days = countDays(data.fromDate, data.toDate || data.fromDate);
    if (data.halfDay) {
      days = sameDay ? 0.5 : Math.max(0.5, days - 0.5);
      if (!data.halfDayDate) data.halfDayDate = dayStart(data.fromDate);
    } else {
      data.halfDayDate = null;
    }
    data.days = days;
    if (!data.toDate) data.toDate = dayStart(data.fromDate);
  }

  if (data.employeeId) {
    const emp = await prisma.hrEmployee.findFirst({ where: { id: data.employeeId, companyId } });
    if (emp) data.employeeName = data.employeeName || emp.employeeName || '';
  }

  if (data.employeeId && data.leaveTypeId) {
    const type = await prisma.hrLeaveType.findFirst({
      where: { id: data.leaveTypeId, companyId }
    });
    if (type) {
      data.type = type.name;
      data.isLop = Boolean(type.isLop);
      const { allocation, leavePeriod } = await allocationFor(companyId, data.employeeId, data.leaveTypeId, data.fromDate);
      if (leavePeriod) data.leavePeriodId = leavePeriod.id;
      if (allocation) {
        data.leaveBalanceId = allocation.id;
        const remaining = allocationRemaining(allocation);
        data.leaveBalanceBefore = remaining;
        const allowNegative = Boolean(allocation.allowNegative ?? type.allowNegative);
        if (!allowNegative && Number(data.days) > remaining) {
          badRequest(
            `${type.name}: only ${remaining} leave day(s) available for this period`,
            { remaining, requested: Number(data.days) }
          );
        }
      } else if (!type.allowNegative) {
        badRequest(`No leave allocation found for ${type.name}. Allocate leaves before applying.`);
      }
    }
  } else if (data.type) {
    const type = await prisma.hrLeaveType.findFirst({ where: { companyId, name: data.type } });
    if (type) data.leaveTypeId = type.id;
  }
  if (!data.appliedOn) data.appliedOn = dayStart(new Date());
}

async function applyApprovedLeave({ row, companyId }) {
  const days = Number(row.days || 0);
  let allocation = row.leaveBalanceId
    ? await prisma.hrLeaveBalance.findFirst({ where: { id: row.leaveBalanceId, companyId } })
    : null;
  if (!allocation && row.leaveTypeId) {
    allocation = (await allocationFor(companyId, row.employeeId, row.leaveTypeId, row.fromDate)).allocation;
  }
  if (allocation) {
    await prisma.hrLeaveBalance.update({
      where: { id: allocation.id },
      data: { used: round2(Number(allocation.used || 0) + days) }
    });
    if (!row.leaveBalanceId) {
      await prisma.hrLeave.update({ where: { id: row.id }, data: { leaveBalanceId: allocation.id } });
    }
  }

  const type = row.leaveTypeId
    ? await prisma.hrLeaveType.findFirst({ where: { id: row.leaveTypeId, companyId } })
    : await prisma.hrLeaveType.findFirst({ where: { companyId, name: row.type } });
  const status = type && type.paid === false ? 'Absent' : 'On Leave';

  const dates = dayKeys(row.fromDate, row.toDate);
  for (const workDate of dates) {
    await prisma.hrAttendance.upsert({
      where: { employeeId_workDate: { employeeId: row.employeeId, workDate } },
      create: {
        companyId,
        employeeId: row.employeeId,
        workDate,
        status,
        source: 'leave-application',
        leaveApplicationId: row.id,
        remarks: `Leave ${row.type || ''}`.trim()
      },
      update: { status, leaveApplicationId: row.id, source: 'leave-application' }
    });
  }
  return prisma.hrLeave.findFirst({ where: { id: row.id } });
}

async function revertApprovedLeave({ row, companyId }) {
  const days = Number(row.days || 0);
  const allocation = row.leaveBalanceId
    ? await prisma.hrLeaveBalance.findFirst({ where: { id: row.leaveBalanceId, companyId } })
    : null;
  if (allocation) {
    await prisma.hrLeaveBalance.update({
      where: { id: allocation.id },
      data: { used: round2(Math.max(0, Number(allocation.used || 0) - days)) }
    });
  }
  await prisma.hrAttendance.deleteMany({
    where: { companyId, leaveApplicationId: row.id, employeeId: row.employeeId }
  });
  return prisma.hrLeave.findFirst({ where: { id: row.id } });
}

async function allocateLeavesFromPolicyAssignment({ row, companyId }) {
  const policy = row.leavePolicyId
    ? await prisma.hrLeavePolicy.findFirst({ where: { id: row.leavePolicyId, companyId } })
    : null;
  const details = Array.isArray(policy?.details) ? policy.details : [];
  const year = dayStart(row.fromDate || new Date()).getUTCFullYear();
  const created = [];
  for (const detail of details) {
    const leaveTypeId = detail.leaveTypeId || detail.leave_type_id;
    if (!leaveTypeId) continue;
    const type = await prisma.hrLeaveType.findFirst({ where: { id: leaveTypeId, companyId } });
    if (!type) continue;
    const newLeaves = round2(detail.annualAllocation ?? detail.annual_allocation ?? 0);
    const carry = round2(detail.carryForwardLeaves ?? 0);
    const data = {
      companyId,
      employeeId: row.employeeId,
      leaveTypeId,
      year,
      totalLeavesAllocated: round2(newLeaves + carry),
      newLeaves,
      carryForwardLeaves: carry,
      accrued: newLeaves,
      carried: carry,
      used: 0,
      encashed: 0,
      leavePeriodId: row.leavePeriodId || null,
      policyAssignmentId: row.id,
      fromDate: row.fromDate || null,
      toDate: row.toDate || null,
      status: 'Open',
      docStatus: 1
    };
    const existing = await prisma.hrLeaveBalance.findFirst({
      where: { employeeId: row.employeeId, leaveTypeId, year }
    });
    created.push(
      existing
        ? await prisma.hrLeaveBalance.update({ where: { id: existing.id }, data })
        : await prisma.hrLeaveBalance.create({ data })
    );
  }
  if (!created.length && row.newLeaves) {
    const types = await prisma.hrLeaveType.findMany({ where: { companyId } });
    for (const type of types) {
      const existing = await prisma.hrLeaveBalance.findFirst({
        where: { employeeId: row.employeeId, leaveTypeId: type.id, year }
      });
      const data = {
        companyId,
        employeeId: row.employeeId,
        leaveTypeId: type.id,
        year,
        totalLeavesAllocated: round2(row.newLeaves),
        newLeaves: round2(row.newLeaves),
        accrued: round2(row.newLeaves),
        leavePeriodId: row.leavePeriodId || null,
        policyAssignmentId: row.id,
        fromDate: row.fromDate || null,
        toDate: row.toDate || null,
        status: 'Open',
        docStatus: 1
      };
      created.push(
        existing
          ? await prisma.hrLeaveBalance.update({ where: { id: existing.id }, data })
          : await prisma.hrLeaveBalance.create({ data })
      );
    }
  }
  return prisma.hrLeavePolicyAssignment.findFirst({
    where: { id: row.id },
    include: { balances: true }
  });
}

async function prepareLeaveEncashment({ data, companyId }) {
  if (data.employeeId) {
    const emp = await prisma.hrEmployee.findFirst({ where: { id: data.employeeId, companyId } });
    if (emp) {
      data.employeeName = data.employeeName || emp.employeeName || '';
      data.department = data.department || emp.department || '';
      if (!data.currency) data.currency = emp.salaryCurrency || '';
    }
  }

  const { allocation } = await allocationFor(
    companyId,
    data.employeeId,
    data.leaveTypeId,
    data.effectiveDate || data.postingDate || new Date()
  );
  if (allocation) {
    data.leaveBalanceId = allocation.id;
    const remaining = allocationRemaining(allocation);
    data.allocatableLeave = remaining;
    data.actualEncashableDays = remaining;
  }

  const days = Number(data.encashmentDays || 0);
  const daily = Number(data.dailyRate || 0);
  if (days > 0 && daily > 0) data.payableAmount = round2(days * daily);
  else if (days > 0 && data.employeeId) {
    const emp = await prisma.hrEmployee.findFirst({ where: { id: data.employeeId, companyId } });
    const monthly = Number(emp?.salary || 0);
    const rate = monthly > 0 ? monthly / 30 : 0;
    data.dailyRate = round2(rate);
    data.payableAmount = round2(days * rate);
  }

  if (!data.payViaPaymentEntry) {
    data.expenseAccount = data.expenseAccount || '';
    data.payableAccount = data.payableAccount || '';
  }
}

async function reserveEncashmentDays({ row, companyId }) {
  const days = round2(Number(row.encashmentDays || 0));
  if (!(days > 0)) badRequest('Encashment days must be greater than zero');
  const allocation = row.leaveBalanceId
    ? await prisma.hrLeaveBalance.findFirst({ where: { id: row.leaveBalanceId, companyId } })
    : (await allocationFor(companyId, row.employeeId, row.leaveTypeId, row.effectiveDate)).allocation;
  if (!allocation) badRequest('No leave allocation found for this employee and leave type');
  const remaining = allocationRemaining(allocation);
  if (days > remaining) badRequest(`Only ${remaining} encashable day(s) available in this allocation`);

  const type = row.leaveTypeId
    ? await prisma.hrLeaveType.findFirst({ where: { id: row.leaveTypeId, companyId } })
    : null;
  if (type && !type.encashable) badRequest(`${type.name} is not encashable`);

  const employee = await prisma.hrEmployee.findFirst({ where: { id: row.employeeId, companyId } });
  const monthly = Number(employee?.salary || 0);
  const daily = round2(Number(row.dailyRate || 0) || (monthly > 0 ? monthly / 30 : 0));
  const payable = round2(days * daily);

  await prisma.hrLeaveBalance.update({
    where: { id: allocation.id },
    data: { encashed: round2(Number(allocation.encashed || 0) + days) }
  });
  return prisma.hrLeaveEncashment.update({
    where: { id: row.id },
    data: { dailyRate: daily, payableAmount: payable, leaveBalanceId: allocation.id }
  });
}

// ── Payroll ───────────────────────────────────────────────────────────────

async function syncEmployeeSalaryFromAssignment({ row, companyId }) {
  const employee = await prisma.hrEmployee.findFirst({ where: { id: row.employeeId, companyId } });
  if (!employee) return null;
  const structure = row.salaryStructureId
    ? await prisma.hrSalaryStructure.findFirst({ where: { id: row.salaryStructureId, companyId } })
    : null;
  const updated = await prisma.hrEmployee.update({
    where: { id: employee.id },
    data: {
      salary: round2(Number(row.base || 0)),
      salaryCurrency: String(row.currency || structure?.currency || employee.salaryCurrency || '').toUpperCase(),
      costCenter: String(row.costCenter || employee.costCenter || ''),
      costCenterId: employee.costCenterId
    }
  });
  return prisma.hrSalaryStructureAssignment.findFirst({ where: { id: row.id } }) || updated;
}

async function salarySlipFor(companyId, employeeId, period) {
  if (!period) return null;
  return prisma.hrPayrollItem.findFirst({
    where: { companyId, employeeId, period },
    orderBy: { createdAt: 'desc' }
  });
}

async function addExtraToSlip({ slip, companyId, amount, label, kind, componentId, sourceId }) {
  if (!slip) return null;
  const breakdown = slip.breakdown && typeof slip.breakdown === 'object' ? { ...slip.breakdown } : {};
  const extras = Array.isArray(breakdown.extras) ? breakdown.extras : [];
  if (sourceId && extras.some((e) => e.sourceId === sourceId)) return slip;
  extras.push({ label, amount: round2(amount), kind, componentId: componentId || null, sourceId: sourceId || null });
  breakdown.extras = extras;

  const earnings = Number(breakdown.earnings || 0) + (kind === 'earning' ? round2(amount) : 0);
  const deductions = Number(breakdown.deductions || 0) + (kind === 'deduction' ? round2(amount) : 0);
  const totalEarning = round2(earnings);
  const net = round2(totalEarning - deductions);
  const isDraft = !['Paid', 'Finalized', 'Posted', 'Cancelled'].includes(slip.status);
  return prisma.hrPayrollItem.update({
    where: { id: slip.id },
    data: isDraft
      ? {
          breakdown: { ...breakdown, earnings: round2(earnings), deductions: round2(deductions) },
          totalEarning,
          deductions: round2(deductions),
          net,
          overtime: kind === 'earning' ? round2(Number(slip.overtime || 0) + amount) : Number(slip.overtime || 0)
        }
      : { breakdown }
  });
}

async function applyAdditionalSalaryToPayroll({ row, companyId }) {
  const period = String(row.period || (row.fromDate ? dayStart(row.fromDate).toISOString().slice(0, 7) : ''));
  const slip = await salarySlipFor(companyId, row.employeeId, period);
  const kind = row.additionalType === 'Deduction' ? 'deduction' : 'earning';
  const updated = await addExtraToSlip({
    slip,
    companyId,
    amount: Number(row.amount || 0),
    label: row.reason || 'Additional Salary',
    kind,
    componentId: row.salaryComponentId,
    sourceId: row.id
  });
  if (updated) {
    await prisma.hrBonus.update({ where: { id: row.id }, data: { payrollItemId: updated.id } });
  }
  return prisma.hrBonus.findFirst({ where: { id: row.id } });
}

async function computeOvertimeAmount({ data, companyId }) {
  // ERPNext Overtime Slip: totals come from the Overtime Details child table.
  const details = Array.isArray(data.overtimeDetails) ? data.overtimeDetails : [];
  if (details.length) {
    let total = 0;
    for (const row of details) {
      const duration = Number(row.overtimeDuration || 0);
      if (!(duration > 0)) badRequest('Each overtime detail needs a duration greater than zero');
      if (!row.date) badRequest('Each overtime detail needs a date');
      if (!row.overtimeTypeId) badRequest('Each overtime detail needs an Overtime Type');
      if (row.overtimeTypeId) {
        const type = await prisma.hrOvertimeType.findFirst({ where: { id: row.overtimeTypeId, companyId } });
        const max = Number(row.maximumOvertimeHoursAllowed || type?.maxHoursPerDay || 0);
        if (max > 0 && duration > max) {
          badRequest(`Overtime on ${row.date} cannot exceed ${max} hours`);
        }
        if (type && row.maximumOvertimeHoursAllowed === undefined) {
          row.maximumOvertimeHoursAllowed = Number(type.maxHoursPerDay || 0);
        }
      }
      total += duration;
    }
    data.totalOvertimeDuration = round2(total);
    data.hours = data.totalOvertimeDuration;
    if (!data.startDate && details[0]?.date) data.startDate = dayStart(details[0].date);
    if (!data.endDate) {
      const last = details[details.length - 1];
      if (last?.date) data.endDate = dayStart(last.date);
    }
    if (!data.workDate) data.workDate = dayStart(data.startDate || details[0].date);
    if (!data.overtimeTypeId) data.overtimeTypeId = details[0].overtimeTypeId || null;
  }

  if (!data.postingDate) data.postingDate = dayStart(new Date());
  if (data.startDate) data.startDate = dayStart(data.startDate);
  if (data.endDate) data.endDate = dayStart(data.endDate);
  if (data.workDate) data.workDate = dayStart(data.workDate);
  else if (data.startDate) data.workDate = data.startDate;

  const hours = Number(data.hours || data.totalOvertimeDuration || 0);
  if (!(hours > 0)) badRequest('Overtime duration must be greater than zero — add Overtime Details rows');

  if (data.overtimeTypeId) {
    const type = await prisma.hrOvertimeType.findFirst({ where: { id: data.overtimeTypeId, companyId } });
    if (type) {
      if (type.maxHoursPerDay && hours > Number(type.maxHoursPerDay) && !details.length) {
        badRequest(`Overtime cannot exceed ${type.maxHoursPerDay} hours for ${type.name}`);
      }
      const multiplier = Number(type.standardMultiplier || 1);
      if (!data.payRateMultiplier) data.payRateMultiplier = multiplier;
      if (type.overtimeCalculationMethod === 'Fixed Hourly Rate' && Number(type.hourlyRate || 0) > 0) {
        data.rate = Number(type.hourlyRate);
      }
    }
  }
  if (!data.rate || Number(data.rate) <= 0) {
    const employee = data.employeeId
      ? await prisma.hrEmployee.findFirst({ where: { id: data.employeeId, companyId } })
      : null;
    const monthly = Number(employee?.salary || 0);
    data.rate = monthly > 0 ? round2(monthly / 30 / 8) : 0;
    if (employee) {
      data.employeeName = data.employeeName || employee.employeeName || '';
      data.department = data.department || employee.department || '';
    }
  }
  data.amount = round2(hours * Number(data.rate || 0) * Number(data.payRateMultiplier || 1));
}

async function prepareSalaryComponent({ data }) {
  const name = String(data.name || '').trim();
  if (!name) badRequest('Name is required');
  data.name = name;
  if (!String(data.abbr || '').trim()) {
    // ERPNext auto-fills Abbr from the component name when left blank.
    data.abbr = name
      .split(/\s+/)
      .map((part) => part[0] || '')
      .join('')
      .toUpperCase()
      .slice(0, 10) || name.slice(0, 3).toUpperCase();
  }
  if (!Array.isArray(data.accounts)) data.accounts = [];
}

async function normalizeTimesheet({ data, companyId }) {
  const logs = Array.isArray(data.timeLogs) ? data.timeLogs : [];
  if (!logs.length) badRequest('Add at least one Time Sheet row');

  let totalHours = 0;
  let billableHours = 0;
  let billableAmount = 0;
  let costingAmount = 0;
  let minFrom = null;
  let maxTo = null;

  for (const row of logs) {
    let hours = Number(row.hours || 0);
    if ((!hours || hours <= 0) && row.fromTime && row.toTime) {
      const from = new Date(row.fromTime).getTime();
      const to = new Date(row.toTime).getTime();
      if (Number.isFinite(from) && Number.isFinite(to) && to > from) {
        hours = round2((to - from) / 3600000);
        row.hours = hours;
      }
    }
    if (!(hours > 0)) badRequest('Each time log needs hours (or From/To Time)');

    if (row.activityTypeId && (!row.billingRate || !row.costingRate)) {
      const activity = await prisma.hrActivityType.findFirst({
        where: { id: row.activityTypeId, companyId }
      });
      if (activity) {
        if (!row.billingRate) row.billingRate = Number(activity.billingRate || 0);
        if (!row.costingRate) row.costingRate = Number(activity.costingRate || 0);
      }
    }

    const isBillable = row.isBillable === true || row.isBillable === 1 || row.billable === true;
    row.isBillable = Boolean(isBillable);
    const billingHours = isBillable ? Number(row.billingHours || hours) : 0;
    row.billingHours = billingHours;
    row.billingAmount = round2(billingHours * Number(row.billingRate || 0));
    row.costingAmount = round2(hours * Number(row.costingRate || 0));

    totalHours += hours;
    billableHours += billingHours;
    billableAmount += Number(row.billingAmount || 0);
    costingAmount += Number(row.costingAmount || 0);

    if (row.fromTime) {
      const d = new Date(row.fromTime);
      if (!minFrom || d < minFrom) minFrom = d;
    }
    if (row.toTime) {
      const d = new Date(row.toTime);
      if (!maxTo || d > maxTo) maxTo = d;
    }
  }

  data.totalHours = round2(totalHours);
  data.totalBillableHours = round2(billableHours);
  data.totalBillableAmount = round2(billableAmount);
  data.totalCostingAmount = round2(costingAmount);
  data.totalBilledHours = Number(data.totalBilledHours || 0);
  data.totalBilledAmount = Number(data.totalBilledAmount || 0);
  data.perBilled =
    data.totalBillableAmount > 0
      ? round2((data.totalBilledAmount / data.totalBillableAmount) * 100)
      : 0;
  if (minFrom) data.startDate = dayStart(minFrom);
  if (maxTo) data.endDate = dayStart(maxTo);
  if (!data.namingSeries) data.namingSeries = 'TS-.YYYY.-';
  if (!data.title && data.employeeName) data.title = data.employeeName;

  if (data.employeeId) {
    const emp = await prisma.hrEmployee.findFirst({ where: { id: data.employeeId, companyId } });
    if (emp) {
      data.employeeName = data.employeeName || emp.employeeName || '';
      data.department = data.department || emp.department || '';
      if (!data.userId && emp.userId) data.userId = emp.userId;
    }
  }
}

async function applyOvertimeSlipToPayroll({ row, companyId }) {
  const period = dayStart(row.workDate).toISOString().slice(0, 7);
  const slip = await salarySlipFor(companyId, row.employeeId, period);
  const updated = await addExtraToSlip({
    slip,
    companyId,
    amount: Number(row.amount || 0),
    label: `Overtime ${dayStart(row.workDate).toISOString().slice(0, 10)}`,
    kind: 'earning',
    sourceId: row.id
  });
  if (updated) {
    await prisma.hrOvertime.update({ where: { id: row.id }, data: { salarySlipId: updated.id } });
    await prisma.hrAttendance.updateMany({
      where: { companyId, employeeId: row.employeeId, workDate: dayStart(row.workDate) },
      data: { overtimeHours: round2(Number(row.hours || 0)), overtimeTypeId: row.overtimeTypeId || null }
    });
  }
  return prisma.hrOvertime.findFirst({ where: { id: row.id } });
}

// ── Shift & attendance ────────────────────────────────────────────────────

async function validateShiftType({ data }) {
  const start = minutesOfDay(data.startTime);
  const end = minutesOfDay(data.endTime);
  if (start !== null && end !== null && !data.isNight && end <= start) {
    badRequest('Shift "To Date"/end time must be after the start time (or mark the shift as night)');
  }
  if (data.enableAutoAttendance) {
    if (!(Number(data.firstCheckinThresholdMinutes || 0) > 0) || !(Number(data.lastCheckoutThresholdMinutes || 0) > 0)) {
      badRequest('Auto attendance needs both the first check-in and last check-out thresholds');
    }
  }
  if (Number(data.breakMinutes || 0) < 0) badRequest('Break minutes cannot be negative');
}

// ERPNext generates auto attendance with the "Process Auto Attendance for
// Shift" job; here the same rule runs for each Employee Checkin log, so a log
// only reaches Attendance when the shift has auto attendance switched on and
// the log falls inside the shift's check-in/check-out thresholds.
const WORK_TIME_ZONE = 'Asia/Karachi';
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

async function processAutoAttendance({ row, companyId }) {
  if (!row?.logTime || !row.employeeId) return;

  const logTime = new Date(row.logTime);
  const workDate = workDateKey(logTime);
  const roster = await prisma.hrRoster.findUnique({
    where: { employeeId_workDate: { employeeId: row.employeeId, workDate } },
    select: { shiftId: true }
  });
  const shiftId =
    roster?.shiftId ||
    (await prisma.hrEmployee.findFirst({
      where: { id: row.employeeId, companyId },
      select: { defaultShiftId: true }
    }))?.defaultShiftId;
  if (!shiftId) return;

  const shift = await prisma.hrShift.findFirst({ where: { id: shiftId, companyId } });
  if (!shift || !shift.enableAutoAttendance) return;

  const workingDays = Array.isArray(shift.workingDays) ? shift.workingDays.filter(Boolean) : [];
  if (workingDays.length && !workingDays.some((d) => WEEKDAYS[workDate.getUTCDay()] === String(d).slice(0, 3))) {
    return;
  }

  const start = minutesOfDay(shift.startTime) ?? 0;
  let end = minutesOfDay(shift.endTime) ?? 0;
  if (end <= start) end += 24 * 60;
  const logged = minutesOfDayInZone(logTime, WORK_TIME_ZONE);
  const isOut = String(row.logType).toUpperCase() === 'OUT';

  if (isOut) {
    if (logged > end + Number(shift.lastCheckoutThresholdMinutes || 0)) return;
  } else if (logged < start - Number(shift.firstCheckinThresholdMinutes || 0)) {
    return;
  }

  let attendance = await prisma.hrAttendance.findUnique({
    where: { employeeId_workDate: { employeeId: row.employeeId, workDate } }
  });
  // approved leave and manually marked days stay as they are
  if (attendance?.leaveApplicationId || String(attendance?.status) === 'on_leave') {
    await prisma.hrEmployeeCheckin.update({ where: { id: row.id }, data: { shiftId } });
    return;
  }

  if (!isOut) {
    if (attendance?.checkIn && new Date(attendance.checkIn) <= logTime) {
      await prisma.hrEmployeeCheckin.update({
        where: { id: row.id },
        data: { shiftId, attendanceId: attendance.id }
      });
      return;
    }
    const late =
      shift.enableLateEntryMarking && logged > start + Number(shift.graceMinutes || 0);
    const data = {
      shiftId,
      checkIn: logTime,
      status: late ? 'late' : 'present',
      lateEntry: late
    };
    attendance = attendance
      ? await prisma.hrAttendance.update({ where: { id: attendance.id }, data })
      : await prisma.hrAttendance.create({
          data: { companyId, employeeId: row.employeeId, workDate, source: 'auto', ...data }
        });
  } else {
    if (!attendance?.checkIn) return;
    if (attendance.checkOut && new Date(attendance.checkOut) >= logTime) {
      await prisma.hrEmployeeCheckin.update({
        where: { id: row.id },
        data: { shiftId, attendanceId: attendance.id }
      });
      return;
    }
    const worked = Math.max(
      0,
      Math.round((logTime.getTime() - new Date(attendance.checkIn).getTime()) / 60000) -
        Number(shift.breakMinutes || 0)
    );
    attendance = await prisma.hrAttendance.update({
      where: { id: attendance.id },
      data: {
        shiftId,
        checkOut: logTime,
        workingMinutes: worked,
        earlyExit:
          Boolean(shift.enableEarlyExitMarking) &&
          logged < end - Number(shift.earlyExitGraceMinutes || 0)
      }
    });
  }

  await prisma.hrEmployeeCheckin.update({
    where: { id: row.id },
    data: { shiftId, attendanceId: attendance.id }
  });
}

async function assignShiftFromRequest({ row, companyId }) {
  if (!row.shiftId) badRequest('The shift request has no shift assigned');
  const shift = await prisma.hrShift.findFirst({ where: { id: row.shiftId, companyId } });
  if (!shift) badRequest('The requested shift no longer exists');
  const workingDays = Array.isArray(shift.workingDays) && shift.workingDays.length
    ? new Set(shift.workingDays.map((d) => String(d).slice(0, 3)))
    : null;
  const names = WEEKDAYS;
  let assigned = 0;
  for (const workDate of dayKeys(row.fromDate, row.toDate)) {
    if (workingDays && !workingDays.has(names[workDate.getUTCDay()])) continue;
    await prisma.hrRoster.upsert({
      where: { employeeId_workDate: { employeeId: row.employeeId, workDate } },
      create: { companyId, employeeId: row.employeeId, workDate, shiftId: shift.id, status: 'Scheduled' },
      update: { shiftId: shift.id, status: 'Scheduled' }
    });
    assigned += 1;
  }
  await prisma.hrShiftRequest.update({
    where: { id: row.id },
    data: { assignedBy: String(row.approverId || ''), assignedAt: new Date() }
  });
  return Object.assign({}, row, { assignedDays: assigned });
}

async function normalizeAttendanceRequest({ data }) {
  if (!data.fromDate && data.workDate) data.fromDate = dayStart(data.workDate);
  if (!data.toDate && data.fromDate) data.toDate = data.fromDate;
  if (data.fromDate && data.toDate && dayStart(data.toDate) < dayStart(data.fromDate)) {
    badRequest('"To Date" cannot be before "From Date"');
  }
  if (data.workDate) data.workDate = dayStart(data.workDate);
  // the pre-ERPNext table keeps one NOT NULL date and one NOT NULL type; the
  // ERPNext from/to range is the source of truth, so the legacy columns mirror it
  else if (data.fromDate) data.workDate = dayStart(data.fromDate);
  if (data.halfDayDate) data.halfDayDate = dayStart(data.halfDayDate);
  if (data.halfDay && !data.halfDayDate) badRequest('Half Day Date is required when Half Day is checked');
  // ERPNext Reason select drives the attendance status that approval writes.
  const reason = String(data.reason || '').trim();
  if (reason && !['Work From Home', 'On Duty'].includes(reason)) {
    // legacy free-text reasons still save; mark attendance as Present
    data.attendanceStatus = data.attendanceStatus || 'Present';
  } else if (data.halfDay) {
    data.attendanceStatus = 'Half Day';
  } else if (reason === 'Work From Home') {
    data.attendanceStatus = 'Work From Home';
  } else {
    data.attendanceStatus = 'Present'; // On Duty
  }
  data.action = 'Make Attendance';
  if (!data.requestType) data.requestType = reason || 'regularization';
}

async function applyAttendanceRequest({ row, companyId }) {
  const explained = row.action === 'Explain Absence';
  let statusLabel = row.attendanceStatus || 'Present';
  if (!explained) {
    if (row.halfDay) statusLabel = 'Half Day';
    else if (String(row.reason) === 'Work From Home') statusLabel = 'Work From Home';
    else if (String(row.reason) === 'On Duty') statusLabel = 'Present';
  }
  const status = explained ? 'absent' : attendanceStatusKey(statusLabel);
  const dates = dayKeys(row.fromDate || row.workDate, row.toDate || row.workDate);
  const shift = row.shiftId ? await prisma.hrShift.findFirst({ where: { id: row.shiftId, companyId } }) : null;
  const remarks = [row.reason, row.explanation].filter(Boolean).join(' — ');
  for (const workDate of dates) {
    await prisma.hrAttendance.upsert({
      where: { employeeId_workDate: { employeeId: row.employeeId, workDate } },
      create: {
        companyId,
        employeeId: row.employeeId,
        workDate,
        status,
        source: 'attendance-request',
        attendanceRequestId: row.id,
        shiftId: shift?.id || null,
        remarks
      },
      update: {
        // ERPNext: shift is not overwritten on existing attendance records.
        status,
        attendanceRequestId: row.id,
        remarks
      }
    });
  }
  return prisma.hrAttendanceCorrection.findFirst({ where: { id: row.id } });
}

// ── Expenses ──────────────────────────────────────────────────────────────

async function computeExpenseClaimTotals({ data }) {
  const expenses = Array.isArray(data.expenses) ? data.expenses : [];
  const advances = Array.isArray(data.advances) ? data.advances : [];
  const totalClaimed = round2(expenses.reduce((sum, e) => sum + Number(e.amount || 0), 0));
  const totalAdvance = round2(advances.reduce((sum, a) => sum + Number(a.allocatedAmount || 0), 0));
  if (!(totalClaimed > 0)) badRequest('Add at least one expense line with an amount');
  data.totalClaimed = totalClaimed;
  data.totalAdvance = totalAdvance;
  if (!data.approvedAmount) data.approvedAmount = totalClaimed;
  data.sanctionedAmount = data.approvedAmount;
  data.reimbursement = round2(Number(data.approvedAmount || 0) - totalAdvance);
  if (!data.claimDate) data.claimDate = dayStart(new Date());
}

async function postExpenseClaimJournal({ row, companyId, ctx, req }) {
  if (row.journalEntryId) return prisma.hrExpenseClaim.findFirst({ where: { id: row.id } });
  const amount = round2(Number(row.approvedAmount || row.totalClaimed || 0));
  if (!(amount > 0)) return row;

  const accounts = await Promise.all([
    row.expenseAccount
      ? prisma.chartOfAccount.findFirst({ where: { companyId, id: row.expenseAccount } })
      : prisma.chartOfAccount.findFirst({
          where: { companyId, OR: [{ code: '5200' }, { name: { contains: 'Expense', mode: 'insensitive' } }] }
        }),
    row.payableAccount
      ? prisma.chartOfAccount.findFirst({ where: { companyId, id: row.payableAccount } })
      : prisma.chartOfAccount.findFirst({
          where: { companyId, name: { contains: 'Payable', mode: 'insensitive' } }
        })
  ]);
  const [expense, payable] = accounts;
  if (!expense || !payable) {
    return prisma.hrExpenseClaim.update({
      where: { id: row.id },
      data: { status: 'Approved', journalEntryId: null }
    });
  }
  const count = await prisma.journalEntry.count({ where: { companyId } });
  const entry = await prisma.journalEntry.create({
    data: {
      entryNumber: `JE-EXP-${new Date().getFullYear()}-${String(count + 1).padStart(4, '0')}`,
      date: new Date(),
      description: `Expense claim ${row.id}`,
      reference: `HR-EXP-${row.id}`,
      status: 'Posted',
      type: 'Expense',
      companyId,
      createdBy: String((req?.user && (req.user.id || req.user._id)) || ctx?.userId || ''),
      postedAt: new Date(),
      lines: {
        create: [
          {
            accountId: expense.id,
            accountName: expense.name,
            accountCode: expense.code,
            debit: amount,
            credit: 0,
            costCenterId: row.costCenter || null
          },
          {
            accountId: payable.id,
            accountName: payable.name,
            accountCode: payable.code,
            debit: 0,
            credit: amount,
            costCenterId: null
          }
        ]
      }
    }
  });
  return prisma.hrExpenseClaim.update({ where: { id: row.id }, data: { journalEntryId: entry.id } });
}

// ── Tenure / recruitment / performance ────────────────────────────────────

async function createEmployeeFromOnboarding({ row, companyId }) {
  if (row.employeeId) return prisma.hrEmployeeOnboarding.findFirst({ where: { id: row.id } });
  const code = await nextEmployeeCode(companyId);
  const department = await resolveByName('hrDepartment', companyId, row.department);
  const designation = await resolveByName('hrDesignation', companyId, row.designation);
  const grade = await resolveByName('hrEmployeeGrade', companyId, row.grade);
  const employee = await prisma.hrEmployee.create({
    data: {
      companyId,
      userId: null,
      employeeCode: row.employeeId || code,
      department: department?.name || row.department || '',
      designation: designation?.name || row.designation || '',
      departmentId: department?.id || null,
      designationId: designation?.id || null,
      employeeGradeId: grade?.id || null,
      employmentType: row.employmentType || 'Full Time',
      joiningDate: row.dateOfJoining || dayStart(new Date()),
      status: 'active',
      profile: {
        firstName: row.firstName,
        lastName: row.lastName,
        name: [row.firstName, row.lastName].filter(Boolean).join(' '),
        email: row.email || '',
        onboardedFrom: row.id
      }
    }
  });
  return prisma.hrEmployeeOnboarding.update({
    where: { id: row.id },
    data: { employeeId: employee.id, boardingStatus: 'Completed' }
  });
}

async function markEmployeeSeparated({ row, companyId }) {
  const employee = await prisma.hrEmployee.findFirst({ where: { id: row.employeeId, companyId } });
  if (!employee) return row;
  await prisma.hrEmployee.update({
    where: { id: employee.id },
    data: {
      status: 'terminated',
      profile: {
        ...(employee.profile || {}),
        terminationDate: row.separationDate ? dayStart(row.separationDate).toISOString().slice(0, 10) : dayStart(new Date()).toISOString().slice(0, 10),
        separationReason: row.reason || ''
      }
    }
  });
  await prisma.hrLifecycleEvent.create({
    data: {
      companyId,
      employeeId: employee.id,
      type: 'resignation',
      toValue: 'Left',
      effective: row.separationDate || dayStart(new Date()),
      notes: row.reason || 'Employee Separation',
      status: 'Completed'
    }
  });
  return prisma.hrEmployeeSeparation.update({
    where: { id: row.id },
    data: { boardingStatus: 'Completed' }
  });
}

async function applyEmployeeTransfer({ row, companyId }) {
  const employee = await prisma.hrEmployee.findFirst({ where: { id: row.employeeId, companyId } });
  if (!employee) badRequest('Employee not found for this transfer');
  const toDepartment = await resolveByName('hrDepartment', companyId, row.toDepartment);
  const toDesignation = await resolveByName('hrDesignation', companyId, row.toDesignation);
  await prisma.hrEmployee.update({
    where: { id: employee.id },
    data: {
      department: toDepartment?.name || row.toDepartment || employee.department,
      designation: toDesignation?.name || row.toDesignation || employee.designation,
      departmentId: toDepartment?.id || employee.departmentId,
      designationId: toDesignation?.id || employee.designationId
    }
  });
  await prisma.hrLifecycleEvent.create({
    data: {
      companyId,
      employeeId: employee.id,
      type: 'transfer',
      fromValue: `${row.fromDepartment || employee.department} / ${row.fromDesignation || employee.designation}`.trim(),
      toValue: `${row.toDepartment || ''} / ${row.toDesignation || ''}`.trim(),
      effective: row.transferDate,
      notes: row.reason || row.remark || '',
      status: 'Completed'
    }
  });
  return prisma.hrEmployeeTransfer.findFirst({ where: { id: row.id } });
}

async function applyEmployeePromotion({ row, companyId }) {
  const employee = await prisma.hrEmployee.findFirst({ where: { id: row.employeeId, companyId } });
  if (!employee) badRequest('Employee not found for this promotion');
  const toDepartment = await resolveByName('hrDepartment', companyId, row.toDepartment);
  const toDesignation = await resolveByName('hrDesignation', companyId, row.toDesignation);
  const toGrade = await resolveByName('hrEmployeeGrade', companyId, row.toGrade);
  await prisma.hrEmployee.update({
    where: { id: employee.id },
    data: {
      department: toDepartment?.name || employee.department,
      designation: toDesignation?.name || employee.designation,
      departmentId: toDepartment?.id || employee.departmentId,
      designationId: toDesignation?.id || employee.designationId,
      employeeGradeId: toGrade?.id || employee.employeeGradeId,
      ctC: Number(row.ctC || 0) > 0 ? round2(row.ctC) : employee.ctC
    }
  });
  if (row.salaryStructureId) {
    const existing = await prisma.hrSalaryStructureAssignment.findFirst({
      where: { companyId, employeeId: employee.id, salaryStructureId: row.salaryStructureId, fromDate: row.promotionDate }
    });
    if (!existing) {
      await prisma.hrSalaryStructureAssignment.create({
        data: {
          companyId,
          employeeId: employee.id,
          salaryStructureId: row.salaryStructureId,
          base: round2(Number(row.ctC || employee.salary || 0)),
          fromDate: row.promotionDate,
          status: 'Submitted',
          docStatus: 1,
          notes: `Created by promotion ${row.id}`
        }
      });
    }
  }
  await prisma.hrLifecycleEvent.create({
    data: {
      companyId,
      employeeId: employee.id,
      type: 'promotion',
      fromValue: `${row.fromDesignation || employee.designation} / ${row.fromGrade || ''}`.trim(),
      toValue: `${row.toDesignation || ''} / ${row.toGrade || ''}`.trim(),
      effective: row.promotionDate,
      notes: row.promotionFor || row.reason || '',
      status: 'Completed'
    }
  });
  return prisma.hrEmployeePromotion.findFirst({ where: { id: row.id } });
}

async function createOnboardingFromJobOffer({ row, companyId }) {
  if (row.onboardingId) return prisma.hrJobOffer.findFirst({ where: { id: row.id } });
  const applicant = await prisma.hrJobApplicant.findFirst({ where: { id: row.jobApplicantId, companyId } });
  if (!applicant) badRequest('Job applicant not found for this offer');
  const [first, ...rest] = String(applicant.applicantName || '').trim().split(/\s+/);
  const template = row.components && typeof row.components === 'object' ? row.components : null;
  const onboarding = await prisma.hrEmployeeOnboarding.create({
    data: {
      companyId,
      firstName: first || applicant.applicantName || 'New',
      lastName: rest.join(' '),
      email: applicant.emailId || '',
      designation: row.designation || applicant.designation || '',
      department: row.department || '',
      grade: row.grade || '',
      employmentType: row.employmentType || 'Full Time',
      dateOfJoining: row.expectedJoiningDate || null,
      offerDate: row.offerDate || dayStart(new Date()),
      jobOfferId: row.id,
      activities: Array.isArray(template?.activities) ? template.activities : [],
      boardingStatus: 'Pending',
      status: 'Draft',
      docStatus: 0
    }
  });
  await prisma.hrJobOffer.update({ where: { id: row.id }, data: { onboardingId: onboarding.id } });
  return prisma.hrJobOffer.findFirst({ where: { id: row.id } });
}

async function createFromJobRequisition({ row, companyId }) {
  if (row.jobOpeningId) return prisma.hrJobRequisition.findFirst({ where: { id: row.id } });
  const opening = await prisma.hrJobOpening.create({
    data: {
      companyId,
      title: row.jobTitle || row.subject,
      department: row.department || '',
      designation: row.designation || '',
      employmentType: row.employmentType || '',
      openings: Number(row.noOfPositions || 1),
      startDate: row.expectedBy || dayStart(new Date()),
      description: row.jobDescription || row.description || '',
      status: 'Open',
      published: false
    }
  });
  return prisma.hrJobRequisition.update({
    where: { id: row.id },
    data: { jobOpeningId: opening.id, approvedOn: dayStart(new Date()) }
  });
}

async function createAppraisalsFromCycle({ row, companyId }) {
  const list = Array.isArray(row.appraisees) ? row.appraisees.map((e) => String(e.employeeId || e)).filter(Boolean) : [];
  const where = { companyId, status: { not: 'terminated' } };
  if (list.length) where.id = { in: list };
  else {
    if (row.department) where.department = row.department;
    if (row.designation) where.designation = row.designation;
  }
  const employees = await prisma.hrEmployee.findMany({ where, select: { id: true } });
  const period = `${dayStart(row.startDate).toISOString().slice(0, 10)} to ${dayStart(row.endDate).toISOString().slice(0, 10)}`;
  const template = row.appraisalTemplateId
    ? await prisma.hrAppraisalTemplate.findFirst({ where: { id: row.appraisalTemplateId, companyId } })
    : null;
  const kraRows = Array.isArray(template?.kras) ? template.kras : [];
  for (const employee of employees) {
    const existing = await prisma.hrPerformanceReview.findFirst({
      where: { companyId, employeeId: employee.id, appraisalCycleId: row.id }
    });
    if (existing) continue;
    await prisma.hrPerformanceReview.create({
      data: {
        companyId,
        employeeId: employee.id,
        period,
        appraisalCycleId: row.id,
        appraisalTemplateId: row.appraisalTemplateId || null,
        kraAssessments: kraRows.map((k) => ({
          kraId: k.kraId || k.id || '',
          kra: k.kra || k.name || '',
          weight: Number(k.perWeightage || k.weight || 0),
          rating: 0,
          score: 0
        })),
        status: 'Draft',
        docStatus: 0
      }
    });
  }
  return prisma.hrAppraisalCycle.update({
    where: { id: row.id },
    data: { status: 'In Progress' }
  });
}

// ── Employee (ERPNext module Setup, doctype "Employee") ──────────────────

// The Bisonstechs tables store the legacy lowercase status words; the ERPNext
// form speaks its own vocabulary, so both directions are mapped here.
const EMPLOYEE_STATUS_TO_KEY = {
  Active: 'active',
  Inactive: 'inactive',
  Suspended: 'suspended',
  Left: 'terminated'
};

async function nextSeriesValue(companyId, series) {
  const last = await prisma.hrEmployee.findFirst({
    where: { companyId, employeeCode: { startsWith: series } },
    orderBy: { employeeCode: 'desc' },
    select: { employeeCode: true }
  });
  const digits = String(last?.employeeCode || '').slice(series.length).replace(/\D/g, '');
  return Number(digits || 0) + 1;
}

// ERPNext autonames an Employee from its naming series (HR-EMP-00001); the
// employee code is that name here, so it is minted on create and never rewritten.
async function mintEmployeeCode(companyId, series) {
  let next = await nextSeriesValue(companyId, series);
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const candidate = `${series}${String(next + attempt).padStart(5, '0')}`;
    const clash = await prisma.hrEmployee.findFirst({
      where: { companyId, employeeCode: candidate },
      select: { id: true }
    });
    if (!clash) return candidate;
  }
  badRequest(`No free employee number is available in the series ${series}`);
  return null;
}

async function normalizeEmployee({ data, companyId, currentId, action, req }) {
  if (data.firstName) data.firstName = String(data.firstName).trim();
  if (data.lastName) data.lastName = String(data.lastName).trim();

  // Employee.employee_name is read-only and composed from the name parts
  const composed = [data.firstName, data.middleName, data.lastName].filter(Boolean).join(' ').trim();
  if (composed) data.employeeName = composed;

  if (data.status) data.status = EMPLOYEE_STATUS_TO_KEY[data.status] || data.status;

  // Legacy readers (payroll, dashboards, the old employee screens) still show the
  // department/designation text columns, so they mirror the links
  if (data.departmentId) {
    const found = await resolveByName('hrDepartment', companyId, data.departmentId, 'name');
    if (found) data.department = found.name || '';
  }
  if (data.designationId) {
    const found = await resolveByName('hrDesignation', companyId, data.designationId, 'name');
    if (found) data.designation = found.name || '';
  }

  // Employee.set_prefered_email: the preferred address is picked from the
  // selected source, and nothing else can fill it
  if (data.preferedContactEmail) {
    if (data.preferedContactEmail === 'Company Email') data.preferedEmail = data.companyEmail || '';
    else if (data.preferedContactEmail === 'Personal Email') data.preferedEmail = data.personalEmail || '';
    else if (data.preferedContactEmail === 'User ID') {
      const user = data.userId
        ? await prisma.user.findFirst({ where: { id: String(data.userId) }, select: { email: true } })
        : null;
      data.preferedEmail = user?.email || '';
    }
  } else {
    data.preferedEmail = data.companyEmail || data.personalEmail || '';
  }

  if (data.dateOfBirth && data.joiningDate && dayStart(data.dateOfBirth) >= dayStart(data.joiningDate)) {
    badRequest('Date of Birth must be less than the Date of Joining');
  }
  if (data.joiningDate && data.relievingDate && dayStart(data.relievingDate) < dayStart(data.joiningDate)) {
    badRequest('Relieving Date must be greater than Date of Joining');
  }
  if (data.joiningDate && data.dateOfRetirement && dayStart(data.dateOfRetirement) < dayStart(data.joiningDate)) {
    badRequest('Retirement Date should be greater than Date of Joining');
  }
  if (data.status === 'terminated' && !data.relievingDate && !currentId) {
    badRequest('Relieving Date must be set for an employee that has left');
  }

  // Employee.attendance_device_id is unique; two logins cannot share one badge
  if (data.attendanceDeviceId) {
    const clash = await prisma.hrEmployee.findFirst({
      where: { companyId, attendanceDeviceId: String(data.attendanceDeviceId) },
      select: { id: true, employeeName: true, employeeCode: true }
    });
    if (clash && clash.id !== currentId) {
      badRequest(`Attendance Device ID is already assigned to ${clash.employeeName || clash.employeeCode}`);
    }
  }

  // a user can be linked to one employee only (Employee.user_id is unique here)
  if (data.userId) {
    const clash = await prisma.hrEmployee.findFirst({
      where: { userId: String(data.userId) },
      select: { id: true, companyId: true, employeeName: true }
    });
    if (clash && clash.id !== currentId) {
      badRequest(
        clash.companyId === companyId
          ? `That user is already linked to ${clash.employeeName || 'another employee'}`
          : 'That user belongs to another company'
      );
    }
  }

  if (action === 'create') {
    if (!data.employeeCode) data.employeeCode = await mintEmployeeCode(companyId, data.namingSeries || 'HR-EMP-');
    if (!data.employeeName) badRequest('First Name is required');
  }

  // keep the legacy JSON profile in step so the older employee screens still
  // resolve a name, an email and a phone for records created here
  const existing = currentId
    ? await prisma.hrEmployee.findFirst({ where: { id: currentId }, select: { profile: true } })
    : null;
  const profile = { ...(existing?.profile && typeof existing.profile === 'object' ? existing.profile : {}) };
  if (data.firstName !== undefined) profile.firstName = data.firstName;
  if (data.lastName !== undefined) profile.lastName = data.lastName;
  if (data.employeeName !== undefined) profile.name = data.employeeName;
  const email = data.preferedEmail || data.companyEmail || data.personalEmail;
  if (email) profile.email = email;
  if (data.phone) profile.phone = data.phone;
  data.profile = profile;
  void req;
}

// Employee.create_user_automatically: a login is created from the preferred,
// company or personal email, exactly like the HR "grant application access" flow.
async function provisionEmployeeUser({ row, companyId, req }) {
  if (row.userId || !row.createUserAutomatically) return null;
  const email = String(row.preferedEmail || row.companyEmail || row.personalEmail || '').trim().toLowerCase();
  if (!email) {
    badRequest('Cannot create the user automatically: the employee has no preferred, company or personal email');
  }

  const existing = await prisma.user.findFirst({
    where: { email: { equals: email, mode: 'insensitive' } },
    include: { hrEmployee: { select: { id: true, companyId: true } } }
  });
  if (existing?.hrEmployee) badRequest('This email is already linked to another employee');

  let user = existing;
  if (!user) {
    const { getCompanyCapacity } = require('../utils/companySubscription');
    const capacity = await getCompanyCapacity(prisma, companyId);
    if (!capacity.canAddUser) {
      badRequest(`User seat limit reached (${capacity.usedUsers}/${capacity.licensedUsers})`);
    }
    const bcrypt = require('bcryptjs');
    const { generateTempPassword } = require('../utils/hrAccess');
    const company = await prisma.company.findUnique({
      where: { id: companyId },
      select: {
        name: true,
        subscriptionPlan: true,
        subscriptionStatus: true,
        subscriptionStartDate: true,
        subscriptionEndDate: true,
        trialStartDate: true,
        trialEndDate: true
      }
    });
    const password = generateTempPassword();
    user = await prisma.user.create({
      data: {
        firstName: row.firstName || row.employeeName,
        lastName: row.lastName || row.firstName || row.employeeName,
        email,
        password: await bcrypt.hash(password, 10),
        role: 'employee',
        createdBy: String(req?.user?.id || req?.user?._id || ''),
        companyId,
        subscriptionPlan: company?.subscriptionPlan || 'trial',
        subscriptionStatus: company?.subscriptionStatus || 'active',
        subscriptionStartDate: company?.subscriptionStartDate || new Date(),
        subscriptionEndDate: company?.subscriptionEndDate || null,
        trialStartDate: company?.trialStartDate || null,
        trialEndDate: company?.trialEndDate || null,
        isActive: !['terminated', 'inactive'].includes(String(row.status || ''))
      }
    });
    try {
      const { ensureMembershipForUserCompany } = require('../utils/companyAccess');
      await ensureMembershipForUserCompany(user.id, companyId, { role: 'employee', isOwner: false });
    } catch (error) {
      console.warn('[hr-docs] employee user membership:', error.message);
    }
    try {
      const emailService = require('./emailService');
      const company = await prisma.company.findUnique({ where: { id: companyId }, select: { name: true } });
      await emailService.sendTeamInviteEmail({
        to: email,
        firstName: user.firstName,
        lastName: user.lastName,
        loginEmail: email,
        password,
        roleLabel: 'Employee',
        companyName: company?.name || 'BisonsTechs',
        invitedBy: [req?.user?.firstName, req?.user?.lastName].filter(Boolean).join(' ').trim() || req?.user?.email || 'HR'
      });
    } catch (error) {
      console.error('[hr-docs] employee invite email failed:', error.message);
    }
  }

  return prisma.hrEmployee.update({ where: { id: row.id }, data: { userId: user.id } });
}

// ── Holiday List (ERPNext module Setup) ──────────────────────────────────

const WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function holidayRowsOf(row) {
  return Array.isArray(row?.holidays) ? row.holidays : [];
}

function holidayKey(value) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString().slice(0, 10);
  return String(value || '').slice(0, 10);
}

async function normalizeHolidayList({ data, currentId }) {
  const current = currentId
    ? await prisma.hrHolidayList.findFirst({ where: { id: currentId }, select: { holidays: true } })
    : null;
  const rows = Array.isArray(data.holidays) ? data.holidays : holidayRowsOf(current);
  if (data.fromDate && data.toDate && dayStart(data.toDate) < dayStart(data.fromDate)) {
    badRequest('To Date should be greater than From Date');
  }
  const seen = new Set();
  for (let index = 0; index < rows.length; index += 1) {
    const date = holidayKey(rows[index].holidayDate);
    if (!date) continue;
    if (seen.has(date)) badRequest(`Row #${index + 1}: Date already exists`);
    seen.add(date);
    if (data.fromDate && data.toDate && (date < holidayKey(data.fromDate) || date > holidayKey(data.toDate))) {
      badRequest(`Row #${index + 1}: Date should be between From Date and To Date`);
    }
  }
  if (data.holidays !== undefined || current) data.totalHolidays = rows.length;
}

// The per-date holiday table is what attendance and the calendar read, so a
// Holiday List keeps it in step with its own child rows.
async function syncHolidayRows({ row, companyId }) {
  const name = String(row?.name || '');
  if (!name) return null;
  const saved = await prisma.$transaction(async (tx) => {
    await tx.hrHoliday.deleteMany({ where: { companyId, name } });
    const rows = holidayRowsOf(row)
      .map((child) => ({
        date: holidayKey(child.holidayDate),
        description: String(child.description || '').trim(),
        weeklyOff: Boolean(child.weeklyOff)
      }))
      .filter((child) => child.date);
    if (rows.length) {
      await tx.hrHoliday.createMany({
        data: rows.map((child) => ({
          companyId,
          name,
          date: new Date(`${child.date}T00:00:00.000Z`),
          type: child.weeklyOff ? 'Weekly Off' : 'Public',
          optional: false
        }))
      });
    }
    return tx.hrHolidayList.findFirst({ where: { id: row.id, companyId } });
  });
  return saved || row;
}

async function removeHolidayRows({ row, companyId }) {
  if (row?.name) await prisma.hrHoliday.deleteMany({ where: { companyId, name: String(row.name) } });
}

// Holiday List "Add to Holidays" for the weekly off: every weekday between the
// list dates becomes a holiday row.
async function addWeeklyOffDates({ row, companyId }) {
  const day = WEEKDAY_NAMES.indexOf(String(row.weeklyOff || ''));
  if (day < 0) badRequest('Select a Weekly Off day first');
  if (!row.fromDate || !row.toDate) badRequest('Set the From Date and To Date first');
  const existing = new Set(holidayRowsOf(row).map((child) => holidayKey(child.holidayDate)));
  const added = [];
  for (const date of dayKeys(row.fromDate, row.toDate)) {
    if (date.getUTCDay() !== day) continue;
    const key = holidayKey(date);
    if (existing.has(key)) continue;
    existing.add(key);
    added.push({ holidayDate: key, weeklyOff: true, description: `${row.weeklyOff}`, isHalfDay: Boolean(row.isHalfDay) });
  }
  const holidays = [...holidayRowsOf(row), ...added];
  const updated = await prisma.hrHolidayList.update({
    where: { id: row.id },
    data: { holidays, totalHolidays: holidays.length }
  });
  return syncHolidayRows({ row: updated, companyId });
}

// Holiday List "Clear Table"
async function clearHolidayTable({ row, companyId }) {
  const updated = await prisma.hrHolidayList.update({ where: { id: row.id }, data: { holidays: [], totalHolidays: 0 } });
  return syncHolidayRows({ row: updated, companyId });
}

// Branch has no ERPNext fields besides its name; the geofence columns this
// product added are NOT NULL, so a branch created from HR gets neutral defaults.
async function normalizeBranch({ data, currentId }) {
  if (!currentId) {
    if (data.latitude === undefined) data.latitude = 0;
    if (data.longitude === undefined) data.longitude = 0;
    if (data.isActive === undefined) data.isActive = true;
  }
}

// ERPNext Department.validate: empty parent → root "All Departments".
// Root node itself cannot be renamed / re-parented.
async function normalizeDepartment({ data, companyId, currentId }) {
  if (currentId) {
    const existing = await prisma.hrDepartment.findFirst({
      where: { id: currentId, companyId },
      select: { name: true, parentId: true }
    });
    if (existing && existing.name === 'All Departments' && !existing.parentId) {
      badRequest('This is a root department and cannot be edited.');
    }
  }
  if (data.name === 'All Departments' && currentId) {
    badRequest('You cannot edit the root node.');
  }
  if (!data.parentId) {
    let root = await prisma.hrDepartment.findFirst({
      where: { companyId, name: 'All Departments' },
      select: { id: true }
    });
    if (!root) {
      const { ensureHrMasterFixtures } = require('./hrMasterFixtures');
      await ensureHrMasterFixtures(companyId);
      root = await prisma.hrDepartment.findFirst({
        where: { companyId, name: 'All Departments' },
        select: { id: true }
      });
    }
    if (root && data.name !== 'All Departments') data.parentId = root.id;
  }
}

// ── Recruitment, lifecycle and training documents ─────────────────────────

function employeeDisplayName(employee) {
  return String(
    employee?.employeeName ||
    [employee?.firstName, employee?.middleName, employee?.lastName].filter(Boolean).join(' ') ||
    [employee?.profile?.firstName, employee?.profile?.lastName].filter(Boolean).join(' ') ||
    String(employee?.profile?.name || '')
  ).trim();
}

async function loadEmployeeById(id, companyId) {
  if (!id) return null;
  return prisma.hrEmployee.findFirst({
    where: { id: String(id), companyId },
    select: {
      id: true,
      employeeCode: true,
      employeeName: true,
      firstName: true,
      middleName: true,
      lastName: true,
      profile: true,
      department: true,
      departmentId: true,
      designation: true,
      designationId: true,
      holidayListId: true,
      companyEmail: true,
      personalEmail: true,
      preferedEmail: true,
      user: { select: { email: true } }
    }
  });
}

function eventEmployeeIds(event) {
  const list = Array.isArray(event?.employees) ? event.employees : [];
  return list
    .map((entry) => (typeof entry === 'string' ? entry : entry?.employeeId || entry?.employee))
    .filter(Boolean)
    .map(String);
}

// Appointment Letter copies the applicant name and the template body exactly
// like the ERPNext fetch_from links do.
async function prepareAppointmentLetter({ data, companyId }) {
  if (!data.jobApplicantId) badRequest('Job Applicant is required');
  const applicant = await prisma.hrJobApplicant.findFirst({
    where: { id: String(data.jobApplicantId), companyId },
    select: { id: true, applicantName: true, status: true }
  });
  if (!applicant) badRequest('Job Applicant not found for this company');
  if (!data.applicantName) data.applicantName = applicant.applicantName || '';
  if (!data.appointmentDate) data.appointmentDate = dayStart(new Date());
  if (!data.templateId) return;

  const template = await prisma.hrAppointmentLetterTemplate.findFirst({
    where: { id: String(data.templateId), companyId }
  });
  if (!template) badRequest('Appointment Letter Template not found for this company');
  if (!data.introduction) data.introduction = template.introduction || '';
  if (!Array.isArray(data.terms) || !data.terms.length) {
    data.terms = Array.isArray(template.terms) ? template.terms : [];
  }
  if (!data.closingNotes) data.closingNotes = template.closingNotes || '';
}

// Staffing Plan: per-line cost/positions and the overall budget, computed from
// live employees and open job openings (staffing_plan.py set_number_of_positions).
async function computeStaffingPlanTotals({ data, companyId }) {
  const from = dayStart(data.fromDate);
  const to = dayStart(data.toDate);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
    badRequest('From Date and To Date are required');
  }
  if (to < from) badRequest('To Date cannot be before From Date');

  const details = Array.isArray(data.staffingDetails) ? data.staffingDetails : [];
  let budget = 0;
  for (const detail of details) {
    const vacancies = Number(detail.vacancies || 0);
    const perPosition = Number(detail.estimatedCostPerPosition || 0);
    detail.totalEstimatedCost = round2(vacancies * perPosition);
    budget += detail.totalEstimatedCost;

    const designationId = detail.designationId ? String(detail.designationId) : '';
    if (!designationId) {
      detail.currentCount = 0;
      detail.currentOpenings = 0;
      detail.numberOfPositions = vacancies;
      continue;
    }
    const designation = await prisma.hrDesignation.findFirst({
      where: { id: designationId, companyId },
      select: { name: true }
    });
    const or = [{ designationId }, ...(designation?.name ? [{ designation: designation.name }] : [])];
    const [currentCount, currentOpenings] = await Promise.all([
      prisma.hrEmployee.count({ where: { companyId, status: { not: 'terminated' }, OR: or } }),
      prisma.hrJobOpening.count({ where: { companyId, status: 'Open', OR: or } })
    ]);
    detail.currentCount = currentCount;
    detail.currentOpenings = currentOpenings;
    detail.numberOfPositions = currentCount + currentOpenings + vacancies;
  }
  data.staffingDetails = details;
  data.totalEstimatedBudget = round2(budget);
}

async function prepareEmployeeReferral({ data, companyId, currentId }) {
  let first = data.firstName;
  let last = data.lastName;
  if (currentId && (first === undefined || last === undefined)) {
    const current = await prisma.hrEmployeeReferral.findFirst({
      where: { id: currentId, companyId },
      select: { firstName: true, lastName: true }
    });
    if (current) {
      if (first === undefined) first = current.firstName;
      if (last === undefined) last = current.lastName;
    }
  }
  if (first !== undefined || last !== undefined) {
    data.fullName = [first, last].filter(Boolean).join(' ').trim();
  }
  if (!currentId && !data.status) data.status = 'Pending';
  if (data.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(data.email))) {
    badRequest('Email is not valid');
  }

  if (data.referrerEmployeeId) {
    const referrer = await loadEmployeeById(data.referrerEmployeeId, companyId);
    if (!referrer) badRequest('Referrer not found for this company');
    data.referrerName = employeeDisplayName(referrer) || referrer.employeeCode || '';
    if (data.departmentId === undefined) data.departmentId = referrer.departmentId || null;
  }
}

async function prepareTrainingFeedback({ data, companyId, currentId }) {
  const eventId = data.trainingEventId;
  if (!eventId) {
    if (!currentId) badRequest('Training Event is required');
    return;
  }
  const event = await prisma.hrTrainingEvent.findFirst({
    where: { id: String(eventId), companyId },
    include: { trainingProgram: { select: { name: true } } }
  });
  if (!event) badRequest('Training Event not found for this company');
  data.eventName = event.eventName || '';
  data.trainerName = event.trainerName || '';
  if (!data.course) data.course = event.trainingProgram?.name || '';

  const employeeId = data.employeeId;
  if (!employeeId) {
    if (!currentId) badRequest('Employee is required');
    return;
  }
  const employee = await loadEmployeeById(employeeId, companyId);
  if (!employee) badRequest('Employee not found for this company');
  if (!data.employeeName) data.employeeName = employeeDisplayName(employee);
  if (!data.department) data.department = employee.departmentId || employee.department || '';

  const invited = eventEmployeeIds(event);
  if (invited.length && !invited.includes(String(employee.id))) {
    badRequest(`${data.employeeName || 'Employee'} is not added to the training event`);
  }
  const duplicate = await prisma.hrTrainingFeedback.findFirst({
    where: {
      companyId,
      trainingEventId: event.id,
      employeeId: employee.id,
      status: 'Submitted',
      ...(currentId ? { id: { not: currentId } } : {})
    },
    select: { id: true }
  });
  if (duplicate) badRequest(`${data.employeeName || 'Employee'} has already submitted feedback for this event`);
}

async function prepareTrainingResult({ data, companyId, currentId }) {
  const eventId = data.trainingEventId;
  if (!eventId) {
    if (!currentId) badRequest('Training Event is required');
    return;
  }
  const event = await prisma.hrTrainingEvent.findFirst({
    where: { id: String(eventId), companyId },
    select: { id: true, employees: true }
  });
  if (!event) badRequest('Training Event not found for this company');

  let provided = data.employees;
  if (!Array.isArray(provided) && currentId) {
    const current = await prisma.hrTrainingResult.findFirst({
      where: { id: currentId, companyId },
      select: { employees: true }
    });
    provided = current?.employees;
  }
  const rows = Array.isArray(provided) && provided.length
    ? provided.map((entry) => ({ ...entry }))
    : eventEmployeeIds(event).map((employeeId) => ({ employeeId }));

  const emails = [];
  for (const entry of rows) {
    if (!entry.employeeId) continue;
    const employee = await loadEmployeeById(entry.employeeId, companyId);
    if (!employee) badRequest('Employee not found for this company');
    if (!entry.employeeName) entry.employeeName = employeeDisplayName(employee);
    if (!entry.department) entry.department = employee.departmentId || employee.department || '';
    const email = employee.preferedEmail || employee.companyEmail || employee.personalEmail || employee.user?.email || '';
    if (email) emails.push(String(email));
  }
  data.employees = rows;
  data.employeeEmails = emails.join(', ');
}

async function prepareHolidayListAssignment({ data, companyId, currentId }) {
  if (!data.holidayListId) {
    if (!currentId) badRequest('Holiday List is required');
    return;
  }
  const list = await prisma.hrHolidayList.findFirst({
    where: { id: String(data.holidayListId), companyId },
    select: { id: true, fromDate: true, toDate: true }
  });
  if (!list) badRequest('Holiday List not found for this company');
  data.holidayListStart = list.fromDate;
  data.holidayListEnd = list.toDate;
  if (!data.fromDate) data.fromDate = list.fromDate;

  const applicableFor = data.applicableFor || 'Employee';
  if (applicableFor === 'Employee') {
    data.assignedToCompanyId = '';
    const assignedTo = data.assignedToId;
    if (assignedTo) {
      const employee = await loadEmployeeById(assignedTo, companyId);
      if (!employee) badRequest('Employee not found for this company');
      data.employeeName = employeeDisplayName(employee);
      data.employeeCompanyId = companyId;
    } else {
      if (!currentId) badRequest('Assigned To is required');
      data.employeeName = '';
      data.employeeCompanyId = '';
    }
  } else {
    data.assignedToId = '';
    data.employeeName = '';
    data.employeeCompanyId = '';
    if (!data.assignedToCompanyId && !currentId) badRequest('Assigned To is required');
  }

  const from = dayStart(data.fromDate);
  if (Number.isNaN(from.getTime())) badRequest('Assignment Starts From is required');
  if (from < dayStart(list.fromDate)) {
    badRequest('Assignment Starts From cannot be before the Holiday List start date');
  }
}

// Submitting a Holiday List Assignment writes the list on the employee(s), the
// same side effect holiday_list_assignment.py has on submit.
async function applyHolidayListAssignment({ row, companyId }) {
  if (!row?.holidayListId) return row;
  if (row.applicableFor === 'Company') {
    await prisma.hrEmployee.updateMany({
      where: { companyId, holidayListId: null },
      data: { holidayListId: row.holidayListId }
    });
  } else if (row.assignedToId) {
    await prisma.hrEmployee.updateMany({
      where: { id: row.assignedToId, companyId },
      data: { holidayListId: row.holidayListId }
    });
  }
  return row;
}

module.exports = {
  leavePeriodDates,
  normalizeLeaveAllocation,
  validateLeaveApplication,
  applyApprovedLeave,
  revertApprovedLeave,
  allocateLeavesFromPolicyAssignment,
  prepareLeaveEncashment,
  reserveEncashmentDays,
  syncEmployeeSalaryFromAssignment,
  applyAdditionalSalaryToPayroll,
  computeOvertimeAmount,
  applyOvertimeSlipToPayroll,
  prepareSalaryComponent,
  normalizeTimesheet,
  validateShiftType,
  processAutoAttendance,
  assignShiftFromRequest,
  normalizeAttendanceRequest,
  applyAttendanceRequest,
  computeExpenseClaimTotals,
  postExpenseClaimJournal,
  createEmployeeFromOnboarding,
  markEmployeeSeparated,
  applyEmployeeTransfer,
  applyEmployeePromotion,
  createOnboardingFromJobOffer,
  createFromJobRequisition,
  createAppraisalsFromCycle,
  normalizeEmployee,
  provisionEmployeeUser,
  normalizeHolidayList,
  syncHolidayRows,
  removeHolidayRows,
  addWeeklyOffDates,
  clearHolidayTable,
  normalizeBranch,
  normalizeDepartment,
  prepareAppointmentLetter,
  computeStaffingPlanTotals,
  prepareEmployeeReferral,
  prepareTrainingFeedback,
  prepareTrainingResult,
  prepareHolidayListAssignment,
  applyHolidayListAssignment,
  helpers: { allocationFor, allocationRemaining, dayKeys, dayStart, nextEmployeeCode, round2 }
};
