'use strict';

function money(n) {
  return Math.round(Number(n || 0) * 100) / 100;
}

function ymd(value) {
  if (!value) return '';
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}/.test(value)) return value.slice(0, 10);
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  return d.toISOString().slice(0, 10);
}

function asDate(value) {
  const key = ymd(value);
  return key ? new Date(`${key}T00:00:00.000Z`) : null;
}

function currentPeriod(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

function nextPeriodStart(period) {
  const [y, m] = String(period || '').split('-').map(Number);
  if (!y || !m) return `${currentPeriod()}-01`.slice(0, 7) + '-01';
  const next = m === 12 ? { y: y + 1, m: 1 } : { y, m: m + 1 };
  return `${next.y}-${String(next.m).padStart(2, '0')}-01`;
}

function periodLabel(period) {
  const [y, m] = String(period || '').split('-').map(Number);
  if (!y || !m) return period || '';
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleString('en-US', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC'
  });
}

function previousPeriod(period) {
  const [y, m] = String(period || '').split('-').map(Number);
  if (!y || !m) return currentPeriod();
  const prev = m === 1 ? { y: y - 1, m: 12 } : { y, m: m - 1 };
  return `${prev.y}-${String(prev.m).padStart(2, '0')}`;
}

function periodBounds(period) {
  const start = asDate(`${period}-01`);
  const endExclusive = asDate(nextPeriodStart(period));
  return { start, endExclusive };
}

function compensationPreview(employee = {}, settings = {}) {
  const cfg = paySettings(settings);
  const packageAmount = money(employee.salary || 0);
  const pct = (key) => Number(cfg[key] || 0) / 100;
  const basic = money(packageAmount * pct('basicPct'));
  const houseAllowance = money(packageAmount * pct('housePct'));
  const transportAllowance = money(packageAmount * pct('transportPct'));
  const medicalAllowance = money(packageAmount * pct('medicalPct'));
  return {
    package: packageAmount,
    basic,
    houseAllowance,
    transportAllowance,
    medicalAllowance,
    taxPct: Number(cfg.taxPct || 0),
    eobiPct: Number(cfg.eobiPct || 0),
    pfPct: Number(cfg.pfPct || 0),
    lateDeductionPerDay: Number(cfg.lateDeductionPerDay || 0),
    workDaysPerWeek: Number(cfg.workDaysPerWeek || 6),
    workHoursPerDay: Number(cfg.workHoursPerDay || 8)
  };
}

function statutorySummary(items = []) {
  const pick = (fn) => money(items.reduce((s, row) => s + Number(fn(row) || 0), 0));
  return {
    tax: pick((r) => r.breakdown?.deductions?.tax),
    eobi: pick((r) => r.breakdown?.deductions?.eobi),
    providentFund: pick((r) => r.breakdown?.deductions?.providentFund),
    unpaidLeave: pick((r) => r.breakdown?.deductions?.unpaidLeave),
    late: pick((r) => r.breakdown?.deductions?.late),
    loan: pick((r) => r.breakdown?.deductions?.loan),
    overtime: pick((r) => r.overtime),
    bonus: pick((r) => r.breakdown?.earnings?.bonus),
    commission: pick((r) => r.breakdown?.earnings?.commission),
    attendanceCut: pick(
      (r) =>
        Number(r.breakdown?.deductions?.attendanceCut ?? 0) ||
        Number(r.breakdown?.deductions?.unpaidLeave || 0) + Number(r.breakdown?.deductions?.late || 0)
    ),
    otherCut: pick((r) => r.breakdown?.deductions?.otherCut)
  };
}

function ytdFromSlips(items = [], year) {
  const yr = String(year || new Date().getFullYear());
  const yearRows = items.filter((r) => String(r.period || '').startsWith(yr));
  return {
    year: yr,
    months: yearRows.length,
    gross: money(yearRows.reduce((s, r) => s + Number(r.breakdown?.earnings?.gross ?? r.base ?? 0), 0)),
    net: money(yearRows.reduce((s, r) => s + Number(r.net || 0), 0)),
    deductions: money(yearRows.reduce((s, r) => s + Number(r.deductions || 0), 0)),
    tax: money(yearRows.reduce((s, r) => s + Number(r.breakdown?.deductions?.tax || 0), 0)),
    eobi: money(yearRows.reduce((s, r) => s + Number(r.breakdown?.deductions?.eobi || 0), 0)),
    providentFund: money(yearRows.reduce((s, r) => s + Number(r.breakdown?.deductions?.providentFund || 0), 0)),
    overtime: money(yearRows.reduce((s, r) => s + Number(r.overtime || 0), 0))
  };
}

