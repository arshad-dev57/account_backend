'use strict';

const { randomUUID } = require('crypto');
const prisma = require('../prisma/client');
const { ensureMembershipForUserCompany } = require('../utils/companyAccess');
const { adjustLocationStock, ensureDefaultLocation } = require('../warehouse/services/locationService');
const { adjustBatchStock } = require('../warehouse/services/productBatchService');
const { MOVEMENT_TYPES } = require('../warehouse/services/inventoryMath');

const SANDBOX_NAME = 'TEXTILE-SANDBOX';
const YARN_SKU = 'TX-YARN-30-1';
const CONE_SKU = 'TX-CONE-YARN';
const YARN_LOT = 'YRN-TEST-001';
const MACHINE_CODE = 'TX-SBX-WIND-01';
const WORK_CENTER_CODE = 'TX-SBX-WC-WIND';

function round3(n) {
  return Math.round((Number(n) || 0) * 1000) / 1000;
}

async function findSandboxCompany() {
  return prisma.company.findFirst({
    where: { OR: [{ isSandbox: true, name: SANDBOX_NAME }, { name: SANDBOX_NAME }] },
    orderBy: { createdAt: 'asc' }
  });
}

async function requireSandboxCompany(companyId) {
  const company = await prisma.company.findFirst({ where: { id: companyId } });
  if (!company) {
    const err = new Error('Company not found');
    err.status = 404;
    throw err;
  }
  if (!company.isSandbox) {
    const err = new Error(
      'Textile production posting is restricted to the TEXTILE-SANDBOX company. Open Textile Sandbox and switch into it first.'
    );
    err.status = 403;
    throw err;
  }
  return company;
}

async function upsertProduct(tx, { companyId, userId, sku, name, costPrice, textileItemClass, isBatchManaged }) {
  const existing = await tx.product.findFirst({ where: { companyId, sku } });
  if (existing) {
    return tx.product.update({
      where: { id: existing.id },
      data: {
        name,
        costPrice,
        sellingPrice: costPrice,
        textileItemClass,
        isBatchManaged: Boolean(isBatchManaged),
        trackInventory: true,
        allowFractionalQty: true,
        stockUnitName: 'KG',
        weightUnitName: 'KG',
        isActive: true,
        status: 'Active',
        updatedBy: userId
      }
    });
  }
  return tx.product.create({
    data: {
      name,
      sku,
      costPrice,
      sellingPrice: costPrice,
      textileItemClass,
      isBatchManaged: Boolean(isBatchManaged),
      trackInventory: true,
      allowFractionalQty: true,
      stockUnitName: 'KG',
      weightUnitName: 'KG',
      productType: 'Physical',
      itemType: 'INGREDIENT',
      showInPos: false,
      currentStock: 0,
      availableStock: 0,
      isActive: true,
      status: 'Active',
      createdBy: userId,
      companyId
    }
  });
}

