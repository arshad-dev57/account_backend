'use strict';

// ============================================================
// CONSTANTS
// ============================================================

/** EOBI Act Pakistan — fixed contributions per month */
const EOBI_EMPLOYEE_AMT = 370;
const EOBI_EMPLOYER_AMT = 1110;

// ============================================================
// UTILITIES
// ============================================================

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

function fullName(user) {
  return [user?.firstName, user?.lastName].filter(Boolean).join(' ').trim() || 'Employee';
}

// ============================================================
// FBR INCOME TAX SLABS — Pakistan Finance Act 2024-25
// Applied on annualized GROSS salary, monthly result = annual / 12
// ============================================================

function fbrAnnualTax(annualIncome) {
  const n = Math.max(0, Number(annualIncome || 0));
  if (n <= 600_000) return 0;
  if (n <= 1_200_000) return (n - 600_000) * 0.025;
  if (n <= 2_400_000) return 15_000 + (n - 1_200_000) * 0.125;
  if (n <= 3_600_000) return 165_000 + (n - 2_400_000) * 0.20;
  if (n <= 6_000_000) return 405_000 + (n - 3_600_000) * 0.25;
  if (n <= 12_000_000) return 1_005_000 + (n - 6_000_000) * 0.325;
  return 2_955_000 + (n - 12_000_000) * 0.35;
}

/**
 * Calculate monthly income tax.
 * cfg.taxMode = 'slab' (default, FBR 2024-25) | 'flat' (use taxPct on gross)
 */
function calcIncomeTax(monthlyGross, cfg) {
  if (!monthlyGross || monthlyGross <= 0) return 0;
  if (String(cfg.taxMode || 'slab') === 'flat') {
    return money(monthlyGross * (Number(cfg.taxPct || 0) / 100));
  }
  return money(fbrAnnualTax(monthlyGross * 12) / 12);
}

/**
 * Calculate EOBI employee contribution.
 * cfg.eobiMode = 'fixed' (default, Rs.370/month) | 'pct' (use eobiPct on basic)
 */
function calcEobi(basic, cfg) {
  if (String(cfg.eobiMode || 'fixed') === 'pct') {
    return money(basic * (Number(cfg.eobiPct || 1) / 100));
  }
  return money(Number(cfg.eobiAmount ?? EOBI_EMPLOYEE_AMT));
}

// ============================================================
// PAY SETTINGS DEFAULTS
// ============================================================

const DEFAULT_PAY_SETTINGS = {
  workHoursPerDay: 8,
  workDaysPerWeek: 6,
  overtimeMultiplier: 1.5,
  annualLeaveQuota: 14,
  // Salary structure (% of gross package)
  basicPct: 60,
  housePct: 25,
  transportPct: 10,
  medicalPct: 5,
  // Tax
  taxMode: 'slab',       // 'slab' = FBR graduated | 'flat' = taxPct %
  taxPct: 0,             // used only when taxMode = 'flat'
  // EOBI
  eobiMode: 'fixed',     // 'fixed' = Rs.370 | 'pct' = eobiPct %
  eobiAmount: 370,       // used when eobiMode = 'fixed'
  eobiPct: 1,            // used when eobiMode = 'pct'
  // Provident fund
  pfPct: 0,
  pfDuringProbation: false,
  // Attendance
  lateDeductionPerDay: 0,
  absentDeductionMode: 'daily_rate',   // 'daily_rate' | 'fixed'
  absentDeductionPerDay: 0,
  halfDayDeductionPct: 50,
  graceMinutes: 15,
  // Gratuity (employer provision, not deducted from employee)
  gratuityEnabled: false,
  // Sales commission
  salesCommissionPct: 5,
  noSaleCutAmount: 0,
  noSaleCutRoles: 'Salesman,sales,Field Employee'
};

function paySettings(payload = {}) {
  return { ...DEFAULT_PAY_SETTINGS, ...payload };
}

// ============================================================
// WORKING DAYS
// ============================================================

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

function attendanceStatusKey(row) {
  return String(row?.status || '').toLowerCase().replace(/\s+/g, '_');
}

