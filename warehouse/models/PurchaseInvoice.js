
const prisma = require('../../prisma/client');
const BalanceCalculator = require('../../utils/balanceCalculator');
const { getOrCreateApAccount } = require('../../utils/apAccountHelper');
const {
  resolveLocationId,
  adjustLocationStock,
} = require('../services/locationService');


function generateInvoiceNumber() {
  const date = new Date();
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const random = Math.floor(Math.random() * 10000).toString().padStart(4, '0');
  return `PI-${year}${month}${day}-${random}`;
}
async function findOrCreateInventoryAccount(tx, companyId, userId) {
  let account = await tx.chartOfAccount.findFirst({
    where: {
      companyId: companyId,
      isActive: true,
      OR: [
        { code: '1300' },
        { code: '1200' },
        { name: { contains: 'Inventory', mode: 'insensitive' } },
        { name: { contains: 'Stock', mode: 'insensitive' } },
        { name: { contains: 'Raw Material', mode: 'insensitive' } }
      ]
    }
  });

  if (!account) {
    account = await tx.chartOfAccount.create({
      data: {
        code: '1300',
        name: 'Inventory',
        type: 'Asset',
        parentAccount: 'Current Assets',
        openingBalance: 0,
        currentBalance: 0,
        balanceType: 'Debit',
        description: 'Inventory Account - Auto-created for Purchase Invoices',
        isActive: true,
        createdBy: userId || 'SYSTEM',
        companyId: companyId
      }
    });
    console.log('✅ Auto-created Inventory Account (1300)');
  }

  return account;
}

async function findOrCreateAPAccount(tx, companyId, userId) {
  return getOrCreateApAccount(userId, companyId, tx);
}
async function findOrCreateSupplier(tx, purchaseOrder, userId, createdBy, companyId) {
  let supplierId = purchaseOrder.supplierId;
  let supplier = null;

  if (supplierId) {
    supplier = await tx.supplier.findUnique({ where: { id: supplierId } });
    if (supplier) return { supplierId, supplier };
    supplierId = null;
  }

  if (purchaseOrder.supplierEmail) {
    supplier = await tx.supplier.findFirst({
      where: { email: purchaseOrder.supplierEmail, companyId, isActive: true }
    });
    if (supplier) {
      await tx.purchaseOrder.update({
        where: { id: purchaseOrder.id },
        data: { supplierId: supplier.id }
      });
      return { supplierId: supplier.id, supplier };
    }
  }

  if (purchaseOrder.supplierPhone) {
    supplier = await tx.supplier.findFirst({
      where: { phone: purchaseOrder.supplierPhone, companyId, isActive: true }
    });
    if (supplier) {
      await tx.purchaseOrder.update({
        where: { id: purchaseOrder.id },
        data: { supplierId: supplier.id }
      });
      return { supplierId: supplier.id, supplier };
    }
  }

  if (purchaseOrder.supplierName) {
    supplier = await tx.supplier.findFirst({
      where: { name: purchaseOrder.supplierName, companyId, isActive: true }
    });
    if (supplier) {
      await tx.purchaseOrder.update({
        where: { id: purchaseOrder.id },
        data: { supplierId: supplier.id }
      });
      return { supplierId: supplier.id, supplier };
    }
  }

  const supplierCode = `SUP-${Date.now()}-${Math.floor(Math.random() * 10000)}`;

  let email = purchaseOrder.supplierEmail;
  if (email) {
    const existingEmail = await tx.supplier.findFirst({
      where: { email, isActive: true }
    });
    if (existingEmail) email = null;
  }

  let phone = purchaseOrder.supplierPhone;
  if (phone) {
    const existingPhone = await tx.supplier.findFirst({
      where: { phone, isActive: true }
    });
    if (existingPhone) phone = null;
  }

  supplier = await tx.supplier.create({
    data: {
      name: purchaseOrder.supplierName || 'Unknown Supplier',
      email,
      phone,
      code: supplierCode,
      companyName: purchaseOrder.supplierCompany || null,
      status: 'active',
      createdBy: createdBy,
      companyId: companyId,
      isActive: true
    }
  });

  await tx.purchaseOrder.update({
    where: { id: purchaseOrder.id },
    data: { supplierId: supplier.id }
  });

  return { supplierId: supplier.id, supplier };
}

async function getConfirmedGrnsForPurchaseOrder(tx, purchaseOrderId, companyId) {
  return tx.goodsReceiving.findMany({
    where: {
      companyId,
      isActive: true,
      isDeleted: false,
      status: { in: ['Partially Received', 'Fully Received'] },
      OR: [
        { purchaseOrderId },
        { purchaseOrders: { some: { purchaseOrderId } } },
      ],
    },
    include: { items: true },
  });
}

async function getReceivedQtyByPoItemId(tx, purchaseOrderId, companyId) {
  const grns = await getConfirmedGrnsForPurchaseOrder(tx, purchaseOrderId, companyId);
  const map = {};
  for (const grn of grns) {
    for (const item of grn.items || []) {
      if (item.purchaseOrderId && item.purchaseOrderId !== purchaseOrderId) continue;
      const poItemId = item.purchaseOrderItemId;
      if (!poItemId) continue;
      map[poItemId] = (map[poItemId] || 0) + Number(item.receivingQuantity || 0);
    }
  }
  return map;
}

async function getInvoicedQtyByPoItemId(
  tx,
  purchaseOrderId,
  companyId,
  excludeInvoiceId = null
) {
  const invoices = await tx.purchaseInvoice.findMany({
    where: {
      purchaseOrderId,
      companyId,
      isActive: true,
      isDeleted: false,
      invoiceStatus: { notIn: ['Cancelled'] },
      ...(excludeInvoiceId ? { id: { not: excludeInvoiceId } } : {}),
    },
    include: { items: true },
  });

  const map = {};
  for (const inv of invoices) {
    for (const item of inv.items || []) {
      const key = item.purchaseOrderItemId || item.productId;
      if (!key) continue;
      map[key] = (map[key] || 0) + Number(item.quantity || 0);
    }
  }
  return map;
}

async function getReturnedQtyByPoItemId(tx, purchaseOrderId, companyId) {
  try {
    const returnItems = await tx.purchaseReturnItem.findMany({
      where: {
        return: {
          companyId,
          isActive: true,
          isDeleted: false,
          status: { in: ['Draft', 'Processed'] },
        },
      },
      select: {
        returnQuantity: true,
        goodsReceivingItem: {
          select: {
            purchaseOrderItemId: true,
            purchaseOrderId: true,
          },
        },
        PurchaseInvoiceItem: {
          select: {
            purchaseOrderItemId: true,
          },
        },
      },
    });

    const map = {};
    for (const item of returnItems) {
      const poItemId =
        item.goodsReceivingItem?.purchaseOrderItemId ||
        item.PurchaseInvoiceItem?.purchaseOrderItemId;
      if (!poItemId) continue;

      const itemPoId = item.goodsReceivingItem?.purchaseOrderId;
      if (purchaseOrderId && itemPoId && itemPoId !== purchaseOrderId) continue;

      map[poItemId] = (map[poItemId] || 0) + Number(item.returnQuantity || 0);
    }
    return map;
  } catch (error) {
    console.warn('⚠️ Could not load returned quantities for PO items:', error?.message);
    return {};
  }
}

function collectPurchaseOrderIdsFromGrn(grn) {
  const ids = new Set();
  if (grn?.purchaseOrderId) ids.add(grn.purchaseOrderId);
  for (const link of grn?.purchaseOrders || []) {
    if (link.purchaseOrderId) ids.add(link.purchaseOrderId);
  }
  for (const item of grn?.items || []) {
    if (item.purchaseOrderId) ids.add(item.purchaseOrderId);
  }
  return [...ids];
}

async function loadPoInvoicingMaps(tx, poId, companyId, excludeInvoiceId = null) {
  const [received, invoiced, returned] = await Promise.all([
    getReceivedQtyByPoItemId(tx, poId, companyId),
    getInvoicedQtyByPoItemId(tx, poId, companyId, excludeInvoiceId),
    getReturnedQtyByPoItemId(tx, poId, companyId),
  ]);
  return { received, invoiced, returned };
}

