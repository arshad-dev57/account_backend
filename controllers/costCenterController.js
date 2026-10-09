'use strict';

/**
 * Accounting-facing Cost Center CRUD (company-scoped).
 * Same CostCenter master as HR — no HR-manager gate so Expenses/Budgets/JE
 * can create and select cost centers from Accounting.
 */

const prisma = require('../prisma/client');
const { normalizeCode } = require('../services/costCenterHelper');

function companyIdOf(req) {
  return req.user?.companyId || null;
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
    departmentCount: row._count?.departments ?? undefined,
  };
}

exports.list = async (req, res) => {
  try {
    const companyId = companyIdOf(req);
    if (!companyId) {
      return res.status(400).json({ success: false, message: 'Company context required' });
    }

    const status = String(req.query.status || '').trim().toLowerCase();
    const search = String(req.query.search || '').trim();
    const includeInactive = req.query.includeInactive === 'true';

    const where = { companyId };
    if (status === 'active' || status === 'inactive') where.status = status;
    else if (!includeInactive) where.status = 'active';
    if (search) {
      where.OR = [
        { code: { contains: search, mode: 'insensitive' } },
        { name: { contains: search, mode: 'insensitive' } },
        { description: { contains: search, mode: 'insensitive' } },
      ];
    }

    const rows = await prisma.costCenter.findMany({
      where,
      include: {
        office: { select: { id: true, name: true } },
        _count: { select: { employees: true, departments: true } },
      },
      orderBy: [{ status: 'asc' }, { code: 'asc' }],
    });

    res.json({ success: true, data: rows.map(serialize) });
  } catch (error) {
    console.error('[cost-centers] list', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.getById = async (req, res) => {
  try {
    const companyId = companyIdOf(req);
    if (!companyId) {
      return res.status(400).json({ success: false, message: 'Company context required' });
    }

    const row = await prisma.costCenter.findFirst({
      where: { id: req.params.id, companyId },
      include: {
        office: { select: { id: true, name: true } },
        _count: { select: { employees: true, departments: true, payrollItems: true, journalLines: true } },
      },
    });
    if (!row) {
      return res.status(404).json({ success: false, message: 'Cost center not found' });
    }
    res.json({ success: true, data: serialize(row) });
  } catch (error) {
    console.error('[cost-centers] get', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.create = async (req, res) => {
  try {
    const companyId = companyIdOf(req);
    if (!companyId) {
      return res.status(400).json({ success: false, message: 'Company context required' });
    }

    const code = normalizeCode(req.body.code);
    const name = String(req.body.name || '').trim();
    const description = String(req.body.description || '').trim();
    const officeId = req.body.officeId || null;

    if (!code || !name) {
      return res.status(400).json({ success: false, message: 'Code and name are required' });
    }

    if (officeId) {
      const office = await prisma.hrOffice.findFirst({ where: { id: officeId, companyId } });
      if (!office) {
        return res.status(400).json({ success: false, message: 'Office not found' });
      }
    }

    const duplicate = await prisma.costCenter.findFirst({ where: { companyId, code } });
    if (duplicate) {
      return res.status(400).json({
        success: false,
        message: 'Cost center code already exists for this company',
      });
    }

    const row = await prisma.costCenter.create({
      data: {
        companyId,
        code,
        name,
        description,
        officeId,
        status: 'active',
      },
      include: { office: { select: { id: true, name: true } } },
    });

    res.status(201).json({ success: true, data: serialize(row) });
  } catch (error) {
    console.error('[cost-centers] create', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.update = async (req, res) => {
  try {
    const companyId = companyIdOf(req);
    if (!companyId) {
      return res.status(400).json({ success: false, message: 'Company context required' });
    }

    const existing = await prisma.costCenter.findFirst({
      where: { id: req.params.id, companyId },
    });
    if (!existing) {
      return res.status(404).json({ success: false, message: 'Cost center not found' });
    }

    const code = req.body.code !== undefined ? normalizeCode(req.body.code) : existing.code;
    const name = req.body.name !== undefined ? String(req.body.name || '').trim() : existing.name;
    const description =
      req.body.description !== undefined
        ? String(req.body.description || '').trim()
        : existing.description;
    const officeId =
      req.body.officeId !== undefined ? req.body.officeId || null : existing.officeId;

    if (!code || !name) {
      return res.status(400).json({ success: false, message: 'Code and name are required' });
    }

    if (code !== existing.code) {
      const duplicate = await prisma.costCenter.findFirst({
        where: { companyId, code, NOT: { id: existing.id } },
      });
      if (duplicate) {
        return res.status(400).json({
          success: false,
          message: 'Cost center code already exists for this company',
        });
      }
    }

    if (officeId) {
      const office = await prisma.hrOffice.findFirst({ where: { id: officeId, companyId } });
      if (!office) {
        return res.status(400).json({ success: false, message: 'Office not found' });
      }
    }

    const row = await prisma.costCenter.update({
      where: { id: existing.id },
      data: { code, name, description, officeId },
      include: { office: { select: { id: true, name: true } } },
    });

    res.json({ success: true, data: serialize(row) });
  } catch (error) {
    console.error('[cost-centers] update', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.setStatus = async (req, res) => {
  try {
    const companyId = companyIdOf(req);
    if (!companyId) {
      return res.status(400).json({ success: false, message: 'Company context required' });
    }

    const status = String(req.body.status || '').toLowerCase();
    if (status !== 'active' && status !== 'inactive') {
      return res.status(400).json({ success: false, message: 'status must be active or inactive' });
    }

    const existing = await prisma.costCenter.findFirst({
      where: { id: req.params.id, companyId },
    });
    if (!existing) {
      return res.status(404).json({ success: false, message: 'Cost center not found' });
    }

    const row = await prisma.costCenter.update({
      where: { id: existing.id },
      data: { status },
      include: { office: { select: { id: true, name: true } } },
    });

    res.json({ success: true, data: serialize(row) });
  } catch (error) {
    console.error('[cost-centers] status', error);
    res.status(500).json({ success: false, message: error.message });
  }
};
