// warehouse/models/PurchaseReturn.js - COMPLETE CORRECTED

const prisma = require('../../prisma/client');
const BalanceCalculator = require('../../utils/balanceCalculator');
const { getOrCreateCashAccount } = require('../../utils/cashAccountHelper');
const { getOrCreateApAccount } = require('../../utils/apAccountHelper');
const {
  resolveLocationId,
  adjustLocationStock,
} = require('../services/locationService');

// ─── Generate Return Number ──────────────────────────────
function generateReturnNumber() {
  const date = new Date();
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const random = Math.floor(Math.random() * 10000).toString().padStart(4, '0');
  return `PR-${year}${month}${day}-${random}`;
}

async function findAPAccount(tx, companyId) {
  const { findApAccount } = require('../../utils/apAccountHelper');
  return findApAccount(companyId, tx);
}

async function findOrCreateAPAccount(tx, companyId, userId) {
  return getOrCreateApAccount(userId, companyId, tx);
}

async function findInventoryAccount(tx, companyId) {
  return tx.chartOfAccount.findFirst({
    where: {
      companyId: companyId,
      isActive: true,
      OR: [
        { code: '1300' },
        { name: { equals: 'Inventory', mode: 'insensitive' } },
        { name: { contains: 'Inventory', mode: 'insensitive' } },
      ]
    }
  });
}

async function findOrCreateInventoryAccount(tx, companyId, userId) {
  let account = await findInventoryAccount(tx, companyId);
  if (account) return account;

  account = await tx.chartOfAccount.create({
    data: {
      code: '1300',
      name: 'Inventory',
      type: 'Asset',
      parentAccount: 'Current Assets',
      openingBalance: 0,
      currentBalance: 0,
      balanceType: 'Debit',
      description: 'Inventory asset',
      taxCode: 'N/A',
      isActive: true,
      createdBy: userId || 'SYSTEM',
      companyId
    }
  });
  return account;
}

// Legacy alias (do not credit revenue for returns)
async function getOrCreatePurchaseReturnsAccount(tx, companyId, userId) {
  return findOrCreateInventoryAccount(tx, companyId, userId);
}

async function applyPurchaseReturnStockOut(tx, purchaseReturn, userId, companyId) {
  let stockLocationId =
    purchaseReturn.goodsReceiving?.locationId ||
    purchaseReturn.purchaseInvoice?.locationId ||
    null;

  if (!stockLocationId && purchaseReturn.goodsReceiving?.purchaseOrderId) {
    const po = await tx.purchaseOrder.findUnique({
      where: { id: purchaseReturn.goodsReceiving.purchaseOrderId },
      select: { locationId: true },
    });
    stockLocationId = po?.locationId || null;
  }

  const locationId = await resolveLocationId(
    tx,
    companyId,
    stockLocationId,
    userId
  );

  for (const item of purchaseReturn.items) {
    const qty = Math.round(Number(item.returnQuantity) || 0);
    if (qty <= 0) continue;

    const existingMovement = await tx.stockMovement.findFirst({
      where: {
        companyId,
        reference: purchaseReturn.returnNumber,
        productId: item.productId,
        type: 'Purchase Return',
        locationId: { not: null },
      },
    });
    if (existingMovement) continue;

    const product = await tx.product.findFirst({
      where: { id: item.productId, companyId },
    });
    if (!product) {
      throw new Error(`Product not found for return line "${item.productName}"`);
    }

    const adj = await adjustLocationStock(tx, {
      companyId,
      productId: item.productId,
      locationId,
      delta: -qty,
      checkAvailable: true,
      productName: item.productName,
    });

    await tx.stockMovement.create({
      data: {
        productId: item.productId,
        productName: item.productName,
        type: 'Purchase Return',
        quantity: qty,
        previousStock: adj.previousLocationStock,
        newStock: adj.newLocationStock,
        stockType: 'bulk',
        reason: `Purchase Return #${purchaseReturn.returnNumber}${
          purchaseReturn.grnNumber ? ` — GRN ${purchaseReturn.grnNumber}` : ''
        }`,
        supplierId: purchaseReturn.supplierId,
        supplierName: purchaseReturn.supplierName,
        reference: purchaseReturn.returnNumber,
        status: 'Completed',
        notes: `Returned ${qty} ${item.productName} - ${purchaseReturn.returnReason}`,
        createdBy: userId,
        companyId,
        locationId,
      },
    });
  }
}

