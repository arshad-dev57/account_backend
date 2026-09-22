'use strict';

const prisma = require('../prisma/client');
const { requireCompany, requireHrManager } = require('../utils/hrAccess');
const { writeAudit } = require('../utils/hrAudit');
const { normalizeCode, assertCostCenterOwned } = require('../services/costCenterHelper');

function wrap(fn) {
  return async (req, res) => {
    try {
      const companyId = requireCompany(req, res);
      if (!companyId) return;
      await fn(req, res, companyId);
    } catch (error) {
      console.error('[hr-cost-center]', error);
      res.status(error.status || 500).json({ success: false, message: error.message });
    }
  };
}

function serialize(row) {
  if (!row) return row;
  return {
    id: row.id,
    companyId: row.companyId,
    code: row.code,
    name: row.name,
    description: row.description || '',
    officeId: row.officeId || null,
    officeName: row.office?.name || null,
    status: row.status,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    employeeCount: row._count?.employees ?? undefined,
    departmentCount: row._count?.departments ?? undefined
  };
}

exports.list = wrap(async (req, res, companyId) => {
  if (!requireHrManager(req, res)) return;
  const status = String(req.query.status || '').trim().toLowerCase();
  const search = String(req.query.search || '').trim();
  const officeId = String(req.query.officeId || '').trim();
  const includeInactive = req.query.includeInactive === 'true';

  const where = { companyId };
  if (status === 'active' || status === 'inactive') where.status = status;
  else if (!includeInactive) where.status = 'active';
  if (officeId) where.officeId = officeId;
  if (search) {
    where.OR = [
      { code: { contains: search, mode: 'insensitive' } },
      { name: { contains: search, mode: 'insensitive' } },
      { description: { contains: search, mode: 'insensitive' } }
    ];
  }

  const rows = await prisma.costCenter.findMany({
    where,
    include: {
      office: { select: { id: true, name: true } },
      _count: { select: { employees: true, departments: true } }
    },
    orderBy: [{ status: 'asc' }, { code: 'asc' }]
  });
  res.json({ success: true, data: rows.map(serialize) });
});

exports.getById = wrap(async (req, res, companyId) => {
  if (!requireHrManager(req, res)) return;
  const row = await prisma.costCenter.findFirst({
    where: { id: req.params.id, companyId },
    include: {
      office: { select: { id: true, name: true } },
      _count: { select: { employees: true, departments: true, payrollItems: true, journalLines: true } }
    }
  });
  if (!row) return res.status(404).json({ success: false, message: 'Cost center not found' });
  res.json({ success: true, data: serialize(row) });
});

exports.create = wrap(async (req, res, companyId) => {
  if (!requireHrManager(req, res)) return;
  const code = normalizeCode(req.body.code);
  const name = String(req.body.name || '').trim();
  const description = String(req.body.description || '').trim();
  const officeId = req.body.officeId || null;
  if (!code || !name) {
    return res.status(400).json({ success: false, message: 'Code and name are required' });
  }

  if (officeId) {
    const office = await prisma.hrOffice.findFirst({ where: { id: officeId, companyId } });
    if (!office) return res.status(400).json({ success: false, message: 'Office not found' });
  }

  const duplicate = await prisma.costCenter.findFirst({ where: { companyId, code } });
  if (duplicate) {
    return res.status(400).json({ success: false, message: 'Cost center code already exists for this company' });
  }

  const row = await prisma.costCenter.create({
    data: {
      companyId,
      code,
      name,
      description,
      officeId,
      status: 'active'
    },
    include: { office: { select: { id: true, name: true } } }
  });
  await writeAudit(companyId, req.user.id, 'create', 'cost_center', row.id, row.code);
  res.status(201).json({ success: true, data: serialize(row) });
});

exports.update = wrap(async (req, res, companyId) => {
  if (!requireHrManager(req, res)) return;
  const existing = await prisma.costCenter.findFirst({
    where: { id: req.params.id, companyId }
  });
  if (!existing) return res.status(404).json({ success: false, message: 'Cost center not found' });

  const data = {};
  if (req.body.code != null) {
    const code = normalizeCode(req.body.code);
    if (!code) return res.status(400).json({ success: false, message: 'Invalid cost center code' });
    const duplicate = await prisma.costCenter.findFirst({
      where: { companyId, code, id: { not: existing.id } }
    });
    if (duplicate) {
      return res.status(400).json({ success: false, message: 'Cost center code already exists for this company' });
    }
    data.code = code;
  }
  if (req.body.name != null) {
    const name = String(req.body.name).trim();
    if (!name) return res.status(400).json({ success: false, message: 'Name is required' });
    data.name = name;
  }
  if (req.body.description != null) data.description = String(req.body.description).trim();
  if (req.body.officeId !== undefined) {
    if (req.body.officeId) {
      const office = await prisma.hrOffice.findFirst({
        where: { id: req.body.officeId, companyId }
      });
      if (!office) return res.status(400).json({ success: false, message: 'Office not found' });
      data.officeId = req.body.officeId;
    } else {
      data.officeId = null;
    }
  }

  const row = await prisma.costCenter.update({
    where: { id: existing.id },
    data,
    include: { office: { select: { id: true, name: true } } }
  });
  await writeAudit(companyId, req.user.id, 'update', 'cost_center', row.id, row.code);
  res.json({ success: true, data: serialize(row) });
});

