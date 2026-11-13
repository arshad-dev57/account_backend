'use strict';

const prisma = require('../prisma/client');
const {
  requireCompany,
  userIdOf,
  paginationParams,
  paginationMeta,
  toDate,
  toNum,
  emptyToNull
} = require('../utils/manufacturingAccess');
const workflow = require('../utils/manufacturingWorkflow');
const { adjustBatchStock } = require('../warehouse/services/productBatchService');
const { MOVEMENT_TYPES } = require('../warehouse/services/inventoryMath');
const sandbox = require('../services/textileSandboxService');

function fail(res, status, message) {
  return res.status(status).json({ success: false, message });
}

function ok(res, data, extra = {}) {
  return res.json({ success: true, data, ...extra });
}

function wrap(handler) {
  return async (req, res) => {
    try {
      const companyId = requireCompany(req, res);
      if (!companyId) return;
      req.mfg = { companyId, userId: userIdOf(req) };
      await handler(req, res);
    } catch (error) {
      const status = error.status || error.statusCode || 500;
      if (error.code === 'P2021' || /does not exist/i.test(error.message || '')) {
        return fail(
          res,
          503,
          'Textile tables are not migrated yet. Run prisma migrate deploy / generate.'
        );
      }
      console.error('[textile]', error);
      return fail(res, status, error.message || 'Textile request failed');
    }
  };
}

async function nextTextileNumber(tx, model, field, prefix, companyId) {
  const tag = String(companyId || '').replace(/-/g, '').slice(0, 6).toUpperCase() || 'SBX';
  const stem = `${prefix}-${tag}-`;
  const count = await tx[model].count({ where: { companyId } });
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const candidate = `${stem}${String(count + 1 + attempt).padStart(4, '0')}`;
    const exists = await tx[model].findFirst({
      where: { companyId, [field]: candidate },
      select: { id: true }
    });
    if (!exists) return candidate;
  }
  return `${stem}${Date.now().toString().slice(-8)}`;
}

function round3(n) {
  return sandbox.round3(n);
}

function normalizeCones(body, outputWeightKg) {
  const raw = Array.isArray(body?.cones) ? body.cones : [];
  if (raw.length) {
    return raw.map((c, idx) => {
      const weightKg = round3(c.weightKg ?? c.weight ?? 0);
      if (weightKg <= 0) {
        const err = new Error(`Cone #${idx + 1} weight must be greater than 0`);
        err.status = 400;
        throw err;
      }
      return {
        coneCode: emptyToNull(c.coneCode || c.code) || null,
        weightKg,
        status: emptyToNull(c.status) === 'Rejected' ? 'Rejected' : 'Available',
        notes: emptyToNull(c.notes)
      };
    });
  }
  const count = Math.max(0, Math.floor(toNum(body?.coneCount, 0)));
  if (count <= 0) {
    const err = new Error('Provide individual cone weights or a coneCount to generate cones');
    err.status = 400;
    throw err;
  }
  if (outputWeightKg <= 0) {
    const err = new Error('Output weight must be greater than 0 to generate cones');
    err.status = 400;
    throw err;
  }
  const base = round3(outputWeightKg / count);
  const cones = [];
  let allocated = 0;
  for (let i = 0; i < count; i += 1) {
    const weightKg = i === count - 1 ? round3(outputWeightKg - allocated) : base;
    allocated = round3(allocated + weightKg);
    cones.push({ coneCode: null, weightKg, status: 'Available', notes: null });
  }
  return cones;
}

function validateMassBalance({ inputWeightKg, outputWeightKg, wastageKg, rejectedWeightKg, remainingYarnKg }) {
  const consumed = round3(outputWeightKg + wastageKg + rejectedWeightKg + remainingYarnKg);
  if (Math.abs(consumed - inputWeightKg) > 0.05) {
    const err = new Error(
      `Mass balance failed: input ${inputWeightKg} KG must equal output (${outputWeightKg}) + wastage (${wastageKg}) + rejected (${rejectedWeightKg}) + remaining (${remainingYarnKg}) = ${consumed} KG`
    );
    err.status = 400;
    throw err;
  }
}

async function createStockMovement(tx, data) {
  return tx.stockMovement.create({ data });
}

const getSandboxStatus = wrap(async (req, res) => {
  const status = await sandbox.sandboxStatus(req.mfg.userId, req.mfg.companyId);
  return ok(res, status);
});

const ensureSandbox = wrap(async (req, res) => {
  const activate = req.body?.activate !== false;
  const parentCompanyId = emptyToNull(req.body?.parentCompanyId) || req.mfg.companyId;
  const result = await sandbox.ensureSandbox(req.mfg.userId, {
    activateForUser: activate,
    parentCompanyId
  });
  return ok(res, result);
});