async function ensureSandbox(userId, { activateForUser = true, parentCompanyId = null } = {}) {
  let company = await findSandboxCompany();
  if (!company) {
    company = await prisma.company.create({
      data: {
        name: SANDBOX_NAME,
        businessType: 'Textile Manufacturing Sandbox',
        isSandbox: true,
        isActive: true,
        parentCompanyId: parentCompanyId || null,
        subscriptionPlan: 'trial',
        subscriptionStatus: 'active',
        productTier: 'erp_pos',
        licensedUsers: 999,
        licensedBranches: 999,
        posMode: 'retail',
        posModeConfigured: false
      }
    });
  } else if (!company.isSandbox) {
    company = await prisma.company.update({
      where: { id: company.id },
      data: { isSandbox: true, businessType: company.businessType || 'Textile Manufacturing Sandbox' }
    });
  }

  await ensureMembershipForUserCompany(userId, company.id, {
    role: 'admin',
    isOwner: true,
    forceRole: true
  });

  const seeded = await prisma.$transaction(async (tx) => {
    const warehouse =
      (await tx.location.findFirst({
        where: { companyId: company.id, OR: [{ code: 'MAIN-WH' }, { name: 'Main Warehouse' }], isDeleted: false }
      })) ||
      (await tx.location.create({
        data: {
          companyId: company.id,
          name: 'Main Warehouse',
          code: 'MAIN-WH',
          type: 'Warehouse',
          isDefault: true,
          isActive: true,
          createdBy: userId
        }
      }));

    const yarn = await upsertProduct(tx, {
      companyId: company.id,
      userId,
      sku: YARN_SKU,
      name: 'Cotton Yarn 30/1',
      costPrice: 500,
      textileItemClass: 'YARN',
      isBatchManaged: true
    });

    const cone = await upsertProduct(tx, {
      companyId: company.id,
      userId,
      sku: CONE_SKU,
      name: 'Yarn Cone',
      costPrice: 510,
      textileItemClass: 'CONE',
      isBatchManaged: false
    });

    let supplier = await tx.supplier.findFirst({
      where: { companyId: company.id, name: 'Test Yarn Supplier' }
    });
    if (!supplier) {
      supplier = await tx.supplier.create({
        data: {
          name: 'Test Yarn Supplier',
          companyName: 'Test Yarn Supplier',
          companyId: company.id,
          createdBy: userId,
          status: 'active',
          notes: 'Textile sandbox supplier'
        }
      });
    }

    await adjustLocationStock(tx, {
      companyId: company.id,
      productId: yarn.id,
      locationId: warehouse.id,
      delta: 0,
      productName: yarn.name
    });

    const yarnStock = await tx.productStock.findUnique({
      where: { productId_locationId: { productId: yarn.id, locationId: warehouse.id } }
    });
    const onHand = Number(yarnStock?.currentStock || 0);
    if (onHand < 1000) {
      const addQty = round3(1000 - onHand);
      const adj = await adjustLocationStock(tx, {
        companyId: company.id,
        productId: yarn.id,
        locationId: warehouse.id,
        delta: addQty,
        productName: yarn.name
      });
      await adjustBatchStock(tx, {
        companyId: company.id,
        productId: yarn.id,
        locationId: warehouse.id,
        batchNumber: YARN_LOT,
        delta: addQty,
        unitCost: 500,
        productName: yarn.name
      });
      await tx.stockMovement.create({
        data: {
          productId: yarn.id,
          productName: yarn.name,
          type: 'stock_in',
          movementType: MOVEMENT_TYPES.OPENING_BALANCE,
          quantity: addQty,
          baseQuantity: addQty,
          enteredQuantity: addQty,
          conversionFactor: 1,
          uom: 'KG',
          previousStock: adj.previousLocationStock,
          newStock: adj.newLocationStock,
          unitCost: 500,
          totalValue: addQty * 500,
          batchNumber: YARN_LOT,
          reason: 'Textile sandbox opening yarn stock',
          reference: `SANDBOX-${YARN_LOT}`,
          status: 'Completed',
          createdBy: userId,
          companyId: company.id,
          locationId: warehouse.id,
          notes: 'Isolated TEXTILE-SANDBOX seed — not live inventory'
        }
      });
    } else {
      await adjustBatchStock(tx, {
        companyId: company.id,
        productId: yarn.id,
        locationId: warehouse.id,
        batchNumber: YARN_LOT,
        delta: 0,
        unitCost: 500,
        productName: yarn.name
      });
    }

    let workCenter = await tx.manufacturingWorkCenter.findFirst({
      where: { companyId: company.id, workCenterCode: WORK_CENTER_CODE }
    });
    if (!workCenter) {
      workCenter = await tx.manufacturingWorkCenter.create({
        data: {
          workCenterCode: WORK_CENTER_CODE,
          name: 'Cone Winding Bay',
          capacity: 100,
          costPerHour: 200,
          status: 'Active',
          locationId: warehouse.id,
          createdBy: userId,
          companyId: company.id
        }
      });
    }

    let machine = await tx.manufacturingMachine.findFirst({
      where: { companyId: company.id, machineCode: MACHINE_CODE }
    });
    if (!machine) {
      machine = await tx.manufacturingMachine.create({
        data: {
          machineCode: MACHINE_CODE,
          name: 'Cone Winder CW-01',
          workCenterId: workCenter.id,
          locationId: warehouse.id,
          owningCompanyId: company.id,
          operatingCompanyId: company.id,
          currentStatus: 'Idle',
          hourlyOperatingCost: 150,
          capacity: 120,
          efficiency: 95,
          description: 'Sandbox cone winding machine',
          createdBy: userId,
          companyId: company.id
        }
      });
    } else {
      machine = await tx.manufacturingMachine.update({
        where: { id: machine.id },
        data: {
          owningCompanyId: machine.owningCompanyId || company.id,
          operatingCompanyId: machine.operatingCompanyId || company.id,
          workCenterId: machine.workCenterId || workCenter.id,
          locationId: machine.locationId || warehouse.id,
          updatedBy: userId
        }
      });
    }

    await tx.manufacturingSetting.upsert({
      where: { companyId: company.id },
      create: {
        companyId: company.id,
        settings: {
          textileEnabled: true,
          textileSandbox: true,
          allowNegativeInventory: false
        }
      },
      update: {
        settings: {
          textileEnabled: true,
          textileSandbox: true,
          allowNegativeInventory: false
        }
      }
    });

    const batch = await tx.productBatch.findUnique({
      where: {
        productId_locationId_batchNumber: {
          productId: yarn.id,
          locationId: warehouse.id,
          batchNumber: YARN_LOT
        }
      }
    });

    const yarnStockAfter = await tx.productStock.findUnique({
      where: { productId_locationId: { productId: yarn.id, locationId: warehouse.id } }
    });
    const coneStock = await tx.productStock.findUnique({
      where: { productId_locationId: { productId: cone.id, locationId: warehouse.id } }
    });

    return {
      warehouse,
      yarn,
      cone,
      supplier,
      workCenter,
      machine,
      yarnLot: YARN_LOT,
      yarnStockKg: Number(yarnStockAfter?.currentStock || 0),
      yarnLotKg: Number(batch?.currentStock || 0),
      coneStockKg: Number(coneStock?.currentStock || 0)
    };
  });

  if (activateForUser) {
    await prisma.user.update({
      where: { id: userId },
      data: { companyId: company.id }
    });
  }

  return {
    company: {
      id: company.id,
      name: company.name,
      isSandbox: true
    },
    activated: Boolean(activateForUser),
    masters: {
      warehouseId: seeded.warehouse.id,
      warehouseName: seeded.warehouse.name,
      yarnProductId: seeded.yarn.id,
      yarnProductName: seeded.yarn.name,
      yarnSku: seeded.yarn.sku,
      coneProductId: seeded.cone.id,
      coneProductName: seeded.cone.name,
      coneSku: seeded.cone.sku,
      yarnLotNumber: seeded.yarnLot,
      supplierId: seeded.supplier.id,
      supplierName: seeded.supplier.name,
      machineId: seeded.machine.id,
      machineCode: seeded.machine.machineCode,
      machineName: seeded.machine.name,
      workCenterId: seeded.workCenter.id,
      yarnStockKg: seeded.yarnStockKg,
      yarnLotKg: seeded.yarnLotKg,
      coneStockKg: seeded.coneStockKg
    }
  };
}

