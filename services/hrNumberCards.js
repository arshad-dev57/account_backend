'use strict';

/**
 * The Home screen of every HRMS workspace in ERPNext is built from Number Cards
 * (the number_card documents shipped under each hrms module) whose filters we
 * reproduce here against the equivalent Bisonstechs tables. Nothing is
 * decorative: each card runs a real, company-scoped query when the workspace
 * is opened.
 *
 * ERPNext filter shorthand → Prisma:
 *   docstatus = 1          → status is one of the submitted states (see APPROVED)
 *   Timespan "this month"  → date column inside the month window
 */

const prisma = require('../prisma/client');

function windowOf(now) {
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth();
  const quarter = Math.floor(m / 3);
  const monthStart = new Date(Date.UTC(y, m, 1));
  const day = now.getUTCDate();
  const weekStart = new Date(Date.UTC(y, m, day - ((now.getUTCDay() + 6) % 7)));
  return {
    now,
    today: new Date(Date.UTC(y, m, day)),
    tomorrow: new Date(Date.UTC(y, m, day + 1)),
    weekStart,
    weekEnd: new Date(weekStart.getTime() + 7 * 86400000),
    monthStart,
    monthEnd: new Date(Date.UTC(y, m + 1, 1)),
    lastMonthStart: new Date(Date.UTC(y, m - 1, 1)),
    lastMonthEnd: monthStart,
    quarterStart: new Date(Date.UTC(y, quarter * 3, 1)),
    quarterEnd: new Date(Date.UTC(y, quarter * 3 + 3, 1)),
    yearStart: new Date(Date.UTC(y, 0, 1)),
    yearEnd: new Date(Date.UTC(y + 1, 0, 1))
  };
}

const between = (w, from, to) => ({ gte: w[from], lt: w[to] });
const submitted = (statuses) => ({ status: { in: statuses } });

const APPROVED = ['Approved', 'Paid', 'Finalized', 'Posted', 'Accepted', 'Completed'];