async function returnLocationStockApplied(tx, companyId, purchaseReturn) {
  const itemsWithQty = purchaseReturn.items.filter(
    (item) => Math.round(Number(item.returnQuantity) || 0) > 0
  );
  if (itemsWithQty.length === 0) return true;

  const appliedCount = await tx.stockMovement.count({
    where: {
      companyId,
      reference: purchaseReturn.returnNumber,
      type: 'Purchase Return',
      locationId: { not: null },
      productId: { in: itemsWithQty.map((item) => item.productId) },
    },
  });

  return appliedCount >= itemsWithQty.length;
}

class PurchaseReturnModel {
  // ============================================================
  // GET GRN PRODUCTS FOR RETURN - ✅ NEW GRN-BASED
  // ============================================================
  static async getGRNProducts(grnId, companyId) {
    const grn = await prisma.goodsReceiving.findFirst({
      where: {
        id: grnId,
        companyId: companyId,
        isActive: true,
        isDeleted: false,
        status: {
          in: ['Confirmed', 'Partially Received', 'Fully Received']
        }
      },
      include: {
        items: {
          include: {
            product: true,
            purchaseOrderItem: true
          }
        },
        supplier: true,
        purchaseOrder: true,
        purchaseInvoices: {
          where: {
            isActive: true,
            isDeleted: false,
            invoiceStatus: { in: ['Posted', 'Partially Paid', 'Paid'] }
          }
        },
        invoiceSources: {
          include: {
            invoice: true
          }
        }
      }
    });

    if (!grn) {
      throw new Error('Goods receiving (GRN) not found or not confirmed');
    }

    const previousReturns = await prisma.purchaseReturnItem.groupBy({
      by: ['productId', 'goodsReceivingItemId'],
      where: {
        goodsReceivingId: grnId,
        return: {
          status: {
            in: ['Draft', 'Processed']
          },
          isActive: true,
          isDeleted: false
        }
      },
      _sum: {
        returnQuantity: true
      }
    });

    const returnMap = {};
    previousReturns.forEach(item => {
      const key = item.goodsReceivingItemId || item.productId;
      returnMap[key] = (returnMap[key] || 0) + (item._sum.returnQuantity || 0);
    });

    // Find linked invoice if exists
    const linkedInvoice = grn.purchaseInvoices[0] || grn.invoiceSources[0]?.invoice || null;

    const products = grn.items.map(item => {
      const previouslyReturned = returnMap[item.id] !== undefined 
        ? returnMap[item.id] 
        : (returnMap[item.productId] || 0);
      const receivedQty = Number(item.receivingQuantity) || 0;
      const availableQuantity = Math.max(0, receivedQty - previouslyReturned);

      return {
        id: item.id,
        goodsReceivingItemId: item.id,
        productId: item.productId,
        productName: item.productName,
        sku: item.sku,
        purchaseOrderId: item.purchaseOrderId || item.purchaseOrderItem?.purchaseOrderId,
        purchaseOrderNumber: item.purchaseOrderNumber || item.purchaseOrderItem?.purchaseOrderNumber || grn.purchaseOrderNumbers || grn.purchaseOrderNumber || '',
        receivedQuantity: receivedQty,
        purchasedQuantity: Math.round(receivedQty),
        previouslyReturned: previouslyReturned,
        availableQuantity: Math.max(0, availableQuantity),
        unitPrice: item.unitPrice || item.purchaseOrderItem?.unitPrice || item.product?.costPrice || 0,
        isBoxBased: item.product?.isBoxBased || false,
        boxQuantity: item.product?.boxQuantity || 0,
        boxUnitName: item.product?.boxUnitName || 'Box',
        product: item.product,
        purchaseOrderItem: item.purchaseOrderItem
      };
    });

    if (grn) {
      grn.purchaseOrderNumber = grn.purchaseOrderNumbers || grn.purchaseOrderNumber || '';
    }

    return {
      grn,
      linkedInvoice,
      products
    };
  }

