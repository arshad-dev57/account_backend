const prisma = require('../../prisma/client');
const { randomUUID } = require('crypto');

const DEFAULT_SETTINGS = {
  valuationMethod: 'WEIGHTED_AVERAGE',
  allowNegativeStock: false,
  enableBatchTracking: true,
  enableSerialTracking: false,
  enableMultiWarehouse: true,
  enableBinManagement: true,
  enableUomConversion: true,
  quantityPrecision: 6,
  costPrecision: 4,
  maxImportFileMb: 15,
  inventoryOpeningDate: null,
  createMissingMastersDefault: false,
};

async function getOrCreateInventorySettings(companyId) {
  if (!companyId) throw Object.assign(new Error('Company context required'), { statusCode: 400 });

  if (!prisma.companyInventorySetting) {
    throw Object.assign(
      new Error(
        'Prisma client is stale (companyInventorySetting missing). Restart the backend after prisma generate.'
      ),
      { statusCode: 503, code: 'PRISMA_CLIENT_STALE' }
    );
  }

  let row = await prisma.companyInventorySetting.findUnique({ where: { companyId } });
  if (row) return row;

  row = await prisma.companyInventorySetting.create({
    data: {
      id: randomUUID(),
      companyId,
      ...DEFAULT_SETTINGS,
      updatedAt: new Date(),
    },
  });
  return row;
}

async function updateInventorySettings(companyId, patch = {}) {
  await getOrCreateInventorySettings(companyId);
  const allowed = [
    'valuationMethod',
    'allowNegativeStock',
    'enableBatchTracking',
    'enableSerialTracking',
    'enableMultiWarehouse',
    'enableBinManagement',
    'enableUomConversion',
    'quantityPrecision',
    'costPrecision',
    'maxImportFileMb',
    'inventoryOpeningDate',
    'createMissingMastersDefault',
  ];
  const data = {};
  for (const key of allowed) {
    if (patch[key] !== undefined) data[key] = patch[key];
  }
  if (data.valuationMethod) {
    const m = String(data.valuationMethod).toUpperCase();
    if (!['WEIGHTED_AVERAGE', 'FIFO', 'STANDARD'].includes(m)) {
      throw Object.assign(new Error('Invalid valuation method'), { statusCode: 400 });
    }
    data.valuationMethod = m;
  }
  if (data.inventoryOpeningDate) {
    data.inventoryOpeningDate = new Date(data.inventoryOpeningDate);
  }
  return prisma.companyInventorySetting.update({
    where: { companyId },
    data,
  });
}

module.exports = {
  DEFAULT_SETTINGS,
  getOrCreateInventorySettings,
  updateInventorySettings,
};
