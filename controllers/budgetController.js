'use strict';

const prisma = require('../prisma/client');

const VALID_STATUS = ['Draft', 'Approved', 'Closed'];

function companyIdFrom(req) {
  return (req.method === 'GET' || req.method === 'HEAD')
    ? (req.companyIdFilter ?? req.user.companyId)
    : req.user.companyId;
}

async function assertCompanyRefs(companyId, { departmentId, costCenterId, fiscalYearId, accountIds }) {
  if (fiscalYearId) {
    const fy = await prisma.fiscalYear.findFirst({
      where: { id: fiscalYearId, companyId },
      select: { id: true, startDate: true, endDate: true, name: true },
    });
    if (!fy) {
      const err = new Error('Fiscal year not found for this company');
      err.statusCode = 400;
      throw err;
    }
  }
  if (departmentId) {
    const d = await prisma.hrDepartment.findFirst({
      where: { id: departmentId, companyId },
      select: { id: true },
    });
    if (!d) {
      const err = new Error('Department not found for this company');
      err.statusCode = 400;
      throw err;
    }
  }
  if (costCenterId) {
    const c = await prisma.costCenter.findFirst({
      where: { id: costCenterId, companyId },
      select: { id: true },
    });
    if (!c) {
      const err = new Error('Cost center not found for this company');
      err.statusCode = 400;
      throw err;
    }
  }
  if (Array.isArray(accountIds) && accountIds.length) {
    const found = await prisma.chartOfAccount.findMany({
      where: { id: { in: accountIds }, companyId, isActive: true },
      select: { id: true },
    });
    if (found.length !== new Set(accountIds).size) {
      const err = new Error('One or more budget accounts are invalid for this company');
      err.statusCode = 400;
      throw err;
    }
  }
}

const budgetInclude = {
  fiscalYear: { select: { id: true, name: true, startDate: true, endDate: true, status: true } },
  department: { select: { id: true, name: true } },
  costCenter: { select: { id: true, code: true, name: true } },
  lines: {
    include: {
      account: { select: { id: true, code: true, name: true, type: true } },
      department: { select: { id: true, name: true } },
      costCenter: { select: { id: true, code: true, name: true } },
      allocations: { orderBy: { periodKey: 'asc' } },
    },
  },
  creator: { select: { id: true, firstName: true, lastName: true, email: true } },
  approver: { select: { id: true, firstName: true, lastName: true, email: true } },
};