  // ============================================================
  // GET SUPPLIER GRNS FOR RETURN - ✅ NEW
  // ============================================================
  static async getSupplierGRNs(supplierId, companyId) {
    const supplier = await prisma.supplier.findFirst({
      where: {
        id: supplierId,
        companyId: companyId,
        status: 'active'
      }
    });

    if (!supplier) {
      throw new Error('Supplier not found');
    }

    const grns = await prisma.goodsReceiving.findMany({
      where: {
        supplierId: supplierId,
        companyId: companyId,
        isActive: true,
        isDeleted: false,
        status: {
          in: ['Confirmed', 'Partially Received', 'Fully Received']
        }
      },
      orderBy: {
        receivingDate: 'desc'
      },
      include: {
        items: {
          include: {
            product: true,
            purchaseReturnItems: {
              where: {
                return: {
                  status: { in: ['Draft', 'Processed'] },
                  isDeleted: false,
                  isActive: true
                }
              }
            }
          }
        },
        supplier: true,
        purchaseOrder: true,
        location: true,
        purchaseInvoices: {
          where: {
            isActive: true,
            isDeleted: false,
            invoiceStatus: { in: ['Draft', 'Posted', 'Partially Paid', 'Paid'] }
          }
        }
      }
    });

    return grns.map(grn => {
      let totalAmount = 0;
      let totalReceivedQty = 0;
      let totalReturnedQty = 0;
      let totalAvailableReturnQty = 0;

      const itemsSummary = (grn.items || []).map(item => {
        const itemReturned = (item.purchaseReturnItems || []).reduce((sum, r) => sum + (r.returnQuantity || 0), 0);
        const itemAvailable = Math.max(0, (item.receivingQuantity || 0) - itemReturned);
        const lineVal = (item.receivingQuantity || 0) * (item.unitPrice || 0);

        totalAmount += lineVal;
        totalReceivedQty += (item.receivingQuantity || 0);
        totalReturnedQty += itemReturned;
        totalAvailableReturnQty += itemAvailable;

        return {
          id: item.id,
          goodsReceivingItemId: item.id,
          productId: item.productId,
          productName: item.productName || item.product?.name || 'Unknown Product',
          sku: item.sku || item.product?.sku || '',
          purchaseOrderId: item.purchaseOrderId,
          purchaseOrderNumber: item.purchaseOrderNumber || grn.purchaseOrderNumbers || grn.purchaseOrderNumber || '',
          receivingQuantity: item.receivingQuantity || 0,
          unitPrice: item.unitPrice || 0,
          previouslyReturned: itemReturned,
          availableReturnQty: itemAvailable,
          unit: item.unit || 'Pcs'
        };
      });

      const linkedInvoice = (grn.purchaseInvoices || [])[0] || null;

      const poNumbersCombined = grn.purchaseOrderNumbers || grn.purchaseOrderNumber || grn.purchaseOrder?.orderNumber || '';

      return {
        id: grn.id,
        grnNumber: grn.grnNumber,
        receivingDate: grn.receivingDate,
        supplierId: grn.supplierId,
        supplierName: grn.supplierName || grn.supplier?.name || '',
        purchaseOrderId: grn.purchaseOrderId,
        purchaseOrderNumber: poNumbersCombined,
        purchaseOrderNumbers: poNumbersCombined,
        status: grn.status,
        notes: grn.notes || '',
        locationName: grn.location?.name || null,
        totalItemsCount: itemsSummary.length,
        totalAmount: totalAmount,
        totalReceivedQty: totalReceivedQty,
        totalReturnedQty: totalReturnedQty,
        totalAvailableReturnQty: totalAvailableReturnQty,
        linkedInvoice: linkedInvoice ? {
          id: linkedInvoice.id,
          invoiceNumber: linkedInvoice.invoiceNumber,
          grandTotal: linkedInvoice.grandTotal,
          invoiceStatus: linkedInvoice.invoiceStatus,
          paymentStatus: linkedInvoice.paymentStatus,
          invoiceDate: linkedInvoice.invoiceDate
        } : null,
        purchaseInvoices: grn.purchaseInvoices || [],
        items: itemsSummary
      };
    });
  }