async function getReturnedQtyByGrnItemId(tx, companyId, grnId = null) {
  try {
    const returnItems = await tx.purchaseReturnItem.findMany({
      where: {
        ...(grnId ? { goodsReceivingItemId: grnId } : {}),
        return: {
          companyId,
          isActive: true,
          isDeleted: false,
          status: { in: ['Draft', 'Processed'] },
        },
      },
      select: {
        goodsReceivingItemId: true,
        returnQuantity: true,
      },
    });

    const map = {};
    for (const item of returnItems) {
      if (!item.goodsReceivingItemId) continue;
      map[item.goodsReceivingItemId] =
        (map[item.goodsReceivingItemId] || 0) + Number(item.returnQuantity || 0);
    }
    return map;
  } catch (error) {
    console.warn('⚠️ Could not load returned quantities for GRN items:', error?.message);
    return {};
  }
}

async function getInvoicedQtyByGrnId(tx, grnId, companyId, excludeInvoiceId = null) {
  const invoices = await tx.purchaseInvoice.findMany({
    where: {
      companyId,
      isActive: true,
      isDeleted: false,
      invoiceStatus: { notIn: ['Cancelled'] },
      ...(excludeInvoiceId ? { id: { not: excludeInvoiceId } } : {}),
      OR: [
        { goodsReceivingId: grnId },
        { sources: { some: { goodsReceivingId: grnId } } },
      ],
    },
    include: { items: true },
  });

  const map = {};
  for (const inv of invoices) {
    for (const item of inv.items || []) {
      const key = item.productId;
      if (!key) continue;
      map[key] = (map[key] || 0) + Number(item.quantity || 0);
    }
  }
  return map;
}

function toBillableGrnLine(meta, qty, receivedMap, invoicedMap, returnedMap, poItemId) {
  const unitPrice =
    meta.purchaseOrderItem?.unitPrice ||
    meta.unitPrice ||
    meta.product?.costPrice ||
    0;
  const discount = meta.purchaseOrderItem?.discount || 0;
  const taxRate = meta.purchaseOrderItem?.taxRate || 0;

  return {
    ...meta,
    receivingQuantity: qty,
    quantity: qty,
    unitPrice,
    discount,
    taxRate,
    totalReceivedOnPoLine: Number(receivedMap[poItemId] || 0),
    totalReturnedOnPoLine: Number(returnedMap[poItemId] || 0),
    previouslyInvoiced: Number(
      invoicedMap[poItemId] || invoicedMap[meta.productId] || 0
    ),
    productName: meta.productName || meta.product?.name,
    sku: meta.sku || meta.product?.sku,
  };
}

async function buildBillableItemsForPoIds(
  tx,
  poIds,
  grnItems,
  companyId,
  excludeInvoiceId = null
) {
  const itemMeta = {};
  for (const item of grnItems || []) {
    if (item.purchaseOrderItemId) {
      itemMeta[item.purchaseOrderItemId] = item;
    }
  }

  const mapsByPo = {};
  await Promise.all(
    poIds.map(async (poId) => {
      mapsByPo[poId] = await loadPoInvoicingMaps(
        tx,
        poId,
        companyId,
        excludeInvoiceId
      );
    })
  );

  const billableItems = [];
  const seenPoItemIds = new Set();

  for (const poId of poIds) {
    const { received, invoiced, returned } = mapsByPo[poId];
    for (const poItemId of Object.keys(received)) {
      if (seenPoItemIds.has(poItemId)) continue;
      const meta = itemMeta[poItemId];
      if (!meta) continue;

      const qty = resolvePoLineInvoiceQuantity(
        poItemId,
        meta.productId,
        received,
        invoiced,
        returned
      );
      if (qty <= 0) continue;

      seenPoItemIds.add(poItemId);
      billableItems.push(
        toBillableGrnLine(meta, qty, received, invoiced, returned, poItemId)
      );
    }
  }

  return billableItems;
}

function resolvePoLineInvoiceQuantity(
  poItemId,
  productId,
  receivedMap,
  invoicedMap,
  returnedMap = {}
) {
  const totalReceived = Number(
    (poItemId && receivedMap[poItemId]) ||
    (productId && receivedMap[productId]) ||
    0
  );
  const totalReturned = Number(
    (poItemId && returnedMap[poItemId]) ||
    (productId && returnedMap[productId]) ||
    0
  );
  const alreadyInvoiced = Number(
    (poItemId && invoicedMap[poItemId]) ||
    (productId && invoicedMap[productId]) ||
    0
  );
  const netReceived = Math.max(0, totalReceived - totalReturned);
  return Math.max(0, netReceived - alreadyInvoiced);
}

async function buildGrnInvoicingContext(tx, grn, companyId, excludeInvoiceId = null) {
  const poIds = collectPurchaseOrderIdsFromGrn(grn);
  if (!poIds.length) {
    const [returnedByGrnItem, invoicedByGrnId] = await Promise.all([
      getReturnedQtyByGrnItemId(tx, companyId, grn.id),
      getInvoicedQtyByGrnId(tx, grn.id, companyId, excludeInvoiceId),
    ]);
    const qtyByGrnItemId = {};
    for (const item of grn.items || []) {
      const received = Number(item.receivingQuantity) || 0;
      const returned = Number(returnedByGrnItem[item.id] || 0);
      const invoiced = Number(invoicedByGrnId[item.productId] || 0);
      qtyByGrnItemId[item.id] = Math.max(0, received - returned - invoiced);
    }
    return { qtyByGrnItemId, receivedMap: {}, invoicedMap: invoicedByGrnId, returnedMap: {} };
  }

  const mapsByPo = {};
  await Promise.all(
    poIds.map(async (poId) => {
      mapsByPo[poId] = await loadPoInvoicingMaps(
        tx,
        poId,
        companyId,
        excludeInvoiceId
      );
    })
  );

  const qtyByGrnItemId = {};
  for (const item of grn.items || []) {
    const itemPoId = item.purchaseOrderId || grn.purchaseOrderId;
    const maps = itemPoId ? mapsByPo[itemPoId] : null;
    qtyByGrnItemId[item.id] = maps
      ? resolvePoLineInvoiceQuantity(
        item.purchaseOrderItemId,
        item.productId,
        maps.received,
        maps.invoiced,
        maps.returned
      )
      : Math.max(0, Number(item.receivingQuantity) || 0);
  }

  const primaryMaps = mapsByPo[grn.purchaseOrderId] || mapsByPo[poIds[0]] || {
    received: {},
    invoiced: {},
    returned: {},
  };

  return {
    qtyByGrnItemId,
    receivedMap: primaryMaps.received,
    invoicedMap: primaryMaps.invoiced,
    returnedMap: primaryMaps.returned,
  };
}

function buildInvoiceLineFromGrnItem(item, quantity) {
  const unitPrice =
    item.purchaseOrderItem?.unitPrice ??
    item.unitPrice ??
    item.product?.costPrice ??
    0;
  const lineTotal = quantity * unitPrice;
  const discount = item.purchaseOrderItem?.discount || 0;
  const taxRate = item.purchaseOrderItem?.taxRate || 0;
  const discountAmount = (lineTotal * discount) / 100;
  const taxableAmount = lineTotal - discountAmount;
  const taxAmount = (taxableAmount * taxRate) / 100;
  const total = taxableAmount + taxAmount;

  return {
    productId: item.productId,
    productName: item.productName,
    sku: item.sku,
    quantity,
    unitPrice,
    discount,
    taxRate,
    taxAmount,
    lineTotal: total,
    notes: item.notes || null,
    purchaseOrderItemId: item.purchaseOrderItemId || null,
    _subtotal: lineTotal,
    _discountAmount: discountAmount,
  };
}

