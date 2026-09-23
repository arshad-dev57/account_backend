'use strict';

const payrollEngine = require('./hrPayrollEngine');

/**
 * Resolve commission inputs without double-counting.
 *
 * Priority:
 * 1. Explicit commission amount on HrBonus (kind commission/sales) — authoritative
 * 2. Order sales aggregation — engine derives commission via salesCommissionPct
 * 3. Sales amount logged in bonus reason (metadata only) — used when no orders
 */
function parseSalesFromReason(reason) {
  const raw = String(reason || '');
  try {
    const j = JSON.parse(raw);
    if (j && j.salesAmount != null) return Number(j.salesAmount) || 0;
  } catch {
    /* plain text */
  }
  const m = raw.match(/sales\s*[:=]\s*([\d.]+)/i);
  return m ? Number(m[1]) || 0 : 0;
}

function isCommissionBonus(row) {
  const kind = String(row?.kind || '').toLowerCase();
  return kind === 'sales' || kind === 'commission' || kind.includes('commission');
}

function resolveEmployeeCommissionInputs({ bonuses = [], orderSalesAmount = 0 }) {
  let explicitCommission = 0;
  let bonusSalesLogged = 0;

  bonuses.forEach((row) => {
    const salesPart = parseSalesFromReason(row.reason);
    if (salesPart > 0) bonusSalesLogged += salesPart;
    if (isCommissionBonus(row)) {
      explicitCommission += Number(row.amount || 0);
    }
  });

  const orderSales = Number(orderSalesAmount || 0);

  if (explicitCommission > 0) {
    return {
      salesAmount: orderSales > 0 ? orderSales : bonusSalesLogged,
      commission: payrollEngine.money(explicitCommission),
      commissionSource: 'hr_bonus',
      bonus: 0
    };
  }

  const salesAmount = orderSales > 0 ? orderSales : bonusSalesLogged;
  return {
    salesAmount: payrollEngine.money(salesAmount),
    commission: 0,
    commissionSource: salesAmount > 0 ? (orderSales > 0 ? 'orders' : 'bonus_sales') : 'none',
    bonus: 0
  };
}

function resolveEmployeeBonusInputs({ bonuses = [] }) {
  let bonus = 0;
  bonuses.forEach((row) => {
    if (isCommissionBonus(row)) return;
    bonus += Number(row.amount || 0);
  });
  return payrollEngine.money(bonus);
}

module.exports = {
  parseSalesFromReason,
  isCommissionBonus,
  resolveEmployeeCommissionInputs,
  resolveEmployeeBonusInputs
};
