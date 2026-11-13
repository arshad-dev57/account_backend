'use strict';

const { Prisma } = require('@prisma/client');
const prisma = require('../prisma/client');

function httpError(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

function num(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function round4(value) {
  return Math.round(num(value) * 10000) / 10000;
}

function dec(value) {
  return new Prisma.Decimal(round4(value));
}

function brandOf(value) {
  return value == null ? '' : String(value).trim();
}

function str(value) {
  if (value === undefined || value === null) return null;
  const s = String(value).trim();
  return s === '' ? null : s;
}

function startOfDay(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

function endOfDay(date) {
  const d = new Date(date);
  d.setHours(23, 59, 59, 999);
  return d;
}

function parseDate(value, label = 'date') {
  if (!value) throw httpError(400, `${label} is required`);
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) throw httpError(400, `Invalid ${label}`);
  return d;
}

async function nextNumber(tx, model, field, companyId, prefix) {
  const tag = String(companyId || '').replace(/-/g, '').slice(0, 6).toUpperCase() || 'TW';
  const stem = `${prefix}-${tag}-`;
  const count = await tx[model].count({ where: { companyId } });
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const candidate = `${stem}${String(count + 1 + attempt).padStart(4, '0')}`;
    const exists = await tx[model].findFirst({
      where: { companyId, [field]: candidate },
      select: { id: true },
    });
    if (!exists) return candidate;
  }
  return `${stem}${Date.now().toString().slice(-8)}`;
}

async function findYarnStock(tx, { companyId, articleCount, brand, lotNumber, warehouseId }) {
  return tx.textileYarnStock.findFirst({
    where: {
      companyId,
      articleCount: String(articleCount).trim(),
      brand: brandOf(brand),
      lotNumber: String(lotNumber).trim(),
      warehouseId: warehouseId || null,
    },
  });
}

async function upsertYarnStock(
  tx,
  {
    companyId,
    userId,
    articleCount,
    brand,
    lotNumber,
    warehouseId = null,
    productId = null,
    kgPerCarton = 32,
    deltaCartons = 0,
    deltaWeightKg = 0,
    allowNegative = false,
  }
) {
  const article = String(articleCount || '').trim();
  const lot = String(lotNumber || '').trim();
  if (!article || !lot) throw httpError(400, 'articleCount and lotNumber are required');

  const kgPer = round4(kgPerCarton || 32);
  let stock = await findYarnStock(tx, {
    companyId,
    articleCount: article,
    brand,
    lotNumber: lot,
    warehouseId,
  });

  if (!stock) {
    if (deltaCartons < 0 || deltaWeightKg < 0) {
      throw httpError(400, `Insufficient yarn stock for ${article} / ${lot}`);
    }
    stock = await tx.textileYarnStock.create({
      data: {
        companyId,
        articleCount: article,
        brand: brandOf(brand),
        lotNumber: lot,
        warehouseId: warehouseId || null,
        productId: productId || null,
        kgPerCarton: dec(kgPer),
        balanceCartons: dec(deltaCartons),
        balanceWeightKg: dec(deltaWeightKg),
        createdBy: userId,
        updatedBy: userId,
      },
    });
    return stock;
  }

  const nextCartons = round4(num(stock.balanceCartons) + deltaCartons);
  const nextWeight = round4(num(stock.balanceWeightKg) + deltaWeightKg);
  if (!allowNegative && (nextCartons < -1e-9 || nextWeight < -1e-9)) {
    throw httpError(
      400,
      `Insufficient yarn stock for ${article} / ${lot}. Available ${num(stock.balanceCartons)} CTN / ${num(stock.balanceWeightKg)} KG`
    );
  }

  return tx.textileYarnStock.update({
    where: { id: stock.id },
    data: {
      balanceCartons: dec(Math.max(0, nextCartons)),
      balanceWeightKg: dec(Math.max(0, nextWeight)),
      kgPerCarton: dec(kgPer || num(stock.kgPerCarton) || 32),
      updatedBy: userId,
      isActive: true,
    },
  });
}

function resolveQty({ cartons, weightKg, kgPerCarton }) {
  const kgPer = round4(kgPerCarton || 32);
  let ctn = cartons == null || cartons === '' ? null : round4(cartons);
  let kg = weightKg == null || weightKg === '' ? null : round4(weightKg);
  if (ctn == null && kg == null) {
    throw httpError(400, 'Provide cartons and/or weightKg');
  }
  if (ctn == null && kg != null) ctn = kgPer > 0 ? round4(kg / kgPer) : 0;
  if (kg == null && ctn != null) kg = round4(ctn * kgPer);
  return { cartons: ctn || 0, weightKg: kg || 0, kgPerCarton: kgPer };
}

async function createGodownLedgerEntry(tx, payload) {
  const {
    companyId,
    userId,
    entryDate,
    challanPrefix,
    challanNumber,
    partyName,
    supplierId,
    articleCount,
    brand,
    lotNumber,
    warehouseId,
    kgPerCarton,
    inCartons = 0,
    inWeightKg = 0,
    outCartons = 0,
    outWeightKg = 0,
    twistingBatchId = null,
    remarks = null,
    productId = null,
  } = payload;

  const prefix = String(challanPrefix || '').toUpperCase();
  if (!['DB', 'P'].includes(prefix)) {
    throw httpError(400, 'challanPrefix must be DB (inward) or P (outward)');
  }

  const qtyIn = { cartons: round4(inCartons), weightKg: round4(inWeightKg) };
  const qtyOut = { cartons: round4(outCartons), weightKg: round4(outWeightKg) };
  if (prefix === 'DB' && qtyIn.cartons <= 0 && qtyIn.weightKg <= 0) {
    throw httpError(400, 'DB inward requires inCartons or inWeightKg');
  }
  if (prefix === 'P' && qtyOut.cartons <= 0 && qtyOut.weightKg <= 0) {
    throw httpError(400, 'P outward requires outCartons or outWeightKg');
  }

  const number =
    str(challanNumber) ||
    (await nextNumber(tx, 'textileGodownLedger', 'challanNumber', companyId, prefix));

  const existing = await tx.textileGodownLedger.findFirst({
    where: { companyId, challanPrefix: prefix, challanNumber: number },
    select: { id: true },
  });
  if (existing) throw httpError(409, `Challan ${prefix}-${number} already exists`);

  const deltaCartons = prefix === 'DB' ? qtyIn.cartons : -qtyOut.cartons;
  const deltaWeightKg = prefix === 'DB' ? qtyIn.weightKg : -qtyOut.weightKg;

  const stock = await upsertYarnStock(tx, {
    companyId,
    userId,
    articleCount,
    brand,
    lotNumber,
    warehouseId,
    productId,
    kgPerCarton: kgPerCarton || 32,
    deltaCartons,
    deltaWeightKg,
    allowNegative: false,
  });

  const ledger = await tx.textileGodownLedger.create({
    data: {
      companyId,
      yarnStockId: stock.id,
      entryDate: entryDate || new Date(),
      challanPrefix: prefix,
      challanNumber: number,
      partyName: str(partyName),
      supplierId: supplierId || null,
      articleCount: String(articleCount).trim(),
      brand: brandOf(brand),
      lotNumber: String(lotNumber).trim(),
      kgPerCarton: dec(kgPerCarton || num(stock.kgPerCarton) || 32),
      inCartons: dec(qtyIn.cartons),
      inWeightKg: dec(qtyIn.weightKg),
      outCartons: dec(qtyOut.cartons),
      outWeightKg: dec(qtyOut.weightKg),
      balanceCartons: stock.balanceCartons,
      balanceWeightKg: stock.balanceWeightKg,
      warehouseId: warehouseId || null,
      twistingBatchId: twistingBatchId || null,
      remarks: str(remarks),
      createdBy: userId,
      updatedBy: userId,
    },
  });

  return { ledger, stock };
}

// ─── Summary ───────────────────────────────────────────────────────────────

async function getSummary(companyId) {
  const todayStart = startOfDay(new Date());
  const todayEnd = endOfDay(new Date());

  const [stocks, activeBatches, beams, looms, todayProduction] = await Promise.all([
    prisma.textileYarnStock.findMany({
      where: { companyId, isActive: true },
      orderBy: [{ articleCount: 'asc' }, { lotNumber: 'asc' }],
    }),
    prisma.textileTwistingBatch.findMany({
      where: { companyId, status: { in: ['ISSUED', 'PARTIAL'] } },
      include: { receipts: true },
      orderBy: { issueDate: 'desc' },
    }),
    prisma.textileBeam.findMany({
      where: {
        companyId,
        OR: [
          { weavingStatus: { in: ['EMPTY', 'WARPING'] } },
          { weavingStatus: null, status: { in: ['Draft', 'Available'] } },
        ],
      },
      orderBy: { createdAt: 'desc' },
    }),
    prisma.textileLoom.findMany({
      where: { companyId, isActive: true },
      orderBy: { loomNumber: 'asc' },
    }),
    prisma.textileDailyLoomProduction.findMany({
      where: {
        companyId,
        productionDate: { gte: todayStart, lte: todayEnd },
      },
    }),
  ]);

  const stockTotals = stocks.reduce(
    (acc, row) => {
      acc.cartons += num(row.balanceCartons);
      acc.weightKg += num(row.balanceWeightKg);
      return acc;
    },
    { cartons: 0, weightKg: 0 }
  );

  const batchWastage = activeBatches.reduce(
    (acc, b) => {
      acc.issuedKg += num(b.issuedStandardKg);
      acc.receivedKg += num(b.totalReceivedNetKg);
      acc.wastageKg += num(b.wastageKg);
      return acc;
    },
    { issuedKg: 0, receivedKg: 0, wastageKg: 0 }
  );

  const fabricToday = todayProduction.reduce(
    (acc, row) => {
      acc.shiftA += num(row.shiftAMeters);
      acc.shiftB += num(row.shiftBMeters);
      acc.total += num(row.dailyTotalMeters);
      acc.gradeA += num(row.gradeAMeters);
      acc.gradeB += num(row.gradeBMeters);
      acc.gradeC += num(row.gradeCMeters);
      return acc;
    },
    { shiftA: 0, shiftB: 0, total: 0, gradeA: 0, gradeB: 0, gradeC: 0 }
  );

  return {
    godown: {
      stockLines: stocks.length,
      totalCartons: round4(stockTotals.cartons),
      totalWeightKg: round4(stockTotals.weightKg),
      byArticleLot: stocks.map((s) => ({
        id: s.id,
        articleCount: s.articleCount,
        brand: s.brand,
        lotNumber: s.lotNumber,
        balanceCartons: num(s.balanceCartons),
        balanceWeightKg: num(s.balanceWeightKg),
        kgPerCarton: num(s.kgPerCarton),
      })),
    },
    twisting: {
      activeBatches: activeBatches.length,
      totalWastageKg: round4(batchWastage.wastageKg),
      totalWastagePercent:
        batchWastage.issuedKg > 0
          ? round4((batchWastage.wastageKg / batchWastage.issuedKg) * 100)
          : 0,
      batches: activeBatches,
    },
    warping: {
      availableBeams: beams.filter((b) => b.weavingStatus === 'EMPTY' || !b.weavingStatus).length,
      warpingBeams: beams.filter((b) => b.weavingStatus === 'WARPING').length,
      beams,
    },
    weaving: {
      runningLooms: looms.filter((l) => l.status === 'RUNNING').length,
      totalLooms: looms.length,
      looms,
      todayFabricProduction: {
        ...Object.fromEntries(Object.entries(fabricToday).map(([k, v]) => [k, round4(v)])),
        entries: todayProduction.length,
      },
    },
  };
}

// ─── Godown ────────────────────────────────────────────────────────────────

async function listGodownStocks(companyId, query = {}) {
  const where = { companyId, isActive: true };
  if (str(query.articleCount)) where.articleCount = String(query.articleCount).trim();
  if (query.brand != null) where.brand = brandOf(query.brand);
  if (str(query.lotNumber)) where.lotNumber = String(query.lotNumber).trim();
  if (str(query.warehouseId)) where.warehouseId = query.warehouseId;

  return prisma.textileYarnStock.findMany({
    where,
    include: {
      warehouse: { select: { id: true, name: true, code: true } },
      product: { select: { id: true, name: true, sku: true } },
    },
    orderBy: [{ articleCount: 'asc' }, { brand: 'asc' }, { lotNumber: 'asc' }],
  });
}

async function listGodownLedger(companyId, query = {}) {
  const where = { companyId };
  if (str(query.articleCount)) where.articleCount = String(query.articleCount).trim();
  if (str(query.lotNumber)) where.lotNumber = String(query.lotNumber).trim();
  if (str(query.challanPrefix)) where.challanPrefix = String(query.challanPrefix).toUpperCase();
  if (query.brand !== undefined) where.brand = brandOf(query.brand);

  if (query.from || query.to) {
    where.entryDate = {};
    if (query.from) where.entryDate.gte = startOfDay(parseDate(query.from, 'from'));
    if (query.to) where.entryDate.lte = endOfDay(parseDate(query.to, 'to'));
  }

  return prisma.textileGodownLedger.findMany({
    where,
    include: {
      yarnStock: true,
      supplier: { select: { id: true, name: true, code: true } },
      warehouse: { select: { id: true, name: true, code: true } },
    },
    orderBy: [{ entryDate: 'desc' }, { createdAt: 'desc' }],
  });
}

async function postGodownLedger(companyId, userId, body = {}) {
  const prefix = String(body.challanPrefix || '').toUpperCase();
  const kgPer = round4(body.kgPerCarton || 32);

  let inCartons = 0;
  let inWeightKg = 0;
  let outCartons = 0;
  let outWeightKg = 0;

  if (prefix === 'DB') {
    const q = resolveQty({
      cartons: body.inCartons ?? body.cartons,
      weightKg: body.inWeightKg ?? body.weightKg,
      kgPerCarton: kgPer,
    });
    inCartons = q.cartons;
    inWeightKg = q.weightKg;
  } else if (prefix === 'P') {
    const q = resolveQty({
      cartons: body.outCartons ?? body.cartons,
      weightKg: body.outWeightKg ?? body.weightKg,
      kgPerCarton: kgPer,
    });
    outCartons = q.cartons;
    outWeightKg = q.weightKg;
  } else {
    throw httpError(400, 'challanPrefix must be DB or P');
  }

  return prisma.$transaction(async (tx) =>
    createGodownLedgerEntry(tx, {
      companyId,
      userId,
      entryDate: body.entryDate ? parseDate(body.entryDate, 'entryDate') : new Date(),
      challanPrefix: prefix,
      challanNumber: body.challanNumber,
      partyName: body.partyName,
      supplierId: body.supplierId || null,
      articleCount: body.articleCount,
      brand: body.brand,
      lotNumber: body.lotNumber,
      warehouseId: body.warehouseId || null,
      kgPerCarton: kgPer,
      inCartons,
      inWeightKg,
      outCartons,
      outWeightKg,
      remarks: body.remarks,
      productId: body.productId || null,
    })
  );
}

// ─── Twisting ──────────────────────────────────────────────────────────────

async function listTwistingBatches(companyId, query = {}) {
  const where = { companyId };
  if (str(query.status)) where.status = String(query.status).toUpperCase();
  return prisma.textileTwistingBatch.findMany({
    where,
    include: {
      receipts: { orderBy: { receiptDate: 'asc' } },
      vendor: { select: { id: true, name: true, code: true } },
      yarnStock: true,
      ledgerIssues: true,
    },
    orderBy: { issueDate: 'desc' },
  });
}

async function createTwistingBatch(companyId, userId, body = {}) {
  const article = str(body.inputArticleCount || body.articleCount);
  const lot = str(body.inputLotNumber || body.lotNumber);
  if (!article || !lot) throw httpError(400, 'inputArticleCount and inputLotNumber are required');

  const kgPer = round4(body.kgPerCarton || 32);
  const qty = resolveQty({
    cartons: body.issuedCartons ?? body.cartons,
    weightKg: body.issuedStandardKg ?? body.weightKg,
    kgPerCarton: kgPer,
  });

  return prisma.$transaction(async (tx) => {
    const batchNumber =
      str(body.batchNumber) || (await nextNumber(tx, 'textileTwistingBatch', 'batchNumber', companyId, 'TW'));

    const batch = await tx.textileTwistingBatch.create({
      data: {
        companyId,
        batchNumber,
        issueDate: body.issueDate ? parseDate(body.issueDate, 'issueDate') : new Date(),
        machineCode: str(body.machineCode),
        vendorId: body.vendorId || null,
        vendorName: str(body.vendorName || body.partyName),
        inputArticleCount: article,
        inputBrand: brandOf(body.inputBrand || body.brand),
        inputLotNumber: lot,
        yarnStockId: body.yarnStockId || null,
        issuedCartons: dec(qty.cartons),
        issuedStandardKg: dec(qty.weightKg),
        kgPerCarton: dec(kgPer),
        status: 'ISSUED',
        notes: str(body.notes),
        createdBy: userId,
        updatedBy: userId,
      },
    });

    const { ledger, stock } = await createGodownLedgerEntry(tx, {
      companyId,
      userId,
      entryDate: batch.issueDate,
      challanPrefix: 'P',
      challanNumber: body.challanNumber,
      partyName: batch.vendorName || batch.machineCode || 'Twisting Issue',
      supplierId: batch.vendorId,
      articleCount: article,
      brand: batch.inputBrand,
      lotNumber: lot,
      warehouseId: body.warehouseId || null,
      kgPerCarton: kgPer,
      outCartons: qty.cartons,
      outWeightKg: qty.weightKg,
      twistingBatchId: batch.id,
      remarks: body.remarks || `Twisting batch ${batchNumber}`,
    });

    const updated = await tx.textileTwistingBatch.update({
      where: { id: batch.id },
      data: { yarnStockId: stock.id },
      include: { receipts: true, vendor: true, yarnStock: true, ledgerIssues: true },
    });

    return { batch: updated, ledger, stock };
  });
}

function recalcBatchWastage(issuedStandardKg, totalReceivedNetKg) {
  const issued = round4(issuedStandardKg);
  const received = round4(totalReceivedNetKg);
  const wastageKg = round4(issued - received);
  const wastagePercent = issued > 0 ? round4((wastageKg / issued) * 100) : 0;
  return { wastageKg, wastagePercent };
}

/**
 * Receipts: add twisted yarn to stock once (via upsert), optionally write a DB ledger
 * that records the inward WITHOUT double-applying stock (ledger snapshot uses current stock).
 */
async function addTwistingReceipt(companyId, userId, batchId, body = {}) {
  const twist = String(body.twistDirection || '').toUpperCase();
  if (!['S', 'Z'].includes(twist)) throw httpError(400, 'twistDirection must be S or Z');

  const cartonsIn = body.cartons == null || body.cartons === '' ? null : round4(body.cartons);
  const conesCount = Math.max(0, parseInt(body.conesCount, 10) || 0);
  const actualNetWeightKg = round4(body.actualNetWeightKg ?? body.netWeightKg);
  if (actualNetWeightKg <= 0) throw httpError(400, 'actualNetWeightKg must be greater than 0');

  return prisma.$transaction(async (tx) => {
    const batch = await tx.textileTwistingBatch.findFirst({
      where: { id: batchId, companyId },
    });
    if (!batch) throw httpError(404, 'Twisting batch not found');
    if (batch.status === 'COMPLETED' || batch.status === 'CANCELLED') {
      throw httpError(400, `Batch is ${batch.status} and cannot accept receipts`);
    }

    const outputArticle = str(body.outputArticleCount || body.articleCount);
    const outputLot = str(body.outputLotNumber || body.lotNumber) || batch.inputLotNumber;
    const outputBrand = brandOf(body.outputBrand || body.brand || batch.inputBrand);
    if (!outputArticle) throw httpError(400, 'outputArticleCount is required');

    const kgPer = round4(body.kgPerCarton || num(batch.kgPerCarton) || 32);
    const resolvedCartons =
      cartonsIn != null && cartonsIn > 0 ? cartonsIn : round4(actualNetWeightKg / (kgPer || 32));

    const outputStock = await upsertYarnStock(tx, {
      companyId,
      userId,
      articleCount: outputArticle,
      brand: outputBrand,
      lotNumber: outputLot,
      warehouseId: body.warehouseId || null,
      kgPerCarton: kgPer,
      deltaCartons: resolvedCartons,
      deltaWeightKg: actualNetWeightKg,
    });

    const receiptDate = body.receiptDate ? parseDate(body.receiptDate, 'receiptDate') : new Date();

    const receipt = await tx.textileTwistingReceipt.create({
      data: {
        companyId,
        batchId: batch.id,
        receiptDate,
        outputArticleCount: outputArticle,
        outputBrand,
        outputLotNumber: outputLot,
        cartons: dec(resolvedCartons),
        conesCount,
        actualNetWeightKg: dec(actualNetWeightKg),
        twistDirection: twist,
        billNumber: str(body.billNumber),
        // Batch-level wastage is authoritative for multi-receipt bills
        wastageKg: dec(0),
        wastagePercent: dec(0),
        outputYarnStockId: outputStock.id,
        remarks: str(body.remarks),
        createdBy: userId,
        updatedBy: userId,
      },
    });

    if (body.postGodownInward !== false) {
      const challanNumber =
        str(body.challanNumber) ||
        (await nextNumber(tx, 'textileGodownLedger', 'challanNumber', companyId, 'DB'));
      await tx.textileGodownLedger.create({
        data: {
          companyId,
          yarnStockId: outputStock.id,
          entryDate: receiptDate,
          challanPrefix: 'DB',
          challanNumber,
          partyName: batch.vendorName || batch.machineCode || 'Twisting Receipt',
          supplierId: batch.vendorId,
          articleCount: outputArticle,
          brand: outputBrand,
          lotNumber: outputLot,
          kgPerCarton: dec(kgPer),
          inCartons: dec(resolvedCartons),
          inWeightKg: dec(actualNetWeightKg),
          outCartons: dec(0),
          outWeightKg: dec(0),
          balanceCartons: outputStock.balanceCartons,
          balanceWeightKg: outputStock.balanceWeightKg,
          warehouseId: body.warehouseId || null,
          twistingBatchId: batch.id,
          remarks: str(body.remarks) || `Twisting receipt ${twist} for ${batch.batchNumber}`,
          createdBy: userId,
          updatedBy: userId,
        },
      });
    }

    const agg = await tx.textileTwistingReceipt.aggregate({
      where: { batchId: batch.id },
      _sum: { actualNetWeightKg: true },
    });
    const totalReceivedNetKg = round4(num(agg._sum.actualNetWeightKg));
    const { wastageKg, wastagePercent } = recalcBatchWastage(
      num(batch.issuedStandardKg),
      totalReceivedNetKg
    );

    const updatedBatch = await tx.textileTwistingBatch.update({
      where: { id: batch.id },
      data: {
        totalReceivedNetKg: dec(totalReceivedNetKg),
        wastageKg: dec(wastageKg),
        wastagePercent: dec(wastagePercent),
        status: 'PARTIAL',
        updatedBy: userId,
      },
      include: {
        receipts: { orderBy: { receiptDate: 'asc' } },
        vendor: true,
        yarnStock: true,
        ledgerIssues: true,
      },
    });

    return { batch: updatedBatch, receipt, outputStock };
  });
}

async function completeTwistingBatch(companyId, userId, batchId, body = {}) {
  return prisma.$transaction(async (tx) => {
    const batch = await tx.textileTwistingBatch.findFirst({
      where: { id: batchId, companyId },
      include: { receipts: true },
    });
    if (!batch) throw httpError(404, 'Twisting batch not found');
    if (batch.status === 'CANCELLED') throw httpError(400, 'Cancelled batch cannot be completed');
    if (!batch.receipts.length) throw httpError(400, 'Add at least one receipt before completing');

    const totalReceivedNetKg = round4(
      batch.receipts.reduce((sum, r) => sum + num(r.actualNetWeightKg), 0)
    );
    const { wastageKg, wastagePercent } = recalcBatchWastage(
      num(batch.issuedStandardKg),
      totalReceivedNetKg
    );

    const billNumber = str(body.billNumber);
    if (billNumber) {
      await tx.textileTwistingReceipt.updateMany({
        where: { batchId: batch.id, OR: [{ billNumber: null }, { billNumber: '' }] },
        data: { billNumber, updatedBy: userId },
      });
    }

    return tx.textileTwistingBatch.update({
      where: { id: batch.id },
      data: {
        totalReceivedNetKg: dec(totalReceivedNetKg),
        wastageKg: dec(wastageKg),
        wastagePercent: dec(wastagePercent),
        status: 'COMPLETED',
        notes: str(body.notes) || batch.notes,
        updatedBy: userId,
      },
      include: {
        receipts: { orderBy: { receiptDate: 'asc' } },
        vendor: true,
        yarnStock: true,
        ledgerIssues: true,
      },
    });
  });
}

// ─── Weft issues ───────────────────────────────────────────────────────────

async function listWeftIssues(companyId, query = {}) {
  const where = { companyId };
  if (str(query.lotNumber)) where.lotNumber = String(query.lotNumber).trim();
  if (str(query.loomId)) where.loomId = query.loomId;
  if (query.from || query.to) {
    where.issueDate = {};
    if (query.from) where.issueDate.gte = startOfDay(parseDate(query.from, 'from'));
    if (query.to) where.issueDate.lte = endOfDay(parseDate(query.to, 'to'));
  }
  return prisma.textileWeftIssue.findMany({
    where,
    include: {
      yarnStock: true,
      loom: true,
    },
    orderBy: { issueDate: 'desc' },
  });
}

async function createWeftIssue(companyId, userId, body = {}) {
  const article = str(body.articleCount);
  const lot = str(body.lotNumber);
  if (!article || !lot) throw httpError(400, 'articleCount and lotNumber are required');

  const issuedNetWeightKg = round4(body.issuedNetWeightKg ?? body.weightKg);
  const issuedCartons = round4(body.issuedCartons ?? body.cartons ?? 0);
  const issuedCones = Math.max(0, parseInt(body.issuedCones ?? body.conesCount, 10) || 0);
  if (issuedNetWeightKg <= 0 && issuedCartons <= 0) {
    throw httpError(400, 'issuedNetWeightKg or issuedCartons is required');
  }

  return prisma.$transaction(async (tx) => {
    let stock = body.yarnStockId
      ? await tx.textileYarnStock.findFirst({ where: { id: body.yarnStockId, companyId } })
      : await findYarnStock(tx, {
          companyId,
          articleCount: article,
          brand: body.brand,
          lotNumber: lot,
          warehouseId: body.warehouseId || null,
        });
    if (!stock) throw httpError(404, 'Yarn stock not found for weft issue');

    const kgPer = round4(num(stock.kgPerCarton) || body.kgPerCarton || 32);
    const weight = issuedNetWeightKg > 0 ? issuedNetWeightKg : round4(issuedCartons * kgPer);
    const cartons = issuedCartons > 0 ? issuedCartons : round4(weight / kgPer);

    stock = await upsertYarnStock(tx, {
      companyId,
      userId,
      articleCount: stock.articleCount,
      brand: stock.brand,
      lotNumber: stock.lotNumber,
      warehouseId: stock.warehouseId,
      kgPerCarton: kgPer,
      deltaCartons: -cartons,
      deltaWeightKg: -weight,
    });

    const challanNumber =
      str(body.challanNumber) ||
      (await nextNumber(tx, 'textileWeftIssue', 'challanNumber', companyId, 'WEFT'));

    const issue = await tx.textileWeftIssue.create({
      data: {
        companyId,
        issueDate: body.issueDate ? parseDate(body.issueDate, 'issueDate') : new Date(),
        challanNumber,
        yarnStockId: stock.id,
        articleCount: stock.articleCount,
        brand: stock.brand,
        lotNumber: stock.lotNumber,
        twistDirection: str(body.twistDirection)
          ? String(body.twistDirection).toUpperCase()
          : null,
        issuedCartons: dec(cartons),
        issuedCones,
        issuedNetWeightKg: dec(weight),
        loomId: body.loomId || null,
        section: str(body.section),
        remarks: str(body.remarks),
        createdBy: userId,
        updatedBy: userId,
      },
      include: { yarnStock: true, loom: true },
    });

    // Mirror outward on godown ledger for audit trail
    await tx.textileGodownLedger.create({
      data: {
        companyId,
        yarnStockId: stock.id,
        entryDate: issue.issueDate,
        challanPrefix: 'P',
        challanNumber: `W-${challanNumber}`,
        partyName: str(body.section) || 'Weft Issue / Unit 3',
        articleCount: stock.articleCount,
        brand: stock.brand,
        lotNumber: stock.lotNumber,
        kgPerCarton: dec(kgPer),
        inCartons: dec(0),
        inWeightKg: dec(0),
        outCartons: dec(cartons),
        outWeightKg: dec(weight),
        balanceCartons: stock.balanceCartons,
        balanceWeightKg: stock.balanceWeightKg,
        warehouseId: stock.warehouseId,
        remarks: str(body.remarks) || 'Direct weft issue to weaving',
        createdBy: userId,
        updatedBy: userId,
      },
    });

    return { issue, stock };
  });
}

// ─── Beams & Warping ───────────────────────────────────────────────────────

async function listBeams(companyId, query = {}) {
  const where = { companyId };
  if (str(query.weavingStatus)) where.weavingStatus = String(query.weavingStatus).toUpperCase();
  if (str(query.beamNumber)) where.beamNumber = String(query.beamNumber).trim();
  return prisma.textileBeam.findMany({
    where,
    include: {
      currentLoom: true,
      warpingSets: { orderBy: { warpingDate: 'desc' }, take: 5 },
      loomAllocations: {
        where: { status: 'ACTIVE' },
        include: { loom: true },
      },
    },
    orderBy: { createdAt: 'desc' },
  });
}

async function createBeam(companyId, userId, body = {}) {
  const beamNumber = str(body.beamNumber || body.beamCode);
  if (!beamNumber) throw httpError(400, 'beamNumber is required');
  const weavingStatus = String(body.weavingStatus || 'EMPTY').toUpperCase();
  if (!['EMPTY', 'WARPING', 'ON_LOOM'].includes(weavingStatus)) {
    throw httpError(400, 'weavingStatus must be EMPTY, WARPING, or ON_LOOM');
  }

  return prisma.textileBeam.create({
    data: {
      companyId,
      beamCode: beamNumber,
      beamNumber,
      weavingStatus,
      status: 'Available',
      beamType: str(body.beamType) || 'Warping',
      productId: body.productId || null,
      warehouseId: body.warehouseId || null,
      totalEnds: body.endsCount != null ? parseInt(body.endsCount, 10) : null,
      yarnLengthM: body.lengthMeters != null ? num(body.lengthMeters) : null,
      weightKg: body.weightKg != null ? num(body.weightKg) : null,
      notes: str(body.notes),
      createdBy: userId,
      updatedBy: userId,
    },
  });
}

async function listWarpingSets(companyId, query = {}) {
  const where = { companyId };
  if (str(query.beamId)) where.beamId = query.beamId;
  if (str(query.status)) where.status = String(query.status).toUpperCase();
  return prisma.textileWarpingSet.findMany({
    where,
    include: { beam: true },
    orderBy: { warpingDate: 'desc' },
  });
}

async function createWarpingSet(companyId, userId, body = {}) {
  const beamId = str(body.beamId);
  if (!beamId) throw httpError(400, 'beamId is required');

  const conesConsumedSKg = round4(body.conesConsumedSKg || 0);
  const conesConsumedZKg = round4(body.conesConsumedZKg || 0);
  const totalYarnConsumedKg = round4(conesConsumedSKg + conesConsumedZKg);
  const netBeamWeightKg = round4(body.netBeamWeightKg);
  if (netBeamWeightKg <= 0) throw httpError(400, 'netBeamWeightKg must be greater than 0');
  const warpingWastageKg = round4(totalYarnConsumedKg - netBeamWeightKg);
  const warpingWastagePercent =
    totalYarnConsumedKg > 0 ? round4((warpingWastageKg / totalYarnConsumedKg) * 100) : 0;

  return prisma.$transaction(async (tx) => {
    const beam = await tx.textileBeam.findFirst({ where: { id: beamId, companyId } });
    if (!beam) throw httpError(404, 'Beam not found');

    const setNumber =
      str(body.setNumber) || (await nextNumber(tx, 'textileWarpingSet', 'setNumber', companyId, 'WS'));

    // Deduct S/Z stocks when linked
    for (const side of [
      { stockId: body.sYarnStockId || body.conesConsumedSStockId, kg: conesConsumedSKg, label: 'S' },
      { stockId: body.zYarnStockId || body.conesConsumedZStockId, kg: conesConsumedZKg, label: 'Z' },
    ]) {
      if (!side.stockId || side.kg <= 0) continue;
      const stock = await tx.textileYarnStock.findFirst({
        where: { id: side.stockId, companyId },
      });
      if (!stock) throw httpError(404, `${side.label}-twist yarn stock not found`);
      const kgPer = round4(num(stock.kgPerCarton) || 32);
      const cartons = round4(side.kg / kgPer);
      const updated = await upsertYarnStock(tx, {
        companyId,
        userId,
        articleCount: stock.articleCount,
        brand: stock.brand,
        lotNumber: stock.lotNumber,
        warehouseId: stock.warehouseId,
        kgPerCarton: kgPer,
        deltaCartons: -cartons,
        deltaWeightKg: -side.kg,
      });
      await tx.textileGodownLedger.create({
        data: {
          companyId,
          yarnStockId: updated.id,
          entryDate: body.warpingDate ? parseDate(body.warpingDate, 'warpingDate') : new Date(),
          challanPrefix: 'P',
          challanNumber: await nextNumber(tx, 'textileGodownLedger', 'challanNumber', companyId, 'P'),
          partyName: `Warping ${setNumber}`,
          articleCount: stock.articleCount,
          brand: stock.brand,
          lotNumber: stock.lotNumber,
          kgPerCarton: dec(kgPer),
          inCartons: dec(0),
          inWeightKg: dec(0),
          outCartons: dec(cartons),
          outWeightKg: dec(side.kg),
          balanceCartons: updated.balanceCartons,
          balanceWeightKg: updated.balanceWeightKg,
          warehouseId: stock.warehouseId,
          remarks: `${side.label}-twist cones consumed on warping set ${setNumber}`,
          createdBy: userId,
          updatedBy: userId,
        },
      });
    }

    const set = await tx.textileWarpingSet.create({
      data: {
        companyId,
        beamId: beam.id,
        setNumber,
        beamNumber: str(body.beamNumber) || beam.beamNumber || beam.beamCode,
        machineCode: str(body.machineCode),
        warpingDate: body.warpingDate ? parseDate(body.warpingDate, 'warpingDate') : new Date(),
        endsCount: parseInt(body.endsCount, 10) || 0,
        lengthMeters: dec(body.lengthMeters || 0),
        reedWidth: body.reedWidth != null ? dec(body.reedWidth) : null,
        netBeamWeightKg: dec(netBeamWeightKg),
        conesConsumedSKg: dec(conesConsumedSKg),
        conesConsumedZKg: dec(conesConsumedZKg),
        totalYarnConsumedKg: dec(totalYarnConsumedKg),
        warpingWastageKg: dec(warpingWastageKg),
        status: str(body.status)?.toUpperCase() || 'COMPLETED',
        notes: str(body.notes),
        createdBy: userId,
        updatedBy: userId,
      },
      include: { beam: true },
    });

    await tx.textileBeam.update({
      where: { id: beam.id },
      data: {
        weavingStatus: 'WARPING',
        beamNumber: set.beamNumber,
        totalEnds: set.endsCount,
        yarnLengthM: num(set.lengthMeters),
        weightKg: num(set.netBeamWeightKg),
        status: 'Available',
        updatedBy: userId,
      },
    });

    return {
      set,
      warpingWastagePercent,
    };
  });
}

// ─── Looms & weaving ───────────────────────────────────────────────────────

async function listLooms(companyId, query = {}) {
  const where = { companyId };
  if (str(query.section)) where.section = String(query.section).trim();
  if (str(query.status)) where.status = String(query.status).toUpperCase();
  if (query.isActive != null) where.isActive = String(query.isActive) !== 'false';

  return prisma.textileLoom.findMany({
    where,
    include: {
      allocations: {
        where: { status: 'ACTIVE' },
        include: { beam: true },
      },
      currentBeams: true,
    },
    orderBy: { loomNumber: 'asc' },
  });
}

async function createLoom(companyId, userId, body = {}) {
  const loomNumber = str(body.loomNumber);
  if (!loomNumber) throw httpError(400, 'loomNumber is required');

  return prisma.textileLoom.create({
    data: {
      companyId,
      loomNumber,
      section: str(body.section),
      status: String(body.status || 'IDLE').toUpperCase(),
      isActive: body.isActive !== false,
      notes: str(body.notes),
      createdBy: userId,
      updatedBy: userId,
    },
  });
}

async function allocateBeam(companyId, userId, loomId, body = {}) {
  const beamId = str(body.beamId);
  if (!beamId) throw httpError(400, 'beamId is required');
  const totalBeamLengthMeters = round4(body.totalBeamLengthMeters ?? body.lengthMeters);
  if (totalBeamLengthMeters <= 0) throw httpError(400, 'totalBeamLengthMeters must be greater than 0');

  return prisma.$transaction(async (tx) => {
    const loom = await tx.textileLoom.findFirst({ where: { id: loomId, companyId } });
    if (!loom) throw httpError(404, 'Loom not found');

    const beam = await tx.textileBeam.findFirst({ where: { id: beamId, companyId } });
    if (!beam) throw httpError(404, 'Beam not found');
    if (beam.weavingStatus === 'ON_LOOM') {
      throw httpError(400, 'Beam is already ON_LOOM');
    }

    const activeOnLoom = await tx.textileLoomBeamAllocation.findFirst({
      where: { companyId, loomId: loom.id, status: 'ACTIVE' },
    });
    if (activeOnLoom) {
      throw httpError(400, 'Loom already has an active beam allocation');
    }

    const remaining = round4(
      body.remainingLengthMeters != null ? body.remainingLengthMeters : totalBeamLengthMeters
    );

    const allocation = await tx.textileLoomBeamAllocation.create({
      data: {
        companyId,
        loomId: loom.id,
        beamId: beam.id,
        allocatedAt: body.allocatedAt ? parseDate(body.allocatedAt, 'allocatedAt') : new Date(),
        weaverName: str(body.weaverName),
        wageRate: body.wageRate != null ? dec(body.wageRate) : null,
        bonusAmount: body.bonusAmount != null ? dec(body.bonusAmount) : null,
        totalBeamLengthMeters: dec(totalBeamLengthMeters),
        remainingLengthMeters: dec(remaining),
        status: 'ACTIVE',
        notes: str(body.notes),
        createdBy: userId,
        updatedBy: userId,
      },
      include: { loom: true, beam: true },
    });

    await tx.textileBeam.update({
      where: { id: beam.id },
      data: {
        weavingStatus: 'ON_LOOM',
        currentLoomId: loom.id,
        status: 'InProcess',
        updatedBy: userId,
      },
    });

    await tx.textileLoom.update({
      where: { id: loom.id },
      data: { status: 'RUNNING', updatedBy: userId },
    });

    return allocation;
  });
}

async function listDailyProduction(companyId, query = {}) {
  const where = { companyId };
  if (str(query.loomId)) where.loomId = query.loomId;
  if (query.date) {
    const d = parseDate(query.date, 'date');
    where.productionDate = startOfDay(d);
  } else if (query.from || query.to) {
    where.productionDate = {};
    if (query.from) where.productionDate.gte = startOfDay(parseDate(query.from, 'from'));
    if (query.to) where.productionDate.lte = startOfDay(parseDate(query.to, 'to'));
  }

  return prisma.textileDailyLoomProduction.findMany({
    where,
    include: {
      loom: true,
      allocation: { include: { beam: true } },
    },
    orderBy: [{ productionDate: 'desc' }, { loomId: 'asc' }],
  });
}

async function upsertDailyProductionEntry(tx, companyId, userId, productionDate, entry) {
  const loomId = str(entry.loomId);
  if (!loomId) throw httpError(400, 'loomId is required for each production entry');

  const loom = await tx.textileLoom.findFirst({ where: { id: loomId, companyId } });
  if (!loom) throw httpError(404, `Loom not found: ${loomId}`);

  let allocation = null;
  if (entry.allocationId) {
    allocation = await tx.textileLoomBeamAllocation.findFirst({
      where: { id: entry.allocationId, companyId },
    });
  } else {
    allocation = await tx.textileLoomBeamAllocation.findFirst({
      where: { companyId, loomId, status: 'ACTIVE' },
      orderBy: { allocatedAt: 'desc' },
    });
  }

  const shiftA = round4(entry.shiftAMeters || 0);
  const shiftB = round4(entry.shiftBMeters || 0);
  const dailyTotalMeters = round4(shiftA + shiftB);
  const gradeA = round4(entry.gradeAMeters || 0);
  const gradeB = round4(entry.gradeBMeters || 0);
  const gradeC = round4(entry.gradeCMeters || 0);

  let previousCumulative = 0;
  if (allocation) {
    const prev = await tx.textileDailyLoomProduction.aggregate({
      where: {
        companyId,
        allocationId: allocation.id,
        productionDate: { lt: productionDate },
      },
      _sum: { dailyTotalMeters: true },
    });
    previousCumulative = round4(num(prev._sum.dailyTotalMeters));
  }

  const existing = await tx.textileDailyLoomProduction.findFirst({
    where: { companyId, loomId, productionDate },
  });
  const previousToday = existing ? round4(num(existing.dailyTotalMeters)) : 0;
  const cumulativeBeamMeters = round4(previousCumulative + dailyTotalMeters);

  const rowData = {
    allocationId: allocation?.id || null,
    shiftAMeters: dec(shiftA),
    shiftBMeters: dec(shiftB),
    dailyTotalMeters: dec(dailyTotalMeters),
    cumulativeBeamMeters: dec(cumulativeBeamMeters),
    gradeAMeters: dec(gradeA),
    gradeBMeters: dec(gradeB),
    gradeCMeters: dec(gradeC),
    remarks: str(entry.remarks),
    updatedBy: userId,
  };

  let row;
  if (existing) {
    row = await tx.textileDailyLoomProduction.update({
      where: { id: existing.id },
      data: rowData,
      include: { loom: true, allocation: true },
    });
  } else {
    row = await tx.textileDailyLoomProduction.create({
      data: {
        companyId,
        loomId,
        productionDate,
        createdBy: userId,
        ...rowData,
      },
      include: { loom: true, allocation: true },
    });
  }

  if (allocation) {
    const delta = round4(dailyTotalMeters - previousToday);
    const remaining = round4(num(allocation.remainingLengthMeters) - delta);
    const completed = remaining <= 0;
    await tx.textileLoomBeamAllocation.update({
      where: { id: allocation.id },
      data: {
        remainingLengthMeters: dec(Math.max(0, remaining)),
        status: completed ? 'COMPLETED' : 'ACTIVE',
        completedAt: completed ? new Date() : null,
        updatedBy: userId,
      },
    });

    if (completed) {
      await tx.textileBeam.update({
        where: { id: allocation.beamId },
        data: {
          weavingStatus: 'EMPTY',
          currentLoomId: null,
          status: 'Available',
          updatedBy: userId,
        },
      });
      await tx.textileLoom.update({
        where: { id: loomId },
        data: { status: 'IDLE', updatedBy: userId },
      });
    }
  }

  return row;
}

async function postDailyProduction(companyId, userId, body = {}) {
  const productionDate = startOfDay(parseDate(body.productionDate || body.date, 'productionDate'));
  const entries = Array.isArray(body.entries)
    ? body.entries
    : body.loomId
      ? [body]
      : null;
  if (!entries || !entries.length) {
    throw httpError(400, 'Provide entries[] or a single loom production payload');
  }

  return prisma.$transaction(async (tx) => {
    const results = [];
    for (const entry of entries) {
      results.push(await upsertDailyProductionEntry(tx, companyId, userId, productionDate, entry));
    }
    return results;
  });
}

async function wagesReport(companyId, query = {}) {
  if (!query.from || !query.to) throw httpError(400, 'from and to date range are required');
  const from = startOfDay(parseDate(query.from, 'from'));
  const to = endOfDay(parseDate(query.to, 'to'));

  const rows = await prisma.textileDailyLoomProduction.findMany({
    where: {
      companyId,
      productionDate: { gte: from, lte: to },
      allocationId: { not: null },
    },
    include: {
      allocation: true,
      loom: true,
    },
    orderBy: { productionDate: 'asc' },
  });

  const byWeaver = new Map();
  for (const row of rows) {
    const weaver = row.allocation?.weaverName || 'Unassigned';
    const wageRate = num(row.allocation?.wageRate);
    const key = `${weaver}::${wageRate}`;
    if (!byWeaver.has(key)) {
      byWeaver.set(key, {
        weaverName: weaver,
        wageRate,
        bonusAmount: 0,
        totalMeters: 0,
        gradeAMeters: 0,
        gradeBMeters: 0,
        gradeCMeters: 0,
        wageAmount: 0,
        loomIds: new Set(),
        allocationIds: new Set(),
      });
    }
    const agg = byWeaver.get(key);
    agg.totalMeters = round4(agg.totalMeters + num(row.dailyTotalMeters));
    agg.gradeAMeters = round4(agg.gradeAMeters + num(row.gradeAMeters));
    agg.gradeBMeters = round4(agg.gradeBMeters + num(row.gradeBMeters));
    agg.gradeCMeters = round4(agg.gradeCMeters + num(row.gradeCMeters));
    agg.wageAmount = round4(agg.totalMeters * wageRate);
    agg.loomIds.add(row.loomId);
    if (row.allocationId) agg.allocationIds.add(row.allocationId);
    // Bonus once per allocation
    if (row.allocationId && !agg._bonusSeen) agg._bonusSeen = new Set();
    if (row.allocationId && !agg._bonusSeen.has(row.allocationId)) {
      agg._bonusSeen.add(row.allocationId);
      agg.bonusAmount = round4(agg.bonusAmount + num(row.allocation?.bonusAmount));
    }
  }

  const report = [...byWeaver.values()].map((r) => ({
    weaverName: r.weaverName,
    wageRate: r.wageRate,
    totalMeters: r.totalMeters,
    gradeAMeters: r.gradeAMeters,
    gradeBMeters: r.gradeBMeters,
    gradeCMeters: r.gradeCMeters,
    meterWageAmount: r.wageAmount,
    bonusAmount: r.bonusAmount,
    totalPayable: round4(r.wageAmount + r.bonusAmount),
    loomCount: r.loomIds.size,
    allocationCount: r.allocationIds.size,
  }));

  return {
    from,
    to,
    weavers: report,
    totals: {
      totalMeters: round4(report.reduce((s, r) => s + r.totalMeters, 0)),
      totalPayable: round4(report.reduce((s, r) => s + r.totalPayable, 0)),
    },
  };
}

module.exports = {
  getSummary,
  listGodownStocks,
  listGodownLedger,
  postGodownLedger,
  listTwistingBatches,
  createTwistingBatch,
  addTwistingReceipt,
  completeTwistingBatch,
  listWeftIssues,
  createWeftIssue,
  listBeams,
  createBeam,
  listWarpingSets,
  createWarpingSet,
  listLooms,
  createLoom,
  allocateBeam,
  listDailyProduction,
  postDailyProduction,
  wagesReport,
};