function workingDaysInPeriod(period, workDaysPerWeek = 6) {
  const { start, endExclusive } = periodBounds(period);
  if (!start || !endExclusive) return 26;
  let count = 0;
  for (let t = start.getTime(); t < endExclusive.getTime(); t += 86400000) {
    const day = new Date(t).getUTCDay();
    const week = Number(workDaysPerWeek) || 6;
    if (week >= 7) count += 1;
    else if (week >= 6 && day !== 0) count += 1;
    else if (day !== 0 && day !== 6) count += 1;
  }
  return Math.max(count, 1);
}

function overlapDays(from, to, start, endExclusive) {
  const a = Math.max(asDate(from)?.getTime() || 0, start.getTime());
  const b = Math.min((asDate(to)?.getTime() || 0) + 86400000, endExclusive.getTime());
  return Math.max(0, Math.round((b - a) / 86400000));
}

function fullName(user) {
  return [user?.firstName, user?.lastName].filter(Boolean).join(' ').trim() || 'Employee';
}

const DEFAULT_PAY_SETTINGS = {
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
  lateDeductionPerDay: 0
};

function paySettings(payload = {}) {
  return { ...DEFAULT_PAY_SETTINGS, ...payload };
}

function computePayslip({
  employee,
  period,
  settings,
  attendanceRows = [],
  leaveRows = [],
  overtimeAmount = 0,
  overtimeHours = 0,
  bonus = 0,
  commission = 0,
  loan = 0,
  /** Optional HR override for attendance cut (unpaid + late). null = auto */
  attendanceCut = null,
  /** Extra HR cut (misc / penalty) */
  otherCut = 0,
  notes = ''
}) {
  const cfg = paySettings(settings);
  const { start, endExclusive } = periodBounds(period);
  const workingDays = workingDaysInPeriod(period, cfg.workDaysPerWeek);
  const presentDays = attendanceRows.filter((r) => r.checkIn).length;
  const lateDays = attendanceRows.filter((r) => String(r.status || '').toLowerCase() === 'late').length;
  const paidLeaveDays = leaveRows.reduce(
    (sum, row) => sum + overlapDays(row.fromDate, row.toDate, start, endExclusive),
    0
  );
  let unpaidLeaveDays = Math.max(0, workingDays - presentDays - paidLeaveDays);
  if (unpaidLeaveDays > workingDays) unpaidLeaveDays = workingDays;

  let factor = 1;
  const joined = employee.joiningDate ? asDate(employee.joiningDate) : null;
  if (joined && joined > start && joined < endExclusive) {
    let remaining = 0;
    for (let t = joined.getTime(); t < endExclusive.getTime(); t += 86400000) {
      const day = new Date(t).getUTCDay();
      const week = Number(cfg.workDaysPerWeek) || 6;
      if (week >= 7 || (week >= 6 && day !== 0) || (day !== 0 && day !== 6)) remaining += 1;
    }
    factor = remaining / workingDays;
  }

  const packageAmount = money((employee.salary || 0) * factor);
  const pct = (key) => Number(cfg[key] || 0) / 100;
  const basic = money(packageAmount * pct('basicPct'));
  const houseAllowance = money(packageAmount * pct('housePct'));
  const transportAllowance = money(packageAmount * pct('transportPct'));
  const medicalAllowance = money(packageAmount * pct('medicalPct'));
  const overtime = money(overtimeAmount);
  const bonusAmt = money(bonus);
  const commissionAmt = money(commission);
  const allowances = money(houseAllowance + transportAllowance + medicalAllowance);
  const gross = money(basic + allowances + overtime + bonusAmt + commissionAmt);

  const dailyRate = money(packageAmount / workingDays);
  const unpaidLeaveAuto = money(dailyRate * unpaidLeaveDays);
  const lateAuto = money(Number(cfg.lateDeductionPerDay || 0) * lateDays);
  const attendanceAuto = money(unpaidLeaveAuto + lateAuto);
  const attendanceOverride =
    attendanceCut != null && attendanceCut !== '' ? money(attendanceCut) : null;
  const attendanceCutAmt = attendanceOverride != null ? attendanceOverride : attendanceAuto;
  // Keep unpaid/late split for display when using auto; when overridden, put all in unpaidLeave
  const unpaidLeaveDeduction =
    attendanceOverride != null ? attendanceCutAmt : unpaidLeaveAuto;
  const lateDeduction = attendanceOverride != null ? 0 : lateAuto;
  const tax = money(basic * pct('taxPct'));
  const eobi = money(basic * pct('eobiPct'));
  const providentFund = money(basic * pct('pfPct'));
  const loanAmt = money(loan);
  const otherCutAmt = money(otherCut);
  const totalDeductions = money(
    attendanceCutAmt + tax + eobi + providentFund + loanAmt + otherCutAmt
  );
  const net = money(Math.max(0, gross - totalDeductions));

  const exceptions = [];
  if (!(employee.salary > 0)) exceptions.push('No salary on profile');
  if (unpaidLeaveDays >= 3) exceptions.push(`${unpaidLeaveDays} unpaid / absent days`);
  if (factor < 1) exceptions.push('Pro-rated for mid-month joining');
  if (lateDays >= 3) exceptions.push(`${lateDays} late arrivals`);
  if (attendanceOverride != null && attendanceOverride !== attendanceAuto) {
    exceptions.push('Attendance cut manually adjusted');
  }

  return {
    period,
    periodLabel: periodLabel(period),
    workingDays,
    presentDays,
    paidLeaveDays,
    unpaidLeaveDays,
    lateDays,
    overtimeHours: money(overtimeHours),
    proRata: money(factor),
    package: packageAmount,
    dailyRate,
    attendanceCutAuto: attendanceAuto,
    attendanceCutManual: attendanceOverride != null,
    earnings: {
      basic,
      houseAllowance,
      transportAllowance,
      medicalAllowance,
      allowances,
      overtime,
      bonus: bonusAmt,
      commission: commissionAmt,
      gross
    },
    deductions: {
      unpaidLeave: unpaidLeaveDeduction,
      late: lateDeduction,
      attendanceCut: attendanceCutAmt,
      tax,
      eobi,
      providentFund,
      loan: loanAmt,
      otherCut: otherCutAmt,
      total: totalDeductions
    },
    net,
    exceptions,
    notes
  };
}

