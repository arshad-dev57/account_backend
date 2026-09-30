const prisma = require('../../prisma/client');
const { randomUUID } = require('crypto');
const { toNumber, roundTo } = require('./inventoryMath');

const DEFAULT_UOMS = [
  { code: 'PCS', name: 'Pieces', symbol: 'Pcs', decimalPlaces: 0, isBase: true },
  { code: 'KG', name: 'Kilogram', symbol: 'KG', decimalPlaces: 3, isBase: true },
  { code: 'LTR', name: 'Litre', symbol: 'LTR', decimalPlaces: 3, isBase: true },
  { code: 'MTR', name: 'Meter', symbol: 'MTR', decimalPlaces: 3, isBase: true },
  { code: 'BOX', name: 'Box', symbol: 'Box', decimalPlaces: 0, isBase: false },
  { code: 'CTN', name: 'Carton', symbol: 'Ctn', decimalPlaces: 0, isBase: false },
  { code: 'TON', name: 'Ton', symbol: 'Ton', decimalPlaces: 3, isBase: false },
  { code: 'DRM', name: 'Drum', symbol: 'Drum', decimalPlaces: 0, isBase: false },
];

async function ensureDefaultUoms(companyId) {
  const existing = await prisma.unitOfMeasure.count({ where: { companyId } });
  if (existing > 0) return;

  const now = new Date();
  await prisma.unitOfMeasure.createMany({
    data: DEFAULT_UOMS.map((u) => ({
      id: randomUUID(),
      companyId,
      code: u.code,
      name: u.name,
      symbol: u.symbol,
      isBase: u.isBase,
      decimalPlaces: u.decimalPlaces,
      isActive: true,
      updatedAt: now,
    })),
    skipDuplicates: true,
  });

  // Seed common conversions if codes exist
  const byCode = Object.fromEntries(
    (
      await prisma.unitOfMeasure.findMany({ where: { companyId } })
    ).map((u) => [u.code.toUpperCase(), u])
  );

  const pairs = [
    ['BOX', 'PCS', 100],
    ['CTN', 'PCS', 24],
    ['TON', 'KG', 1000],
    ['DRM', 'LTR', 200],
  ];
  for (const [from, to, factor] of pairs) {
    if (!byCode[from] || !byCode[to]) continue;
    await prisma.uomConversion.upsert({
      where: {
        companyId_fromUomId_toUomId: {
          companyId,
          fromUomId: byCode[from].id,
          toUomId: byCode[to].id,
        },
      },
      create: {
        id: randomUUID(),
        companyId,
        fromUomId: byCode[from].id,
        toUomId: byCode[to].id,
        conversionFactor: factor,
        updatedAt: now,
      },
      update: { conversionFactor: factor, isActive: true },
    });
  }
}

async function findUomByCode(companyId, code) {
  if (!code) return null;
  const normalized = String(code).trim().toUpperCase();
  if (!normalized) return null;
  await ensureDefaultUoms(companyId);
  return prisma.unitOfMeasure.findFirst({
    where: {
      companyId,
      isActive: true,
      OR: [
        { code: { equals: normalized, mode: 'insensitive' } },
        { name: { equals: String(code).trim(), mode: 'insensitive' } },
        { symbol: { equals: String(code).trim(), mode: 'insensitive' } },
      ],
    },
  });
}

async function ensureUom(companyId, code, name) {
  const existing = await findUomByCode(companyId, code);
  if (existing) return existing;
  const c = String(code || name || 'PCS').trim().toUpperCase().slice(0, 20);
  return prisma.unitOfMeasure.create({
    data: {
      id: randomUUID(),
      companyId,
      code: c,
      name: name || c,
      symbol: c,
      isBase: true,
      isActive: true,
      updatedAt: new Date(),
    },
  });
}

/**
 * Convert quantity from `fromCode` into `toCode` (usually base UOM).
 * Direct conversion, or via identity if same.
 */
async function convertQuantity(companyId, qty, fromCode, toCode, precision = 6) {
  const q = toNumber(qty);
  if (!fromCode || !toCode || String(fromCode).toUpperCase() === String(toCode).toUpperCase()) {
    return roundTo(q, precision);
  }
  const from = await findUomByCode(companyId, fromCode);
  const to = await findUomByCode(companyId, toCode);
  if (!from || !to) return roundTo(q, precision);

  if (from.id === to.id) return roundTo(q, precision);

  const direct = await prisma.uomConversion.findFirst({
    where: {
      companyId,
      fromUomId: from.id,
      toUomId: to.id,
      isActive: true,
    },
  });
  if (direct) return roundTo(q * toNumber(direct.conversionFactor, 1), precision);

  const inverse = await prisma.uomConversion.findFirst({
    where: {
      companyId,
      fromUomId: to.id,
      toUomId: from.id,
      isActive: true,
    },
  });
  if (inverse && toNumber(inverse.conversionFactor) !== 0) {
    return roundTo(q / toNumber(inverse.conversionFactor), precision);
  }

  // No conversion — treat as 1:1 but flag caller via NaN sentinel? Keep qty and let validation warn.
  return roundTo(q, precision);
}

async function listUoms(companyId) {
  await ensureDefaultUoms(companyId);
  return prisma.unitOfMeasure.findMany({
    where: { companyId, isActive: true },
    orderBy: [{ isBase: 'desc' }, { code: 'asc' }],
  });
}

async function listConversions(companyId) {
  await ensureDefaultUoms(companyId);
  return prisma.uomConversion.findMany({
    where: { companyId, isActive: true },
    include: {
      fromUom: true,
      toUom: true,
    },
    orderBy: { createdAt: 'asc' },
  });
}

module.exports = {
  DEFAULT_UOMS,
  ensureDefaultUoms,
  findUomByCode,
  ensureUom,
  convertQuantity,
  listUoms,
  listConversions,
};