async function buildInvoiceItemsFromGrns(
  tx,
  grns,
  companyId,
  excludeInvoiceId = null
) {
  const invoiceItems = [];
  const seenPoItemIds = new Set();

  for (const grn of grns) {
    const poIds = collectPurchaseOrderIdsFromGrn(grn);

    if (poIds.length > 0) {
      const billableItems = await buildBillableItemsForPoIds(
        tx,
        poIds,
        grn.items,
        companyId,
        excludeInvoiceId
      );

      for (const item of billableItems) {
        const poItemId = item.purchaseOrderItemId;
        if (poItemId && seenPoItemIds.has(poItemId)) continue;
        if (poItemId) seenPoItemIds.add(poItemId);

        const line = buildInvoiceLineFromGrnItem(item, item.quantity);
        invoiceItems.push({
          productId: line.productId,
          productName: line.productName,
          sku: line.sku,
          quantity: line.quantity,
          unitPrice: line.unitPrice,
          discount: line.discount,
          taxRate: line.taxRate,
          taxAmount: line.taxAmount,
          lineTotal: line.lineTotal,
          notes: line.notes,
          purchaseOrderItemId: line.purchaseOrderItemId,
        });
      }
      continue;
    }

    const [returnedByGrnItem, invoicedByGrnId] = await Promise.all([
      getReturnedQtyByGrnItemId(tx, companyId, grn.id),
      getInvoicedQtyByGrnId(tx, grn.id, companyId, excludeInvoiceId),
    ]);
    for (const item of grn.items || []) {
      const received = Number(item.receivingQuantity) || 0;
      const returned = Number(returnedByGrnItem[item.id] || 0);
      const invoiced = Number(invoicedByGrnId[item.productId] || 0);
      const quantity = Math.max(0, received - returned - invoiced);
      if (quantity <= 0) continue;

      const line = buildInvoiceLineFromGrnItem(item, quantity);
      invoiceItems.push({
        productId: line.productId,
        productName: line.productName,
        sku: line.sku,
        quantity: line.quantity,
        unitPrice: line.unitPrice,
        discount: line.discount,
        taxRate: line.taxRate,
        taxAmount: line.taxAmount,
        lineTotal: line.lineTotal,
        notes: line.notes,
        purchaseOrderItemId: line.purchaseOrderItemId,
      });
    }
  }

  return invoiceItems;
}

async function applyPurchaseInvoiceStockIn(tx, invoice, userId) {
  const alreadyMoved = await tx.stockMovement.count({
    where: {
      companyId: invoice.companyId,
      reference: invoice.invoiceNumber,
      type: { in: ['stock_in', 'Purchase Invoice'] }
    }
  });
  if (alreadyMoved > 0) return;

  const receivedByProduct = {};
  if (invoice.purchaseOrderId) {
    const grns = await tx.goodsReceiving.findMany({
      where: {
        purchaseOrderId: invoice.purchaseOrderId,
        companyId: invoice.companyId,
        isActive: true,
        isDeleted: false,
        OR: [
          { confirmedAt: { not: null } },
          { status: { in: ['Partially Received', 'Fully Received'] } },
        ],
      },
      include: { items: true }
    });
    for (const grn of grns) {
      for (const gi of grn.items || []) {
        if (!gi.productId) continue;
        receivedByProduct[gi.productId] =
          (receivedByProduct[gi.productId] || 0) + Number(gi.receivingQuantity || 0);
      }
    }
  }

  for (const item of invoice.items || []) {
    if (!item.productId) continue;
    const ordered = Math.round(Number(item.quantity) || 0);
    if (ordered <= 0) continue;

    const alreadyReceived = receivedByProduct[item.productId] || 0;
    const addQty = Math.max(0, ordered - alreadyReceived);
    receivedByProduct[item.productId] = Math.max(0, alreadyReceived - ordered);
    if (addQty <= 0) continue;

    const product = await tx.product.findFirst({
      where: { id: item.productId, companyId: invoice.companyId }
    });
    if (!product) continue;

    let purchaseLocationId = invoice.locationId || null;
    if (!purchaseLocationId && invoice.purchaseOrderId) {
      const po = await tx.purchaseOrder.findUnique({
        where: { id: invoice.purchaseOrderId },
        select: { locationId: true },
      });
      purchaseLocationId = po?.locationId || null;
    }

    const locationId = await resolveLocationId(
      tx,
      invoice.companyId,
      purchaseLocationId,
      userId
    );

    const adj = await adjustLocationStock(tx, {
      companyId: invoice.companyId,
      productId: product.id,
      locationId,
      delta: addQty,
      productName: product.name,
    });

    await tx.stockMovement.create({
      data: {
        productId: product.id,
        productName: item.productName || product.name,
        type: 'stock_in',
        quantity: addQty,
        previousStock: adj.previousLocationStock,
        newStock: adj.newLocationStock,
        stockType: 'bulk',
        reason: `Purchase Invoice #${invoice.invoiceNumber}`,
        reference: invoice.invoiceNumber,
        status: 'Completed',
        createdBy: userId || invoice.createdBy || 'SYSTEM',
        companyId: invoice.companyId,
        locationId,
        supplierId: invoice.supplierId || null,
        supplierName: invoice.supplierName || null
      }
    });
  }
}

class PurchaseInvoiceModel {
  static async createFromGRN(data) {
    const invoiceNumber = generateInvoiceNumber();

    const invoice = await prisma.$transaction(async (tx) => {
      const grn = await tx.goodsReceiving.findFirst({
        where: {
          id: data.goodsReceivingId,
          companyId: data.companyId,
          isActive: true,
          isDeleted: false,
          status: { in: ['Partially Received', 'Fully Received'] }
        },
        include: {
          items: {
            include: {
              product: true,
              purchaseOrderItem: true
            }
          },
          purchaseOrder: {
            include: { supplier: true }
          },
          supplier: true
        }
      });

      if (!grn) {
        throw new Error('Goods receiving not found or not confirmed');
      }

      const existingInvoice = await tx.purchaseInvoice.findFirst({
        where: {
          isActive: true,
          isDeleted: false,
          invoiceStatus: { notIn: ['Cancelled'] },
          OR: [
            { goodsReceivingId: data.goodsReceivingId },
            ...(grn.purchaseOrderId
              ? [{ purchaseOrderId: grn.purchaseOrderId }]
              : []),
          ],
        },
      });

      if (existingInvoice) {
        throw new Error(
          grn.purchaseOrderId
            ? 'Invoice already exists for this purchase order / goods receiving'
            : 'Invoice already exists for this goods receiving'
        );
      }

      const relatedGrns = grn.purchaseOrderId
        ? await tx.goodsReceiving.findMany({
          where: {
            companyId: data.companyId,
            isActive: true,
            isDeleted: false,
            status: { in: ['Partially Received', 'Fully Received'] },
            OR: [
              { purchaseOrderId: grn.purchaseOrderId },
              {
                purchaseOrders: {
                  some: { purchaseOrderId: grn.purchaseOrderId },
                },
              },
            ],
          },
          include: {
            items: {
              include: {
                product: true,
                purchaseOrderItem: true,
              },
            },
          },
        })
        : [grn];

      let subtotal = 0;
      let totalDiscount = 0;
      let totalTax = 0;
      const invoiceItems = [];

      const builtItems = await buildInvoiceItemsFromGrns(
        tx,
        relatedGrns.length ? relatedGrns : [grn],
        data.companyId
      );

      for (const line of builtItems) {
        subtotal += line.quantity * line.unitPrice;
        totalDiscount += (line.quantity * line.unitPrice * (line.discount || 0)) / 100;
        totalTax += line.taxAmount || 0;
        invoiceItems.push(line);
      }

      if (!invoiceItems.length) {
        throw new Error(
          'No received quantity left to invoice for this goods receiving'
        );
      }

      const grandTotal = subtotal - totalDiscount + totalTax;
      const grnsForSource = relatedGrns.length ? relatedGrns : [grn];
      const linkedGrnNumbers = grnsForSource.map((g) => g.grnNumber).join(', ');

      const { supplierId, supplier } = await findOrCreateSupplier(
        tx,
        grn.purchaseOrder,
        data.userId,
        data.createdBy,
        data.companyId
      );

      const inventoryAccount = await findOrCreateInventoryAccount(
        tx,
        data.companyId,
        data.userId
      );
      const apAccount = await findOrCreateAPAccount(
        tx,
        data.companyId,
        data.userId
      );
      const invoice = await tx.purchaseInvoice.create({
        data: {
          invoiceNumber,
          supplierId: supplierId,
          supplierName: supplier?.name || grn.supplierName,
          supplierEmail: supplier?.email || grn.supplier?.email || null,
          supplierPhone: supplier?.phone || grn.supplier?.phone || null,
          supplierInvoiceNo: data.supplierInvoiceNo || null,
          purchaseOrderId: grn.purchaseOrderId,
          purchaseOrderNumber: grn.purchaseOrder?.orderNumber || grn.purchaseOrderNumber || null,
          goodsReceivingId: grn.id,
          grnNumber: linkedGrnNumbers,
          sourceSummary: linkedGrnNumbers,
          invoiceDate: new Date(data.invoiceDate || Date.now()),
          dueDate: new Date(data.dueDate || Date.now() + 30 * 24 * 60 * 60 * 1000),
          paymentTerms: data.paymentTerms || 'Net 30',
          subtotal: subtotal,
          discountTotal: totalDiscount,
          taxTotal: totalTax,
          grandTotal: grandTotal,
          paidAmount: 0,
          outstanding: grandTotal,
          invoiceStatus: 'Draft',
          paymentStatus: 'Unpaid',
          notes: data.notes || null,
          inventoryAccountId: inventoryAccount.id,
          apAccountId: apAccount.id,
          createdBy: data.createdBy,
          companyId: data.companyId,
          fiscalYearId: data.fiscalYearId,
          locationId: data.locationId || grn.locationId || null,
          items: { create: invoiceItems },
          sources: {
            create: grnsForSource.map((g) => ({
              sourceType: 'GRN',
              goodsReceivingId: g.id,
              purchaseOrderId: g.purchaseOrderId,
              sourceNumber: g.grnNumber,
            })),
          },
        },
        include: {
          items: { include: { product: true } },
          supplier: true,
          purchaseOrder: true,
          goodsReceiving: true,
          sources: true,
        }
      });

      return {
        ...invoice,
        canEdit: true,
        canPost: true,
      };
    });
    if (data.autoPost) {
      return await this.postInvoice(invoice.id, data.createdBy || data.userId);
    }
    return invoice;
  }

