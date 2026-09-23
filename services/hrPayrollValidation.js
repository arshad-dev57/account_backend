'use strict';

const payrollEngine = require('./hrPayrollEngine');
const { sumLoanDeduction } = require('./hrPayrollLoanHelper');
const {
  resolveEmployeeCommissionInputs,
  resolveEmployeeBonusInputs
} = require('./hrPayrollCommission');
const { isPeriodLocked, canRecalculatePeriod } = require('./hrPayrollStatus');

function pushError(errors, code, message, employeeId = null) {
  errors.push({ code, message, employeeId });
}

function pushWarning(warnings, code, message, employeeId = null) {
  warnings.push({ code, message, employeeId });
}

function employeePayBasis(employee) {
  const profile = employee.profile && typeof employee.profile === 'object' ? employee.profile : {};
  return String(employee.payBasis || profile.payBasis || 'monthly').toLowerCase();
}

function isActiveEmployee(employee) {
  const st = String(employee.status || 'active').toLowerCase();
  return !['terminated', 'inactive'].includes(st);
}

/**
 * Validate payroll for a pay period before calculation.
 */
async function validatePayPeriod({
  prisma,
  companyId,
  payPeriod,
  settings,
  mode = 'all',
  employees: employeesOverride
}) {
  const errors = [];
  const warnings = [];
  const eligibleEmployees = [];
  const excludedEmployees = [];

  if (!payPeriod) {
    pushError(errors, 'PERIOD_NOT_FOUND', 'Pay period not found');
    return { errors, warnings, eligibleEmployees, excludedEmployees, summary: { errorCount: 1 } };
  }

  if (payPeriod.companyId !== companyId) {
    pushError(errors, 'PERIOD_COMPANY_MISMATCH', 'Pay period does not belong to this company');
    return { errors, warnings, eligibleEmployees, excludedEmployees, summary: { errorCount: 1 } };
  }

  if (isPeriodLocked(payPeriod.status)) {
    pushError(errors, 'PERIOD_LOCKED', `Pay period is ${payPeriod.status} and cannot be recalculated`);
  } else if (!canRecalculatePeriod(payPeriod.status) && payPeriod.status !== 'OPEN') {
    pushWarning(warnings, 'PERIOD_STATUS', `Pay period status is ${payPeriod.status}`);
  }

  const periodKey = payPeriod.periodKey;
  const { start, endExclusive } = payrollEngine.periodBounds(periodKey);
  if (!start || !endExclusive) {
    pushError(errors, 'INVALID_PERIOD_DATES', 'Invalid pay period dates');
  }

  let employees =
    employeesOverride ||
    (await prisma.hrEmployee.findMany({
      where: { companyId, status: { notIn: ['terminated', 'inactive'] } },
      include: {
        user: { select: { firstName: true, lastName: true, email: true } },
        office: { select: { name: true } }
      }
    }));

  if (payPeriod.branchId) {
    employees = employees.filter((e) => e.officeId === payPeriod.branchId);
  }

  if (mode === 'sales') {
    employees = employees.filter((e) => payrollEngine.isSalesRoleEmployee(e, settings));
  } else if (mode === 'office') {
    employees = employees.filter((e) => !payrollEngine.isSalesRoleEmployee(e, settings));
  }

  const employeeIds = employees.map((e) => e.id);
  const [overtime, attendance, leaves, existingItems, loans, bonuses, pendingOt, pendingBonus] =
    await Promise.all([
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
      prisma.hrLoan.findMany({ where: { companyId, status: 'Approved' } }),
      prisma.hrBonus.findMany({ where: { companyId, status: 'Approved', period: periodKey } }),
      prisma.hrOvertime.findMany({
        where: {
          companyId,
          status: { in: ['Pending', 'pending'] },
          workDate: { gte: start, lt: endExclusive }
        }
      }),
      prisma.hrBonus.findMany({
        where: {
          companyId,
          status: { in: ['Pending', 'pending'] },
          period: periodKey
        }
      })
    ]);

  const existingByEmp = new Map(existingItems.map((r) => [r.employeeId, r]));
  const finalizedExists = existingItems.some((r) =>
    ['Finalized', 'Paid', 'Closed'].includes(r.status)
  );
  if (finalizedExists) {
    pushWarning(warnings, 'FINALIZED_ITEMS_EXIST', 'Some employees already have finalized payroll for this period');
  }

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

  let orderSalesByEmp = new Map();
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
    /* orders optional */
  }

  pendingOt.forEach((row) => {
    if (employeeIds.includes(row.employeeId)) {
      pushWarning(
        warnings,
        'PENDING_OVERTIME',
        'Employee has pending overtime approval',
        row.employeeId
      );
    }
  });
  pendingBonus.forEach((row) => {
    if (employeeIds.includes(row.employeeId)) {
      pushWarning(
        warnings,
        'PENDING_BONUS',
        'Employee has pending bonus/commission approval',
        row.employeeId
      );
    }
  });

  for (const emp of employees) {
    const empErrors = [];
    const empWarnings = [];

    if (!isActiveEmployee(emp)) {
      empErrors.push({ code: 'INACTIVE_EMPLOYEE', message: 'Employee is not active' });
    }

    if (!(Number(emp.salary) > 0)) {
      empErrors.push({ code: 'MISSING_SALARY', message: 'No salary on employee profile' });
    }

    const basis = employeePayBasis(emp);
    if (!['monthly', 'daily', 'hourly'].includes(basis)) {
      empWarnings.push({ code: 'INVALID_PAY_BASIS', message: `Unknown pay basis: ${basis}` });
    }

    const attRows = attByEmp.get(emp.id) || [];
    if (!attRows.length) {
      empWarnings.push({ code: 'NO_ATTENDANCE', message: 'No attendance records for period' });
    }

    const empLeaves = leaveByEmp.get(emp.id) || [];
    const pendingLeave = await prisma.hrLeave.findFirst({
      where: {
        companyId,
        employeeId: emp.id,
        status: { in: ['Pending', 'pending'] },
        fromDate: { lte: endExclusive },
        toDate: { gte: start }
      }
    });
    if (pendingLeave) {
      empWarnings.push({ code: 'PENDING_LEAVE', message: 'Employee has pending leave requests' });
    }

    const existing = existingByEmp.get(emp.id);
    if (existing && ['Finalized', 'Paid', 'Closed'].includes(existing.status)) {
      empErrors.push({
        code: 'FINALIZED_PAYROLL',
        message: `Payroll already ${existing.status} for this employee`
      });
    } else if (existing && ['Approved'].includes(existing.status)) {
      empWarnings.push({ code: 'EXISTING_APPROVED', message: 'Approved payroll exists — recalculate will reset to Draft' });
    }

    const empLoans = loanByEmp.get(emp.id) || [];
    empLoans.forEach((loan) => {
      if (Number(loan.monthlyDeduct) > Number(loan.remaining)) {
        empWarnings.push({
          code: 'LOAN_INSTALLMENT_EXCEEDS_BALANCE',
          message: 'Loan installment exceeds remaining balance — will be capped'
        });
      }
    });

    const requireBank = Boolean(settings?.requireBankForPayroll);
    if (requireBank && (!emp.bankName || !emp.accountNumber)) {
      empWarnings.push({ code: 'MISSING_BANK', message: 'Bank details missing for payment' });
    }

    const empBonuses = bonusByEmp.get(emp.id) || [];
    const bonus = resolveEmployeeBonusInputs({ bonuses: empBonuses });
    const { salesAmount, commission } = resolveEmployeeCommissionInputs({
      bonuses: empBonuses,
      orderSalesAmount: orderSalesByEmp.get(emp.id) || 0
    });
    const loanDeduction = sumLoanDeduction(empLoans);

    const preview = payrollEngine.computePayslip({
      employee: emp,
      period: periodKey,
      settings,
      attendanceRows: attRows,
      leaveRows: empLeaves,
      bonus,
      commission,
      salesAmount,
      loan: loanDeduction
    });

    if (preview.net < 0) {
      empErrors.push({ code: 'NEGATIVE_NET', message: 'Calculated net pay is negative' });
    }

    const entry = {
      employeeId: emp.id,
      employeeCode: emp.employeeCode,
      employeeName: payrollEngine.fullName(emp.user),
      errors: empErrors,
      warnings: empWarnings,
      preview: {
        gross: preview.earnings.gross,
        net: preview.net,
        deductions: preview.deductions.total
      }
    };

    if (empErrors.length) {
      excludedEmployees.push(entry);
      empErrors.forEach((e) => pushError(errors, e.code, `${emp.employeeCode}: ${e.message}`, emp.id));
    } else {
      eligibleEmployees.push(entry);
      empWarnings.forEach((w) => pushWarning(warnings, w.code, `${emp.employeeCode}: ${w.message}`, emp.id));
    }
  }

  if (!employees.length) {
    pushError(errors, 'NO_EMPLOYEES', 'No eligible employees found for this payroll run');
  }

  const summary = {
    employeeCount: employees.length,
    eligibleCount: eligibleEmployees.length,
    excludedCount: excludedEmployees.length,
    errorCount: errors.length,
    warningCount: warnings.length,
    periodKey,
    periodStatus: payPeriod.status
  };

  return { errors, warnings, eligibleEmployees, excludedEmployees, summary };
}

module.exports = { validatePayPeriod };