const listYarnLots = wrap(async (req, res) => {
  await sandbox.requireSandboxCompany(req.mfg.companyId);
  const productId = emptyToNull(req.query.productId);
  const locationId = emptyToNull(req.query.warehouseId || req.query.locationId);
  const where = {
    companyId: req.mfg.companyId,
    isActive: true,
    currentStock: { gt: 0 }
  };
  if (productId) where.productId = productId;
  if (locationId) where.locationId = locationId;
  const rows = await prisma.productBatch.findMany({
    where,
    include: {
      product: { select: { id: true, name: true, sku: true, textileItemClass: true, costPrice: true } },
      location: { select: { id: true, name: true, code: true } }
    },
    orderBy: [{ batchNumber: 'asc' }]
  });
  return ok(
    res,
    rows.map((r) => ({
      id: r.id,
      lotNumber: r.batchNumber,
      productId: r.productId,
      productName: r.product?.name,
      productSku: r.product?.sku,
      warehouseId: r.locationId,
      warehouseName: r.location?.name,
      currentStock: r.currentStock,
      availableStock: r.availableStock,
      unitCost: r.unitCost,
      manufacturingDate: r.manufacturingDate
    }))
  );
});

const listMachines = wrap(async (req, res) => {
  await sandbox.requireSandboxCompany(req.mfg.companyId);
  const rows = await prisma.manufacturingMachine.findMany({
    where: { companyId: req.mfg.companyId },
    include: {
      owningCompany: { select: { id: true, name: true } },
      operatingCompany: { select: { id: true, name: true } },
      workCenter: { select: { id: true, name: true, workCenterCode: true } },
      location: { select: { id: true, name: true } }
    },
    orderBy: { name: 'asc' }
  });
  return ok(res, rows);
});

const listWarehouses = wrap(async (req, res) => {
  await sandbox.requireSandboxCompany(req.mfg.companyId);
  const rows = await prisma.location.findMany({
    where: { companyId: req.mfg.companyId, isDeleted: false, isActive: true },
    orderBy: [{ isDefault: 'desc' }, { name: 'asc' }]
  });
  return ok(res, rows);
});

const listProducts = wrap(async (req, res) => {
  await sandbox.requireSandboxCompany(req.mfg.companyId);
  const textileClass = emptyToNull(req.query.textileItemClass || req.query.class);
  const where = { companyId: req.mfg.companyId, isActive: true };
  if (textileClass) where.textileItemClass = textileClass;
  const rows = await prisma.product.findMany({
    where,
    select: {
      id: true,
      name: true,
      sku: true,
      textileItemClass: true,
      stockUnitName: true,
      costPrice: true,
      isBatchManaged: true,
      currentStock: true,
      availableStock: true
    },
    orderBy: { name: 'asc' }
  });
  return ok(res, rows);
});

