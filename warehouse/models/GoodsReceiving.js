// warehouse/models/GoodsReceiving.js - COMPLETE CORRECTED

const prisma = require('../../prisma/client');
const {
  resolveLocationId,
  adjustLocationStock,
} = require('../services/locationService');

function generateGRNNumber() {
  const date = new Date();
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const random = Math.floor(Math.random() * 10000).toString().padStart(4, '0');

  return `GRN-${year}${month}${day}-${random}`;
}

function isUnconfirmedGRN(grn) {
  return Boolean(grn) && !grn.confirmedAt && grn.status !== 'Cancelled';
}

function grnActionFlags(grn) {
  const unconfirmed = isUnconfirmedGRN(grn);
  return {
    canConfirm: unconfirmed,
    canEdit: unconfirmed,
    canDelete: unconfirmed,
  };
}

function linkedPurchaseOrderIds(grn) {
  return [
    ...new Set(
      [
        grn.purchaseOrderId,
        ...(grn.purchaseOrders || []).map((link) => link.purchaseOrderId),
      ]
        .filter(Boolean)
        .map(String)
    ),
  ];
}

function withGRNTotals(grn, extra = {}) {
  const supplierDetails = grn.supplier
    ? {
        supplierEmail: grn.supplier.email,
        supplierPhone: grn.supplier.phone,
        supplierAddress: grn.supplier.address,
      }
    : {};

  const totalReceivedQty = (grn.items || []).reduce(
    (sum, item) => sum + (item.receivingQuantity || 0),
    0
  );
  const totalCumulativeReceivedQty = (grn.items || []).reduce(
    (sum, item) =>
      sum + (item.previouslyReceivedQty || 0) + (item.receivingQuantity || 0),
    0
  );
  const totalOrderedQty = (grn.items || []).reduce(
    (sum, item) => sum + (item.orderedQuantity || 0),
    0
  );
  const totalItems = (grn.items || []).length;
  const receivingProgress =
    totalOrderedQty > 0
      ? (totalCumulativeReceivedQty || totalReceivedQty) / totalOrderedQty
      : 0;

  return {
    ...grn,
    ...supplierDetails,
    totalReceivedQty,
    totalCumulativeReceivedQty,
    totalOrderedQty,
    totalItems,
    receivingProgress,
    ...grnActionFlags(grn),
    ...extra,
  };
}