function isCountedPresent(row) {
  const st = attendanceStatusKey(row);
  if (['absent', 'weekly_off', 'holiday', 'on_leave', 'leave'].includes(st)) return false;
  if (st === 'half_day' || st === 'half-day') return true;
  return Boolean(row.checkIn) || ['present', 'late', 'checked_in', 'checkedin'].includes(st);
}

// ============================================================
// SALES ROLE DETECTION
// ============================================================

function isSalesRoleEmployee(employee, settings = {}) {
  const cfg = paySettings(settings);
  const roles = String(cfg.noSaleCutRoles || 'Salesman,sales,Field Employee')
    .toLowerCase()
    .split(/[,|/]/)
    .map((s) => s.trim())
    .filter(Boolean);
  const empType = `${employee?.employeeType || ''} ${employee?.employmentType || ''} ${employee?.designation || ''}`.toLowerCase();
  if (!roles.length) return /sales|field/.test(empType);
  return roles.some((r) => empType.includes(r));
}

// ============================================================
// PRO-RATA FACTORS
// ============================================================

/**
 * Count working days in [fromDate, toDate] inclusive within the period.
 */
function workingDaysInRange(fromDate, toDate, workDaysPerWeek) {
  const week = Number(workDaysPerWeek) || 6;
  let count = 0;
  for (let t = fromDate.getTime(); t <= toDate.getTime(); t += 86400000) {
    const day = new Date(t).getUTCDay();
    if (week >= 7) count += 1;
    else if (week >= 6 && day !== 0) count += 1;
    else if (day !== 0 && day !== 6) count += 1;
  }
  return Math.max(count, 1);
}

// ============================================================
// GRATUITY PROVISION (employer liability — not deducted from pay)
// Formula: 1 month last basic / year of service, accrued monthly
// Eligible: permanent employees after completing 1 year
// ============================================================

function calcGratuityProvision(basic, yearsOfService, cfg) {
  if (!cfg.gratuityEnabled) return 0;
  if (yearsOfService < 1) return 0;
  // Monthly provision = basic / 12 (1 month basic per year → per month = 1/12)
  return money(basic / 12);
}