async function buildWindingPayload(companyId, userId, body, { forPost = false } = {}) {
  const yarnProductId = emptyToNull(body.yarnProductId);
  const coneProductId = emptyToNull(body.coneProductId);
  const yarnLotNumber = emptyToNull(body.yarnLotNumber || body.lotNumber);
  const sourceWarehouseId = emptyToNull(body.sourceWarehouseId || body.warehouseId);
  const outputWarehouseId = emptyToNull(body.outputWarehouseId) || sourceWarehouseId;
  const machineId = emptyToNull(body.machineId);
  if (!yarnProductId || !coneProductId || !yarnLotNumber || !sourceWarehouseId || !outputWarehouseId) {
    const err = new Error('yarnProductId, coneProductId, yarnLotNumber, sourceWarehouseId and outputWarehouseId are required');
    err.status = 400;
    throw err;
  }
  const [yarn, cone, sourceWh, outputWh] = await Promise.all([
    prisma.product.findFirst({ where: { id: yarnProductId, companyId } }),
    prisma.product.findFirst({ where: { id: coneProductId, companyId } }),
    prisma.location.findFirst({ where: { id: sourceWarehouseId, companyId, isDeleted: false } }),
    prisma.location.findFirst({ where: { id: outputWarehouseId, companyId, isDeleted: false } })
  ]);
  if (!yarn) {
    const err = new Error('Yarn product not found in sandbox company');
    err.status = 400;
    throw err;
  }
  if (!cone) {
    const err = new Error('Cone product not found in sandbox company');
    err.status = 400;
    throw err;
  }
  if (!sourceWh || !outputWh) {
    const err = new Error('Warehouse not found in sandbox company');
    err.status = 400;
    throw err;
  }

  let machine = null;
  if (machineId) {
    machine = await prisma.manufacturingMachine.findFirst({
      where: { id: machineId, companyId },
      include: { owningCompany: true, operatingCompany: true }
    });
    if (!machine) {
      const err = new Error('Machine not found in sandbox company');
      err.status = 400;
      throw err;
    }
  }

  const inputWeightKg = round3(body.inputWeightKg);
  const wastageKg = round3(body.wastageKg);
  const rejectedWeightKg = round3(body.rejectedWeightKg);
  const remainingYarnKg =
    body.remainingYarnKg === undefined || body.remainingYarnKg === null || body.remainingYarnKg === ''
      ? null
      : round3(body.remainingYarnKg);

  if (inputWeightKg <= 0) {
    const err = new Error('inputWeightKg must be greater than 0');
    err.status = 400;
    throw err;
  }

  let cones = normalizeCones(body, round3(body.outputWeightKg || 0));
  if (!Array.isArray(body?.cones) || !body.cones.length) {
    // regenerate with computed output if only coneCount given
    const outputGuess =
      body.outputWeightKg !== undefined && body.outputWeightKg !== null && body.outputWeightKg !== ''
        ? round3(body.outputWeightKg)
        : null;
    if (outputGuess == null) {
      const err = new Error('outputWeightKg is required when generating cones from coneCount');
      err.status = 400;
      throw err;
    }
    cones = normalizeCones({ ...body, outputWeightKg: outputGuess }, outputGuess);
  }

  const acceptedCones = cones.filter((c) => c.status !== 'Rejected');
  const rejectedCones = cones.filter((c) => c.status === 'Rejected');
  const outputWeightKg = round3(
    body.outputWeightKg !== undefined && body.outputWeightKg !== null && body.outputWeightKg !== ''
      ? body.outputWeightKg
      : acceptedCones.reduce((s, c) => s + c.weightKg, 0)
  );
  const coneWeightSum = round3(acceptedCones.reduce((s, c) => s + c.weightKg, 0));
  if (Math.abs(coneWeightSum - outputWeightKg) > 0.05) {
    const err = new Error(
      `Accepted cone weights (${coneWeightSum} KG) must equal outputWeightKg (${outputWeightKg} KG)`
    );
    err.status = 400;
    throw err;
  }

  const remaining =
    remainingYarnKg == null
      ? round3(inputWeightKg - outputWeightKg - wastageKg - rejectedWeightKg)
      : remainingYarnKg;
  if (remaining < -0.05) {
    const err = new Error('Remaining yarn cannot be negative — check input/output/wastage/rejected');
    err.status = 400;
    throw err;
  }
  validateMassBalance({
    inputWeightKg,
    outputWeightKg,
    wastageKg,
    rejectedWeightKg,
    remainingYarnKg: Math.max(0, remaining)
  });

  const remainingFinal = Math.max(0, remaining);
  const netYarnConsumed = round3(inputWeightKg - remainingFinal);

  if (forPost) {
    const stockRow = await prisma.productStock.findUnique({
      where: { productId_locationId: { productId: yarn.id, locationId: sourceWh.id } }
    });
    const onHand = Number(stockRow?.currentStock || 0);
    if (netYarnConsumed > onHand) {
      const err = new Error(
        `Insufficient yarn stock. On hand: ${onHand} KG, Required: ${netYarnConsumed} KG`
      );
      err.status = 400;
      throw err;
    }
    const batch = await prisma.productBatch.findUnique({
      where: {
        productId_locationId_batchNumber: {
          productId: yarn.id,
          locationId: sourceWh.id,
          batchNumber: yarnLotNumber
        }
      }
    });
    const lotOnHand = Number(batch?.currentStock || 0);
    if (netYarnConsumed > lotOnHand) {
      const err = new Error(
        `Insufficient yarn LOT ${yarnLotNumber}. On hand: ${lotOnHand} KG, Required: ${netYarnConsumed} KG`
      );
      err.status = 400;
      throw err;
    }
  }

  return {
    yarn,
    cone,
    sourceWh,
    outputWh,
    machine,
    yarnLotNumber,
    inputWeightKg,
    outputWeightKg,
    wastageKg,
    rejectedWeightKg,
    remainingYarnKg: remainingFinal,
    cones,
    rejectedConeCount: rejectedCones.length + Math.max(0, Math.floor(toNum(body.rejectedConeCount))),
    targetOutputKg: body.targetOutputKg == null || body.targetOutputKg === '' ? null : round3(body.targetOutputKg),
    operatorId: emptyToNull(body.operatorId),
    operatorName: emptyToNull(body.operatorName) || 'Sandbox Operator',
    shift: emptyToNull(body.shift) || 'A',
    productionDate: toDate(body.productionDate, new Date()),
    runningHours: body.runningHours == null || body.runningHours === '' ? null : toNum(body.runningHours),
    downtimeHours: body.downtimeHours == null || body.downtimeHours === '' ? null : toNum(body.downtimeHours),
    productionOrderId: emptyToNull(body.productionOrderId),
    notes: emptyToNull(body.notes),
    machineOwningCompanyId:
      emptyToNull(body.machineOwningCompanyId) || machine?.owningCompanyId || companyId,
    machineOperatingCompanyId:
      emptyToNull(body.machineOperatingCompanyId) || machine?.operatingCompanyId || companyId
  };
}