async function applyGRNInventory(tx, { goodsReceiving, userId, companyId }) {
  const stockAlreadyApplied = await tx.stockMovement.count({
    where: {
      companyId,
      reference: goodsReceiving.grnNumber,
      type: 'Goods Receiving',
    },
  });

  const linkedPoIds = linkedPurchaseOrderIds(goodsReceiving);
  const previousGRNs = linkedPoIds.length
    ? await tx.goodsReceiving.findMany({
        where: {
          companyId,
          isActive: true,
          isDeleted: false,
          status: { not: 'Cancelled' },
          id: { not: goodsReceiving.id },
          OR: [
            { purchaseOrderId: { in: linkedPoIds } },
            { purchaseOrders: { some: { purchaseOrderId: { in: linkedPoIds } } } },
          ],
        },
        include: { items: true },
      })
    : [];

  const previousReceivedQty = {};
  for (const grn of previousGRNs) {
    for (const item of grn.items) {
      previousReceivedQty[item.purchaseOrderItemId] =
        (previousReceivedQty[item.purchaseOrderItemId] || 0) + item.receivingQuantity;
    }
  }

  let allItemsFullyReceived = true;

  for (const item of goodsReceiving.items) {
    const alreadyReceived = previousReceivedQty[item.purchaseOrderItemId] || 0;
    const orderedQuantity =
      item.purchaseOrderItem?.quantity ?? item.orderedQuantity ?? 0;
    const remainingQuantity =
      orderedQuantity - (alreadyReceived + item.receivingQuantity);

    if (stockAlreadyApplied === 0) {
      const product = await tx.product.findUnique({
        where: { id: item.productId },
      });
      if (!product) {
        throw new Error(
          `Product not found for received item "${item.productName}"`
        );
      }

      const locationId = await resolveLocationId(
        tx,
        companyId,
        goodsReceiving.locationId || goodsReceiving.purchaseOrder?.locationId,
        userId
      );

      const qty = Math.round(Number(item.receivingQuantity) || 0);
      if (qty > 0) {
        const adj = await adjustLocationStock(tx, {
          companyId,
          productId: item.productId,
          locationId,
          delta: qty,
          productName: item.productName,
        });

        await tx.stockMovement.create({
          data: {
            productId: item.productId,
            productName: item.productName,
            type: 'Goods Receiving',
            quantity: qty,
            previousStock: adj.previousLocationStock,
            newStock: adj.newLocationStock,
            reason: `GRN #${goodsReceiving.grnNumber} confirmed - PO #${
              goodsReceiving.purchaseOrderNumber ||
              goodsReceiving.purchaseOrder?.orderNumber ||
              ''
            }`,
            reference: goodsReceiving.grnNumber,
            status: 'Completed',
            createdBy: userId,
            companyId,
            locationId,
            supplierId:
              goodsReceiving.supplierId ||
              goodsReceiving.purchaseOrder?.supplierId ||
              null,
            supplierName:
              goodsReceiving.supplierName ||
              goodsReceiving.purchaseOrder?.supplierName ||
              null,
          },
        });
      }
    }

    await tx.goodsReceivingItem.update({
      where: { id: item.id },
      data: { remainingQuantity },
    });

    if (remainingQuantity > 0) {
      allItemsFullyReceived = false;
    }
  }

  const status = allItemsFullyReceived ? 'Fully Received' : 'Partially Received';

  const updatedGRN = await tx.goodsReceiving.update({
    where: { id: goodsReceiving.id },
    data: {
      status,
      confirmedBy: userId,
      confirmedAt: new Date(),
      updatedBy: userId,
    },
    include: {
      items: {
        include: {
          product: true,
          purchaseOrderItem: true,
        },
      },
      purchaseOrder: {
        include: {
          supplier: true,
        },
      },
      purchaseOrders: true,
      supplier: true,
      creator: {
        select: { id: true, firstName: true, lastName: true, email: true },
      },
      confirmer: {
        select: { id: true, firstName: true, lastName: true, email: true },
      },
    },
  });

  for (const poId of linkedPoIds) {
    const po = await tx.purchaseOrder.findUnique({
      where: { id: poId },
      include: { items: true },
    });
    if (!po || po.status === 'Cancelled') continue;

    const poGRNs = await tx.goodsReceiving.findMany({
      where: {
        companyId,
        isActive: true,
        isDeleted: false,
        status: { not: 'Cancelled' },
        confirmedAt: { not: null },
        OR: [
          { purchaseOrderId: po.id },
          { purchaseOrders: { some: { purchaseOrderId: po.id } } },
        ],
      },
      include: { items: true },
    });

    const poTotalRecv = {};
    for (const g of poGRNs) {
      for (const gi of g.items) {
        poTotalRecv[gi.purchaseOrderItemId] =
          (poTotalRecv[gi.purchaseOrderItemId] || 0) + gi.receivingQuantity;
      }
    }

    const anyPoReceived = po.items.some((poi) => (poTotalRecv[poi.id] || 0) > 0);
    const allPoFullyReceived = po.items.every(
      (poi) => (poTotalRecv[poi.id] || 0) >= poi.quantity
    );

    if (anyPoReceived) {
      await tx.purchaseOrder.update({
        where: { id: po.id },
        data: {
          status: allPoFullyReceived ? 'Received' : 'Partially Received',
          updatedBy: userId,
        },
      });
    }
  }

  return updatedGRN;
}

