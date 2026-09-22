'use strict';

const prisma = require('../prisma/client');

function normalizeCode(code) {
  return String(code || '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

async function assertCostCenterOwned(companyId, costCenterId, { activeOnly = false } = {}) {
  if (!costCenterId) return null;
  const row = await prisma.costCenter.findFirst({
    where: {
      id: String(costCenterId),
      companyId,
      ...(activeOnly ? { status: 'active' } : {})
    }
  });
  if (!row) {
    const err = new Error('Cost center not found for this company');
    err.status = 400;
    throw err;
  }
  return row;
}

async function resolveEmployeeCostCenter(employee, companyId) {
  if (!employee) return null;

  if (employee.costCenterId) {
    const direct = await prisma.costCenter.findFirst({
      where: { id: employee.costCenterId, companyId }
    });
    if (direct) return direct;
  }

  const deptName = String(employee.department || '').trim();
  if (deptName) {
    const dept = await prisma.hrDepartment.findFirst({
      where: { companyId, name: { equals: deptName, mode: 'insensitive' } },
      include: { costCenterRef: true }
    });
    if (dept?.costCenterRef) return dept.costCenterRef;
    if (dept?.costCenterId) {
      const linked = await prisma.costCenter.findFirst({
        where: { id: dept.costCenterId, companyId }
      });
      if (linked) return linked;
    }
  }

  const legacy = String(employee.costCenter || '').trim();
  if (legacy) {
    const byCode = await prisma.costCenter.findFirst({
      where: {
        companyId,
        OR: [
          { code: { equals: normalizeCode(legacy), mode: 'insensitive' } },
          { name: { equals: legacy, mode: 'insensitive' } }
        ]
      }
    });
    if (byCode) return byCode;
  }

  return null;
}

function snapshotCostCenter(costCenter) {
  if (!costCenter) {
    return { costCenterId: null, costCenterCode: '', costCenterName: '' };
  }
  return {
    costCenterId: costCenter.id,
    costCenterCode: costCenter.code || '',
    costCenterName: costCenter.name || ''
  };
}

module.exports = {
  normalizeCode,
  assertCostCenterOwned,
  resolveEmployeeCostCenter,
  snapshotCostCenter
};