async function sandboxStatus(userId, activeCompanyId) {
  const company = await findSandboxCompany();
  const active = activeCompanyId
    ? await prisma.company.findFirst({ where: { id: activeCompanyId }, select: { id: true, name: true, isSandbox: true } })
    : null;
  let membership = null;
  if (company) {
    membership = await prisma.companyMembership.findFirst({
      where: { userId, companyId: company.id }
    });
  }
  let masters = null;
  if (company) {
    const yarn = await prisma.product.findFirst({ where: { companyId: company.id, sku: YARN_SKU } });
    const cone = await prisma.product.findFirst({ where: { companyId: company.id, sku: CONE_SKU } });
    const warehouse = await prisma.location.findFirst({
      where: { companyId: company.id, OR: [{ code: 'MAIN-WH' }, { isDefault: true }], isDeleted: false }
    });
    const machine = await prisma.manufacturingMachine.findFirst({
      where: { companyId: company.id, machineCode: MACHINE_CODE }
    });
    let yarnStockKg = 0;
    let yarnLotKg = 0;
    let coneStockKg = 0;
    if (yarn && warehouse) {
      const ys = await prisma.productStock.findUnique({
        where: { productId_locationId: { productId: yarn.id, locationId: warehouse.id } }
      });
      yarnStockKg = Number(ys?.currentStock || 0);
      const batch = await prisma.productBatch.findUnique({
        where: {
          productId_locationId_batchNumber: {
            productId: yarn.id,
            locationId: warehouse.id,
            batchNumber: YARN_LOT
          }
        }
      });
      yarnLotKg = Number(batch?.currentStock || 0);
    }
    if (cone && warehouse) {
      const cs = await prisma.productStock.findUnique({
        where: { productId_locationId: { productId: cone.id, locationId: warehouse.id } }
      });
      coneStockKg = Number(cs?.currentStock || 0);
    }
    masters = {
      warehouseId: warehouse?.id || null,
      warehouseName: warehouse?.name || null,
      yarnProductId: yarn?.id || null,
      yarnProductName: yarn?.name || null,
      coneProductId: cone?.id || null,
      coneProductName: cone?.name || null,
      yarnLotNumber: YARN_LOT,
      machineId: machine?.id || null,
      machineName: machine?.name || null,
      yarnStockKg,
      yarnLotKg,
      coneStockKg
    };
  }
  return {
    sandboxCompany: company
      ? { id: company.id, name: company.name, isSandbox: company.isSandbox }
      : null,
    activeCompany: active,
    inSandbox: Boolean(active?.isSandbox && company && active.id === company.id),
    hasMembership: Boolean(membership),
    masters,
    constants: {
      sandboxName: SANDBOX_NAME,
      yarnSku: YARN_SKU,
      coneSku: CONE_SKU,
      yarnLot: YARN_LOT,
      machineCode: MACHINE_CODE
    }
  };
}

module.exports = {
  SANDBOX_NAME,
  YARN_SKU,
  CONE_SKU,
  YARN_LOT,
  MACHINE_CODE,
  round3,
  findSandboxCompany,
  requireSandboxCompany,
  ensureSandbox,
  sandboxStatus,
  ensureDefaultLocation,
  randomUUID
};