class GoodsReceivingModel {
  // ============================================================
  // CREATE GOODS RECEIVING FROM ONE OR MORE PURCHASE ORDERS
  // ============================================================
  static async create(data) {
    const grnNumber = generateGRNNumber();

    return await prisma.$transaction(async (tx) => {
      const purchaseOrderIds = [
        ...new Set(
          (data.purchaseOrderIds?.length
            ? data.purchaseOrderIds
            : data.purchaseOrderId
              ? [data.purchaseOrderId]
              : []
          ).map((id) => String(id).trim()).filter(Boolean)
        ),
      ];

      if (!purchaseOrderIds.length) {
        throw new Error('At least one purchase order is required');
      }

      const purchaseOrders = await tx.purchaseOrder.findMany({
        where: {
          id: { in: purchaseOrderIds },
          companyId: data.companyId,
          isActive: true,
          isDeleted: false,
          status: { not: 'Cancelled' },
        },
        include: {
          items: { include: { product: true } },
          supplier: true,
        },
      });

      if (purchaseOrders.length !== purchaseOrderIds.length) {
        throw new Error('One or more purchase orders were not found or cancelled');
      }

      const supplierId = purchaseOrders[0].supplierId;
      if (purchaseOrders.some((po) => po.supplierId !== supplierId)) {
        throw new Error('All purchase orders in a GRN must belong to the same supplier');
      }

      const poById = Object.fromEntries(purchaseOrders.map((po) => [po.id, po]));
      const poItemById = {};
      for (const po of purchaseOrders) {
        for (const item of po.items) {
          poItemById[item.id] = { ...item, purchaseOrderId: po.id, purchaseOrderNumber: po.orderNumber };
        }
      }

      // Previous confirmed GRNs for any of these POs (via primary or link table)
      const previousGRNs = await tx.goodsReceiving.findMany({
        where: {
          companyId: data.companyId,
          isActive: true,
          isDeleted: false,
          status: { not: 'Cancelled' },
          OR: [
            { purchaseOrderId: { in: purchaseOrderIds } },
            { purchaseOrders: { some: { purchaseOrderId: { in: purchaseOrderIds } } } },
          ],
        },
        include: { items: true },
      });

      const previousReceivedQty = {};
      for (const grn of previousGRNs) {
        for (const item of grn.items) {
          previousReceivedQty[item.purchaseOrderItemId] =
            (previousReceivedQty[item.purchaseOrderItemId] || 0) + item.receivingQuantity;
        }
      }

      const receivingItems = [];
      for (const item of data.items) {
        const poItem = poItemById[item.purchaseOrderItemId];
        if (!poItem) {
          throw new Error(`Purchase order item ${item.purchaseOrderItemId} not found in selected orders`);
        }

        const alreadyReceived = previousReceivedQty[item.purchaseOrderItemId] || 0;
        const orderedQuantity = poItem.quantity;
        const remainingQuantity = orderedQuantity - alreadyReceived;

        if (item.receivingQuantity <= 0) {
          throw new Error(`Receiving quantity must be greater than 0 for product ${poItem.productName}`);
        }
        if (item.receivingQuantity > remainingQuantity) {
          throw new Error(
            `Receiving quantity (${item.receivingQuantity}) exceeds remaining quantity (${remainingQuantity}) for product ${poItem.productName}`
          );
        }

        receivingItems.push({
          purchaseOrderItemId: item.purchaseOrderItemId,
          purchaseOrderId: poItem.purchaseOrderId,
          purchaseOrderNumber: poItem.purchaseOrderNumber,
          productId: poItem.productId,
          productName: poItem.productName,
          sku: poItem.sku,
          orderedQuantity,
          previouslyReceivedQty: alreadyReceived,
          remainingQuantity: remainingQuantity - item.receivingQuantity,
          receivingQuantity: item.receivingQuantity,
          unitPrice: poItem.unitPrice || 0,
          unit: poItem.product?.stockUnitName || 'Pcs',
          notes: item.notes || null,
        });
      }

      const primaryPo = purchaseOrders[0];
      const locationId = await resolveLocationId(
        tx,
        data.companyId,
        data.locationId || primaryPo.locationId,
        data.createdBy
      );

      const purchaseOrderNumbers = purchaseOrders.map((po) => po.orderNumber).join(', ');

      const goodsReceiving = await tx.goodsReceiving.create({
        data: {
          grnNumber,
          purchaseOrderId: primaryPo.id,
          purchaseOrderNumber: primaryPo.orderNumber,
          purchaseOrderNumbers,
          supplierId: primaryPo.supplierId,
          supplierName: primaryPo.supplierName,
          receivingDate: new Date(data.receivingDate || Date.now()),
          status: 'Draft',
          receivedBy: data.receivedBy || null,
          notes: data.notes || null,
          createdBy: data.createdBy,
          companyId: data.companyId,
          locationId,
          items: { create: receivingItems },
          purchaseOrders: {
            create: purchaseOrders.map((po) => ({
              purchaseOrderId: po.id,
              purchaseOrderNumber: po.orderNumber,
            })),
          },
        },
        include: {
          items: {
            include: {
              product: true,
              purchaseOrderItem: true,
            },
          },
          purchaseOrders: true,
          purchaseOrder: { include: { supplier: true } },
          supplier: true,
          creator: {
            select: { id: true, firstName: true, lastName: true, email: true },
          },
        },
      });

      return withGRNTotals(goodsReceiving);
    });
  }