async function persistWinding(tx, companyId, userId, payload, { status, stockPosted, yarnMoveId, coneMoveId, entryNumber: forcedEntryNumber }) {
  const entryNumber =
    forcedEntryNumber ||
    (await nextTextileNumber(tx, 'textileConeWindingEntry', 'entryNumber', 'CWE', companyId));
  const entry = await tx.textileConeWindingEntry.create({
    data: {
      entryNumber,
      companyId,
      productionOrderId: payload.productionOrderId,
      yarnProductId: payload.yarn.id,
      yarnProductName: payload.yarn.name,
      yarnLotNumber: payload.yarnLotNumber,
      coneProductId: payload.cone.id,
      coneProductName: payload.cone.name,
      sourceWarehouseId: payload.sourceWh.id,
      outputWarehouseId: payload.outputWh.id,
      machineId: payload.machine?.id || null,
      machineOwningCompanyId: payload.machineOwningCompanyId,
      machineOperatingCompanyId: payload.machineOperatingCompanyId,
      operatorId: payload.operatorId,
      operatorName: payload.operatorName,
      shift: payload.shift,
      productionDate: payload.productionDate,
      targetOutputKg: payload.targetOutputKg,
      inputWeightKg: payload.inputWeightKg,
      outputWeightKg: payload.outputWeightKg,
      wastageKg: payload.wastageKg,
      rejectedWeightKg: payload.rejectedWeightKg,
      remainingYarnKg: payload.remainingYarnKg,
      rejectedConeCount: payload.rejectedConeCount,
      coneCount: payload.cones.length,
      runningHours: payload.runningHours,
      downtimeHours: payload.downtimeHours,
      status,
      stockPosted,
      yarnStockMovementId: yarnMoveId || null,
      coneStockMovementId: coneMoveId || null,
      notes: payload.notes,
      createdBy: userId
    }
  });

  const createdCones = [];
  for (let i = 0; i < payload.cones.length; i += 1) {
    const c = payload.cones[i];
    const coneCode =
      c.coneCode ||
      (await nextTextileNumber(tx, 'textileCone', 'coneCode', 'CONE', companyId));
    const cone = await tx.textileCone.create({
      data: {
        coneCode,
        companyId,
        windingEntryId: entry.id,
        productId: payload.cone.id,
        yarnProductId: payload.yarn.id,
        yarnLotNumber: payload.yarnLotNumber,
        yarnSupplierName: 'Test Yarn Supplier',
        weightKg: c.weightKg,
        status: status === 'Posted' ? (c.status === 'Rejected' ? 'Rejected' : 'Available') : 'Available',
        warehouseId: payload.outputWh.id,
        machineId: payload.machine?.id || null,
        owningCompanyId: payload.machineOwningCompanyId,
        operatingCompanyId: payload.machineOperatingCompanyId,
        operatorId: payload.operatorId,
        operatorName: payload.operatorName,
        productionDate: payload.productionDate,
        barcode: coneCode,
        qrCode: `TX-CONE:${companyId}:${coneCode}`,
        notes: c.notes,
        createdBy: userId
      }
    });
    createdCones.push(cone);
    if (status === 'Posted' && c.status !== 'Rejected') {
      await tx.textileGenealogyLink.create({
        data: {
          companyId,
          parentType: 'YarnLot',
          parentId: `${payload.yarn.id}:${payload.yarnLotNumber}`,
          parentCode: payload.yarnLotNumber,
          childType: 'Cone',
          childId: cone.id,
          childCode: cone.coneCode,
          relation: 'ProducedFrom',
          quantity: cone.weightKg,
          unit: 'KG',
          metadata: {
            windingEntryId: entry.id,
            windingEntryNumber: entry.entryNumber,
            yarnProductId: payload.yarn.id,
            yarnProductName: payload.yarn.name,
            machineId: payload.machine?.id || null,
            machineName: payload.machine?.name || null
          },
          createdBy: userId
        }
      });
      await tx.textileGenealogyLink.create({
        data: {
          companyId,
          parentType: 'WindingEntry',
          parentId: entry.id,
          parentCode: entry.entryNumber,
          childType: 'Cone',
          childId: cone.id,
          childCode: cone.coneCode,
          relation: 'ProducedFrom',
          quantity: cone.weightKg,
          unit: 'KG',
          createdBy: userId
        }
      });
    }
  }

  return { entry, cones: createdCones };
}