  static async createFromSources(data) {
    const invoiceNumber = generateInvoiceNumber();
    const goodsReceivingIds = [...new Set((data.goodsReceivingIds || []).filter(Boolean))];
    const purchaseOrderIds = [...new Set((data.purchaseOrderIds || []).filter(Boolean))];

    if (!goodsReceivingIds.length && !purchaseOrderIds.length) {
      throw new Error('Select at least one GRN or purchase order');
    }

    return prisma.$transaction(async (tx) => {
      const grns = goodsReceivingIds.length
        ? await tx.goodsReceiving.findMany({
          where: {
            id: { in: goodsReceivingIds },
            companyId: data.companyId,
            isActive: true,
            isDeleted: false,
            status: { in: ['Partially Received', 'Fully Received'] },
          },
          include: {
            items: { include: { product: true, purchaseOrderItem: true } },
            purchaseOrder: { include: { supplier: true } },
            supplier: true,
          },
        })
        : [];

      if (grns.length !== goodsReceivingIds.length) {
        throw new Error('One or more GRNs were not found or not confirmed');
      }

      const pos = purchaseOrderIds.length
        ? await tx.purchaseOrder.findMany({
          where: {
            id: { in: purchaseOrderIds },
            companyId: data.companyId,
            isActive: true,
            isDeleted: false,
            status: { not: 'Cancelled' },
          },
          include: { items: { include: { product: true } }, supplier: true },
        })
        : [];

      if (pos.length !== purchaseOrderIds.length) {
        throw new Error('One or more purchase orders were not found or cancelled');
      }

      const supplierIds = [
        ...new Set([
          ...grns.map((g) => g.supplierId),
          ...pos.map((p) => p.supplierId),
        ]),
      ];
      if (supplierIds.length !== 1) {
        throw new Error('All selected documents must belong to the same supplier');
      }

      for (const grn of grns) {
        const existing = await tx.purchaseInvoice.findFirst({
          where: {
            isActive: true,
            isDeleted: false,
            OR: [
              { goodsReceivingId: grn.id },
              { sources: { some: { goodsReceivingId: grn.id } } },
            ],
          },
        });
        if (existing) {
          throw new Error(`Invoice already exists for GRN ${grn.grnNumber}`);
        }
      }

      const primary = grns[0] || pos[0];
      const { supplierId, supplier } = await findOrCreateSupplier(
        tx,
        primary.purchaseOrder || primary,
        data.userId,
        data.createdBy,
        data.companyId
      );

      let invoiceItems = [];
      if (data.items?.length) {
        // Validate manually supplied item quantities against net billable GRN/PO quantities
        if (grns.length > 0) {
          const allPoIds = [
            ...new Set(grns.flatMap((grn) => collectPurchaseOrderIdsFromGrn(grn))),
          ];
          const mapsByPo = {};
          await Promise.all(
            allPoIds.map(async (poId) => {
              mapsByPo[poId] = await loadPoInvoicingMaps(
                tx,
                poId,
                data.companyId
              );
            })
          );

          const poItemToPoId = {};
          for (const grn of grns) {
            for (const grnItem of grn.items || []) {
              if (grnItem.purchaseOrderItemId) {
                poItemToPoId[grnItem.purchaseOrderItemId] =
                  grnItem.purchaseOrderId || grn.purchaseOrderId;
              }
            }
          }

          for (const item of data.items) {
            let maxBillable = 0;
            if (item.purchaseOrderItemId) {
              const poId =
                poItemToPoId[item.purchaseOrderItemId] || grns[0]?.purchaseOrderId;
              const maps = poId ? mapsByPo[poId] : null;
              if (maps) {
                maxBillable = resolvePoLineInvoiceQuantity(
                  item.purchaseOrderItemId,
                  item.productId,
                  maps.received,
                  maps.invoiced,
                  maps.returned
                );
              }
            } else if (grns.length > 0) {
              const grn =
                grns.find((g) =>
                  (g.items || []).some((gi) => gi.productId === item.productId)
                ) || grns[0];
              if (grn) {
                const grnItem = (grn.items || []).find(
                  (gi) => gi.productId === item.productId
                );
                const [returnedByGrnItem, invoicedByGrnId] = await Promise.all([
                  getReturnedQtyByGrnItemId(tx, data.companyId, grn.id),
                  getInvoicedQtyByGrnId(tx, grn.id, data.companyId),
                ]);
                const received = Number(grnItem?.receivingQuantity) || 0;
                const returned = Number(returnedByGrnItem[grnItem?.id] || 0);
                const invoiced = Number(invoicedByGrnId[item.productId] || 0);
                maxBillable = Math.max(0, received - returned - invoiced);
              }
            }

            if (maxBillable > 0 && item.quantity > maxBillable) {
              throw new Error(
                `Invoice quantity (${item.quantity}) cannot exceed received quantity (${maxBillable}) for ${item.productName || 'product'}`
              );
            }
          }
        }

        invoiceItems = data.items.map((item) => {
          const lineTotal = item.quantity * item.unitPrice;
          const discountAmount = (lineTotal * (item.discount || 0)) / 100;
          const taxableAmount = lineTotal - discountAmount;
          const taxAmount = (taxableAmount * (item.taxRate || 0)) / 100;
          return {
            productId: item.productId,
            productName: item.productName,
            sku: item.sku,
            quantity: item.quantity,
            unitPrice: item.unitPrice,
            discount: item.discount || 0,
            taxRate: item.taxRate || 0,
            taxAmount,
            lineTotal: taxableAmount + taxAmount,
            notes: item.notes || null,
            purchaseOrderItemId: item.purchaseOrderItemId || null,
          };
        });
      } else {
        invoiceItems.push(
          ...(await buildInvoiceItemsFromGrns(tx, grns, data.companyId))
        );
        for (const po of pos) {
          for (const item of po.items) {
            const lineTotal = item.quantity * item.unitPrice;
            const discountAmount = (lineTotal * (item.discount || 0)) / 100;
            const taxableAmount = lineTotal - discountAmount;
            const taxAmount = (taxableAmount * (item.taxRate || 0)) / 100;
            invoiceItems.push({
              productId: item.productId,
              productName: item.productName,
              sku: item.sku,
              quantity: item.quantity,
              unitPrice: item.unitPrice,
              discount: item.discount || 0,
              taxRate: item.taxRate || 0,
              taxAmount,
              lineTotal: taxableAmount + taxAmount,
              notes: item.notes || null,
              purchaseOrderItemId: item.id,
            });
          }
        }
      }

      if (!invoiceItems.length) {
        throw new Error('Invoice must have at least one item');
      }

      let subtotal = 0;
      let totalDiscount = 0;
      let totalTax = 0;
      for (const item of invoiceItems) {
        const line = item.quantity * item.unitPrice;
        const disc = (line * (item.discount || 0)) / 100;
        subtotal += line;
        totalDiscount += disc;
        totalTax += item.taxAmount || 0;
      }
      const grandTotal = subtotal - totalDiscount + totalTax;

      const inventoryAccount = await findOrCreateInventoryAccount(tx, data.companyId, data.userId);
      const apAccount = await findOrCreateAPAccount(tx, data.companyId, data.userId);

      const sourceSummary = [
        ...grns.map((g) => g.grnNumber),
        ...pos.map((p) => p.orderNumber),
      ].join(', ');

      const invoice = await tx.purchaseInvoice.create({
        data: {
          invoiceNumber,
          supplierId,
          supplierName: supplier?.name || primary.supplierName,
          supplierEmail: supplier?.email || null,
          supplierPhone: supplier?.phone || null,
          supplierInvoiceNo: data.supplierInvoiceNo || null,
          purchaseOrderId: pos[0]?.id || grns[0]?.purchaseOrderId || null,
          purchaseOrderNumber:
            pos[0]?.orderNumber || grns[0]?.purchaseOrderNumber || null,
          goodsReceivingId: grns[0]?.id || null,
          grnNumber: grns[0]?.grnNumber || null,
          sourceSummary,
          invoiceDate: new Date(data.invoiceDate || Date.now()),
          dueDate: new Date(data.dueDate || Date.now() + 30 * 24 * 60 * 60 * 1000),
          paymentTerms: data.paymentTerms || 'Net 30',
          subtotal,
          discountTotal: totalDiscount,
          taxTotal: totalTax,
          grandTotal,
          paidAmount: 0,
          outstanding: grandTotal,
          invoiceStatus: 'Draft',
          paymentStatus: 'Unpaid',
          notes: data.notes || null,
          inventoryAccountId: inventoryAccount.id,
          apAccountId: apAccount.id,
          createdBy: data.createdBy,
          companyId: data.companyId,
          fiscalYearId: data.fiscalYearId,
          locationId: data.locationId || primary.locationId || null,
          items: { create: invoiceItems },
          sources: {
            create: [
              ...grns.map((g) => ({
                sourceType: 'GRN',
                goodsReceivingId: g.id,
                purchaseOrderId: g.purchaseOrderId,
                sourceNumber: g.grnNumber,
              })),
              ...pos.map((p) => ({
                sourceType: 'PO',
                purchaseOrderId: p.id,
                sourceNumber: p.orderNumber,
              })),
            ],
          },
        },
        include: {
          items: { include: { product: true } },
          supplier: true,
          purchaseOrder: true,
          goodsReceiving: true,
          sources: true,
        },
      });

      return {
        ...invoice,
        canEdit: true,
        canPost: true,
      };
    });
  }