  // ============================================================
  // CONFIRM GOODS RECEIVING
  // ============================================================
  static async confirmReceiving(id, userId, companyId) {  // ✅ Added companyId
    return await prisma.$transaction(async (tx) => {
      const goodsReceiving = await tx.goodsReceiving.findUnique({
        where: { id },
        include: {
          items: {
            include: {
              product: true,
              purchaseOrderItem: true
            }
          },
          purchaseOrder: {
            include: {
              supplier: true
            }
          },
          purchaseOrders: true,
        }
      });

      if (!goodsReceiving) {
        throw new Error('Goods receiving not found');
      }

      if (goodsReceiving.companyId && goodsReceiving.companyId !== companyId) {
        throw new Error('Goods receiving not found');
      }

      if (goodsReceiving.status === 'Cancelled' || goodsReceiving.isDeleted) {
        throw new Error('Cancelled goods receiving cannot be confirmed');
      }

      if (goodsReceiving.confirmedAt) {
        throw new Error('Goods receiving already confirmed');
      }

      const updatedGRN = await applyGRNInventory(tx, {
        goodsReceiving,
        userId,
        companyId,
      });

      return withGRNTotals(updatedGRN);
    }, { maxWait: 30_000, timeout: 120_000 });
  }

  // ============================================================
  // GET GOODS RECEIVING BY ID
  // ============================================================
  static async findById(id) {
    const grn = await prisma.goodsReceiving.findUnique({
      where: { id },
      include: {
        items: {
          include: {
            product: {
              select: { id: true, name: true, sku: true }
            },
            purchaseOrderItem: {
              include: {
                product: {
                  select: { id: true, name: true, sku: true }
                }
              }
            }
          }
        },
        purchaseOrders: true,
        purchaseOrder: {
          include: {
            supplier: true,
            items: true
          }
        },
        supplier: true,
        creator: {
          select: { id: true, firstName: true, lastName: true, email: true }
        },
        updater: {
          select: { id: true, firstName: true, lastName: true, email: true }
        },
        confirmer: {
          select: { id: true, firstName: true, lastName: true, email: true }
        }
      }
    });

    if (!grn) return null;

    const returnAgg = await prisma.purchaseReturnItem.groupBy({
      by: ['goodsReceivingItemId'],
      where: {
        goodsReceivingId: id,
        return: {
          status: { in: ['Draft', 'Processed'] },
          isActive: true,
          isDeleted: false,
        },
      },
      _sum: { returnQuantity: true },
    });

    const returnedByItemId = {};
    for (const row of returnAgg) {
      if (row.goodsReceivingItemId) {
        returnedByItemId[row.goodsReceivingItemId] = Number(row._sum.returnQuantity || 0);
      }
    }

    // Add supplier details from the supplier relation
    const supplierDetails = grn.supplier ? {
      supplierEmail: grn.supplier.email,
      supplierPhone: grn.supplier.phone,
      supplierAddress: grn.supplier.address,
      supplierCity: grn.supplier.city,
      supplierCountry: grn.supplier.country,
      supplierContactPerson: grn.supplier.contactPerson,
      supplierPaymentTerms: grn.supplier.paymentTerms,
      supplierGstNumber: grn.supplier.gstNumber || grn.supplier.taxId,
    } : {};

    const enrichedItems = grn.items.map((item) => {
      const previously = Number(item.previouslyReceivedQty) || 0;
      const receiving = Number(item.receivingQuantity) || 0;
      const ordered = Number(item.orderedQuantity) || 0;
      const returnedQuantity = returnedByItemId[item.id] || 0;
      const remaining =
        Number(item.remainingQuantity) ??
        Math.max(0, ordered - previously - receiving);
      const totalReceivedQty = previously + receiving;
      const netReceivedQty = Math.max(0, receiving - returnedQuantity);
      return {
        ...item,
        totalReceivedQty,
        returnedQuantity,
        netReceivedQty,
        isFullyReceived: remaining <= 0,
      };
    });

    const totalReturnedQty = enrichedItems.reduce(
      (sum, item) => sum + (item.returnedQuantity || 0),
      0
    );

    // Progress for this GRN: qty received now vs qty ordered on linked PO lines
    const totalReceivedQty = enrichedItems.reduce(
      (sum, item) => sum + item.receivingQuantity,
      0
    );
    const totalOrderedQty = enrichedItems.reduce(
      (sum, item) => sum + item.orderedQuantity,
      0
    );
    const totalItems = enrichedItems.length;
    const receivingProgress =
      totalOrderedQty > 0 ? totalReceivedQty / totalOrderedQty : 0;
    const isDraft = grn.status === 'Draft' && !grn.confirmedAt;

    return {
      ...grn,
      items: enrichedItems,
      ...supplierDetails,
      purchaseOrderNumbers:
        grn.purchaseOrderNumbers ||
        (grn.purchaseOrders?.length
          ? grn.purchaseOrders.map((l) => l.purchaseOrderNumber).join(', ')
          : grn.purchaseOrderNumber),
      totalReceivedQty,
      totalReturnedQty,
      totalOrderedQty,
      totalItems,
      receivingProgress,
      canEdit: isDraft || isUnconfirmedGRN(grn),
      canConfirm: isUnconfirmedGRN(grn),
      canDelete: isUnconfirmedGRN(grn),
    };
  }