async function postInventoryForWinding(tx, companyId, userId, payload, entryNumber) {
  // Net warehouse consumption excludes yarn remaining on the job (returned / unused).
  const netYarnConsumed = round3(
    payload.inputWeightKg - payload.remainingYarnKg
  );
  if (netYarnConsumed < 0) {
    const err = new Error('Net yarn consumption cannot be negative');
    err.status = 400;
    throw err;
  }
  let yarnAdj = { previousLocationStock: 0, newLocationStock: 0 };
  if (netYarnConsumed > 0) {
    yarnAdj = await workflow.postStockOut(tx, {
      companyId,
      productId: payload.yarn.id,
      locationId: payload.sourceWh.id,
      qty: netYarnConsumed,
      productName: payload.yarn.name,
      allowNegative: false
    });
    await adjustBatchStock(tx, {
      companyId,
      productId: payload.yarn.id,
      locationId: payload.sourceWh.id,
      batchNumber: payload.yarnLotNumber,
      delta: -netYarnConsumed,
      checkAvailable: true,
      productName: payload.yarn.name
    });
  }

  const acceptedOutput = round3(
    payload.cones.filter((c) => c.status !== 'Rejected').reduce((s, c) => s + c.weightKg, 0)
  );
  const coneAdj = await workflow.postStockIn(tx, {
    companyId,
    productId: payload.cone.id,
    locationId: payload.outputWh.id,
    qty: acceptedOutput,
    productName: payload.cone.name
  });

  const yarnMove =
    netYarnConsumed > 0
      ? await createStockMovement(tx, {
          productId: payload.yarn.id,
          productName: payload.yarn.name,
          type: 'stock_out',
          movementType: MOVEMENT_TYPES.PRODUCTION_CONSUMPTION,
          quantity: netYarnConsumed,
          baseQuantity: netYarnConsumed,
          enteredQuantity: netYarnConsumed,
          conversionFactor: 1,
          uom: 'KG',
          previousStock: yarnAdj.previousLocationStock,
          newStock: yarnAdj.newLocationStock,
          unitCost: Number(payload.yarn.costPrice || 0),
          totalValue: round3(Number(payload.yarn.costPrice || 0) * netYarnConsumed),
          batchNumber: payload.yarnLotNumber,
          reason: 'Cone winding yarn consumption',
          reference: entryNumber,
          status: 'Completed',
          createdBy: userId,
          companyId,
          locationId: payload.sourceWh.id,
          notes: JSON.stringify({
            inputWeightKg: payload.inputWeightKg,
            wastageKg: payload.wastageKg,
            rejectedWeightKg: payload.rejectedWeightKg,
            remainingYarnKg: payload.remainingYarnKg,
            outputWeightKg: payload.outputWeightKg,
            netYarnConsumed
          })
        })
      : { id: null };

  const coneMove = await createStockMovement(tx, {
    productId: payload.cone.id,
    productName: payload.cone.name,
    type: 'stock_in',
    movementType: MOVEMENT_TYPES.PRODUCTION_RECEIPT,
    quantity: acceptedOutput,
    baseQuantity: acceptedOutput,
    enteredQuantity: acceptedOutput,
    conversionFactor: 1,
    uom: 'KG',
    previousStock: coneAdj.previousLocationStock,
    newStock: coneAdj.newLocationStock,
    unitCost: Number(payload.cone.costPrice || 0),
    totalValue: round3(Number(payload.cone.costPrice || 0) * acceptedOutput),
    reason: 'Cone winding production receipt',
    reference: entryNumber,
    status: 'Completed',
    createdBy: userId,
    companyId,
    locationId: payload.outputWh.id,
    notes: `Cones produced from LOT ${payload.yarnLotNumber}`
  });

  await tx.manufacturingStockEntry.create({
    data: {
      name: await nextTextileNumber(tx, 'manufacturingStockEntry', 'name', 'STE', companyId),
      purpose: 'Manufacture',
      fromWarehouse: payload.sourceWh.id,
      toWarehouse: payload.outputWh.id,
      postingDate: payload.productionDate,
      fgCompletedQty: acceptedOutput,
      status: 'Submitted',
      items: [
        {
          itemId: payload.yarn.id,
          itemName: payload.yarn.name,
          qty: netYarnConsumed,
          uom: 'KG',
          batchNumber: payload.yarnLotNumber,
          s_warehouse: payload.sourceWh.id,
          t_warehouse: null
        },
        {
          itemId: payload.cone.id,
          itemName: payload.cone.name,
          qty: acceptedOutput,
          uom: 'KG',
          s_warehouse: null,
          t_warehouse: payload.outputWh.id
        }
      ],
      remarks: `Textile cone winding ${entryNumber}`,
      createdBy: userId,
      companyId
    }
  });

  if (payload.machine?.id) {
    await tx.manufacturingMachine.update({
      where: { id: payload.machine.id },
      data: { currentStatus: 'Idle', updatedBy: userId }
    });
  }

  return { yarnMove, coneMove };
}

