'use strict';

const payrollEngine = require('./hrPayrollEngine');

/**
 * Sum monthly loan deductions capped by each loan's remaining balance.
 */
function sumLoanDeduction(loans = []) {
  let total = 0;
  for (const row of loans) {
    const remaining = Number(row.remaining || 0);
    if (remaining <= 0) continue;
    const installment = Math.min(Number(row.monthlyDeduct || 0), remaining);
    total += installment;
  }
  return payrollEngine.money(total);
}

module.exports = { sumLoanDeduction };