  // ============================================================
  // GET GOODS RECEIVING BY GRN NUMBER
  // ============================================================
  static async findByGRNNumber(grnNumber) {
    const grn = await prisma.goodsReceiving.findUnique({
      where: { grnNumber },
      include: {
        items: {
          include: {
            product: {
              select: { id: true, name: true, sku: true }
            }
          }
        },
        purchaseOrder: {
          include: {
            supplier: true
          }
        },
        supplier: true
      }
    });

    if (!grn) return null;

    // Add supplier details from the supplier relation
    const supplierDetails = grn.supplier ? {
      supplierEmail: grn.supplier.email,
      supplierPhone: grn.supplier.phone,
      supplierAddress: grn.supplier.address
    } : {};

    // Calculate totalReceivedQty, totalOrderedQty, totalItems, and receivingProgress
    const totalReceivedQty = grn.items.reduce((sum, item) => sum + item.receivingQuantity, 0);
    const totalOrderedQty = grn.items.reduce((sum, item) => sum + item.orderedQuantity, 0);
    const totalItems = grn.items.length;
    const receivingProgress = totalOrderedQty > 0 ? totalReceivedQty / totalOrderedQty : 0;

    return {
      ...grn,
      ...supplierDetails,
      totalReceivedQty,
      totalOrderedQty,
      totalItems,
      receivingProgress
    };
  }

  // ============================================================
  // GET GOODS RECEIVINGS BY PURCHASE ORDER
  // ============================================================
  static async findByPurchaseOrder(purchaseOrderId) {
    const grns = await prisma.goodsReceiving.findMany({
      where: {
        purchaseOrderId: purchaseOrderId,
        isActive: true,
        isDeleted: false
      },
      include: {
        items: {
          include: {
            product: true
          }
        },
        purchaseOrder: {
          include: {
            supplier: true
          }
        },
        supplier: true,
        creator: {
          select: { id: true, firstName: true, lastName: true, email: true }
        },
        confirmer: {
          select: { id: true, firstName: true, lastName: true, email: true }
        }
      },
      orderBy: {
        createdAt: 'desc'
      }
    });

    // Calculate totalReceivedQty, totalOrderedQty, totalItems, and receivingProgress for each GRN
    return grns.map(grn => {
      const supplierDetails = grn.supplier ? {
        supplierEmail: grn.supplier.email,
        supplierPhone: grn.supplier.phone,
        supplierAddress: grn.supplier.address
      } : {};

      const totalReceivedQty = grn.items.reduce((sum, item) => sum + item.receivingQuantity, 0);
      const totalOrderedQty = grn.items.reduce((sum, item) => sum + item.orderedQuantity, 0);
      const totalItems = grn.items.length;
      const receivingProgress = totalOrderedQty > 0 ? totalReceivedQty / totalOrderedQty : 0;

      return {
        ...grn,
        ...supplierDetails,
        totalReceivedQty,
        totalOrderedQty,
        totalItems,
        receivingProgress
      };
    });
  }