  static async createFromPurchaseOrder(data) {
    const invoiceNumber = generateInvoiceNumber();

    const invoice = await prisma.$transaction(async (tx) => {
      const purchaseOrder = await tx.purchaseOrder.findFirst({
        where: {
          id: data.purchaseOrderId,
          companyId: data.companyId,
          isActive: true,
          isDeleted: false,
          status: { not: 'Cancelled' }
        },
        include: {
          items: { include: { product: true } },
          supplier: true,
          goodsReceivings: {
            where: {
              isActive: true,
              isDeleted: false,
              status: { in: ['Partially Received', 'Fully Received'] }
            },
            include: { items: true }
          }
        }
      });

      if (!purchaseOrder) {
        throw new Error('Purchase order not found');
      }

      const receivedQty = await getReceivedQtyByPoItemId(
        tx,
        data.purchaseOrderId,
        data.companyId
      );

      const existingInvoice = await tx.purchaseInvoice.findFirst({
        where: {
          purchaseOrderId: data.purchaseOrderId,
          isActive: true,
          isDeleted: false
        }
      });

      if (existingInvoice) {
        throw new Error('Invoice already exists for this purchase order');
      }

      const { supplierId, supplier } = await findOrCreateSupplier(
        tx,
        purchaseOrder,
        data.userId,
        data.createdBy,
        data.companyId
      );

      let subtotal = 0;
      let totalDiscount = 0;
      let totalTax = 0;

      const invoiceItems = purchaseOrder.items
        .map(item => {
          const receivedQuantity = receivedQty[item.id] || 0;
          const quantity =
            receivedQuantity > 0 ? receivedQuantity : item.quantity || 0;
          if (quantity === 0) return null;

          const unitPrice = item.unitPrice;
          const lineTotal = quantity * unitPrice;
          const discountAmount = (lineTotal * (item.discount || 0)) / 100;
          const taxableAmount = lineTotal - discountAmount;
          const taxAmount = (taxableAmount * (item.taxRate || 0)) / 100;
          const total = taxableAmount + taxAmount;

          subtotal += lineTotal;
          totalDiscount += discountAmount;
          totalTax += taxAmount;

          return {
            productId: item.productId,
            productName: item.productName,
            sku: item.sku,
            quantity: quantity,
            unitPrice: unitPrice,
            discount: item.discount || 0,
            taxRate: item.taxRate || 0,
            taxAmount: taxAmount,
            lineTotal: total,
            notes: item.notes || null,
            purchaseOrderItemId: item.id,
          };
        })
        .filter(item => item !== null);

      if (invoiceItems.length === 0) {
        throw new Error('Purchase order has no items to invoice');
      }

      const grandTotal = subtotal - totalDiscount + totalTax;

      const inventoryAccount = await findOrCreateInventoryAccount(
        tx,
        data.companyId,
        data.userId
      );
      const apAccount = await findOrCreateAPAccount(
        tx,
        data.companyId,
        data.userId
      );

      const invoice = await tx.purchaseInvoice.create({
        data: {
          invoiceNumber,
          supplierId: supplierId,
          supplierName: supplier?.name || purchaseOrder.supplierName,
          supplierEmail: supplier?.email || purchaseOrder.supplierEmail || null,
          supplierPhone: supplier?.phone || purchaseOrder.supplierPhone || null,
          supplierInvoiceNo: data.supplierInvoiceNo || null,
          purchaseOrderId: purchaseOrder.id,
          purchaseOrderNumber: purchaseOrder.orderNumber,
          goodsReceivingId: null,
          grnNumber: null,
          sourceSummary: purchaseOrder.orderNumber,
          invoiceDate: new Date(data.invoiceDate || Date.now()),
          dueDate: new Date(data.dueDate || Date.now() + 30 * 24 * 60 * 60 * 1000),
          paymentTerms: data.paymentTerms || 'Net 30',
          subtotal: subtotal,
          discountTotal: totalDiscount,
          taxTotal: totalTax,
          grandTotal: grandTotal,
          paidAmount: 0,
          outstanding: grandTotal,
          invoiceStatus: 'Draft',
          paymentStatus: 'Unpaid',
          notes: data.notes || null,
          inventoryAccountId: inventoryAccount.id,
          apAccountId: apAccount.id,
          createdBy: data.createdBy,
          companyId: data.companyId,
          fiscalYearId: data.fiscalYearId,
          locationId: data.locationId || purchaseOrder.locationId || null,
          items: { create: invoiceItems },
          sources: {
            create: [
              {
                sourceType: 'PO',
                purchaseOrderId: purchaseOrder.id,
                sourceNumber: purchaseOrder.orderNumber,
              },
            ],
          },
        },
        include: {
          items: { include: { product: true } },
          supplier: true,
          purchaseOrder: true,
          sources: true,
        }
      });

      return {
        ...invoice,
        canEdit: true,
        canPost: true,
      };
    });

    if (data.autoPost) {
      return await this.postInvoice(invoice.id, data.createdBy || data.userId);
    }
    return invoice;
  }