// ============================================================
// CORE PAYSLIP COMPUTATION
// ============================================================

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
  salesAmount = 0,
  loan = 0,
  attendanceCut = null,    // null = auto-compute from attendance
  otherCut = 0,
  noSaleCut = null,        // null = auto from settings when sales role + 0 sales
  notes = ''
}) {
  const cfg = paySettings(settings);
  const { start, endExclusive } = periodBounds(period);
  const workingDays = workingDaysInPeriod(period, cfg.workDaysPerWeek);

  // ── Employee profile extras ──────────────────────────────
  const profile = employee.profile && typeof employee.profile === 'object' ? employee.profile : {};

  // ── Probation check ──────────────────────────────────────
  const probationEnd = profile.probationEndDate ? asDate(profile.probationEndDate) : null;
  const isOnProbation = probationEnd ? probationEnd > start : false;

  // ── Termination / last working day pro-rata ───────────────
  const terminationDate =
    profile.terminationDate || profile.lastWorkingDay
      ? asDate(profile.terminationDate || profile.lastWorkingDay)
      : null;

  // ── Joining date pro-rata ─────────────────────────────────
  const joined = employee.joiningDate ? asDate(employee.joiningDate) : null;

  // Calculate the active window within the period
  const activeFrom = joined && joined > start && joined < endExclusive ? joined : start;
  const activeTo =
    terminationDate && terminationDate >= start && terminationDate < endExclusive
      ? terminationDate
      : new Date(endExclusive.getTime() - 86400000); // last day of period (inclusive)

  let factor = 1;
  if (activeFrom > start || activeTo < new Date(endExclusive.getTime() - 86400000)) {
    const activeDays = workingDaysInRange(activeFrom, activeTo, cfg.workDaysPerWeek);
    factor = activeDays / workingDays;
  }
  factor = Math.min(1, Math.max(0, factor));

  // ── Attendance stats ──────────────────────────────────────
  const presentFull = attendanceRows.filter((r) => {
    const st = attendanceStatusKey(r);
    return isCountedPresent(r) && st !== 'half_day' && st !== 'half-day';
  }).length;
  const halfDays = attendanceRows.filter((r) => {
    const st = attendanceStatusKey(r);
    return st === 'half_day' || st === 'half-day';
  }).length;
  const presentDays = presentFull + halfDays * 0.5;
  const lateDays = attendanceRows.filter((r) => attendanceStatusKey(r) === 'late').length;
  const paidLeaveDays = leaveRows.reduce(
    (sum, row) => sum + overlapDays(row.fromDate, row.toDate, start, endExclusive),
    0
  );
  let unpaidLeaveDays = Math.max(0, workingDays - presentDays - paidLeaveDays);
  if (unpaidLeaveDays > workingDays) unpaidLeaveDays = workingDays;

  // ── Pay basis (monthly / daily / hourly) ──────────────────
  const payBasis = String(
    employee.payBasis || profile.payBasis || 'monthly'
  ).toLowerCase();
  const rate = Number(employee.salary || 0);
  let periodPackage = rate;
  if (payBasis === 'hourly') {
    periodPackage = rate * Number(cfg.workHoursPerDay || 8) * workingDays;
  } else if (payBasis === 'daily') {
    periodPackage = rate * workingDays;
  }
  const packageAmount = money(periodPackage * factor);

  // ── Salary structure breakdown ────────────────────────────
  const pct = (key) => Number(cfg[key] || 0) / 100;
  let basic = money(packageAmount * pct('basicPct'));
  let houseAllowance = money(packageAmount * pct('housePct'));
  let transportAllowance = money(packageAmount * pct('transportPct'));
  let medicalAllowance = money(packageAmount * pct('medicalPct'));

  // Fallback: if structure %s are zero but salary exists, full package → basic
  if (packageAmount > 0 && basic + houseAllowance + transportAllowance + medicalAllowance <= 0) {
    basic = packageAmount;
    houseAllowance = 0;
    transportAllowance = 0;
    medicalAllowance = 0;
  }

  const overtime = money(overtimeAmount);
  const bonusAmt = money(bonus);

  // ── Commission / sales ────────────────────────────────────
  const salesTotal = money(salesAmount);
  const commissionPct = Number(cfg.salesCommissionPct || 0);
  const autoCommission = money((salesTotal * commissionPct) / 100);
  const commissionAmt = money(
    commission > 0 ? commission : salesTotal > 0 ? autoCommission : 0
  );

  const allowances = money(houseAllowance + transportAllowance + medicalAllowance);
  const gross = money(basic + allowances + overtime + bonusAmt + commissionAmt);

  // ── Daily rate for absent deduction ──────────────────────
  const dailyRate = money(packageAmount / Math.max(workingDays, 1));
  const absentUnit =
    String(cfg.absentDeductionMode || 'daily_rate') === 'fixed'
      ? money(Number(cfg.absentDeductionPerDay || 0))
      : dailyRate;
  const unpaidLeaveAuto = money(absentUnit * unpaidLeaveDays);
  const lateAuto = money(Number(cfg.lateDeductionPerDay || 0) * lateDays);
  const attendanceAuto = money(unpaidLeaveAuto + lateAuto);

  const attendanceOverride =
    attendanceCut != null && attendanceCut !== '' ? money(attendanceCut) : null;
  const attendanceCutAmt = attendanceOverride != null ? attendanceOverride : attendanceAuto;
  const unpaidLeaveDeduction = attendanceOverride != null ? attendanceCutAmt : unpaidLeaveAuto;
  const lateDeduction = attendanceOverride != null ? 0 : lateAuto;

  // ── Statutory deductions ──────────────────────────────────
  // Income tax: FBR slab on annualized gross (or flat % if configured)
  const incomeTax = calcIncomeTax(gross, cfg);

  // EOBI: fixed Rs. 370 (or % if configured) — only deducted if packageAmount > 0
  const eobi = packageAmount > 0 ? calcEobi(basic, cfg) : 0;

  // Provident Fund: % of basic; waived during probation unless pfDuringProbation = true
  const pfEnabled = !isOnProbation || cfg.pfDuringProbation === true;
  const providentFund = pfEnabled ? money(basic * pct('pfPct')) : 0;

  // ── Loan ─────────────────────────────────────────────────
  const loanAmt = money(loan);

  // ── No-sale cut ──────────────────────────────────────────
  const salesRoles = String(cfg.noSaleCutRoles || '')
    .toLowerCase()
    .split(/[,|/]/)
    .map((s) => s.trim())
    .filter(Boolean);
  const empStr = `${employee.employeeType || ''} ${employee.employmentType || ''} ${employee.designation || ''}`.toLowerCase();
  const isSalesRole = salesRoles.length === 0 ? false : salesRoles.some((r) => empStr.includes(r));
  let noSaleCutAmt = 0;
  if (noSaleCut != null && noSaleCut !== '') {
    noSaleCutAmt = money(noSaleCut);
  } else if (isSalesRole && salesTotal <= 0 && commissionAmt <= 0) {
    noSaleCutAmt = money(Number(cfg.noSaleCutAmount || 0));
  }
  const otherCutAmt = money(otherCut);

  const totalDeductions = money(
    attendanceCutAmt + incomeTax + eobi + providentFund + loanAmt + otherCutAmt + noSaleCutAmt
  );
  const net = money(Math.max(0, gross - totalDeductions));

  // ── Gratuity provision (employer liability, not deducted from employee) ──
  let yearsOfService = 0;
  if (joined) {
    yearsOfService = (endExclusive.getTime() - joined.getTime()) / (365.25 * 86400000);
  }
  const isPermanent =
    /permanent|full.?time/i.test(employee.employmentType || '') &&
    !isOnProbation;
  const gratuityProvision = isPermanent
    ? calcGratuityProvision(basic, yearsOfService, cfg)
    : 0;

  // ── Exceptions / flags ────────────────────────────────────
  const exceptions = [];
  if (!(employee.salary > 0)) exceptions.push('No salary on profile');
  if (isOnProbation) exceptions.push('On probation — PF waived');
  if (terminationDate && terminationDate < endExclusive) {
    exceptions.push(`Terminated ${ymd(terminationDate)} — final settlement month`);
  }
  if (factor < 1 && factor > 0) {
    const pct100 = Math.round(factor * 100);
    exceptions.push(`Pro-rated ${pct100}% (${payBasis === 'monthly' ? 'mid-period join/leave' : payBasis})`);
  }
  if (unpaidLeaveDays >= 3) exceptions.push(`${unpaidLeaveDays} unpaid/absent days`);
  if (lateDays >= 3) exceptions.push(`${lateDays} late arrivals`);
  if (attendanceOverride != null && attendanceOverride !== attendanceAuto) {
    exceptions.push('Attendance cut manually adjusted');
  }
  if (salesTotal > 0) {
    exceptions.push(`Sales ${salesTotal} → commission ${commissionAmt} (${commissionPct}%)`);
  }
  if (noSaleCutAmt > 0) exceptions.push(`No-sale cut Rs. ${noSaleCutAmt}`);
  if (String(cfg.taxMode || 'slab') === 'slab') {
    exceptions.push(`Income tax (FBR slab) Rs. ${incomeTax}/month on gross ${gross}`);
  }

  return {
    period,
    periodLabel: periodLabel(period),
    // Attendance context
    workingDays,
    presentDays,
    halfDays,
    paidLeaveDays,
    unpaidLeaveDays,
    lateDays,
    overtimeHours: money(overtimeHours),
    // Package
    proRata: money(factor),
    isOnProbation,
    terminationDate: terminationDate ? ymd(terminationDate) : null,
    package: packageAmount,
    payBasis,
    rate,
    dailyRate,
    yearsOfService: money(yearsOfService),
    // Sales
    salesAmount: salesTotal,
    salesCommissionPct: commissionPct,
    autoCommission,
    isSalesRole,
    noSaleCut: noSaleCutAmt,
    // Attendance cut detail
    attendanceCutAuto: attendanceAuto,
    attendanceCutManual: attendanceOverride != null,
    // Earnings
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
    // Deductions
    deductions: {
      unpaidLeave: unpaidLeaveDeduction,
      late: lateDeduction,
      attendanceCut: attendanceCutAmt,
      incomeTax,
      eobi,
      eobiEmployer: money(EOBI_EMPLOYER_AMT), // employer contribution (for cost reporting)
      providentFund,
      loan: loanAmt,
      noSaleCut: noSaleCutAmt,
      otherCut: otherCutAmt,
      total: totalDeductions
    },
    // Employer provisions (not deducted from employee pay)
    provisions: {
      gratuityMonthly: gratuityProvision,
      eobiEmployer: money(packageAmount > 0 ? EOBI_EMPLOYER_AMT : 0)
    },
    net,
    exceptions,
    notes
  };
}