/** Lightweight masters for accounting dropdowns (no HR-manager gate). */
const listDimensions = async (req, res) => {
  try {
    const companyId = companyIdFrom(req);
    if (!companyId) {
      return res.status(400).json({ success: false, message: 'Company context required' });
    }
    const [departments, costCenters] = await Promise.all([
      prisma.hrDepartment.findMany({
        where: { companyId },
        select: { id: true, name: true, costCenterId: true },
        orderBy: { name: 'asc' },
      }),
      prisma.costCenter.findMany({
        where: { companyId, status: 'active' },
        select: { id: true, code: true, name: true },
        orderBy: { name: 'asc' },
      }),
    ]);
    return res.json({ success: true, data: { departments, costCenters } });
  } catch (error) {
    console.error('listDimensions error:', error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

const listBudgets = async (req, res) => {
  try {
    const companyId = companyIdFrom(req);
    const { fiscalYearId, status, departmentId, costCenterId } = req.query;
    const where = { companyId };
    if (fiscalYearId) where.fiscalYearId = String(fiscalYearId);
    if (status) where.status = String(status);
    if (departmentId) where.departmentId = String(departmentId);
    if (costCenterId) where.costCenterId = String(costCenterId);

    const budgets = await prisma.budget.findMany({
      where,
      include: {
        fiscalYear: { select: { id: true, name: true } },
        department: { select: { id: true, name: true } },
        costCenter: { select: { id: true, code: true, name: true } },
        lines: { select: { id: true, amount: true } },
        _count: { select: { lines: true } },
      },
      orderBy: { updatedAt: 'desc' },
    });

    const data = budgets.map((b) => ({
      ...b,
      totalAmount: (b.lines || []).reduce((s, l) => s + (Number(l.amount) || 0), 0),
      lineCount: b._count?.lines || 0,
      lines: undefined,
      _count: undefined,
    }));

    return res.json({ success: true, data });
  } catch (error) {
    console.error('listBudgets error:', error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

const getBudget = async (req, res) => {
  try {
    const companyId = companyIdFrom(req);
    const budget = await prisma.budget.findFirst({
      where: { id: req.params.id, companyId },
      include: budgetInclude,
    });
    if (!budget) {
      return res.status(404).json({ success: false, message: 'Budget not found' });
    }
    const totalAmount = budget.lines.reduce((s, l) => s + (Number(l.amount) || 0), 0);
    const allocatedAmount = budget.lines.reduce(
      (s, l) => s + (l.allocations || []).reduce((a, p) => a + (Number(p.amount) || 0), 0),
      0
    );
    return res.json({
      success: true,
      data: { ...budget, totalAmount, allocatedAmount },
    });
  } catch (error) {
    console.error('getBudget error:', error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

function normalizeLines(lines) {
  if (!Array.isArray(lines) || lines.length === 0) {
    const err = new Error('At least one budget account line is required');
    err.statusCode = 400;
    throw err;
  }
  return lines.map((line) => {
    const accountId = String(line.accountId || '').trim();
    const amount = Number(line.amount) || 0;
    if (!accountId) {
      const err = new Error('Budget line account is required');
      err.statusCode = 400;
      throw err;
    }
    if (amount < 0) {
      const err = new Error('Budget line amount cannot be negative');
      err.statusCode = 400;
      throw err;
    }
    const allocations = Array.isArray(line.allocations) ? line.allocations : [];
    const allocTotal = allocations.reduce((s, a) => s + (Number(a.amount) || 0), 0);
    if (allocTotal > amount + 0.0001 && amount > 0) {
      const err = new Error(
        `Allocated amount (${allocTotal}) exceeds line budget (${amount}) for an account`
      );
      err.statusCode = 400;
      throw err;
    }
    return {
      accountId,
      amount,
      notes: String(line.notes || ''),
      departmentId: line.departmentId || null,
      costCenterId: line.costCenterId || null,
      allocations: allocations
        .filter((a) => a && a.periodKey)
        .map((a) => ({
          periodKey: String(a.periodKey),
          amount: Number(a.amount) || 0,
        })),
    };
  });
}

const createBudget = async (req, res) => {
  try {
    const companyId = companyIdFrom(req);
    const userId = req.user.id;
    const {
      name,
      fiscalYearId,
      departmentId,
      costCenterId,
      startDate,
      endDate,
      notes,
      status,
      lines,
    } = req.body;

    if (!name || !String(name).trim()) {
      return res.status(400).json({ success: false, message: 'Budget name is required' });
    }
    if (!fiscalYearId) {
      return res.status(400).json({ success: false, message: 'Fiscal year is required' });
    }

    const normalized = normalizeLines(lines);
    await assertCompanyRefs(companyId, {
      fiscalYearId,
      departmentId: departmentId || null,
      costCenterId: costCenterId || null,
      accountIds: normalized.map((l) => l.accountId),
    });

    const fy = await prisma.fiscalYear.findFirst({
      where: { id: fiscalYearId, companyId },
    });
    const start = startDate ? new Date(startDate) : new Date(fy.startDate);
    const end = endDate ? new Date(endDate) : new Date(fy.endDate);
    if (isNaN(start.getTime()) || isNaN(end.getTime()) || end < start) {
      return res.status(400).json({ success: false, message: 'Invalid budget date range' });
    }

    const nextStatus = VALID_STATUS.includes(status) ? status : 'Draft';

    const budget = await prisma.budget.create({
      data: {
        companyId,
        fiscalYearId,
        name: String(name).trim(),
        departmentId: departmentId || null,
        costCenterId: costCenterId || null,
        startDate: start,
        endDate: end,
        notes: String(notes || ''),
        status: nextStatus,
        createdBy: userId,
        ...(nextStatus === 'Approved'
          ? { approvedBy: userId, approvedAt: new Date() }
          : {}),
        lines: {
          create: normalized.map((l) => ({
            accountId: l.accountId,
            amount: l.amount,
            notes: l.notes,
            departmentId: l.departmentId,
            costCenterId: l.costCenterId,
            allocations: {
              create: l.allocations,
            },
          })),
        },
      },
      include: budgetInclude,
    });

    return res.status(201).json({ success: true, data: budget });
  } catch (error) {
    console.error('createBudget error:', error);
    if (error.code === 'P2002') {
      return res.status(400).json({
        success: false,
        message: 'A budget with this name already exists for the fiscal year',
      });
    }
    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.message || 'Failed to create budget',
    });
  }
};

const updateBudget = async (req, res) => {
  try {
    const companyId = companyIdFrom(req);
    const userId = req.user.id;
    const existing = await prisma.budget.findFirst({
      where: { id: req.params.id, companyId },
      include: { lines: true },
    });
    if (!existing) {
      return res.status(404).json({ success: false, message: 'Budget not found' });
    }
    if (existing.status === 'Closed') {
      return res.status(400).json({ success: false, message: 'Closed budgets cannot be edited' });
    }

    const {
      name,
      fiscalYearId,
      departmentId,
      costCenterId,
      startDate,
      endDate,
      notes,
      status,
      lines,
    } = req.body;

    const nextFiscalYearId = fiscalYearId || existing.fiscalYearId;
    const normalized = lines !== undefined ? normalizeLines(lines) : null;

    await assertCompanyRefs(companyId, {
      fiscalYearId: nextFiscalYearId,
      departmentId: departmentId !== undefined ? departmentId || null : existing.departmentId,
      costCenterId: costCenterId !== undefined ? costCenterId || null : existing.costCenterId,
      accountIds: normalized ? normalized.map((l) => l.accountId) : [],
    });

    const nextStatus =
      status && VALID_STATUS.includes(status) ? status : existing.status;

    const budget = await prisma.$transaction(async (tx) => {
      if (normalized) {
        await tx.budgetLine.deleteMany({ where: { budgetId: existing.id } });
      }

      return tx.budget.update({
        where: { id: existing.id },
        data: {
          name: name != null ? String(name).trim() : undefined,
          fiscalYearId: nextFiscalYearId,
          departmentId: departmentId !== undefined ? departmentId || null : undefined,
          costCenterId: costCenterId !== undefined ? costCenterId || null : undefined,
          startDate: startDate ? new Date(startDate) : undefined,
          endDate: endDate ? new Date(endDate) : undefined,
          notes: notes !== undefined ? String(notes || '') : undefined,
          status: nextStatus,
          ...(nextStatus === 'Approved' && existing.status !== 'Approved'
            ? { approvedBy: userId, approvedAt: new Date() }
            : {}),
          ...(normalized
            ? {
                lines: {
                  create: normalized.map((l) => ({
                    accountId: l.accountId,
                    amount: l.amount,
                    notes: l.notes,
                    departmentId: l.departmentId,
                    costCenterId: l.costCenterId,
                    allocations: { create: l.allocations },
                  })),
                },
              }
            : {}),
        },
        include: budgetInclude,
      });
    });

    return res.json({ success: true, data: budget });
  } catch (error) {
    console.error('updateBudget error:', error);
    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.message || 'Failed to update budget',
    });
  }
};

const deleteBudget = async (req, res) => {
  try {
    const companyId = companyIdFrom(req);
    const existing = await prisma.budget.findFirst({
      where: { id: req.params.id, companyId },
    });
    if (!existing) {
      return res.status(404).json({ success: false, message: 'Budget not found' });
    }
    if (existing.status === 'Approved') {
      return res.status(400).json({
        success: false,
        message: 'Approved budgets cannot be deleted. Close them instead.',
      });
    }
    await prisma.budget.delete({ where: { id: existing.id } });
    return res.json({ success: true, message: 'Budget deleted' });
  } catch (error) {
    console.error('deleteBudget error:', error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

const setBudgetStatus = async (req, res) => {
  try {
    const companyId = companyIdFrom(req);
    const userId = req.user.id;
    const { status } = req.body;
    if (!VALID_STATUS.includes(status)) {
      return res.status(400).json({
        success: false,
        message: `Status must be one of: ${VALID_STATUS.join(', ')}`,
      });
    }
    const existing = await prisma.budget.findFirst({
      where: { id: req.params.id, companyId },
    });
    if (!existing) {
      return res.status(404).json({ success: false, message: 'Budget not found' });
    }

    const budget = await prisma.budget.update({
      where: { id: existing.id },
      data: {
        status,
        ...(status === 'Approved'
          ? { approvedBy: userId, approvedAt: new Date() }
          : {}),
      },
      include: budgetInclude,
    });
    return res.json({ success: true, data: budget });
  } catch (error) {
    console.error('setBudgetStatus error:', error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * Budget vs Actual from posted journal lines (Expense account debits).
 * Budget itself never posts to GL.
 */
const budgetVsActual = async (req, res) => {
  try {
    const companyId = companyIdFrom(req);
    const {
      budgetId,
      fiscalYearId,
      departmentId,
      costCenterId,
      accountId,
      startDate,
      endDate,
    } = req.query;

    let budgets = [];
    if (budgetId) {
      const one = await prisma.budget.findFirst({
        where: { id: String(budgetId), companyId },
        include: budgetInclude,
      });
      if (!one) {
        return res.status(404).json({ success: false, message: 'Budget not found' });
      }
      budgets = [one];
    } else {
      const where = {
        companyId,
        status: { in: ['Approved', 'Closed', 'Draft'] },
      };
      if (fiscalYearId) where.fiscalYearId = String(fiscalYearId);
      if (departmentId) where.departmentId = String(departmentId);
      if (costCenterId) where.costCenterId = String(costCenterId);
      budgets = await prisma.budget.findMany({
        where,
        include: budgetInclude,
        orderBy: { name: 'asc' },
      });
    }

    if (!budgets.length) {
      return res.json({ success: true, data: { rows: [], totals: { budget: 0, actual: 0, variance: 0 } } });
    }

    // Date window: intersection of query + budget ranges (use union of budget dates for actuals)
    let rangeStart = startDate ? new Date(String(startDate)) : null;
    let rangeEnd = endDate ? new Date(String(endDate)) : null;
    if (!rangeStart || !rangeEnd) {
      rangeStart = new Date(Math.min(...budgets.map((b) => new Date(b.startDate).getTime())));
      rangeEnd = new Date(Math.max(...budgets.map((b) => new Date(b.endDate).getTime())));
    }

    const accountIds = [
      ...new Set(
        budgets.flatMap((b) =>
          b.lines
            .filter((l) => !accountId || l.accountId === String(accountId))
            .map((l) => l.accountId)
        )
      ),
    ];

    const lineWhere = {
      debit: { gt: 0 },
      accountId: { in: accountIds.length ? accountIds : ['__none__'] },
      journal: {
        companyId,
        status: 'Posted',
        date: { gte: rangeStart, lte: rangeEnd },
      },
    };
    // Prefer budget-level cost center, else query filter
    const ccFilter = costCenterId || budgets[0]?.costCenterId;
    if (ccFilter && budgets.length === 1) {
      lineWhere.costCenterId = String(ccFilter);
    } else if (costCenterId) {
      lineWhere.costCenterId = String(costCenterId);
    }

    const actualLines = accountIds.length
      ? await prisma.journalLine.findMany({
          where: lineWhere,
          select: {
            accountId: true,
            debit: true,
            costCenterId: true,
            journal: { select: { date: true, reference: true } },
          },
        })
      : [];

    // Also include posted Expense totals by department when filtering by department
    // (expenses carry departmentId; JE lines only carry costCenterId)
    let expenseActualByAccount = new Map();
    if (departmentId || budgets.some((b) => b.departmentId)) {
      const deptIds = departmentId
        ? [String(departmentId)]
        : [...new Set(budgets.map((b) => b.departmentId).filter(Boolean))];
      if (deptIds.length) {
        const expenses = await prisma.expense.findMany({
          where: {
            companyId,
            status: 'Posted',
            departmentId: { in: deptIds },
            expenseAccountId: { in: accountIds },
            date: { gte: rangeStart, lte: rangeEnd },
          },
          select: { expenseAccountId: true, totalAmount: true },
        });
        for (const e of expenses) {
          if (!e.expenseAccountId) continue;
          expenseActualByAccount.set(
            e.expenseAccountId,
            (expenseActualByAccount.get(e.expenseAccountId) || 0) + (Number(e.totalAmount) || 0)
          );
        }
      }
    }

    const actualByAccount = new Map();
    for (const l of actualLines) {
      actualByAccount.set(
        l.accountId,
        (actualByAccount.get(l.accountId) || 0) + (Number(l.debit) || 0)
      );
    }
    // If department filter used expense path, prefer that for those accounts to avoid double-count
    // when both JE and expense exist for same posting — use max of JE vs expense for dept mode
    const useExpenseActuals = expenseActualByAccount.size > 0;
    if (useExpenseActuals) {
      for (const [accId, amt] of expenseActualByAccount.entries()) {
        actualByAccount.set(accId, amt);
      }
    }

    const rows = [];
    for (const budget of budgets) {
      for (const line of budget.lines) {
        if (accountId && line.accountId !== String(accountId)) continue;
        const budgetAmt = Number(line.amount) || 0;
        const allocated = (line.allocations || []).reduce(
          (s, a) => s + (Number(a.amount) || 0),
          0
        );
        const actual = actualByAccount.get(line.accountId) || 0;
        const variance = budgetAmt - actual;
        const utilization = budgetAmt > 0 ? (actual / budgetAmt) * 100 : 0;
        rows.push({
          budgetId: budget.id,
          budgetName: budget.name,
          budgetStatus: budget.status,
          accountId: line.accountId,
          accountCode: line.account?.code,
          accountName: line.account?.name,
          departmentId: line.departmentId || budget.departmentId,
          departmentName: line.department?.name || budget.department?.name || null,
          costCenterId: line.costCenterId || budget.costCenterId,
          costCenterName: line.costCenter?.name || budget.costCenter?.name || null,
          budget: budgetAmt,
          allocated,
          actual,
          variance,
          utilization: Math.round(utilization * 100) / 100,
          remaining: Math.max(0, variance),
        });
      }
    }

    const totals = rows.reduce(
      (acc, r) => {
        acc.budget += r.budget;
        acc.actual += r.actual;
        acc.allocated += r.allocated;
        acc.variance += r.variance;
        return acc;
      },
      { budget: 0, actual: 0, allocated: 0, variance: 0 }
    );
    totals.utilization =
      totals.budget > 0
        ? Math.round((totals.actual / totals.budget) * 10000) / 100
        : 0;

    return res.json({
      success: true,
      data: {
        range: { startDate: rangeStart, endDate: rangeEnd },
        rows,
        totals,
      },
    });
  } catch (error) {
    console.error('budgetVsActual error:', error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

module.exports = {
  listDimensions,
  listBudgets,
  getBudget,
  createBudget,
  updateBudget,
  deleteBudget,
  setBudgetStatus,
  budgetVsActual,
};