  // ============================================================
  // GET INVOICE PRODUCTS FOR RETURN - LEGACY FALLBACK
  // ============================================================
  static async getInvoiceProducts(invoiceId, companyId) {
    const invoice = await prisma.purchaseInvoice.findFirst({
      where: {
        id: invoiceId,
        companyId: companyId,
        isActive: true,
        isDeleted: false,
        invoiceStatus: {
          in: ['Posted', 'Partially Paid', 'Paid']
        }
      },
      include: {
        items: {
          include: {
            product: true
          }
        }
      }
    });

    if (!invoice) {
      throw new Error('Purchase invoice not found');
    }

    const previousReturns = await prisma.purchaseReturnItem.groupBy({
      by: ['productId', 'purchaseInvoiceId'],
      where: {
        purchaseInvoiceId: invoiceId,
        return: {
          status: {
            in: ['Draft', 'Processed']
          },
          isActive: true,
          isDeleted: false
        }
      },
      _sum: {
        returnQuantity: true
      }
    });

    const returnMap = {};
    previousReturns.forEach(item => {
      returnMap[item.productId] = item._sum.returnQuantity || 0;
    });

    const products = invoice.items.map(item => {
      const previouslyReturned = returnMap[item.productId] || 0;
      const availableQuantity = item.quantity - previouslyReturned;

      return {
        ...item,
        product: item.product,
        previouslyReturned: previouslyReturned,
        availableQuantity: Math.max(0, availableQuantity),
        isBoxBased: item.product?.isBoxBased || false,
        boxQuantity: item.product?.boxQuantity || 0,
        boxUnitName: item.product?.boxUnitName || 'Box'
      };
    });

    return {
      invoice,
      products
    };
  }