const workspaces = {
  'hr-setup': [
    {
      label: 'Active Employees',
      model: 'hrEmployee',
      where: (w, ctx) => ({ companyId: ctx.companyId, status: 'active' })
    },
    {
      label: 'Employees Joining (This Quarter)',
      model: 'hrEmployee',
      where: (w, ctx) => ({ companyId: ctx.companyId, joiningDate: between(w, 'quarterStart', 'quarterEnd') })
    },
    {
      label: 'Employees Relieving (This Quarter)',
      model: 'hrEmployeeSeparation',
      where: (w, ctx) => ({ companyId: ctx.companyId, separationDate: between(w, 'quarterStart', 'quarterEnd') })
    }
  ],
  tenure: [
    {
      label: 'New Hires (This Year)',
      model: 'hrEmployee',
      where: (w, ctx) => ({ companyId: ctx.companyId, joiningDate: between(w, 'yearStart', 'yearEnd') })
    },
    {
      label: 'Employee Exits (This Year)',
      model: 'hrEmployeeSeparation',
      where: (w, ctx) => ({ companyId: ctx.companyId, separationDate: between(w, 'yearStart', 'yearEnd') })
    },
    {
      label: 'Promotions (This Month)',
      model: 'hrEmployeePromotion',
      where: (w, ctx) => ({ companyId: ctx.companyId, status: 'Approved', promotionDate: between(w, 'monthStart', 'monthEnd') })
    }
  ],
  recruitment: [
    {
      label: 'Job Openings',
      model: 'hrJobOpening',
      where: (w, ctx) => ({ companyId: ctx.companyId, status: 'Open' })
    },
    {
      label: 'Total Applicants (This Month)',
      model: 'hrJobApplicant',
      where: (w, ctx) => ({ companyId: ctx.companyId, createdAt: between(w, 'monthStart', 'monthEnd') })
    },
    {
      label: 'Job Offers (This Month)',
      model: 'hrJobOffer',
      where: (w, ctx) => ({ companyId: ctx.companyId, offerDate: between(w, 'monthStart', 'monthEnd') })
    }
  ],
  'shift-and-attendance': [
    {
      label: 'Total Present (This Month)',
      model: 'hrAttendance',
      where: (w, ctx) => ({ companyId: ctx.companyId, status: 'Present', workDate: between(w, 'monthStart', 'monthEnd') })
    },
    {
      label: 'Total Absent (This Month)',
      model: 'hrAttendance',
      where: (w, ctx) => ({ companyId: ctx.companyId, status: 'Absent', workDate: between(w, 'monthStart', 'monthEnd') })
    },
    {
      label: 'Late Entry (This Month)',
      model: 'hrAttendance',
      where: (w, ctx) => ({ companyId: ctx.companyId, lateEntry: true, workDate: between(w, 'monthStart', 'monthEnd') })
    }
  ],
  leaves: [
    {
      label: 'Number of Employees on Leave (Today)',
      model: 'hrLeave',
      where: (w, ctx) => ({
        companyId: ctx.companyId,
        status: 'Approved',
        fromDate: { lte: w.today },
        toDate: { gte: w.today }
      })
    },
    {
      label: 'Number of Employees on Leave (This Month)',
      model: 'hrLeave',
      where: (w, ctx) => ({ companyId: ctx.companyId, status: 'Approved', fromDate: between(w, 'monthStart', 'monthEnd') })
    },
    {
      label: 'Holidays in this month',
      model: 'hrHoliday',
      where: (w, ctx) => ({ companyId: ctx.companyId, date: between(w, 'monthStart', 'monthEnd') })
    }
  ],
  expenses: [
    {
      label: 'Expense Claims (This Month)',
      model: 'hrExpenseClaim',
      where: (w, ctx) => ({ companyId: ctx.companyId, status: { in: APPROVED }, claimDate: between(w, 'monthStart', 'monthEnd') })
    },
    {
      label: 'Approved Claims (This Month)',
      model: 'hrExpenseClaim',
      where: (w, ctx) => ({ companyId: ctx.companyId, status: { in: ['Approved', 'Paid'] }, claimDate: between(w, 'monthStart', 'monthEnd') })
    },
    {
      label: 'Rejected Claims (This Month)',
      model: 'hrExpenseClaim',
      where: (w, ctx) => ({ companyId: ctx.companyId, status: 'Rejected', claimDate: between(w, 'monthStart', 'monthEnd') })
    }
  ],
  performance: [
    {
      label: 'Ongoing Appraisal Cycles',
      model: 'hrAppraisalCycle',
      where: (w, ctx) => ({ companyId: ctx.companyId, status: 'In Progress' })
    },
    {
      label: 'Appraisals (This Year)',
      model: 'hrPerformanceReview',
      where: (w, ctx) => ({ companyId: ctx.companyId, status: { in: APPROVED }, createdAt: between(w, 'yearStart', 'yearEnd') })
    },
    {
      label: 'Goals In Progress',
      model: 'hrGoal',
      where: (w, ctx) => ({ companyId: ctx.companyId, status: 'In Progress' })
    }
  ],
  'tax-and-benefits': [
    {
      label: 'Total Declaration Submitted',
      model: 'hrTaxExemptionDeclaration',
      where: (w, ctx) => ({ companyId: ctx.companyId, ...submitted(['Submitted', 'Approved']) })
    },
    {
      label: 'Benefit Claims (This Month)',
      model: 'hrEmployeeBenefitClaim',
      where: (w, ctx) => ({ companyId: ctx.companyId, status: { in: APPROVED }, claimedOn: between(w, 'monthStart', 'monthEnd') })
    },
    {
      label: 'Tax Exemption Proofs (This Year)',
      model: 'hrTaxExemptionProofSubmission',
      where: (w, ctx) => ({ companyId: ctx.companyId, ...submitted(['Submitted', 'Approved']), createdAt: between(w, 'yearStart', 'yearEnd') })
    }
  ],
  payroll: [
    {
      label: 'Total Outgoing Salary (Last month)',
      model: 'hrPayrollItem',
      fn: 'sum',
      field: 'net',
      where: (w, ctx) => ({ companyId: ctx.companyId, status: { in: ['Paid', 'Finalized', 'Posted'] }, period: lastPeriodKey(w) })
    },
    {
      label: 'Total Salary Structure',
      model: 'hrSalaryStructure',
      where: (w, ctx) => ({ companyId: ctx.companyId, ...submitted(['Submitted', 'Approved']) })
    },
    {
      label: 'Total Incentive Given (Last month)',
      model: 'hrBonus',
      fn: 'sum',
      field: 'amount',
      where: (w, ctx) => ({
        companyId: ctx.companyId,
        additionalType: { in: ['Salary', 'Bonus'] },
        status: 'Approved',
        period: lastPeriodKey(w)
      })
    }
  ]
};