  // ============================================================
  // GET ALL GOODS RECEIVINGS WITH FILTERS
  // ============================================================
  static async findAll(filter = {}, options = {}) {
    const { skip, take, orderBy = { receivingDate: 'desc' } } = options;

    // ✅ FIXED: Map userId to createdBy if present
    const cleanFilter = { ...filter };
    if (cleanFilter.userId) {
      cleanFilter.createdBy = cleanFilter.userId;
      delete cleanFilter.userId;
    }

    const grns = await prisma.goodsReceiving.findMany({
      where: {
        ...cleanFilter,
        isActive: true,
        isDeleted: false
      },
      skip,
      take,
      orderBy,
      include: {
        items: {
          include: {
            product: {
              select: { id: true, name: true, sku: true }
            }
          }
        },
        purchaseOrders: true,
        purchaseOrder: {
          include: {
            supplier: true
          }
        },
        supplier: true,
        creator: {
          select: { id: true, firstName: true, lastName: true, email: true }
        },
        confirmer: {
          select: { id: true, firstName: true, lastName: true, email: true }
        }
      }
    });

    // Calculate totals and collapse multiple GRNs on the same PO into one list row.
    const enriched = grns.map(grn => {
      const supplierDetails = grn.supplier ? {
        supplierEmail: grn.supplier.email,
        supplierPhone: grn.supplier.phone,
        supplierAddress: grn.supplier.address
      } : {};

      const totalReceivedQty = grn.items.reduce((sum, item) => sum + item.receivingQuantity, 0);
      const totalCumulativeReceivedQty = grn.items.reduce(
        (sum, item) => sum + (item.previouslyReceivedQty || 0) + item.receivingQuantity,
        0
      );
      const totalOrderedQty = grn.items.reduce((sum, item) => sum + item.orderedQuantity, 0);
      const totalItems = grn.items.length;
      const receivingProgress = totalOrderedQty > 0 ? (totalCumulativeReceivedQty || totalReceivedQty) / totalOrderedQty : 0;

      return {
        ...grn,
        ...supplierDetails,
        purchaseOrderNumbers:
          grn.purchaseOrderNumbers ||
          (grn.purchaseOrders?.length
            ? grn.purchaseOrders.map((l) => l.purchaseOrderNumber).join(', ')
            : grn.purchaseOrderNumber),
        totalReceivedQty,
        totalCumulativeReceivedQty,
        totalOrderedQty,
        totalItems,
        receivingProgress,
        ...grnActionFlags(grn),
      };
    });

    const byPo = {};
    for (const grn of enriched) {
      const poId = grn.purchaseOrderId;
      if (!poId) continue;
      if (!byPo[poId]) byPo[poId] = [];
      byPo[poId].push(grn);
    }

    const withConsolidation = enriched.map((grn) => {
      const poId = grn.purchaseOrderId;
      if (!poId || !byPo[poId] || byPo[poId].length <= 1) {
        return {
          ...grn,
          linkedGrnCount: 1,
          linkedGrnNumbers: grn.grnNumber,
          isPrimaryGrnForPo: true,
        };
      }

      const sorted = [...byPo[poId]].sort(
        (a, b) => new Date(b.receivingDate) - new Date(a.receivingDate)
      );
      const primary = sorted[0];
      const linkedGrnNumbers = sorted.map((g) => g.grnNumber).join(', ');
      const isPrimary = grn.id === primary.id;

      return {
        ...grn,
        linkedGrnCount: sorted.length,
        linkedGrnNumbers,
        isPrimaryGrnForPo: isPrimary,
        grnNumber: isPrimary ? linkedGrnNumbers : grn.grnNumber,
        totalCumulativeReceivedQty: sorted.reduce(
          (max, g) => Math.max(max, g.totalCumulativeReceivedQty || 0),
          grn.totalCumulativeReceivedQty || 0
        ),
        totalReceivedQty: sorted.reduce(
          (sum, g) => sum + (g.totalReceivedQty || 0),
          0
        ),
      };
    });

    return withConsolidation.filter(
      (grn) => grn.isPrimaryGrnForPo !== false
    );
  }