  // ============================================================
  // CREATE PURCHASE RETURN (DRAFT) - ✅ GRN-BASED WITH INVOICE LINK
  // ============================================================
  static async createDraft(data) {
    const returnNumber = generateReturnNumber();

    return await prisma.$transaction(async (tx) => {
      const {
        supplierId,
        supplierName,
        goodsReceivingId,
        grnNumber,
        purchaseInvoiceId,
        purchaseInvoiceNumber,
        returnReason,
        notes,
        items,
        userId,
        createdBy,
        companyId,
        fiscalYearId
      } = data;

      // ─── Validation ──────────────────────────────────────────
      if (!supplierId) {
        throw new Error('Supplier is required');
      }

      if (!goodsReceivingId && !purchaseInvoiceId) {
        throw new Error('Goods receiving (GRN) or Purchase invoice is required');
      }

      if (!items || items.length === 0) {
        throw new Error('At least one product must be returned');
      }

      // ─── Validate Supplier ──────────────────────────────────
      const supplier = await tx.supplier.findFirst({
        where: {
          id: supplierId,
          companyId: companyId,
          status: 'active'
        }
      });

      if (!supplier) {
        throw new Error('Supplier not found');
      }

      // ─── Validate GRN (if provided) ──────────────────────────
      let grn = null;
      if (goodsReceivingId) {
        grn = await tx.goodsReceiving.findFirst({
          where: {
            id: goodsReceivingId,
            companyId: companyId,
            supplierId: supplierId,
            isActive: true,
            isDeleted: false
          },
          include: {
            items: true
          }
        });

        if (!grn) {
          throw new Error('Goods receiving (GRN) not found or supplier mismatch');
        }
      }

      // ─── Validate Invoice (if provided) ──────────────────────
      let invoice = null;
      if (purchaseInvoiceId) {
        invoice = await tx.purchaseInvoice.findFirst({
          where: {
            id: purchaseInvoiceId,
            companyId: companyId,
            supplierId: supplierId,
            isActive: true,
            isDeleted: false
          },
          include: {
            items: true
          }
        });

        if (!invoice) {
          throw new Error('Purchase invoice not found or supplier mismatch');
        }
      }

      // ─── Validate Items ──────────────────────────────────────
      let totalReturnQty = 0;
      let returnAmount = 0;
      let grandTotal = 0;
      const validatedItems = [];

      for (const item of items) {
        let maxAvailable = 0;
        let unitPrice = item.unitPrice || 0;
        let grnItemId = item.goodsReceivingItemId || null;
        let invItemId = item.purchaseInvoiceItemId || null;

        if (grn) {
          const grnItem = grn.items.find(i => i.id === item.goodsReceivingItemId || i.productId === item.productId);
          if (!grnItem) {
            throw new Error(`Product ${item.productName} not found in GRN`);
          }
          grnItemId = grnItem.id;
          unitPrice = item.unitPrice || grnItem.unitPrice || 0;

          const previousReturns = await tx.purchaseReturnItem.aggregate({
            where: {
              goodsReceivingId: goodsReceivingId,
              goodsReceivingItemId: grnItemId,
              return: {
                status: { in: ['Draft', 'Processed'] },
                isActive: true,
                isDeleted: false,
                NOT: { id: item.returnId || '' }
              }
            },
            _sum: { returnQuantity: true }
          });

          const previouslyReturned = previousReturns._sum.returnQuantity || 0;
          maxAvailable = Math.max(0, Number(grnItem.receivingQuantity) - previouslyReturned);
        } else if (invoice) {
          const invoiceItem = invoice.items.find(i => i.id === item.purchaseInvoiceItemId || i.productId === item.productId);
          if (!invoiceItem) {
            throw new Error(`Product ${item.productName} not found in invoice`);
          }
          invItemId = invoiceItem.id;
          unitPrice = item.unitPrice || invoiceItem.unitPrice || 0;

          const previousReturns = await tx.purchaseReturnItem.aggregate({
            where: {
              purchaseInvoiceId: purchaseInvoiceId,
              productId: item.productId,
              return: {
                status: { in: ['Draft', 'Processed'] },
                isActive: true,
                isDeleted: false,
                NOT: { id: item.returnId || '' }
              }
            },
            _sum: { returnQuantity: true }
          });

          const previouslyReturned = previousReturns._sum.returnQuantity || 0;
          maxAvailable = Math.max(0, invoiceItem.quantity - previouslyReturned);
        }

        if (item.returnQuantity <= 0) {
          throw new Error(`Return quantity must be greater than 0 for ${item.productName}`);
        }

        if (item.returnQuantity > maxAvailable) {
          throw new Error(
            `Return quantity ${item.returnQuantity} exceeds remaining returnable quantity ${maxAvailable} for ${item.productName}`
          );
        }

        const lineTotal = item.returnQuantity * unitPrice;

        totalReturnQty += item.returnQuantity;
        returnAmount += lineTotal;
        grandTotal += lineTotal;

        validatedItems.push({
          ...item,
          goodsReceivingId: grn?.id || null,
          goodsReceivingItemId: grnItemId,
          purchaseInvoiceId: invoice?.id || null,
          purchaseInvoiceItemId: invItemId,
          lineTotal,
          unitPrice,
          receivedQuantity: grn ? (grn.items.find(i => i.id === grnItemId)?.receivingQuantity || 0) : 0,
          purchasedQuantity: invoice ? (invoice.items.find(i => i.id === invItemId)?.quantity || 0) : 0,
          availableQuantity: maxAvailable,
          previouslyReturned: 0
        });
      }

      // ─── Create Purchase Return ─────────────────────────────
      const purchaseReturn = await tx.purchaseReturn.create({
        data: {
          returnNumber,
          returnDate: new Date(),
          supplierId,
          supplierName: supplier.name,
          goodsReceivingId: grn?.id || null,
          grnNumber: grn?.grnNumber || grnNumber || null,
          purchaseInvoiceId: invoice?.id || null,
          purchaseInvoiceNumber: invoice?.invoiceNumber || purchaseInvoiceNumber || null,
          returnReason: returnReason || 'Return',
          status: 'Draft',
          notes: notes || '',
          totalReturnQty,
          returnAmount,
          grandTotal,
          createdBy: createdBy || userId,
          companyId: companyId,
          fiscalYearId: fiscalYearId,
          items: {
            create: validatedItems.map(item => ({
              productId: item.productId,
              productName: item.productName,
              sku: item.sku || '',
              goodsReceivingId: item.goodsReceivingId,
              goodsReceivingItemId: item.goodsReceivingItemId,
              purchaseInvoiceId: item.purchaseInvoiceId,
              purchaseInvoiceItemId: item.purchaseInvoiceItemId,
              receivedQuantity: item.receivedQuantity,
              purchasedQuantity: item.purchasedQuantity,
              previouslyReturned: item.previouslyReturned,
              availableQuantity: item.availableQuantity,
              returnQuantity: item.returnQuantity,
              isBoxBased: item.isBoxBased || false,
              boxes: item.boxes || null,
              quantityPerBox: item.quantityPerBox || 0,
              unitPrice: item.unitPrice,
              lineTotal: item.lineTotal,
              returnReason: item.returnReason || returnReason || 'Return',
              condition: item.condition || 'Good',
              notes: item.notes || ''
            }))
          }
        },
        include: {
          items: {
            include: {
              product: true
            }
          },
          supplier: true,
          goodsReceiving: true,
          purchaseInvoice: true
        }
      });

      return purchaseReturn;
    });
  }