const createWinding = wrap(async (req, res) => {
  await sandbox.requireSandboxCompany(req.mfg.companyId);
  const postNow = Boolean(req.body?.post || req.body?.status === 'Posted');
  const payload = await buildWindingPayload(req.mfg.companyId, req.mfg.userId, req.body || {}, {
    forPost: postNow
  });

  const result = await prisma.$transaction(async (tx) => {
    if (!postNow) {
      return persistWinding(tx, req.mfg.companyId, req.mfg.userId, payload, {
        status: 'Draft',
        stockPosted: false
      });
    }
    const entryNumber = await nextTextileNumber(
      tx,
      'textileConeWindingEntry',
      'entryNumber',
      'CWE',
      req.mfg.companyId
    );
    const moves = await postInventoryForWinding(
      tx,
      req.mfg.companyId,
      req.mfg.userId,
      payload,
      entryNumber
    );
    return persistWinding(tx, req.mfg.companyId, req.mfg.userId, payload, {
      status: 'Posted',
      stockPosted: true,
      yarnMoveId: moves.yarnMove.id,
      coneMoveId: moves.coneMove.id,
      entryNumber
    });
  });

  const full = await loadWinding(req.mfg.companyId, result.entry.id);
  return ok(res, full, { message: postNow ? 'Cone winding posted' : 'Cone winding draft saved' });
});

async function loadWinding(companyId, id) {
  return prisma.textileConeWindingEntry.findFirst({
    where: { id, companyId },
    include: {
      cones: { orderBy: { coneCode: 'asc' } },
      machine: {
        include: {
          owningCompany: { select: { id: true, name: true } },
          operatingCompany: { select: { id: true, name: true } }
        }
      },
      yarnProduct: { select: { id: true, name: true, sku: true, costPrice: true } },
      coneProduct: { select: { id: true, name: true, sku: true, costPrice: true } },
      sourceWarehouse: { select: { id: true, name: true, code: true } },
      outputWarehouse: { select: { id: true, name: true, code: true } },
      machineOwningCompany: { select: { id: true, name: true } },
      machineOperatingCompany: { select: { id: true, name: true } }
    }
  });
}

const listWinding = wrap(async (req, res) => {
  await sandbox.requireSandboxCompany(req.mfg.companyId);
  const { page, limit, skip } = paginationParams(req);
  const where = { companyId: req.mfg.companyId };
  const status = emptyToNull(req.query.status);
  if (status) where.status = status;
  const [total, rows] = await Promise.all([
    prisma.textileConeWindingEntry.count({ where }),
    prisma.textileConeWindingEntry.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip,
      take: limit,
      include: {
        machine: { select: { id: true, name: true, machineCode: true } },
        _count: { select: { cones: true } }
      }
    })
  ]);
  return ok(res, rows, { pagination: paginationMeta(page, limit, total) });
});

const getWinding = wrap(async (req, res) => {
  await sandbox.requireSandboxCompany(req.mfg.companyId);
  const row = await loadWinding(req.mfg.companyId, req.params.id);
  if (!row) return fail(res, 404, 'Winding entry not found');
  return ok(res, row);
});

const postWinding = wrap(async (req, res) => {
  await sandbox.requireSandboxCompany(req.mfg.companyId);
  const existing = await loadWinding(req.mfg.companyId, req.params.id);
  if (!existing) return fail(res, 404, 'Winding entry not found');
  if (existing.status === 'Posted') return fail(res, 400, 'Entry already posted');
  if (existing.status === 'Cancelled') return fail(res, 400, 'Cancelled entry cannot be posted');

  const body = {
    yarnProductId: existing.yarnProductId,
    coneProductId: existing.coneProductId,
    yarnLotNumber: existing.yarnLotNumber,
    sourceWarehouseId: existing.sourceWarehouseId,
    outputWarehouseId: existing.outputWarehouseId,
    machineId: existing.machineId,
    machineOwningCompanyId: existing.machineOwningCompanyId,
    machineOperatingCompanyId: existing.machineOperatingCompanyId,
    operatorId: existing.operatorId,
    operatorName: existing.operatorName,
    shift: existing.shift,
    productionDate: existing.productionDate,
    targetOutputKg: existing.targetOutputKg,
    inputWeightKg: existing.inputWeightKg,
    outputWeightKg: existing.outputWeightKg,
    wastageKg: existing.wastageKg,
    rejectedWeightKg: existing.rejectedWeightKg,
    remainingYarnKg: existing.remainingYarnKg,
    rejectedConeCount: existing.rejectedConeCount,
    runningHours: existing.runningHours,
    downtimeHours: existing.downtimeHours,
    productionOrderId: existing.productionOrderId,
    notes: existing.notes,
    cones: (existing.cones || []).map((c) => ({
      coneCode: c.coneCode,
      weightKg: c.weightKg,
      status: c.status === 'Rejected' ? 'Rejected' : 'Available',
      notes: c.notes
    }))
  };

  const payload = await buildWindingPayload(req.mfg.companyId, req.mfg.userId, body, { forPost: true });

  await prisma.$transaction(async (tx) => {
    const moves = await postInventoryForWinding(
      tx,
      req.mfg.companyId,
      req.mfg.userId,
      payload,
      existing.entryNumber
    );
    await tx.textileConeWindingEntry.update({
      where: { id: existing.id },
      data: {
        status: 'Posted',
        stockPosted: true,
        yarnStockMovementId: moves.yarnMove.id,
        coneStockMovementId: moves.coneMove.id,
        updatedBy: req.mfg.userId
      }
    });
    for (const cone of existing.cones || []) {
      if (cone.status === 'Rejected') continue;
      await tx.textileCone.update({
        where: { id: cone.id },
        data: { status: 'Available', updatedBy: req.mfg.userId }
      });
      await tx.textileGenealogyLink.create({
        data: {
          companyId: req.mfg.companyId,
          parentType: 'YarnLot',
          parentId: `${payload.yarn.id}:${payload.yarnLotNumber}`,
          parentCode: payload.yarnLotNumber,
          childType: 'Cone',
          childId: cone.id,
          childCode: cone.coneCode,
          relation: 'ProducedFrom',
          quantity: cone.weightKg,
          unit: 'KG',
          metadata: {
            windingEntryId: existing.id,
            windingEntryNumber: existing.entryNumber,
            yarnProductId: payload.yarn.id,
            yarnProductName: payload.yarn.name
          },
          createdBy: req.mfg.userId
        }
      });
      await tx.textileGenealogyLink.create({
        data: {
          companyId: req.mfg.companyId,
          parentType: 'WindingEntry',
          parentId: existing.id,
          parentCode: existing.entryNumber,
          childType: 'Cone',
          childId: cone.id,
          childCode: cone.coneCode,
          relation: 'ProducedFrom',
          quantity: cone.weightKg,
          unit: 'KG',
          createdBy: req.mfg.userId
        }
      });
    }
  });

  return ok(res, await loadWinding(req.mfg.companyId, existing.id), { message: 'Cone winding posted' });
});

