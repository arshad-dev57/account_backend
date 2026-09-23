'use strict';

const payrollEngine = require('./hrPayrollEngine');

/**
 * Authoritative register row from stored HrPayrollItem — no recalculation.
 */
function registerRowFromItem(row) {
  const breakdown = row.breakdown && typeof row.breakdown === 'object' ? row.breakdown : {};
  const earn = breakdown.earnings || {};
  const ded = breakdown.deductions || {};
  const prov = breakdown.provisions || {};
  const emp = row.employee || {};

  const basic = Number(earn.basic ?? row.base ?? 0);
  const houseAllowance = Number(earn.houseAllowance || 0);
  const transportAllowance = Number(earn.transportAllowance || 0);
  const medicalAllowance = Number(earn.medicalAllowance || 0);
  const allowances = Number(
    earn.allowances ?? houseAllowance + transportAllowance + medicalAllowance
  );
  const overtime = Number(earn.overtime ?? row.overtime ?? 0);
  const bonus = Number(earn.bonus ?? row.manualBonus ?? 0);
  const commission = Number(earn.commission || 0);
  const gross = Number(earn.gross ?? 0);
  const incomeTax = Number(ded.incomeTax ?? ded.tax ?? row.customTax ?? 0);
  const eobi = Number(ded.eobi || 0);
  const pf = Number(ded.providentFund || 0);
  const loan = Number(ded.loan || 0);
  const attendanceCut = Number(
    ded.attendanceCut ?? Number(ded.unpaidLeave || 0) + Number(ded.late || 0) + Number(ded.halfDay || 0)
  );
  const otherCut = Number(ded.otherCut || 0) + Number(ded.noSaleCut || 0) + Number(row.manualDeduction || 0);
  const totalDeductions = Number(row.deductions ?? ded.total ?? 0);
  const net = Number(row.net || breakdown.net || 0);
  const eobiEmployer = Number(prov.eobiEmployer ?? ded.eobiEmployer ?? 0);
  const gratuity = Number(prov.gratuityMonthly || 0);
  const employerContributions = payrollEngine.money(eobiEmployer + gratuity);

  const paymentStatus =
    row.status === 'Paid' ? 'Paid' : row.status === 'Approved' || row.status === 'Finalized' ? 'Pending' : 'Unpaid';

  return {
    id: row.id,
    employeeId: row.employeeId,
    employee: payrollEngine.fullName(emp.user),
    employeeCode: emp.employeeCode || '',
    department: emp.department || '',
    designation: emp.designation || '',
    branch: emp.office?.name || '',
    basic,
    houseAllowance,
    transportAllowance,
    medicalAllowance,
    allowances,
    overtime,
    bonus,
    commission,
    gross,
    taxableIncome: gross,
    tax: incomeTax,
    eobi,
    providentFund: pf,
    attendanceCut,
    loan,
    otherDeductions: otherCut,
    deductions: totalDeductions,
    employerContributions,
    net,
    paymentStatus,
    payrollStatus: row.status,
    paidAt: row.paidAt,
    breakdown
  };
}

function registerTotals(rows = []) {
  const sum = (fn) => payrollEngine.money(rows.reduce((s, r) => s + Number(fn(r) || 0), 0));
  return {
    count: rows.length,
    basic: sum((r) => r.basic),
    allowances: sum((r) => r.allowances),
    overtime: sum((r) => r.overtime),
    bonus: sum((r) => r.bonus),
    commission: sum((r) => r.commission),
    gross: sum((r) => r.gross),
    tax: sum((r) => r.tax),
    loan: sum((r) => r.loan),
    deductions: sum((r) => r.deductions),
    employerContributions: sum((r) => r.employerContributions),
    net: sum((r) => r.net)
  };
}

module.exports = {
  registerRowFromItem,
  registerTotals
};
