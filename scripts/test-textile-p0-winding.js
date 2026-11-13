'use strict';

/**
 * End-to-end API test for Textile P0 cone winding inside TEXTILE-SANDBOX.
 * Usage: node scripts/test-textile-p0-winding.js
 */

require('dotenv').config();
const prisma = require('../prisma/client');
const sandbox = require('../services/textileSandboxService');

async function main() {
  const user = await prisma.user.findFirst({
    where: { email: { contains: '@' } },
    orderBy: { createdAt: 'asc' }
  });
  if (!user) throw new Error('No user found to own sandbox membership');

  console.log('1) Ensure sandbox for', user.email || user.id);
  const ensured = await sandbox.ensureSandbox(user.id, {
    activateForUser: true,
    parentCompanyId: user.companyId
  });
  const companyId = ensured.company.id;
  const m = ensured.masters;
  console.log('   company', companyId, 'yarnLotKg', m.yarnLotKg, 'coneStockKg', m.coneStockKg);

  const beforeYarn = m.yarnLotKg;
  const beforeCone = m.coneStockKg;

  console.log('2) Insufficient stock guard prep');
  {
    const lot = await prisma.productBatch.findUnique({
      where: {
        productId_locationId_batchNumber: {
          productId: m.yarnProductId,
          locationId: m.warehouseId,
          batchNumber: m.yarnLotNumber
        }
      }
    });
    if (Number(lot.currentStock) >= 999999) throw new Error('unexpected huge stock');
    console.log('   LOT on hand', lot.currentStock, '(will reject 999999 KG)');
  }

  // Direct controller is Express-bound; exercise domain via internal recreate of post by importing workflow pieces.
  const { adjustBatchStock } = require('../warehouse/services/productBatchService');
  const workflow = require('../utils/manufacturingWorkflow');
  const { MOVEMENT_TYPES } = require('../warehouse/services/inventoryMath');

  async function postWindingSample({ input, output, wastage, remaining, coneWeights, label }) {
    const entryNumber = `TEST-${Date.now().toString().slice(-8)}`;
    const net = Math.round((input - remaining) * 1000) / 1000;
    return prisma.$transaction(async (tx) => {
      const yarnAdj = await workflow.postStockOut(tx, {
        companyId,
        productId: m.yarnProductId,
        locationId: m.warehouseId,
        qty: net,
        productName: m.yarnProductName,
        allowNegative: false
      });
      await adjustBatchStock(tx, {
        companyId,
        productId: m.yarnProductId,
        locationId: m.warehouseId,
        batchNumber: m.yarnLotNumber,
        delta: -net,
        checkAvailable: true,
        productName: m.yarnProductName
      });
      const coneAdj = await workflow.postStockIn(tx, {
        companyId,
        productId: m.coneProductId,
        locationId: m.warehouseId,
        qty: output,
        productName: m.coneProductName
      });
      const yarnMove = await tx.stockMovement.create({
        data: {
          productId: m.yarnProductId,
          productName: m.yarnProductName,
          type: 'stock_out',
          movementType: MOVEMENT_TYPES.PRODUCTION_CONSUMPTION,
          quantity: net,
          baseQuantity: net,
          previousStock: yarnAdj.previousLocationStock,
          newStock: yarnAdj.newLocationStock,
          reason: label,
          reference: entryNumber,
          batchNumber: m.yarnLotNumber,
          status: 'Completed',
          createdBy: user.id,
          companyId,
          locationId: m.warehouseId,
          uom: 'KG'
        }
      });
      const coneMove = await tx.stockMovement.create({
        data: {
          productId: m.coneProductId,
          productName: m.coneProductName,
          type: 'stock_in',
          movementType: MOVEMENT_TYPES.PRODUCTION_RECEIPT,
          quantity: output,
          baseQuantity: output,
          previousStock: coneAdj.previousLocationStock,
          newStock: coneAdj.newLocationStock,
          reason: label,
          reference: entryNumber,
          status: 'Completed',
          createdBy: user.id,
          companyId,
          locationId: m.warehouseId,
          uom: 'KG'
        }
      });
      const entry = await tx.textileConeWindingEntry.create({
        data: {
          entryNumber,
          companyId,
          yarnProductId: m.yarnProductId,
          yarnProductName: m.yarnProductName,
          yarnLotNumber: m.yarnLotNumber,
          coneProductId: m.coneProductId,
          coneProductName: m.coneProductName,
          sourceWarehouseId: m.warehouseId,
          outputWarehouseId: m.warehouseId,
          machineId: m.machineId,
          machineOwningCompanyId: companyId,
          machineOperatingCompanyId: companyId,
          operatorName: 'Test Operator',
          shift: 'A',
          productionDate: new Date(),
          targetOutputKg: output,
          inputWeightKg: input,
          outputWeightKg: output,
          wastageKg: wastage,
          rejectedWeightKg: 0,
          remainingYarnKg: remaining,
          coneCount: coneWeights.length,
          status: 'Posted',
          stockPosted: true,
          yarnStockMovementId: yarnMove.id,
          coneStockMovementId: coneMove.id,
          notes: label,
          createdBy: user.id
        }
      });
      const cones = [];
      for (let i = 0; i < coneWeights.length; i += 1) {
        const coneCode = `${entryNumber}-C${String(i + 1).padStart(2, '0')}`;
        const cone = await tx.textileCone.create({
          data: {
            coneCode,
            companyId,
            windingEntryId: entry.id,
            productId: m.coneProductId,
            yarnProductId: m.yarnProductId,
            yarnLotNumber: m.yarnLotNumber,
            weightKg: coneWeights[i],
            status: 'Available',
            warehouseId: m.warehouseId,
            machineId: m.machineId,
            owningCompanyId: companyId,
            operatingCompanyId: companyId,
            operatorName: 'Test Operator',
            productionDate: new Date(),
            barcode: coneCode,
            qrCode: `TX-CONE:${companyId}:${coneCode}`,
            createdBy: user.id
          }
        });
        await tx.textileGenealogyLink.create({
          data: {
            companyId,
            parentType: 'YarnLot',
            parentId: `${m.yarnProductId}:${m.yarnLotNumber}`,
            parentCode: m.yarnLotNumber,
            childType: 'Cone',
            childId: cone.id,
            childCode: cone.coneCode,
            relation: 'ProducedFrom',
            quantity: cone.weightKg,
            unit: 'KG',
            createdBy: user.id
          }
        });
        cones.push(cone);
      }
      return { entry, cones, yarnMove, coneMove };
    });
  }

  // Successful full sample: 200 in / 198 out / 2 waste (keep most seed stock for UI tests)
  console.log('3) Successful production 200→198 (+2 waste)');
  const full = await postWindingSample({
    input: 200,
    output: 198,
    wastage: 2,
    remaining: 0,
    coneWeights: Array.from({ length: 6 }, (_, i) => (i === 5 ? 33 : 33)),
    label: 'P0 test successful winding'
  });
  // Fix last cone weight to exact 198
  // 5*33=165, last=33 => 198. Good.
  console.log('   entry', full.entry.entryNumber, 'cones', full.cones.length);

  console.log('4) Partial production 50→45 (+2 waste +3 remaining)');
  const partial = await postWindingSample({
    input: 50,
    output: 45,
    wastage: 2,
    remaining: 3,
    coneWeights: [15, 15, 15],
    label: 'P0 test partial winding'
  });
  console.log('   entry', partial.entry.entryNumber);

  console.log('5) Insufficient stock attempt');
  let blocked = false;
  try {
    await postWindingSample({
      input: 999999,
      output: 999998,
      wastage: 1,
      remaining: 0,
      coneWeights: [999998],
      label: 'should fail'
    });
  } catch (err) {
    blocked = true;
    console.log('   blocked OK:', err.message);
  }
  if (!blocked) throw new Error('Insufficient stock was not blocked');

  const yarnLotAfter = await prisma.productBatch.findUnique({
    where: {
      productId_locationId_batchNumber: {
        productId: m.yarnProductId,
        locationId: m.warehouseId,
        batchNumber: m.yarnLotNumber
      }
    }
  });
  const coneStockAfter = await prisma.productStock.findUnique({
    where: { productId_locationId: { productId: m.coneProductId, locationId: m.warehouseId } }
  });
  const gene = await prisma.textileGenealogyLink.findMany({
    where: { companyId, childType: 'Cone', childId: full.cones[0].id }
  });
  const expectedYarn = Math.round((beforeYarn - 200 - 47) * 1000) / 1000; // net: 200 + (50-3)
  const expectedCone = Math.round((beforeCone + 198 + 45) * 1000) / 1000;
  console.log('6) Inventory reconciliation');
  console.log('   yarnLot before', beforeYarn, 'after', yarnLotAfter.currentStock, 'expected', expectedYarn);
  console.log('   cone stock before', beforeCone, 'after', coneStockAfter?.currentStock, 'expected', expectedCone);
  console.log('   genealogy parents for', full.cones[0].coneCode, gene.length);
  if (Math.abs(Number(yarnLotAfter.currentStock) - expectedYarn) > 0.05) {
    throw new Error('Yarn LOT reconciliation mismatch');
  }
  if (Math.abs(Number(coneStockAfter?.currentStock || 0) - expectedCone) > 0.05) {
    throw new Error('Cone stock reconciliation mismatch');
  }
  if (!gene.length) throw new Error('Missing genealogy link');
  console.log('PASS textile P0 winding domain tests');
}

main()
  .catch((err) => {
    console.error('FAIL', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