const listCones = wrap(async (req, res) => {
  await sandbox.requireSandboxCompany(req.mfg.companyId);
  const { page, limit, skip } = paginationParams(req);
  const where = { companyId: req.mfg.companyId };
  const status = emptyToNull(req.query.status);
  const lot = emptyToNull(req.query.yarnLotNumber || req.query.lot);
  if (status) where.status = status;
  if (lot) where.yarnLotNumber = lot;
  const [total, rows] = await Promise.all([
    prisma.textileCone.count({ where }),
    prisma.textileCone.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip,
      take: limit,
      include: {
        windingEntry: { select: { id: true, entryNumber: true, status: true } },
        warehouse: { select: { id: true, name: true } },
        machine: { select: { id: true, name: true } }
      }
    })
  ]);
  return ok(res, rows, { pagination: paginationMeta(page, limit, total) });
});

const getCone = wrap(async (req, res) => {
  await sandbox.requireSandboxCompany(req.mfg.companyId);
  const cone = await prisma.textileCone.findFirst({
    where: { id: req.params.id, companyId: req.mfg.companyId },
    include: {
      windingEntry: true,
      product: { select: { id: true, name: true, sku: true } },
      yarnProduct: { select: { id: true, name: true, sku: true } },
      warehouse: { select: { id: true, name: true } },
      machine: true,
      owningCompany: { select: { id: true, name: true } },
      operatingCompany: { select: { id: true, name: true } }
    }
  });
  if (!cone) return fail(res, 404, 'Cone not found');
  const genealogy = await buildGenealogy(req.mfg.companyId, 'Cone', cone.id);
  return ok(res, { ...cone, genealogy });
});

async function buildGenealogy(companyId, entityType, entityId) {
  const parents = await prisma.textileGenealogyLink.findMany({
    where: { companyId, childType: entityType, childId: entityId },
    orderBy: { createdAt: 'asc' }
  });
  const children = await prisma.textileGenealogyLink.findMany({
    where: { companyId, parentType: entityType, parentId: entityId },
    orderBy: { createdAt: 'asc' }
  });
  const yarnLotParents = parents.filter((p) => p.parentType === 'YarnLot');
  return {
    entityType,
    entityId,
    parents,
    children,
    yarnLots: yarnLotParents.map((p) => ({
      lotNumber: p.parentCode,
      parentId: p.parentId,
      quantity: p.quantity,
      unit: p.unit,
      metadata: p.metadata
    }))
  };
}

const getGenealogy = wrap(async (req, res) => {
  await sandbox.requireSandboxCompany(req.mfg.companyId);
  const entityType = emptyToNull(req.params.entityType);
  const entityId = emptyToNull(req.params.entityId);
  if (!entityType || !entityId) return fail(res, 400, 'entityType and entityId are required');
  return ok(res, await buildGenealogy(req.mfg.companyId, entityType, entityId));
});