  // ============================================================
  // PROCESS PURCHASE RETURN - ✅ FIXED
  // ============================================================
  static async processReturn(id, userId, companyId) {
    return await prisma.$transaction(async (tx) => {
      const purchaseReturn = await tx.purchaseReturn.findFirst({
        where: {
          id,
          companyId: companyId,
          isActive: true,
          isDeleted: false
        },
        include: {
          items: {
            include: {
              product: true
            }
          },
          supplier: true,
          goodsReceiving: {
            select: {
              id: true,
              grnNumber: true,
              locationId: true,
              purchaseOrderId: true,
            },
          },
          purchaseInvoice: {
            include: {
              accountsPayable: true
            }
          }
        }
      });

      if (!purchaseReturn) {
        throw new Error('Purchase return not found');
      }

      if (purchaseReturn.status === 'Cancelled') {
        throw new Error('Purchase return is cancelled');
      }

      const stockAlreadyApplied = await returnLocationStockApplied(
        tx,
        companyId,
        purchaseReturn
      );

      if (purchaseReturn.status === 'Processed') {
        if (stockAlreadyApplied) {
          throw new Error('Purchase return already processed');
        }

        await applyPurchaseReturnStockOut(tx, purchaseReturn, userId, companyId);

        return await tx.purchaseReturn.findFirst({
          where: { id },
          include: {
            items: { include: { product: true } },
            supplier: true,
            goodsReceiving: true,
            purchaseInvoice: true,
            journalEntry: {
              include: {
                lines: { include: { account: true } },
              },
            },
          },
        });
      }

      const amount = Number(purchaseReturn.grandTotal) || 0;
      if (amount <= 0) {
        throw new Error('Return amount must be greater than zero');
      }

      const invoice = purchaseReturn.purchaseInvoice;
      const isPostedInvoice = invoice && ['posted', 'partially paid', 'paid'].includes(String(invoice.invoiceStatus || '').toLowerCase());
      const isPaidInvoice = invoice && (
        String(invoice.paymentStatus || '').toLowerCase() === 'paid' ||
        String(invoice.invoiceStatus || '').toLowerCase() === 'paid'
      );

      let createdJournalEntryId = null;

      // ─── Resolve GL accounts & Journal Entry (Only if Invoice exists and is posted) ──────
      if (isPostedInvoice) {
        const inventoryAccount = await findOrCreateInventoryAccount(
          tx,
          companyId,
          userId
        );
        const cashAccount = await getOrCreateCashAccount(userId, companyId, tx);
        const apAccount = await findOrCreateAPAccount(tx, companyId, userId);

        // Paid invoice → cash refund back; unpaid → reduce AP liability
        const debitAccount = isPaidInvoice ? cashAccount : apAccount;

        const entryNumber = `JE-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
        const journalEntry = await tx.journalEntry.create({
          data: {
            entryNumber,
            date: new Date(),
            description: `Purchase return #${purchaseReturn.returnNumber} from ${purchaseReturn.supplierName}`,
            reference: purchaseReturn.returnNumber,
            status: 'Posted',
            createdBy: userId,
            postedBy: userId,
            postedAt: new Date(),
            companyId: companyId,
            fiscalYearId: purchaseReturn.fiscalYearId,
            lines: {
              create: [
                {
                  accountId: debitAccount.id,
                  accountName: debitAccount.name,
                  accountCode: debitAccount.code,
                  debit: amount,
                  credit: 0
                },
                {
                  accountId: inventoryAccount.id,
                  accountName: inventoryAccount.name,
                  accountCode: inventoryAccount.code,
                  debit: 0,
                  credit: amount
                },
              ]
            }
          },
          include: { lines: true }
        });

        await BalanceCalculator.applyJournalLines(tx, journalEntry.lines);
        createdJournalEntryId = journalEntry.id;
      }