function lastPeriodKey(w) {
  const d = new Date(w.lastMonthStart);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

function cardsFor(slug) {
  return (workspaces[slug] || []).map((card) => ({ label: card.label, fn: card.fn || 'count', field: card.field || null }));
}

// Each ERPNext workspace Home also carries exactly one chart (the `charts` list
// of the workspace document). These are the same groupings, computed from the
// company's own rows.
const chartDefinitions = {
  'hr-setup': {
    label: 'Department Wise Employee Count',
    async: (companyId) =>
      prisma.hrEmployee.groupBy({ by: ['department'], where: { companyId, status: 'active' }, _count: { _all: true } })
  },
  tenure: {
    label: 'Hiring vs Attrition Count',
    async: async (companyId) => {
      const months = 6;
      const rows = [];
      for (let i = months - 1; i >= 0; i -= 1) {
        const start = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth() - i, 1));
        const end = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 1));
        const [hired, exited] = await Promise.all([
          prisma.hrEmployee.count({ where: { companyId, joiningDate: { gte: start, lt: end } } }),
          prisma.hrEmployeeSeparation.count({ where: { companyId, separationDate: { gte: start, lt: end } } })
        ]);
        rows.push({ name: start.toISOString().slice(0, 7), hired, exited });
      }
      return rows;
    }
  },
  recruitment: {
    label: 'Job Applicant Pipeline',
    async: (companyId) => prisma.hrJobApplicant.groupBy({ by: ['status'], where: { companyId }, _count: { _all: true } })
  },
  'shift-and-attendance': {
    label: 'Attendance Count',
    async: (companyId) => {
      const w = windowOf(new Date());
      return prisma.hrAttendance.groupBy({
        by: ['status'],
        where: { companyId, workDate: between(w, 'monthStart', 'monthEnd') },
        _count: { _all: true }
      });
    }
  },
  leaves: {
    label: 'Leave Applications by Type',
    async: (companyId) => {
      const w = windowOf(new Date());
      return prisma.hrLeave.groupBy({
        by: ['type'],
        where: { companyId, status: 'Approved', fromDate: between(w, 'monthStart', 'monthEnd') },
        _count: { _all: true }
      });
    }
  },
  expenses: {
    label: 'Expense Claims',
    async: (companyId) =>
      prisma.hrExpenseClaim.groupBy({ by: ['status'], where: { companyId }, _count: { _all: true }, _sum: { approvedAmount: true } })
  },
  performance: {
    label: 'Appraisal Overview',
    async: (companyId) => prisma.hrPerformanceReview.groupBy({ by: ['status'], where: { companyId }, _count: { _all: true } })
  },
  'tax-and-benefits': {
    label: 'Benefit Claims',
    async: (companyId) => prisma.hrEmployeeBenefitClaim.groupBy({ by: ['status'], where: { companyId }, _count: { _all: true } })
  },
  payroll: {
    label: 'Outgoing Salary',
    async: async (companyId) => {
      const rows = [];
      const now = new Date();
      for (let i = 5; i >= 0; i -= 1) {
        const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
        const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
        const total = await prisma.hrPayrollItem.aggregate({
          where: { companyId, period: key, status: { in: ['Paid', 'Finalized', 'Posted'] } },
          _sum: { net: true }
        });
        rows.push({ name: key, total: Math.round((total._sum.net || 0) * 100) / 100 });
      }
      return rows;
    }
  }
};

function shapeChart(rows) {
  if (!Array.isArray(rows) || !rows.length) return [];
  if (rows[0].hired !== undefined) {
    return rows.map((r) => ({ label: r.name, value: r.hired, secondary: r.exited }));
  }
  return rows.map((r) => ({
    label: r.name || r.department || r.status || r.type || '',
    value: r._count?._all ?? 0,
    total: r._sum ? Object.values(r._sum)[0] || 0 : undefined
  }));
}

async function chartFor(slug, companyId) {
  const chart = chartDefinitions[slug];
  if (!chart) return null;
  const rows = await chart.async(companyId);
  return { label: chart.label, points: shapeChart(rows) };
}

async function computeWorkspace(slug, companyId, now = new Date()) {
  const w = windowOf(now);
  const cards = workspaces[slug];
  if (!cards) return [];
  const values = await Promise.all(
    cards.map(async (card) => {
      const client = prisma[card.model];
      if (!client) return null;
      const where = card.where(w, { companyId });
      if (card.fn === 'sum') {
        const total = await client.aggregate({ where, _sum: { [card.field]: true } });
        return Math.round((total._sum[card.field] || 0) * 100) / 100;
      }
      return client.count({ where });
    })
  );
  return cards.map((card, i) => ({ label: card.label, value: values[i] ?? 0 }));
}

module.exports = { computeWorkspace, cardsFor, chartFor, workspaces: Object.keys(workspaces) };