const listBeams = wrap(async (req, res) => {
  await sandbox.requireSandboxCompany(req.mfg.companyId);
  const { page, limit, skip } = paginationParams(req);
  const where = { companyId: req.mfg.companyId };
  const [total, rows] = await Promise.all([
    prisma.textileBeam.count({ where }),
    prisma.textileBeam.findMany({ where, orderBy: { createdAt: 'desc' }, skip, take: limit })
  ]);
  return ok(res, rows, { pagination: paginationMeta(page, limit, total) });
});

const createBeam = wrap(async (req, res) => {
  await sandbox.requireSandboxCompany(req.mfg.companyId);
  const beamCode =
    emptyToNull(req.body?.beamCode) ||
    (await nextTextileNumber(prisma, 'textileBeam', 'beamCode', 'BEAM', req.mfg.companyId));
  const row = await prisma.textileBeam.create({
    data: {
      beamCode,
      companyId: req.mfg.companyId,
      productId: emptyToNull(req.body?.productId),
      beamType: emptyToNull(req.body?.beamType) || 'Warping',
      status: emptyToNull(req.body?.status) || 'Draft',
      totalEnds: req.body?.totalEnds == null ? null : Math.floor(toNum(req.body.totalEnds)),
      yarnLengthM: req.body?.yarnLengthM == null ? null : toNum(req.body.yarnLengthM),
      weightKg: req.body?.weightKg == null ? null : toNum(req.body.weightKg),
      warehouseId: emptyToNull(req.body?.warehouseId),
      sourceYarnLot: emptyToNull(req.body?.sourceYarnLot),
      notes: emptyToNull(req.body?.notes),
      createdBy: req.mfg.userId
    }
  });
  return ok(res, row, { message: 'Beam foundation record created (warping workflow not in P0)' });
});

const listRolls = wrap(async (req, res) => {
  await sandbox.requireSandboxCompany(req.mfg.companyId);
  const { page, limit, skip } = paginationParams(req);
  const where = { companyId: req.mfg.companyId };
  const [total, rows] = await Promise.all([
    prisma.textileFabricRoll.count({ where }),
    prisma.textileFabricRoll.findMany({ where, orderBy: { createdAt: 'desc' }, skip, take: limit })
  ]);
  return ok(res, rows, { pagination: paginationMeta(page, limit, total) });
});

const createRoll = wrap(async (req, res) => {
  await sandbox.requireSandboxCompany(req.mfg.companyId);
  const rollCode =
    emptyToNull(req.body?.rollCode) ||
    (await nextTextileNumber(prisma, 'textileFabricRoll', 'rollCode', 'ROLL', req.mfg.companyId));
  const row = await prisma.textileFabricRoll.create({
    data: {
      rollCode,
      companyId: req.mfg.companyId,
      productId: emptyToNull(req.body?.productId),
      stage: emptyToNull(req.body?.stage) || 'Greige',
      status: emptyToNull(req.body?.status) || 'Draft',
      weightKg: req.body?.weightKg == null ? null : toNum(req.body.weightKg),
      meters: req.body?.meters == null ? null : toNum(req.body.meters),
      widthMm: req.body?.widthMm == null ? null : toNum(req.body.widthMm),
      gsm: req.body?.gsm == null ? null : toNum(req.body.gsm),
      qualityGrade: emptyToNull(req.body?.qualityGrade),
      warehouseId: emptyToNull(req.body?.warehouseId),
      yarnLotNumber: emptyToNull(req.body?.yarnLotNumber),
      productionBatch: emptyToNull(req.body?.productionBatch),
      barcode: emptyToNull(req.body?.barcode) || rollCode,
      qrCode: emptyToNull(req.body?.qrCode) || `TX-ROLL:${req.mfg.companyId}:${rollCode}`,
      notes: emptyToNull(req.body?.notes),
      createdBy: req.mfg.userId
    }
  });
  return ok(res, row, { message: 'Fabric roll foundation record created (formation workflow not in P0)' });
});

const inventorySnapshot = wrap(async (req, res) => {
  await sandbox.requireSandboxCompany(req.mfg.companyId);
  const status = await sandbox.sandboxStatus(req.mfg.userId, req.mfg.companyId);
  const coneCount = await prisma.textileCone.count({
    where: { companyId: req.mfg.companyId, status: 'Available' }
  });
  const coneWeight = await prisma.textileCone.aggregate({
    where: { companyId: req.mfg.companyId, status: 'Available' },
    _sum: { weightKg: true }
  });
  return ok(res, {
    ...status.masters,
    availableConeCount: coneCount,
    availableConeWeightKg: Number(coneWeight._sum.weightKg || 0)
  });
});

module.exports = {
  getSandboxStatus,
  ensureSandbox,
  listYarnLots,
  listMachines,
  listWarehouses,
  listProducts,
  createWinding,
  listWinding,
  getWinding,
  postWinding,
  listCones,
  getCone,
  getGenealogy,
  listBeams,
  createBeam,
  listRolls,
  createRoll,
  inventorySnapshot
};