      // ─── Update Purchase Return Status ────────────────────────
      const updatedReturn = await tx.purchaseReturn.update({
        where: { id },
        data: {
          status: 'Processed',
          ...(createdJournalEntryId ? { journalEntryId: createdJournalEntryId } : {}),
          processedBy: userId,
          processedAt: new Date(),
          updatedBy: userId
        },
        include: {
          items: {
            include: {
              product: true
            }
          },
          supplier: true,
          goodsReceiving: true,
          purchaseInvoice: true,
          journalEntry: {
            include: {
              lines: {
                include: {
                  account: true
                }
              }
            }
          }
        }
      });

      // ─── Update Inventory Stock (location-aware, same as GRN confirm) ──
      if (!stockAlreadyApplied) {
        await applyPurchaseReturnStockOut(tx, purchaseReturn, userId, companyId);
      }

      // ─── Invoice / AP impact (If invoice exists and posted) ──────
      if (invoice && isPostedInvoice) {
        if (isPaidInvoice) {
          const newPaid = Math.max(0, Number(invoice.paidAmount || 0) - amount);
          await tx.purchaseInvoice.update({
            where: { id: invoice.id },
            data: {
              paidAmount: newPaid,
              notes: `${invoice.notes || ''}\nReturn ${purchaseReturn.returnNumber} refund ${amount}`.trim()
            }
          });
        } else {
          const newOutstanding = Math.max(
            0,
            Number(invoice.outstanding || invoice.grandTotal || 0) - amount
          );
          let invoiceStatus = invoice.invoiceStatus;
          let paymentStatus = invoice.paymentStatus;

          if (newOutstanding <= 0.01) {
            invoiceStatus = 'Paid';
            paymentStatus = 'Paid';
          } else if (Number(invoice.paidAmount || 0) > 0) {
            invoiceStatus = 'Partially Paid';
            paymentStatus = 'Partial';
          }

          await tx.purchaseInvoice.update({
            where: { id: invoice.id },
            data: {
              outstanding: newOutstanding,
              invoiceStatus,
              paymentStatus
            }
          });

          await tx.accountsPayable.updateMany({
            where: { invoiceId: invoice.id },
            data: {
              outstanding: newOutstanding,
              status: newOutstanding <= 0.01 ? 'Paid' : 'Current'
            }
          });
        }
      }