// ============================================================
// HR FULL MANUAL PAYSLIP
// All line items controlled by HR — no auto-computation
// ============================================================

function buildManualPayslip({ period, base = {}, lines = {}, notes = '' }) {
  const basic = money(lines.basic ?? 0);
  const houseAllowance = money(lines.houseAllowance ?? 0);
  const transportAllowance = money(lines.transportAllowance ?? 0);
  const medicalAllowance = money(lines.medicalAllowance ?? 0);
  const allowances =
    lines.allowances != null
      ? money(lines.allowances)
      : money(houseAllowance + transportAllowance + medicalAllowance);
  const overtime = money(lines.overtime ?? 0);
  const bonusAmt = money(lines.bonus ?? 0);
  const salesTotal = money(lines.salesAmount ?? base.salesAmount ?? 0);
  const commissionAmt = money(lines.commission ?? 0);
  const gross = money(basic + allowances + overtime + bonusAmt + commissionAmt);

  const attendanceCutAmt = money(lines.attendanceCut ?? 0);
  const incomeTax = money(lines.tax ?? lines.incomeTax ?? 0);
  const eobi = money(lines.eobi ?? 0);
  const providentFund = money(lines.providentFund ?? 0);
  const loanAmt = money(lines.loan ?? 0);
  const noSaleCutAmt = money(lines.noSaleCut ?? 0);
  const otherCutAmt = money(lines.otherCut ?? 0);
  const totalDeductions = money(
    attendanceCutAmt + incomeTax + eobi + providentFund + loanAmt + otherCutAmt + noSaleCutAmt
  );
  const net = money(Math.max(0, gross - totalDeductions));

  const exceptions = Array.isArray(base.exceptions) ? [...base.exceptions] : [];
  if (!exceptions.includes('HR manually edited payslip')) {
    exceptions.push('HR manually edited payslip');
  }
  if (salesTotal > 0) exceptions.push(`Sales ${salesTotal} (HR)`);

  return {
    ...base,
    period: period || base.period,
    periodLabel: base.periodLabel || periodLabel(period || base.period),
    package: money(lines.package ?? base.package ?? gross),
    salesAmount: salesTotal,
    salesCommissionPct: base.salesCommissionPct,
    noSaleCut: noSaleCutAmt,
    hrManual: true,
    attendanceCutManual: true,
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
      unpaidLeave: attendanceCutAmt,
      late: 0,
      attendanceCut: attendanceCutAmt,
      incomeTax,
      // backward compat: keep 'tax' key too
      tax: incomeTax,
      eobi,
      providentFund,
      loan: loanAmt,
      noSaleCut: noSaleCutAmt,
      otherCut: otherCutAmt,
      total: totalDeductions
    },
    net,
    exceptions,
    notes: notes != null ? String(notes) : base.notes || ''
  };
}