  // ============================================================
  // COUNT GOODS RECEIVINGS - ✅ FIXED
  // ============================================================
  static async count(filter = {}) {
    // ✅ FIXED: Map userId to createdBy if present
    const cleanFilter = { ...filter };
    if (cleanFilter.userId) {
      cleanFilter.createdBy = cleanFilter.userId;
      delete cleanFilter.userId;
    }

    return await prisma.goodsReceiving.count({
      where: {
        ...cleanFilter,
        isActive: true,
        isDeleted: false
      }
    });
  }

  // ============================================================
  // UPDATE GOODS RECEIVING (Draft only)
  // ============================================================
  static async update(id, data) {
    return await prisma.$transaction(async (tx) => {
      const goodsReceiving = await tx.goodsReceiving.findUnique({
        where: { id },
        include: {
          items: true,
          purchaseOrders: true,
        },
      });

      if (!goodsReceiving) {
        throw new Error('Goods receiving not found');
      }

      if (goodsReceiving.confirmedAt) {
        throw new Error('Only unconfirmed goods receiving can be updated');
      }

      const updateData = {
        updatedBy: data.updatedBy,
        ...(data.receivingDate && { receivingDate: new Date(data.receivingDate) }),
        ...(data.receivedBy !== undefined && { receivedBy: data.receivedBy }),
        ...(data.notes !== undefined && { notes: data.notes }),
      };

      if (data.items) {
        await tx.goodsReceivingItem.deleteMany({
          where: { goodsReceivingId: id },
        });

        const linkedIds = [
          ...new Set(
            [
              goodsReceiving.purchaseOrderId,
              ...(goodsReceiving.purchaseOrders || []).map((l) => l.purchaseOrderId),
            ]
              .filter(Boolean)
              .map(String)
          ),
        ];

        const purchaseOrders = await tx.purchaseOrder.findMany({
          where: {
            id: { in: linkedIds },
            isActive: true,
            isDeleted: false,
          },
          include: {
            items: { include: { product: true } },
          },
        });

        if (!purchaseOrders.length) {
          throw new Error('Linked purchase orders not found');
        }

        const poItemById = {};
        for (const po of purchaseOrders) {
          for (const item of po.items) {
            poItemById[item.id] = {
              ...item,
              purchaseOrderId: po.id,
              purchaseOrderNumber: po.orderNumber,
            };
          }
        }

        const previousGRNs = await tx.goodsReceiving.findMany({
          where: {
            companyId: goodsReceiving.companyId,
            isActive: true,
            isDeleted: false,
            status: { not: 'Cancelled' },
            id: { not: id },
            OR: [
              { purchaseOrderId: { in: linkedIds } },
              { purchaseOrders: { some: { purchaseOrderId: { in: linkedIds } } } },
            ],
          },
          include: { items: true },
        });

        const previousReceivedQty = {};
        for (const grn of previousGRNs) {
          for (const item of grn.items) {
            previousReceivedQty[item.purchaseOrderItemId] =
              (previousReceivedQty[item.purchaseOrderItemId] || 0) + item.receivingQuantity;
          }
        }

        const receivingItems = [];
        for (const item of data.items) {
          const poItem = poItemById[item.purchaseOrderItemId];
          if (!poItem) {
            throw new Error(`Purchase order item ${item.purchaseOrderItemId} not found`);
          }

          const alreadyReceived = previousReceivedQty[item.purchaseOrderItemId] || 0;
          const orderedQuantity = poItem.quantity;
          const remainingQuantity = orderedQuantity - alreadyReceived;

          if (item.receivingQuantity <= 0) {
            throw new Error(`Receiving quantity must be greater than 0 for product ${poItem.productName}`);
          }
          if (item.receivingQuantity > remainingQuantity) {
            throw new Error(
              `Receiving quantity (${item.receivingQuantity}) exceeds remaining quantity (${remainingQuantity}) for product ${poItem.productName}`
            );
          }

          receivingItems.push({
            purchaseOrderItemId: item.purchaseOrderItemId,
            purchaseOrderId: poItem.purchaseOrderId,
            purchaseOrderNumber: poItem.purchaseOrderNumber,
            productId: poItem.productId,
            productName: poItem.productName,
            sku: poItem.sku,
            orderedQuantity,
            previouslyReceivedQty: alreadyReceived,
            remainingQuantity: remainingQuantity - item.receivingQuantity,
            receivingQuantity: item.receivingQuantity,
            unitPrice: poItem.unitPrice || 0,
            unit: poItem.product?.stockUnitName || 'Pcs',
            notes: item.notes || null,
          });
        }

        updateData.status = 'Draft';
        updateData.items = { create: receivingItems };
      }

      const updatedGRN = await tx.goodsReceiving.update({
        where: { id },
        data: updateData,
        include: {
          items: {
            include: {
              product: true,
              purchaseOrderItem: true,
            },
          },
          purchaseOrders: true,
          purchaseOrder: {
            include: {
              supplier: true,
            },
          },
          supplier: true,
        },
      });

      return {
        ...updatedGRN,
        purchaseOrderNumbers:
          updatedGRN.purchaseOrderNumbers ||
          (updatedGRN.purchaseOrders?.length
            ? updatedGRN.purchaseOrders.map((l) => l.purchaseOrderNumber).join(', ')
            : updatedGRN.purchaseOrderNumber),
        canEdit: true,
        canConfirm: true,
        canDelete: true,
      };
    });
  }