function serializePayslip(row) {
  const breakdown = row.breakdown && typeof row.breakdown === 'object' ? row.breakdown : {};
  const emp = row.employee || {};
  return {
    id: row.id,
    employeeId: row.employeeId,
    employee: fullName(emp.user),
    employeeCode: emp.employeeCode || '',
    email: emp.user?.email || '',
    department: emp.department || '',
    designation: emp.designation || '',
    office: emp.office?.name || '',
    joiningDate: emp.joiningDate,
    period: row.period,
    periodLabel: breakdown.periodLabel || periodLabel(row.period),
    status: row.status,
    base: row.base,
    overtime: row.overtime,
    deductions: row.deductions,
    net: row.net,
    paidAt: row.paidAt || null,
    notes: row.notes || breakdown.notes || '',
    breakdown,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt
  };
}

function runSummary(items) {
  const list = items || [];
  const sum = (fn) => money(list.reduce((s, row) => s + Number(fn(row) || 0), 0));
  const byStatus = list.reduce((acc, row) => {
    acc[row.status] = (acc[row.status] || 0) + 1;
    return acc;
  }, {});
  const byDepartment = {};
  list.forEach((row) => {
    const dept = row.department || 'Unassigned';
    if (!byDepartment[dept]) {
      byDepartment[dept] = { department: dept, headcount: 0, gross: 0, deductions: 0, overtime: 0, net: 0 };
    }
    const g = Number(row.breakdown?.earnings?.gross ?? row.base ?? 0);
    byDepartment[dept].headcount += 1;
    byDepartment[dept].gross = money(byDepartment[dept].gross + g);
    byDepartment[dept].deductions = money(byDepartment[dept].deductions + Number(row.deductions || 0));
    byDepartment[dept].overtime = money(byDepartment[dept].overtime + Number(row.overtime || 0));
    byDepartment[dept].net = money(byDepartment[dept].net + Number(row.net || 0));
  });
  return {
    headcount: list.length,
    gross: sum((r) => r.breakdown?.earnings?.gross ?? r.base),
    overtime: sum((r) => r.overtime),
    deductions: sum((r) => r.deductions),
    net: sum((r) => r.net),
    byStatus,
    byDepartment: Object.values(byDepartment).sort((a, b) => b.net - a.net),
    exceptions: list.filter((r) => (r.breakdown?.exceptions || []).length > 0).length,
    statutory: statutorySummary(list)
  };
}

module.exports = {
  money,
  ymd,
  asDate,
  currentPeriod,
  nextPeriodStart,
  previousPeriod,
  periodLabel,
  periodBounds,
  workingDaysInPeriod,
  paySettings,
  DEFAULT_PAY_SETTINGS,
  compensationPreview,
  statutorySummary,
  ytdFromSlips,
  computePayslip,
  serializePayslip,
  runSummary,
  fullName
};