// ============================================================
// COMPENSATION PREVIEW (for employee profile display)
// ============================================================

function compensationPreview(employee = {}, settings = {}) {
  const cfg = paySettings(settings);
  const packageAmount = money(employee.salary || 0);
  const pct = (key) => Number(cfg[key] || 0) / 100;
  const basic = money(packageAmount * pct('basicPct')) || packageAmount;
  const houseAllowance = money(packageAmount * pct('housePct'));
  const transportAllowance = money(packageAmount * pct('transportPct'));
  const medicalAllowance = money(packageAmount * pct('medicalPct'));
  const gross = money(basic + houseAllowance + transportAllowance + medicalAllowance);
  return {
    package: packageAmount,
    basic,
    houseAllowance,
    transportAllowance,
    medicalAllowance,
    gross,
    incomeTax: calcIncomeTax(gross, cfg),
    eobi: calcEobi(basic, cfg),
    eobiEmployer: EOBI_EMPLOYER_AMT,
    providentFund: money(basic * pct('pfPct')),
    taxMode: String(cfg.taxMode || 'slab'),
    eobiMode: String(cfg.eobiMode || 'fixed'),
    workDaysPerWeek: Number(cfg.workDaysPerWeek || 6),
    workHoursPerDay: Number(cfg.workHoursPerDay || 8)
  };
}

