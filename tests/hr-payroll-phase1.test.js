'use strict';

const assert = require('assert');
const payrollEngine = require('../services/hrPayrollEngine');
const { sumLoanDeduction } = require('../services/hrPayrollLoanHelper');
const {
  resolveEmployeeCommissionInputs,
  resolveEmployeeBonusInputs
} = require('../services/hrPayrollCommission');
const { registerRowFromItem, registerTotals } = require('../services/hrPayrollRegister');
const {
  canTransitionPeriod,
  canTransitionItem,
  canRecalculatePeriod,
  isItemLocked
} = require('../services/hrPayrollStatus');

const baseEmployee = {
  salary: 100000,
  joiningDate: new Date('2020-01-01'),
  status: 'active',
  employeeType: 'Office Employee',
  profile: {}
};

function fullMonthAttendance() {
  return Array.from({ length: 26 }, (_, i) => ({
    status: 'present',
    checkIn: new Date(),
    workDate: new Date(`2026-03-${String(i + 1).padStart(2, '0')}`)
  }));
}

function slip(overrides = {}) {
  return payrollEngine.computePayslip({
    employee: baseEmployee,
    period: '2026-03',
    settings: payrollEngine.paySettings({}),
    attendanceRows: overrides.attendanceRows || fullMonthAttendance(),
    leaveRows: overrides.leaveRows || [],
    overtimeAmount: overrides.overtimeAmount || 0,
    bonus: overrides.bonus || 0,
    commission: overrides.commission || 0,
    salesAmount: overrides.salesAmount || 0,
    loan: overrides.loan || 0,
    ...overrides
  });
}

function testNormalPayroll() {
  const s = slip();
  assert.ok(s.earnings.gross > 0);
  assert.ok(s.net > 0);
  assert.strictEqual(s.deductions.total, s.earnings.gross - s.net);
}

function testAttendanceDeduction() {
  const rows = Array.from({ length: 26 }, (_, i) => ({
    status: i < 20 ? 'present' : 'absent',
    checkIn: i < 20 ? new Date() : null,
    workDate: new Date(`2026-03-${String(i + 1).padStart(2, '0')}`)
  }));
  const s = slip({ attendanceRows: rows });
  assert.ok(s.deductions.attendanceCut > 0);
}

function testHalfDayDeduction() {
  const rows = [
    { status: 'half_day', checkIn: new Date(), workDate: new Date('2026-03-02') },
    ...Array.from({ length: 25 }, () => ({
      status: 'present',
      checkIn: new Date(),
      workDate: new Date()
    }))
  ];
  const s = slip({ attendanceRows: rows });
  assert.ok(s.deductions.halfDay > 0);
}

function testOvertime() {
  const s = slip({ overtimeAmount: 5000 });
  assert.strictEqual(s.earnings.overtime, 5000);
  assert.ok(s.earnings.gross >= 5000);
}

function testBonus() {
  const s = slip({ bonus: 3000 });
  assert.strictEqual(s.earnings.bonus, 3000);
}

function testLoanDeduction() {
  const loan = sumLoanDeduction([
    { monthlyDeduct: 5000, remaining: 3000 },
    { monthlyDeduct: 2000, remaining: 10000 }
  ]);
  assert.strictEqual(loan, 5000);
  const s = slip({ loan });
  assert.strictEqual(s.deductions.loan, 5000);
}

function testTax() {
  const s = slip();
  assert.ok(s.deductions.incomeTax >= 0);
}

function testMissingSalary() {
  const s = payrollEngine.computePayslip({
    employee: { ...baseEmployee, salary: 0 },
    period: '2026-03',
    settings: payrollEngine.paySettings({})
  });
  assert.ok(s.exceptions.includes('No salary on profile'));
}

function testNegativeNetBlockedInValidationShape() {
  const s = slip({ loan: 999999 });
  assert.ok(s.net >= 0);
}

function testCommissionNoDoubleCount() {
  const fromBonus = resolveEmployeeCommissionInputs({
    bonuses: [{ kind: 'commission', amount: 2500, reason: 'sales:100000' }],
    orderSalesAmount: 100000
  });
  assert.strictEqual(fromBonus.commission, 2500);
  assert.strictEqual(fromBonus.commissionSource, 'hr_bonus');

  const fromOrders = resolveEmployeeCommissionInputs({
    bonuses: [],
    orderSalesAmount: 50000
  });
  assert.strictEqual(fromOrders.commission, 0);
  assert.strictEqual(fromOrders.commissionSource, 'orders');
}

function testBonusExcludesCommission() {
  const bonus = resolveEmployeeBonusInputs({
    bonuses: [
      { kind: 'performance', amount: 1000 },
      { kind: 'commission', amount: 500 }
    ]
  });
  assert.strictEqual(bonus, 1000);
}

function testPeriodTransitions() {
  assert.strictEqual(canTransitionPeriod('OPEN', 'CALCULATING'), true);
  assert.strictEqual(canTransitionPeriod('FINALIZED', 'OPEN'), false);
  assert.strictEqual(canRecalculatePeriod('CALCULATED'), true);
  assert.strictEqual(canRecalculatePeriod('FINALIZED'), false);
}

function testItemLocked() {
  assert.strictEqual(isItemLocked('Finalized'), true);
  assert.strictEqual(isItemLocked('Draft'), false);
  assert.strictEqual(canTransitionItem('Calculated', 'Review'), true);
  assert.strictEqual(canTransitionItem('Finalized', 'Draft'), false);
}

function testRegisterConsistency() {
  const computed = slip({ bonus: 2000, overtimeAmount: 1000 });
  const row = {
    id: 'x',
    employeeId: 'e1',
    period: '2026-03',
    base: computed.earnings.basic,
    overtime: computed.earnings.overtime,
    deductions: computed.deductions.total,
    net: computed.net,
    status: 'Calculated',
    breakdown: computed,
    employee: {
      employeeCode: 'E001',
      department: 'IT',
      designation: 'Dev',
      user: { firstName: 'Ali', lastName: 'Khan' },
      office: { name: 'HQ' }
    }
  };
  const reg = registerRowFromItem(row);
  assert.strictEqual(reg.gross, computed.earnings.gross);
  assert.strictEqual(reg.net, computed.net);
  assert.strictEqual(reg.tax, computed.deductions.incomeTax);
  assert.strictEqual(reg.deductions, computed.deductions.total);

  const reviewNet = computed.net;
  const payslipNet = row.net;
  assert.strictEqual(reg.net, reviewNet);
  assert.strictEqual(reg.net, payslipNet);
}

function testAdjustmentsCanonical() {
  const computed = slip();
  const existing = {
    period: '2026-03',
    notes: '',
    breakdown: computed
  };
  const adjusted = payrollEngine.applyPayrollAdjustments(existing, {
    manualBonus: 1500,
    manualDeduction: 200,
    customTax: 1000,
    adjustmentNotes: 'HR adjustment'
  });
  assert.strictEqual(adjusted.breakdown.earnings.bonus, 1500);
  assert.strictEqual(adjusted.breakdown.deductions.incomeTax, 1000);
  assert.ok(adjusted.net >= 0);
  assert.ok(adjusted.deductions > 0);
}

testNormalPayroll();
testAttendanceDeduction();
testHalfDayDeduction();
testOvertime();
testBonus();
testLoanDeduction();
testTax();
testMissingSalary();
testNegativeNetBlockedInValidationShape();
testCommissionNoDoubleCount();
testBonusExcludesCommission();
testPeriodTransitions();
testItemLocked();
testRegisterConsistency();
testAdjustmentsCanonical();
console.log('hr-payroll-phase1 tests passed');