exports.setStatus = wrap(async (req, res, companyId) => {
  if (!requireHrManager(req, res)) return;
  const status = String(req.body.status || '').toLowerCase();
  if (!['active', 'inactive'].includes(status)) {
    return res.status(400).json({ success: false, message: 'Status must be active or inactive' });
  }
  const existing = await prisma.costCenter.findFirst({
    where: { id: req.params.id, companyId }
  });
  if (!existing) return res.status(404).json({ success: false, message: 'Cost center not found' });

  const row = await prisma.costCenter.update({
    where: { id: existing.id },
    data: { status },
    include: { office: { select: { id: true, name: true } } }
  });
  await writeAudit(companyId, req.user.id, status === 'active' ? 'activate' : 'deactivate', 'cost_center', row.id, row.code);
  res.json({ success: true, data: serialize(row) });
});

exports.summaryReport = wrap(async (req, res, companyId) => {
  if (!requireHrManager(req, res)) return;
  const period = String(req.query.period || '').trim();
  const from = String(req.query.from || '').trim();
  const to = String(req.query.to || '').trim();

  const centers = await prisma.costCenter.findMany({
    where: { companyId },
    include: {
      _count: { select: { employees: true } }
    },
    orderBy: { code: 'asc' }
  });

  const payrollWhere = { companyId };
  if (period) payrollWhere.period = period;

  const payrollRows = await prisma.hrPayrollItem.findMany({
    where: payrollWhere,
    select: {
      costCenterId: true,
      costCenterCode: true,
      costCenterName: true,
      net: true,
      status: true
    }
  });

  let journalLines = [];
  if (from || to) {
    const dateFilter = {};
    if (from) dateFilter.gte = new Date(`${from}T00:00:00.000Z`);
    if (to) dateFilter.lte = new Date(`${to}T23:59:59.999Z`);
    journalLines = await prisma.journalLine.findMany({
      where: {
        costCenterId: { not: null },
        journal: {
          companyId,
          status: 'Posted',
          ...(Object.keys(dateFilter).length ? { date: dateFilter } : {})
        }
      },
      select: {
        costCenterId: true,
        debit: true,
        credit: true,
        accountName: true,
        accountCode: true
      }
    });
  }

  const payrollByCc = new Map();
  payrollRows.forEach((row) => {
    const key = row.costCenterId || 'unassigned';
    if (!payrollByCc.has(key)) {
      payrollByCc.set(key, { payrollCost: 0, count: 0, code: row.costCenterCode, name: row.costCenterName });
    }
    const bucket = payrollByCc.get(key);
    bucket.payrollCost += Number(row.net || 0);
    bucket.count += 1;
  });

  const glByCc = new Map();
  journalLines.forEach((line) => {
    const key = line.costCenterId;
    if (!glByCc.has(key)) glByCc.set(key, { debit: 0, credit: 0 });
    const bucket = glByCc.get(key);
    bucket.debit += Number(line.debit || 0);
    bucket.credit += Number(line.credit || 0);
  });

  const data = centers.map((cc) => {
    const payroll = payrollByCc.get(cc.id) || { payrollCost: 0, count: 0 };
    const gl = glByCc.get(cc.id) || { debit: 0, credit: 0 };
    return {
      id: cc.id,
      code: cc.code,
      name: cc.name,
      status: cc.status,
      employees: cc._count.employees,
      payrollItems: payroll.count,
      payrollCost: Math.round(payroll.payrollCost * 100) / 100,
      glDebit: Math.round(gl.debit * 100) / 100,
      glCredit: Math.round(gl.credit * 100) / 100,
      totalAnalytical: Math.round((payroll.payrollCost + gl.debit - gl.credit) * 100) / 100
    };
  });

  res.json({ success: true, data, period: period || null, from: from || null, to: to || null });
});

exports.glReport = wrap(async (req, res, companyId) => {
  if (!requireHrManager(req, res)) return;
  const costCenterId = String(req.query.costCenterId || '').trim();
  const from = String(req.query.from || '').trim();
  const to = String(req.query.to || '').trim();
  if (!costCenterId) {
    return res.status(400).json({ success: false, message: 'costCenterId is required' });
  }
  await assertCostCenterOwned(companyId, costCenterId);

  const dateFilter = {};
  if (from) dateFilter.gte = new Date(`${from}T00:00:00.000Z`);
  if (to) dateFilter.lte = new Date(`${to}T23:59:59.999Z`);

  const lines = await prisma.journalLine.findMany({
    where: {
      costCenterId,
      journal: {
        companyId,
        status: 'Posted',
        ...(Object.keys(dateFilter).length ? { date: dateFilter } : {})
      }
    },
    include: {
      journal: { select: { id: true, entryNumber: true, date: true, reference: true, description: true } },
      account: { select: { id: true, code: true, name: true, type: true } }
    },
    orderBy: [{ journal: { date: 'asc' } }, { id: 'asc' }]
  });

  let balance = 0;
  const rows = lines.map((line) => {
    balance += Number(line.debit || 0) - Number(line.credit || 0);
    return {
      date: line.journal.date,
      entryNumber: line.journal.entryNumber,
      reference: line.journal.reference,
      description: line.journal.description,
      accountCode: line.accountCode,
      accountName: line.accountName,
      debit: line.debit,
      credit: line.credit,
      balance: Math.round(balance * 100) / 100
    };
  });

  res.json({ success: true, data: rows, costCenterId });
});