// ============================================================
// SERIALIZATION
// ============================================================

function serializePayslip(row) {
  const breakdown = row.breakdown && typeof row.breakdown === 'object' ? row.breakdown : {};
  const emp = row.employee || {};
  const deductions = breakdown.deductions || {};
  return {
    id: row.id,
    employeeId: row.employeeId,
    employee: fullName(emp.user),
    employeeCode: emp.employeeCode || '',
    email: emp.user?.email || '',
    department: emp.department || '',
    designation: emp.designation || '',
    employeeType: emp.employeeType || '',
    employmentType: emp.employmentType || '',
    salary: Number(emp.salary || 0),
    package: Number(breakdown.package ?? emp.salary ?? 0),
    office: emp.office?.name || '',
    joiningDate: emp.joiningDate,
    isOnProbation: Boolean(breakdown.isOnProbation),
    period: row.period,
    periodLabel: breakdown.periodLabel || periodLabel(row.period),
    status: row.status,
    base: row.base,
    overtime: row.overtime,
    deductions: row.deductions,
    net: row.net,
    paidAt: row.paidAt || null,
    notes: row.notes || breakdown.notes || '',
    isSalesRole: Boolean(breakdown.isSalesRole) || isSalesRoleEmployee(emp),
    salesAmount: Number(breakdown.salesAmount || 0),
    // Bank details (for payslip printing)
    bankName: emp.profile?.bankName || '',
    bankAccount: emp.profile?.bankAccount || '',
    breakdown,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt
  };
}

// ============================================================
// SUMMARY / REPORTING
// ============================================================

function statutorySummary(items = []) {
  const pick = (fn) => money(items.reduce((s, row) => s + Number(fn(row) || 0), 0));
  return {
    incomeTax: pick((r) => r.breakdown?.deductions?.incomeTax ?? r.breakdown?.deductions?.tax),
    eobi: pick((r) => r.breakdown?.deductions?.eobi),
    eobiEmployer: pick((r) => r.breakdown?.provisions?.eobiEmployer ?? r.breakdown?.deductions?.eobiEmployer),
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
    otherCut: pick((r) => r.breakdown?.deductions?.otherCut),
    gratuityProvision: pick((r) => r.breakdown?.provisions?.gratuityMonthly)
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
    incomeTax: money(yearRows.reduce((s, r) => s + Number(r.breakdown?.deductions?.incomeTax ?? r.breakdown?.deductions?.tax ?? 0), 0)),
    eobi: money(yearRows.reduce((s, r) => s + Number(r.breakdown?.deductions?.eobi || 0), 0)),
    providentFund: money(yearRows.reduce((s, r) => s + Number(r.breakdown?.deductions?.providentFund || 0), 0)),
    overtime: money(yearRows.reduce((s, r) => s + Number(r.overtime || 0), 0))
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

// ============================================================
// EXPORTS
// ============================================================

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
  EOBI_EMPLOYEE_AMT,
  EOBI_EMPLOYER_AMT,
  fbrAnnualTax,
  calcIncomeTax,
  calcEobi,
  compensationPreview,
  statutorySummary,
  ytdFromSlips,
  computePayslip,
  buildManualPayslip,
  isSalesRoleEmployee,
  serializePayslip,
  runSummary,
  fullName
};