  static async postInvoice(invoiceId, userId) {
    return await prisma.$transaction(async (tx) => {
      const invoice = await tx.purchaseInvoice.findUnique({
        where: { id: invoiceId },
        include: {
          items: true,
          supplier: true,
          inventoryAccount: true,
          apAccount: true
        }
      });

      if (!invoice) throw new Error('Invoice not found');
      if (invoice.invoiceStatus === 'Posted') throw new Error('Invoice already posted');
      if (invoice.invoiceStatus === 'Cancelled') throw new Error('Cannot post cancelled invoice');

      const inventoryAccount = await findOrCreateInventoryAccount(
        tx,
        invoice.companyId,
        userId
      );
      const apAccount = await findOrCreateAPAccount(
        tx,
        invoice.companyId,
        userId
      );

      await tx.purchaseInvoice.update({
        where: { id: invoiceId },
        data: {
          inventoryAccountId: inventoryAccount.id,
          apAccountId: apAccount.id
        }
      });

      const entryNumber = `JE-${Date.now()}-${Math.floor(Math.random() * 10000)}`;

      const journalEntry = await tx.journalEntry.create({
        data: {
          entryNumber,
          date: new Date(),
          description: `Purchase Invoice #${invoice.invoiceNumber} from ${invoice.supplierName}`,
          reference: invoice.invoiceNumber,
          status: 'Posted',
          createdBy: userId,
          postedBy: userId,
          postedAt: new Date(),
          companyId: invoice.companyId,
          fiscalYearId: invoice.fiscalYearId,
          lines: {
            create: [
              {
                accountId: inventoryAccount.id,
                accountName: inventoryAccount.name,
                accountCode: inventoryAccount.code,
                debit: invoice.grandTotal,
                credit: 0
              },
              {
                accountId: apAccount.id,
                accountName: apAccount.name,
                accountCode: apAccount.code,
                debit: 0,
                credit: invoice.grandTotal
              }
            ]
          }
        },
        include: { lines: true }
      });

      // Sync COA balances with posted purchase invoice JE
      await BalanceCalculator.applyJournalLines(tx, journalEntry.lines);

      await applyPurchaseInvoiceStockIn(tx, invoice, userId);

      const apRecord = await tx.accountsPayable.create({
        data: {
          invoiceId: invoice.id,
          invoiceNumber: invoice.invoiceNumber,
          supplierId: invoice.supplierId,
          supplierName: invoice.supplierName,
          amount: invoice.grandTotal,
          paidAmount: 0,
          outstanding: invoice.grandTotal,
          dueDate: invoice.dueDate,
          status: 'Current',
          accountId: apAccount.id,
          companyId: invoice.companyId,
          fiscalYearId: invoice.fiscalYearId,
          notes: `Created from invoice #${invoice.invoiceNumber}`
        }
      });

      const updatedInvoice = await tx.purchaseInvoice.update({
        where: { id: invoiceId },
        data: {
          invoiceStatus: 'Posted',
          postedAt: new Date(),
          accountsPayableId: apRecord.id,
          journalEntryId: journalEntry.id,
          updatedBy: userId
        },
        include: {
          items: { include: { product: true } },
          supplier: true,
          journalEntry: {
            include: { lines: { include: { account: true } } }
          },
          accountsPayable: true
        }
      });

      return updatedInvoice;
    });
  }

  // ============================================================
  // GET INVOICE BY ID
  // ============================================================
  static async findById(id) {
    return await prisma.purchaseInvoice.findUnique({
      where: { id },
      include: {
        items: {
          include: {
            product: {
              select: { id: true, name: true, sku: true, costPrice: true }
            }
          }
        },
        supplier: true,
        purchaseOrder: { include: { supplier: true } },
        goodsReceiving: { include: { items: true } },
        creator: { select: { id: true, firstName: true, lastName: true, email: true } },
        updater: { select: { id: true, firstName: true, lastName: true, email: true } },
        journalEntry: {
          include: { lines: { include: { account: true } } }
        },
        accountsPayable: { include: { payments: true } },
        inventoryAccount: true,
        apAccount: true
      }
    });
  }

  // ============================================================
  // GET INVOICE BY NUMBER
  // ============================================================
  static async findByInvoiceNumber(invoiceNumber) {
    return await prisma.purchaseInvoice.findUnique({
      where: { invoiceNumber },
      include: {
        items: { include: { product: true } },
        supplier: true,
        journalEntry: {
          include: { lines: { include: { account: true } } }
        },
        accountsPayable: { include: { payments: true } }
      }
    });
  }

  // ============================================================
  // GET ALL INVOICES WITH FILTERS
  // ============================================================
  static async findAll(filter = {}, options = {}) {
    const { skip, take, orderBy = { invoiceDate: 'desc' } } = options;

    const cleanFilter = { ...filter };
    if (cleanFilter.userId) {
      cleanFilter.createdBy = cleanFilter.userId;
      delete cleanFilter.userId;
    }

    return await prisma.purchaseInvoice.findMany({
      where: { ...cleanFilter, isActive: true, isDeleted: false },
      skip,
      take,
      orderBy,
      include: {
        items: {
          include: {
            product: { select: { id: true, name: true, sku: true } }
          }
        },
        supplier: true,
        sources: true,
        purchaseOrder: { select: { id: true, orderNumber: true, status: true } },
        goodsReceiving: { select: { id: true, grnNumber: true, status: true } },
        creator: { select: { id: true, firstName: true, lastName: true, email: true } },
        accountsPayable: { include: { payments: true } }
      }
    }).then((invoices) =>
      invoices.map((invoice) => {
        const isDraft = invoice.invoiceStatus === 'Draft';
        return {
          ...invoice,
          canEdit: isDraft,
          canPost: isDraft,
          canCancel: ['Posted', 'Partially Paid'].includes(invoice.invoiceStatus),
          canDelete: isDraft,
          totalItems: invoice.items?.length || 0,
        };
      })
    );
  }

  // ============================================================
  // COUNT INVOICES - ✅ FIXED
  // ============================================================
  static async count(filter = {}) {
    const cleanFilter = { ...filter };
    if (cleanFilter.userId) {
      cleanFilter.createdBy = cleanFilter.userId;
      delete cleanFilter.userId;
    }

    return await prisma.purchaseInvoice.count({
      where: { ...cleanFilter, isActive: true, isDeleted: false }
    });
  }

  // ============================================================
  // UPDATE INVOICE (Draft only)
  // ============================================================
  static async update(id, data) {
    return await prisma.$transaction(async (tx) => {
      const invoice = await tx.purchaseInvoice.findUnique({
        where: { id },
        include: { items: true }
      });

      if (!invoice) throw new Error('Invoice not found');
      if (invoice.invoiceStatus === 'Posted') throw new Error('Cannot update posted invoice');
      if (invoice.invoiceStatus === 'Cancelled') throw new Error('Cannot update cancelled invoice');

      const updateData = {
        updatedBy: data.updatedBy,
        ...(data.supplierInvoiceNo !== undefined && { supplierInvoiceNo: data.supplierInvoiceNo }),
        ...(data.invoiceDate && { invoiceDate: new Date(data.invoiceDate) }),
        ...(data.dueDate && { dueDate: new Date(data.dueDate) }),
        ...(data.paymentTerms && { paymentTerms: data.paymentTerms }),
        ...(data.notes !== undefined && { notes: data.notes }),
        ...(data.status && { invoiceStatus: data.status })
      };

      if (data.items) {
        await tx.purchaseInvoiceItem.deleteMany({ where: { invoiceId: id } });

        let subtotal = 0, totalDiscount = 0, totalTax = 0;

        const invoiceItems = data.items.map(item => {
          const lineTotal = item.quantity * item.unitPrice;
          const discountAmount = (lineTotal * (item.discount || 0)) / 100;
          const taxableAmount = lineTotal - discountAmount;
          const taxAmount = (taxableAmount * (item.taxRate || 0)) / 100;
          const total = taxableAmount + taxAmount;
          subtotal += lineTotal;
          totalDiscount += discountAmount;
          totalTax += taxAmount;
          return {
            productId: item.productId,
            productName: item.productName,
            sku: item.sku,
            quantity: item.quantity,
            unitPrice: item.unitPrice,
            discount: item.discount || 0,
            taxRate: item.taxRate || 0,
            taxAmount: taxAmount,
            lineTotal: total,
            notes: item.notes || null
          };
        });

        const grandTotal = subtotal - totalDiscount + totalTax;
        updateData.subtotal = subtotal;
        updateData.discountTotal = totalDiscount;
        updateData.taxTotal = totalTax;
        updateData.grandTotal = grandTotal;
        updateData.outstanding = grandTotal - invoice.paidAmount;
        updateData.items = { create: invoiceItems };
      }

      return await tx.purchaseInvoice.update({
        where: { id },
        data: updateData,
        include: {
          items: { include: { product: true } },
          supplier: true
        }
      });
    });
  }