      return updatedReturn;
    }, { maxWait: 30_000, timeout: 120_000 });
  }

  // ============================================================
  // CANCEL PURCHASE RETURN
  // ============================================================
  static async cancelReturn(id, userId, companyId, reason = '') {
    return await prisma.$transaction(async (tx) => {
      const purchaseReturn = await tx.purchaseReturn.findFirst({
        where: {
          id,
          companyId: companyId,
          isActive: true,
          isDeleted: false
        },
        include: {
          items: {
            include: {
              product: true
            }
          }
        }
      });

      if (!purchaseReturn) {
        throw new Error('Purchase return not found');
      }

      if (purchaseReturn.status === 'Cancelled') {
        throw new Error('Purchase return already cancelled');
      }

      if (purchaseReturn.status === 'Processed') {
        throw new Error('Cannot cancel a processed return. Please reverse the transaction.');
      }

      const cancelledReturn = await tx.purchaseReturn.update({
        where: { id },
        data: {
          status: 'Cancelled',
          cancelledBy: userId,
          cancelledAt: new Date(),
          notes: purchaseReturn.notes 
            ? `${purchaseReturn.notes}\nCancelled: ${reason}`
            : `Cancelled: ${reason}`,
          updatedBy: userId
        },
        include: {
          items: {
            include: {
              product: true
            }
          },
          supplier: true,
          purchaseInvoice: true
        }
      });

      return cancelledReturn;
    });
  }

  // ============================================================
  // GET RETURN BY ID
  // ============================================================
  static async findById(id) {
    return await prisma.purchaseReturn.findUnique({
      where: { id },
      include: {
        items: {
          include: {
            product: true,
            purchaseInvoice: {
              include: {
                supplier: true
              }
            }
          }
        },
        supplier: true,
        purchaseInvoice: {
          include: {
            supplier: true,
            items: true
          }
        },
        journalEntry: {
          include: {
            lines: {
              include: {
                account: true
              }
            }
          }
        },
        creator: {
          select: { id: true, firstName: true, lastName: true, email: true }
        },
        processor: {
          select: { id: true, firstName: true, lastName: true, email: true }
        },
        canceller: {
          select: { id: true, firstName: true, lastName: true, email: true }
        }
      }
    });
  }

  // ============================================================
  // GET RETURN BY NUMBER
  // ============================================================
  static async findByReturnNumber(returnNumber) {
    return await prisma.purchaseReturn.findUnique({
      where: { returnNumber },
      include: {
        items: {
          include: {
            product: true
          }
        },
        supplier: true,
        purchaseInvoice: true,
        journalEntry: {
          include: {
            lines: {
              include: {
                account: true
              }
            }
          }
        }
      }
    });
  }

  // ============================================================
  // GET ALL RETURNS WITH FILTERS - ✅ FIXED
  // ============================================================
  static async findAll(filter = {}, options = {}) {
    const { skip, take, orderBy = { createdAt: 'desc' } } = options;

    // ✅ FIXED: Map userId to createdBy if present
    const cleanFilter = { ...filter };
    if (cleanFilter.userId) {
      cleanFilter.createdBy = cleanFilter.userId;
      delete cleanFilter.userId;
    }

    return await prisma.purchaseReturn.findMany({
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
            product: true
          }
        },
        supplier: true,
        purchaseInvoice: true,
        creator: {
          select: { id: true, firstName: true, lastName: true, email: true }
        },
        processor: {
          select: { id: true, firstName: true, lastName: true, email: true }
        }
      }
    });
  }

  // ============================================================
  // COUNT RETURNS - ✅ FIXED
  // ============================================================
  static async count(filter = {}) {
    // ✅ FIXED: Map userId to createdBy if present
    const cleanFilter = { ...filter };
    if (cleanFilter.userId) {
      cleanFilter.createdBy = cleanFilter.userId;
      delete cleanFilter.userId;
    }

    return await prisma.purchaseReturn.count({
      where: {
        ...cleanFilter,
        isActive: true,
        isDeleted: false
      }
    });
  }

  // ============================================================
  // GET RETURN STATS - ✅ FIXED
  // ============================================================
  static async getStats(companyId) {
    // ✅ FIXED: Use companyId instead of userId
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const startOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);

    const baseFilter = {
      isActive: true,
      isDeleted: false,
      companyId: companyId
    };

    const todayReturns = await prisma.purchaseReturn.count({
      where: {
        ...baseFilter,
        returnDate: { gte: today },
        status: 'Processed'
      }
    });

    const todayAmount = await prisma.purchaseReturn.aggregate({
      where: {
        ...baseFilter,
        returnDate: { gte: today },
        status: 'Processed'
      },
      _sum: { grandTotal: true }
    });

    const monthReturns = await prisma.purchaseReturn.count({
      where: {
        ...baseFilter,
        returnDate: { gte: startOfMonth },
        status: 'Processed'
      }
    });

    const monthAmount = await prisma.purchaseReturn.aggregate({
      where: {
        ...baseFilter,
        returnDate: { gte: startOfMonth },
        status: 'Processed'
      },
      _sum: { grandTotal: true }
    });

    const draftCount = await prisma.purchaseReturn.count({
      where: {
        ...baseFilter,
        status: 'Draft'
      }
    });

    return {
      today: {
        count: todayReturns,
        amount: todayAmount._sum.grandTotal || 0
      },
      month: {
        count: monthReturns,
        amount: monthAmount._sum.grandTotal || 0
      },
      draft: {
        count: draftCount
      }
    };
  }

  // ============================================================
  // PRINT RETURN NOTE DATA
  // ============================================================
  static async getReturnNoteData(id) {
    const purchaseReturn = await prisma.purchaseReturn.findUnique({
      where: { id },
      include: {
        items: {
          include: {
            product: true
          }
        },
        supplier: true,
        purchaseInvoice: {
          include: {
            supplier: true
          }
        },
        journalEntry: {
          include: {
            lines: {
              include: {
                account: true
              }
            }
          }
        },
        creator: {
          select: { id: true, firstName: true, lastName: true, email: true }
        },
        processor: {
          select: { id: true, firstName: true, lastName: true, email: true }
        }
      }
    });

    if (!purchaseReturn) {
      throw new Error('Purchase return not found');
    }

    return purchaseReturn;
  }
}

module.exports = PurchaseReturnModel;