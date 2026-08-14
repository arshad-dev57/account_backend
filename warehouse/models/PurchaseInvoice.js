// warehouse/models/PurchaseInvoice.js - COMPLETE CORRECTED

const prisma = require('../../prisma/client');
const BalanceCalculator = require('../../utils/balanceCalculator');
const { getOrCreateApAccount } = require('../../utils/apAccountHelper');

// ─── Generate Invoice Number Function ──────────────────────
function generateInvoiceNumber() {
  const date = new Date();
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const random = Math.floor(Math.random() * 10000).toString().padStart(4, '0');
  return `PI-${year}${month}${day}-${random}`;
}

// ─── Helper: Find or Create Inventory Account ──────────────
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

// ─── Helper: Find or Create Supplier ────────────────────────
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
        status: { in: ['Confirmed', 'Partially Received', 'Fully Received'] }
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

    const prevStock = Number(product.currentStock) || 0;
    const newStock = prevStock + addQty;
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
        productName: item.productName || product.name,
        type: 'stock_in',
        quantity: addQty,
        previousStock: prevStock,
        newStock,
        stockType: 'bulk',
        reason: `Purchase Invoice #${invoice.invoiceNumber}`,
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

class PurchaseInvoiceModel {
  // ============================================================
  // CREATE PURCHASE INVOICE FROM GOODS RECEIVING
  // ============================================================
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
          goodsReceivingId: data.goodsReceivingId,
          isActive: true,
          isDeleted: false
        }
      });

      if (existingInvoice) {
        throw new Error('Invoice already exists for this goods receiving');
      }

      const { supplierId, supplier } = await findOrCreateSupplier(
        tx,
        grn.purchaseOrder,
        data.userId,
        data.createdBy,
        data.companyId
      );

      let subtotal = 0;
      let totalDiscount = 0;
      let totalTax = 0;

      const invoiceItems = grn.items.map(item => {
        // Use PO line price (agreed cost), not product master costPrice
        const unitPrice =
          item.purchaseOrderItem?.unitPrice ??
          item.product?.costPrice ??
          0;
        const lineTotal = item.receivingQuantity * unitPrice;
        const discountAmount = (lineTotal * (item.purchaseOrderItem?.discount || 0)) / 100;
        const taxableAmount = lineTotal - discountAmount;
        const taxAmount = (taxableAmount * (item.purchaseOrderItem?.taxRate || 0)) / 100;
        const total = taxableAmount + taxAmount;

        subtotal += lineTotal;
        totalDiscount += discountAmount;
        totalTax += taxAmount;

        return {
          productId: item.productId,
          productName: item.productName,
          sku: item.sku,
          quantity: item.receivingQuantity,
          unitPrice: unitPrice,
          discount: item.purchaseOrderItem?.discount || 0,
          taxRate: item.purchaseOrderItem?.taxRate || 0,
          taxAmount: taxAmount,
          lineTotal: total,
          notes: item.notes || null
        };
      });

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
          supplierName: supplier?.name || grn.supplierName,
          supplierEmail: supplier?.email || grn.supplier?.email || null,
          supplierPhone: supplier?.phone || grn.supplier?.phone || null,
          supplierInvoiceNo: data.supplierInvoiceNo || null,
          purchaseOrderId: grn.purchaseOrderId,
          purchaseOrderNumber: grn.purchaseOrder?.orderNumber || null,
          goodsReceivingId: grn.id,
          grnNumber: grn.grnNumber,
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
          items: { create: invoiceItems }
        },
        include: {
          items: { include: { product: true } },
          supplier: true,
          purchaseOrder: true,
          goodsReceiving: true
        }
      });

      return invoice;
    });

    // No Draft — post immediately (JE + AP, Unpaid)
    return await this.postInvoice(invoice.id, data.createdBy || data.userId);
  }

  // ============================================================
  // CREATE PURCHASE INVOICE FROM PURCHASE ORDER
  // ============================================================
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

      const receivedQty = {};
      for (const grn of purchaseOrder.goodsReceivings) {
        for (const item of grn.items) {
          receivedQty[item.purchaseOrderItemId] =
            (receivedQty[item.purchaseOrderItemId] || 0) + item.receivingQuantity;
        }
      }

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
          // Prefer confirmed received qty; otherwise use ordered PO qty
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
            notes: item.notes || null
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
          items: { create: invoiceItems }
        },
        include: {
          items: { include: { product: true } },
          supplier: true,
          purchaseOrder: true
        }
      });

      return invoice;
    });

    // No Draft — post immediately (JE + AP, Unpaid)
    return await this.postInvoice(invoice.id, data.createdBy || data.userId);
  }

  // ============================================================
  // POST PURCHASE INVOICE (Create Accounting Entries)
  // ============================================================
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
        purchaseOrder: { select: { id: true, orderNumber: true, status: true } },
        goodsReceiving: { select: { id: true, grnNumber: true, status: true } },
        creator: { select: { id: true, firstName: true, lastName: true, email: true } },
        accountsPayable: { include: { payments: true } }
      }
    });
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

  // ============================================================
  // UPDATE PAYMENT STATUS (Called from Payment Made)
  // ============================================================
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
}

module.exports = PurchaseInvoiceModel;