  // ============================================================
  // CANCEL INVOICE
  // ============================================================
  static async cancelInvoice(id, userId, reason = '') {
    return await prisma.$transaction(async (tx) => {
      const invoice = await tx.purchaseInvoice.findUnique({
        where: { id },
        include: {
          items: true,
          accountsPayable: true,
          journalEntry: { include: { lines: true } }
        }
      });

      if (!invoice) throw new Error('Invoice not found');
      if (invoice.invoiceStatus === 'Cancelled') throw new Error('Invoice already cancelled');
      if (invoice.invoiceStatus === 'Posted' && invoice.paidAmount > 0) {
        throw new Error('Cannot cancel invoice with payments');
      }

      if (invoice.invoiceStatus === 'Posted') {
        if (invoice.journalEntry) {
          const reverseEntryNumber = `REV-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
          const reverseEntry = await tx.journalEntry.create({
            data: {
              entryNumber: reverseEntryNumber,
              date: new Date(),
              description: `Reversal of purchase invoice #${invoice.invoiceNumber}`,
              reference: invoice.invoiceNumber,
              status: 'Posted',
              createdBy: userId,
              postedBy: userId,
              postedAt: new Date(),
              companyId: invoice.companyId,
              fiscalYearId: invoice.fiscalYearId,
              lines: {
                create: invoice.journalEntry.lines.map(line => ({
                  accountId: line.accountId,
                  accountName: line.accountName,
                  accountCode: line.accountCode,
                  debit: line.credit,
                  credit: line.debit
                }))
              }
            },
            include: { lines: true }
          });
          await BalanceCalculator.applyJournalLines(tx, reverseEntry.lines);
        }

        if (invoice.accountsPayable) {
          await tx.accountsPayable.delete({ where: { id: invoice.accountsPayable.id } });
        }

        const stockMoves = await tx.stockMovement.findMany({
          where: {
            companyId: invoice.companyId,
            reference: invoice.invoiceNumber,
            type: { in: ['stock_in', 'Purchase Invoice'] }
          }
        });
        for (const move of stockMoves) {
          const product = await tx.product.findUnique({ where: { id: move.productId } });
          if (!product) continue;
          const prevStock = Number(product.currentStock) || 0;
          const newStock = Math.max(0, prevStock - Number(move.quantity || 0));
          const reserved = Number(product.reservedStock) || 0;
          await tx.product.update({
            where: { id: product.id },
            data: {
              currentStock: newStock,
              availableStock: Math.max(0, newStock - reserved),
              totalValue: newStock * (product.costPrice || 0)
            }
          });
          await tx.stockMovement.create({
            data: {
              productId: product.id,
              productName: product.name,
              type: 'stock_out',
              quantity: Number(move.quantity || 0),
              previousStock: prevStock,
              newStock,
              stockType: 'bulk',
              reason: `Reversal of Purchase Invoice #${invoice.invoiceNumber}`,
              reference: invoice.invoiceNumber,
              status: 'Completed',
              createdBy: userId || invoice.createdBy || 'SYSTEM',
              companyId: invoice.companyId,
              supplierId: invoice.supplierId || null,
              supplierName: invoice.supplierName || null
            }
          });
        }
      }