  // ============================================================
  // SOFT DELETE GOODS RECEIVING
  // ============================================================
  static async softDelete(id, userId) {
    const goodsReceiving = await prisma.goodsReceiving.findUnique({
      where: { id }
    });

    if (!goodsReceiving) {
      throw new Error('Goods receiving not found');
    }

    if (goodsReceiving.confirmedAt) {
      throw new Error('Cannot delete confirmed goods receiving');
    }

    return await prisma.goodsReceiving.update({
      where: { id },
      data: {
        isDeleted: true,
        isActive: false,
        updatedBy: userId
      },
      include: {
        items: true
      }
    });
  }

  // ============================================================
  // GET GOODS RECEIVING STATS - ✅ FIXED
  // ============================================================
  static async getStats(companyId, locationId = null) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const startOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);

    const baseFilter = {
      isActive: true,
      isDeleted: false,
      companyId: companyId,
      ...(locationId ? { locationId: String(locationId) } : {}),
    };

    const todayGRNs = await prisma.goodsReceiving.count({
      where: {
        ...baseFilter,
        receivingDate: {
          gte: today
        }
      }
    });

    const monthGRNs = await prisma.goodsReceiving.count({
      where: {
        ...baseFilter,
        receivingDate: {
          gte: startOfMonth
        }
      }
    });

    const [draft, partiallyReceived, fullyReceived] = await Promise.all([
      prisma.goodsReceiving.count({ where: { ...baseFilter, status: 'Draft' } }),
      prisma.goodsReceiving.count({ where: { ...baseFilter, status: 'Partially Received' } }),
      prisma.goodsReceiving.count({ where: { ...baseFilter, status: 'Fully Received' } })
    ]);

    return {
      today: {
        count: todayGRNs
      },
      month: {
        count: monthGRNs
      },
      status: {
        draft,
        partiallyReceived,
        fullyReceived,
        total: draft + partiallyReceived + fullyReceived
      }
    };
  }

  // ============================================================
  // GET GOODS RECEIVING SUMMARY BY SUPPLIER - ✅ FIXED
  // ============================================================
  static async getSupplierSummary(companyId, supplierId) {  // ✅ Use companyId instead of userId
    const baseFilter = {
      isActive: true,
      isDeleted: false,
      companyId: companyId,  // ✅ Use companyId
      supplierId: supplierId
    };

    const grns = await prisma.goodsReceiving.findMany({
      where: baseFilter,
      select: {
        id: true,
        grnNumber: true,
        receivingDate: true,
        status: true,
        items: {
          select: {
            receivingQuantity: true,
            productName: true,
            productId: true
          }
        }
      },
      orderBy: {
        receivingDate: 'desc'
      }
    });

    const summary = {
      totalGRNs: grns.length,
      totalItems: 0,
      draftCount: 0,
      partiallyReceivedCount: 0,
      fullyReceivedCount: 0,
      grns: grns
    };

    for (const grn of grns) {
      const itemCount = grn.items.length;
      summary.totalItems += itemCount;

      switch (grn.status) {
        case 'Draft': summary.draftCount++; break;
        case 'Partially Received': summary.partiallyReceivedCount++; break;
        case 'Fully Received': summary.fullyReceivedCount++; break;
      }
    }

    return summary;
  }
}

module.exports = GoodsReceivingModel;