      return await tx.purchaseInvoice.update({
        where: { id },
        data: {
          invoiceStatus: 'Cancelled',
          cancelledAt: new Date(),
          updatedBy: userId
        },
        include: {
          items: { include: { product: true } },
          supplier: true
        }
      });
    });
  }

  // ============================================================
  // SOFT DELETE INVOICE
  // ============================================================
  static async softDelete(id, userId) {
    const invoice = await prisma.purchaseInvoice.findUnique({ where: { id } });
    if (!invoice) throw new Error('Invoice not found');
    if (invoice.invoiceStatus === 'Posted') throw new Error('Cannot delete posted invoice');

    return await prisma.purchaseInvoice.update({
      where: { id },
      data: {
        isDeleted: true,
        isActive: false,
        updatedBy: userId
      },
      include: { items: true }
    });
  }

  // ============================================================
  // GET INVOICE STATS - ✅ FIXED
  // ============================================================
  static async getStats(companyId) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const startOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);

    const baseFilter = {
      isActive: true,
      isDeleted: false,
      companyId: companyId
    };

    const todayInvoices = await prisma.purchaseInvoice.count({
      where: { ...baseFilter, invoiceDate: { gte: today } }
    });

    const todayAmount = await prisma.purchaseInvoice.aggregate({
      where: { ...baseFilter, invoiceDate: { gte: today } },
      _sum: { grandTotal: true }
    });

    const monthInvoices = await prisma.purchaseInvoice.count({
      where: { ...baseFilter, invoiceDate: { gte: startOfMonth } }
    });

    const monthAmount = await prisma.purchaseInvoice.aggregate({
      where: { ...baseFilter, invoiceDate: { gte: startOfMonth } },
      _sum: { grandTotal: true }
    });

    const [draft, posted, partiallyPaid, paid, cancelled] = await Promise.all([
      prisma.purchaseInvoice.count({ where: { ...baseFilter, invoiceStatus: 'Draft' } }),
      prisma.purchaseInvoice.count({ where: { ...baseFilter, invoiceStatus: 'Posted' } }),
      prisma.purchaseInvoice.count({ where: { ...baseFilter, invoiceStatus: 'Partially Paid' } }),
      prisma.purchaseInvoice.count({ where: { ...baseFilter, invoiceStatus: 'Paid' } }),
      prisma.purchaseInvoice.count({ where: { ...baseFilter, invoiceStatus: 'Cancelled' } })
    ]);

    const totalOutstanding = await prisma.purchaseInvoice.aggregate({
      where: {
        ...baseFilter,
        invoiceStatus: { in: ['Posted', 'Partially Paid'] }
      },
      _sum: { outstanding: true }
    });

    return {
      today: {
        count: todayInvoices,
        amount: todayAmount._sum.grandTotal || 0
      },
      month: {
        count: monthInvoices,
        amount: monthAmount._sum.grandTotal || 0
      },
      status: { draft, posted, partiallyPaid, paid, cancelled },
      totalOutstanding: totalOutstanding._sum.outstanding || 0
    };
  }

  // ============================================================
  // GET SUPPLIER INVOICE SUMMARY - ✅ FIXED
  // ============================================================
  static async getSupplierSummary(companyId, supplierId) {
    const invoices = await prisma.purchaseInvoice.findMany({
      where: {
        companyId: companyId,
        supplierId: supplierId,
        isActive: true,
        isDeleted: false,
        invoiceStatus: { notIn: ['Draft', 'Cancelled'] }
      },
      select: {
        id: true,
        invoiceNumber: true,
        invoiceDate: true,
        dueDate: true,
        grandTotal: true,
        paidAmount: true,
        outstanding: true,
        invoiceStatus: true,
        paymentStatus: true
      },
      orderBy: { invoiceDate: 'desc' }
    });

    const summary = {
      totalInvoices: invoices.length,
      totalAmount: 0,
      totalPaid: 0,
      totalOutstanding: 0,
      overdueCount: 0,
      overdueAmount: 0,
      invoices: invoices
    };

    const today = new Date();
    for (const invoice of invoices) {
      summary.totalAmount += invoice.grandTotal;
      summary.totalPaid += invoice.paidAmount;
      summary.totalOutstanding += invoice.outstanding;
      if (invoice.dueDate < today && invoice.outstanding > 0) {
        summary.overdueCount++;
        summary.overdueAmount += invoice.outstanding;
      }
    }

    return summary;
  }

  static async updatePaymentStatus(invoiceId) {
    return await prisma.$transaction(async (tx) => {
      const invoice = await tx.purchaseInvoice.findUnique({ where: { id: invoiceId } });
      if (!invoice) throw new Error('Invoice not found');

      const totalPaid = await tx.paymentMade.aggregate({
        where: { invoiceId: invoiceId, status: 'Completed' },
        _sum: { amount: true }
      });

      const paidAmount = totalPaid._sum.amount || 0;
      const outstanding = invoice.grandTotal - paidAmount;

      let invoiceStatus = invoice.invoiceStatus;
      let paymentStatus = 'Unpaid';

      if (paidAmount >= invoice.grandTotal) {
        invoiceStatus = 'Paid';
        paymentStatus = 'Paid';
      } else if (paidAmount > 0) {
        invoiceStatus = 'Partially Paid';
        paymentStatus = 'Partial';
      }

      const updatedInvoice = await tx.purchaseInvoice.update({
        where: { id: invoiceId },
        data: {
          paidAmount: paidAmount,
          outstanding: outstanding,
          invoiceStatus: invoiceStatus,
          paymentStatus: paymentStatus,
          ...(invoiceStatus === 'Paid' && { paidAt: new Date() })
        }
      });

      await tx.accountsPayable.updateMany({
        where: { invoiceId: invoiceId },
        data: {
          paidAmount: paidAmount,
          outstanding: outstanding,
          status: invoiceStatus === 'Paid' ? 'Paid' : 'Current'
        }
      });

      return updatedInvoice;
    });
  }

  static async prepareGrnsForInvoicing(grns, companyId, excludeInvoiceId = null) {
    const poIds = [
      ...new Set(grns.flatMap((grn) => collectPurchaseOrderIdsFromGrn(grn))),
    ];
    const mapsByPo = {};

    await Promise.all(
      poIds.map(async (poId) => {
        mapsByPo[poId] = await loadPoInvoicingMaps(
          prisma,
          poId,
          companyId,
          excludeInvoiceId
        );
      })
    );

    const returnedByGrnItemByGrnId = {};
    const invoicedByGrnIdByGrnId = {};
    await Promise.all(
      grns.map(async (grn) => {
        if (!collectPurchaseOrderIdsFromGrn(grn).length) {
          const [ret, inv] = await Promise.all([
            getReturnedQtyByGrnItemId(prisma, companyId, grn.id),
            getInvoicedQtyByGrnId(prisma, grn.id, companyId, excludeInvoiceId),
          ]);
          returnedByGrnItemByGrnId[grn.id] = ret;
          invoicedByGrnIdByGrnId[grn.id] = inv;
        }
      })
    );

    return grns.map((grn) => {
      const items = (grn.items || []).map((item) => {
        const itemPoId = item.purchaseOrderId || grn.purchaseOrderId;
        const maps = itemPoId ? mapsByPo[itemPoId] : null;
        const unitPrice =
          item.purchaseOrderItem?.unitPrice || item.product?.costPrice || 0;
        const discount = item.purchaseOrderItem?.discount || 0;
        const taxRate = item.purchaseOrderItem?.taxRate || 0;
        const qty = maps
          ? resolvePoLineInvoiceQuantity(
            item.purchaseOrderItemId,
            item.productId,
            maps.received,
            maps.invoiced,
            maps.returned
          )
          : Math.max(
            0,
            (Number(item.receivingQuantity) || 0) -
            Number(returnedByGrnItemByGrnId[grn.id]?.[item.id] || 0) -
            Number(invoicedByGrnIdByGrnId[grn.id]?.[item.productId] || 0)
          );

        return {
          ...item,
          receivingQuantity: qty,
          quantity: qty,
          unitPrice,
          discount,
          taxRate,
          totalReceivedOnPoLine: Number(
            maps?.received?.[item.purchaseOrderItemId] || 0
          ),
          totalReturnedOnPoLine: Number(
            maps?.returned?.[item.purchaseOrderItemId] || 0
          ),
          previouslyInvoiced: Number(
            maps?.invoiced?.[item.purchaseOrderItemId] ||
            maps?.invoiced?.[item.productId] ||
            0
          ),
          productName: item.productName || item.product?.name,
          sku: item.sku || item.product?.sku,
        };
      });

      const billableItems = items.filter((item) => (item.quantity || 0) > 0);
      const totalQuantity = billableItems.reduce(
        (sum, item) => sum + (item.quantity || 0),
        0
      );
      const invoiceSubtotal = billableItems.reduce(
        (sum, item) => sum + (item.quantity || 0) * (item.unitPrice || 0),
        0
      );
      const totalDiscount = billableItems.reduce((sum, item) => {
        const line = (item.quantity || 0) * (item.unitPrice || 0);
        return sum + line * ((item.discount || 0) / 100);
      }, 0);
      const totalTax = billableItems.reduce((sum, item) => {
        const line = (item.quantity || 0) * (item.unitPrice || 0);
        const afterDisc = line * (1 - (item.discount || 0) / 100);
        return sum + afterDisc * ((item.taxRate || 0) / 100);
      }, 0);

      return {
        grn,
        items: billableItems,
        totalQuantity,
        invoiceSubtotal,
        totalDiscount,
        totalTax,
        grandTotal: invoiceSubtotal - totalDiscount + totalTax,
      };
    });
  }

  static async consolidateGrnsForInvoicing(
    grns,
    companyId,
    excludeInvoiceId = null
  ) {
    const groups = new Map();

    for (const grn of grns) {
      const key = grn.purchaseOrderId || `grn:${grn.id}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(grn);
    }

    const results = [];

    for (const groupGrns of groups.values()) {
      const sorted = [...groupGrns].sort(
        (a, b) => new Date(b.receivingDate) - new Date(a.receivingDate)
      );
      const primary = sorted[0];
      const allPoIds = [
        ...new Set(groupGrns.flatMap((grn) => collectPurchaseOrderIdsFromGrn(grn))),
      ];
      const allItems = groupGrns.flatMap((grn) => grn.items || []);
      let billableItems = [];

      if (allPoIds.length > 0) {
        billableItems = await buildBillableItemsForPoIds(
          prisma,
          allPoIds,
          allItems,
          companyId,
          excludeInvoiceId
        );
      } else {
        const [prepared] = await this.prepareGrnsForInvoicing(
          [primary],
          companyId,
          excludeInvoiceId
        );
        billableItems = prepared?.items || [];
      }

      const totalQuantity = billableItems.reduce(
        (sum, item) => sum + (item.quantity || 0),
        0
      );
      if (totalQuantity <= 0) continue;

      const invoiceSubtotal = billableItems.reduce(
        (sum, item) => sum + (item.quantity || 0) * (item.unitPrice || 0),
        0
      );
      const totalDiscount = billableItems.reduce((sum, item) => {
        const line = (item.quantity || 0) * (item.unitPrice || 0);
        return sum + line * ((item.discount || 0) / 100);
      }, 0);
      const totalTax = billableItems.reduce((sum, item) => {
        const line = (item.quantity || 0) * (item.unitPrice || 0);
        const afterDisc = line * (1 - (item.discount || 0) / 100);
        return sum + afterDisc * ((item.taxRate || 0) / 100);
      }, 0);

      const linkedGrnIds = groupGrns.map((g) => g.id);
      const grnNumbers = groupGrns.map((g) => g.grnNumber).join(', ');
      const allInvoices = groupGrns.flatMap((g) => g.purchaseInvoices || []);
      const uniqueInvoices = [
        ...new Map(allInvoices.map((inv) => [inv.id, inv])).values(),
      ];

      results.push({
        grn: primary,
        linkedGrns: groupGrns,
        linkedGrnIds,
        grnNumbers,
        grnCount: groupGrns.length,
        items: billableItems,
        totalQuantity,
        invoiceSubtotal,
        totalDiscount,
        totalTax,
        grandTotal: invoiceSubtotal - totalDiscount + totalTax,
        purchaseInvoices: uniqueInvoices,
      });
    }

    return results;
  }

  static async getReceivedQuantitiesForPurchaseOrder(purchaseOrderId, companyId) {
    return getReceivedQtyByPoItemId(prisma, purchaseOrderId, companyId);
  }

  static async syncDraftInvoiceItemsFromReceiving(invoice, companyId) {
    if (
      invoice.invoiceStatus !== 'Draft' ||
      !invoice.goodsReceiving?.items?.length ||
      !invoice.items?.length
    ) {
      return invoice.items;
    }

    const prepared = await this.prepareGrnsForInvoicing(
      [invoice.goodsReceiving],
      companyId,
      invoice.id
    );
    const resolvedItems = prepared[0]?.items || [];

    return invoice.items.map((invItem) => {
      const grnLine = resolvedItems.find(
        (r) =>
          (invItem.purchaseOrderItemId &&
            r.purchaseOrderItemId === invItem.purchaseOrderItemId) ||
          r.productId === invItem.productId
      );
      if (!grnLine || (grnLine.quantity || 0) <= 0) return invItem;

      const quantity = grnLine.quantity;
      const unitPrice = Number(invItem.unitPrice) || 0;
      const discount = Number(invItem.discount) || 0;
      const taxRate = Number(invItem.taxRate) || 0;
      const lineTotal = quantity * unitPrice;
      const discountAmount = (lineTotal * discount) / 100;
      const taxableAmount = lineTotal - discountAmount;
      const taxAmount = (taxableAmount * taxRate) / 100;

      return {
        ...invItem,
        quantity,
        taxAmount,
        lineTotal: taxableAmount + taxAmount,
      };
    });
  }
}

module.exports = PurchaseInvoiceModel;