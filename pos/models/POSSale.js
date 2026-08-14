// pos/models/POSSale.js — Complete POS Sale Model
// Reuses: Product stock, JournalEntry, StockMovement (NO Fiscal Year dependency)

const prisma = require('../../prisma/client');
const { randomUUID } = require('crypto');
const { getOrCreateCashAccount } = require('../../utils/cashAccountHelper');

// ─── Number Generators ─────────────────────────────────────────────────────
function generatePOSInvoiceNumber() {
  const d = new Date();
  const ts = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
  return `POS-${ts}-${Math.floor(Math.random() * 100000).toString().padStart(5, '0')}`;
}
function generateReturnNumber() {
  return `RET-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
}
function generateJENumber() {
  return `JE-POS-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
}

// ─── GL Account Helpers (mirrors existing SalesInvoice/PurchaseInvoice pattern) ──
async function findOrCreateCashAccount(tx, companyId, userId) {
  return getOrCreateCashAccount(userId, companyId, tx);
}
async function findOrCreateBankAccount(tx, companyId, userId) {
  let acc = await tx.chartOfAccount.findFirst({
    where: { companyId, isActive: true, OR: [{ code: '1110' }, { name: { contains: 'Bank', mode: 'insensitive' } }] }
  });
  if (!acc) {
    acc = await tx.chartOfAccount.create({ data: { code: '1110', name: 'Bank Account', type: 'Asset', parentAccount: 'Current Assets', openingBalance: 0, currentBalance: 0, balanceType: 'Debit', description: 'Bank account', isActive: true, createdBy: userId, companyId } });
  }
  return acc;
}
async function findOrCreateSalesRevenueAccount(tx, companyId, userId) {
  let acc = await tx.chartOfAccount.findFirst({
    where: { companyId, isActive: true, OR: [{ code: '4000' }, { name: { contains: 'Sales Revenue', mode: 'insensitive' } }, { name: { contains: 'Revenue', mode: 'insensitive' } }] }
  });
  if (!acc) {
    acc = await tx.chartOfAccount.create({ data: { code: '4000', name: 'Sales Revenue', type: 'Revenue', parentAccount: 'Operating Revenue', openingBalance: 0, currentBalance: 0, balanceType: 'Credit', description: 'Sales Revenue', isActive: true, createdBy: userId, companyId } });
  }
  return acc;
}
async function findOrCreateCOGSAccount(tx, companyId, userId) {
  let acc = await tx.chartOfAccount.findFirst({
    where: { companyId, isActive: true, OR: [{ code: '5000' }, { name: { contains: 'Cost of Goods', mode: 'insensitive' } }, { name: { contains: 'COGS', mode: 'insensitive' } }] }
  });
  if (!acc) {
    acc = await tx.chartOfAccount.create({ data: { code: '5000', name: 'Cost of Goods Sold', type: 'Expense', parentAccount: 'Cost of Sales', openingBalance: 0, currentBalance: 0, balanceType: 'Debit', description: 'Cost of Goods Sold', isActive: true, createdBy: userId, companyId } });
  }
  return acc;
}
async function findOrCreateInventoryAccount(tx, companyId, userId) {
  let acc = await tx.chartOfAccount.findFirst({
    where: { companyId, isActive: true, OR: [{ code: '1300' }, { name: { contains: 'Inventory', mode: 'insensitive' } }, { name: { contains: 'Stock', mode: 'insensitive' } }] }
  });
  if (!acc) {
    acc = await tx.chartOfAccount.create({ data: { code: '1300', name: 'Inventory', type: 'Asset', parentAccount: 'Current Assets', openingBalance: 0, currentBalance: 0, balanceType: 'Debit', description: 'Inventory/Stock Account', isActive: true, createdBy: userId, companyId } });
  }
  return acc;
}

// ─── GL Account for payment method ──────────────────────────────────────────
async function resolveDebitAccountForPayment(tx, companyId, userId, paymentMethod) {
  const method = (paymentMethod || 'Cash').toLowerCase();
  if (method === 'cash') return findOrCreateCashAccount(tx, companyId, userId);
  if (['card', 'bank', 'bank transfer', 'mobile wallet', 'cheque'].includes(method)) return findOrCreateBankAccount(tx, companyId, userId);
  return findOrCreateCashAccount(tx, companyId, userId);
}

class POSSaleModel {


  // ============================================================
  // COMPLETE POS SALE — Inventory + JE + COGS in one transaction
  // ============================================================
  static async completeSale(data) {
    const {
      id, shiftId, terminalId, customerId, customerName, customerEmail, customerPhone,
      items, payments, discountTotal = 0, taxTotal = 0, notes,
      companyId, createdBy, isOffline = false, offlineCreatedAt = null
    } = data;

    const taxProfile = await prisma.companyTaxProfile.findUnique({ where: { companyId } }).catch(() => null);
    const taxOn = Boolean(taxProfile?.taxEnabled);

    // Pre-compute totals
    let subtotal = 0;
    const processedItems = [];
    for (const item of items) {
      const lineTotal = parseFloat((item.quantity * item.unitPrice).toFixed(2));
      const discountAmt = item.discount ? parseFloat((lineTotal * item.discount / 100).toFixed(2)) : 0;
      const taxableAmt = lineTotal - discountAmt;
      const pricing = String(item.pricingModel || item.taxType || 'exclusive').toLowerCase();
      const inclusive = taxOn && pricing.includes('inclusive');
      let taxAmount = 0;
      if (taxOn && item.taxRate) {
        if (inclusive) {
          const divisor = 1 + item.taxRate / 100;
          taxAmount = parseFloat((taxableAmt - taxableAmt / divisor).toFixed(2));
        } else {
          taxAmount = parseFloat((taxableAmt * item.taxRate / 100).toFixed(2));
        }
      }
      const finalLineTotal = inclusive
        ? parseFloat(taxableAmt.toFixed(2))
        : parseFloat((taxableAmt + taxAmount).toFixed(2));
      subtotal += lineTotal;
      processedItems.push({ ...item, lineTotal: finalLineTotal, taxAmount, discountAmount: discountAmt, inclusive });
    }
    const anyInclusive = processedItems.some((i) => i.inclusive);
    const appliedTaxTotal = taxOn ? taxTotal : 0;
    const grandTotal = parseFloat(
      (anyInclusive ? subtotal - discountTotal : subtotal - discountTotal + appliedTaxTotal).toFixed(2)
    );
    const paidAmount = payments.reduce((s, p) => s + p.amount, 0);
    const changeAmount = parseFloat((paidAmount - grandTotal).toFixed(2));

    const invoiceNumber = generatePOSInvoiceNumber();

    return await prisma.$transaction(async (tx) => {

      // ── 1. Validate products + Reduce Stock ──────────────────
      let totalCOGS = 0;
      for (const item of processedItems) {
        const product = await tx.product.findFirst({
          where: { id: item.productId, companyId, isActive: true }
        });
        if (!product) throw new Error(`Product not found or inactive: ${item.productName || item.productId}`);
        if (product.currentStock < item.quantity) {
          throw new Error(`Insufficient stock for "${product.name}". Available: ${product.currentStock}, Requested: ${item.quantity}`);
        }
        const prevStock = product.currentStock;
        const newStock = prevStock - item.quantity;

        await tx.product.update({
          where: { id: product.id },
          data: { currentStock: newStock, availableStock: newStock, totalValue: newStock * product.costPrice }
        });

        await tx.stockMovement.create({
          data: {
            productId: product.id,
            productName: product.name,
            type: 'stock_out',
            quantity: item.quantity,
            previousStock: prevStock,
            newStock,
            reason: 'POS Sale',
            customerName: customerName || 'Walk-in',
            reference: invoiceNumber,
            notes: `POS Sale — ${invoiceNumber}`,
            createdBy,
            companyId
          }
        });

        totalCOGS += product.costPrice * item.quantity;
      }

      // ── 2. Build Journal Entry lines ─────────────────────────
      const revenueAcc = await findOrCreateSalesRevenueAccount(tx, companyId, createdBy);
      const cogsAcc = await findOrCreateCOGSAccount(tx, companyId, createdBy);
      const inventoryAcc = await findOrCreateInventoryAccount(tx, companyId, createdBy);

      // Build debit lines per payment method (split payments)
      const jeLines = [];
      for (const pmt of payments) {
        const debitAcc = await resolveDebitAccountForPayment(tx, companyId, createdBy, pmt.paymentMethod);
        jeLines.push({ accountId: debitAcc.id, accountName: debitAcc.name, accountCode: debitAcc.code, debit: pmt.amount, credit: 0 });
      }
      // Credit: Sales Revenue
      jeLines.push({ accountId: revenueAcc.id, accountName: revenueAcc.name, accountCode: revenueAcc.code, debit: 0, credit: grandTotal });
      // COGS entry
      jeLines.push({ accountId: cogsAcc.id, accountName: cogsAcc.name, accountCode: cogsAcc.code, debit: totalCOGS, credit: 0 });
      jeLines.push({ accountId: inventoryAcc.id, accountName: inventoryAcc.name, accountCode: inventoryAcc.code, debit: 0, credit: totalCOGS });

      const journalEntry = await tx.journalEntry.create({
        data: {
          entryNumber: generateJENumber(),
          date: new Date(),
          description: `POS Sale ${invoiceNumber} — ${customerName || 'Walk-in'}`,
          reference: invoiceNumber,
          status: 'Posted',
          createdBy,
          postedBy: createdBy,
          postedAt: new Date(),
          companyId,
          lines: { create: jeLines }
        }
      });

      const sale = await tx.pOSSale.create({
        data: {
          id: id || randomUUID(),
          invoiceNumber,
          shiftId,
          terminalId,
          customerId: customerId || null,
          customerName: customerName || 'Walk-in Customer',
          customerEmail: customerEmail || null,
          customerPhone: customerPhone || null,
          subtotal,
          discountTotal,
          taxTotal: appliedTaxTotal,
          grandTotal,
          paidAmount,
          changeAmount,
          notes: notes || null,
          status: 'Completed',
          journalEntryId: journalEntry.id,
          syncStatus: isOffline ? 'Completed' : 'Completed',
          isOffline,
          offlineCreatedAt: offlineCreatedAt ? new Date(offlineCreatedAt) : null,
          companyId,
          createdBy,
          items: {
            create: processedItems.map(item => ({
              productId: item.productId,
              productName: item.productName,
              sku: item.sku || '',
              quantity: item.quantity,
              unitPrice: item.unitPrice,
              discount: item.discount || 0,
              taxRate: item.taxRate || 0,
              taxAmount: item.taxAmount || 0,
              lineTotal: item.lineTotal,
              notes: item.notes || null
            }))
          },
          payments: {
            create: payments.map(pmt => ({
              paymentMethod: pmt.paymentMethod,
              amount: pmt.amount,
              reference: pmt.reference || ''
            }))
          }
        },
        include: { items: true, payments: true }
      });

      // ── 4. Update customer stats + loyalty ───────────────────
      if (customerId) {
        const loyaltyEarn = Math.max(0, Math.floor(grandTotal)); // 1 point per currency unit
        await tx.customer.update({
          where: { id: customerId },
          data: {
            totalOrders: { increment: 1 },
            totalSpent: { increment: grandTotal },
            lastOrderDate: new Date(),
            loyaltyPoints: { increment: loyaltyEarn }
          }
        }).catch(() => { }); // Non-fatal
      }

      // ── 5. Audit log ─────────────────────────────────────────
      await tx.pOSAuditLog.create({
        data: { action: 'Sale', details: `POS Sale ${invoiceNumber} — Total: ${grandTotal}`, companyId, createdBy }
      });

      return { sale, journalEntry };
    });
  }

  // ============================================================
  // HOLD SALE (No stock deduction, no JE)
  // ============================================================
  static async holdSale(data) {
    const { shiftId, terminalId, customerId, customerName, customerEmail, customerPhone,
      items, discountTotal = 0, taxTotal = 0, notes,
      companyId, createdBy } = data;

    let subtotal = 0;
    const processedItems = items.map(item => {
      const lineTotal = parseFloat((item.quantity * item.unitPrice).toFixed(2));
      subtotal += lineTotal;
      return { ...item, lineTotal, taxAmount: 0 };
    });

    const grandTotal = parseFloat((subtotal - discountTotal + taxTotal).toFixed(2));
    const invoiceNumber = generatePOSInvoiceNumber();

    return await prisma.pOSSale.create({
      data: {
        invoiceNumber,
        shiftId, terminalId,
        customerId: customerId || null,
        customerName: customerName || 'Walk-in Customer',
        customerEmail: customerEmail || null,
        customerPhone: customerPhone || null,
        subtotal, discountTotal, taxTotal, grandTotal,
        paidAmount: 0, changeAmount: 0,
        notes: notes || null,
        status: 'Held',
        companyId, createdBy,
        items: {
          create: processedItems.map(i => ({
            productId: i.productId, productName: i.productName, sku: i.sku || '',
            quantity: i.quantity, unitPrice: i.unitPrice, discount: i.discount || 0,
            taxRate: i.taxRate || 0, taxAmount: 0, lineTotal: i.lineTotal, notes: i.notes || null
          }))
        }
      },
      include: { items: true }
    });
  }

  // ============================================================
  // PROCESS RETURN (partial or full, reverses JE + restores stock)
  // ============================================================
  static async processReturn(data) {
    const { originalSaleId, returnItems, refundMethod, reason, approvedBy, companyId, createdBy, shiftId } = data;

    return await prisma.$transaction(async (tx) => {
      const originalSale = await tx.pOSSale.findFirst({
        where: { id: originalSaleId, companyId },
        include: { items: true }
      });
      if (!originalSale) throw new Error('Original POS sale not found');
      if (originalSale.status === 'Returned') throw new Error('Sale is already fully returned');

      let subtotal = 0, grandTotal = 0, totalCOGS = 0;
      const returnItemsData = [];

      for (const ri of returnItems) {
        const origItem = originalSale.items.find(i => i.productId === ri.productId);
        if (!origItem) throw new Error(`Product ${ri.productId} not in original sale`);
        if (ri.quantity > origItem.quantity) throw new Error(`Return qty exceeds sold qty for product ${origItem.productName}`);

        const lineTotal = parseFloat((ri.quantity * origItem.unitPrice).toFixed(2));
        subtotal += lineTotal;
        grandTotal += lineTotal;

        const product = await tx.product.findFirst({ where: { id: ri.productId, companyId } });
        const prevStock = product ? product.currentStock : 0;
        const newStock = prevStock + ri.quantity;

        // Restore inventory
        if (product) {
          await tx.product.update({
            where: { id: product.id },
            data: { currentStock: newStock, availableStock: newStock, totalValue: newStock * product.costPrice }
          });
          totalCOGS += product.costPrice * ri.quantity;

          await tx.stockMovement.create({
            data: {
              productId: product.id, productName: product.name,
              type: 'stock_in', quantity: ri.quantity, previousStock: prevStock, newStock,
              reason: 'POS Return', reference: originalSale.invoiceNumber,
              notes: `POS Return from ${originalSale.invoiceNumber}`, createdBy, companyId
            }
          });
        }
        returnItemsData.push({ productId: ri.productId, quantity: ri.quantity, unitPrice: origItem.unitPrice, lineTotal });
      }

      const returnNumber = generateReturnNumber();

      // Reverse Journal Entry: debit Revenue, credit Cash; debit Inventory, credit COGS
      const revenueAcc = await findOrCreateSalesRevenueAccount(tx, companyId, createdBy);
      const cogsAcc = await findOrCreateCOGSAccount(tx, companyId, createdBy);
      const inventoryAcc = await findOrCreateInventoryAccount(tx, companyId, createdBy);
      const refundAcc = await resolveDebitAccountForPayment(tx, companyId, createdBy, refundMethod);

      const journalEntry = await tx.journalEntry.create({
        data: {
          entryNumber: generateJENumber(),
          date: new Date(),
          description: `POS Return ${returnNumber} from ${originalSale.invoiceNumber}`,
          reference: returnNumber,
          status: 'Posted', createdBy, postedBy: createdBy, postedAt: new Date(),
          companyId,
          lines: {
            create: [
              { accountId: revenueAcc.id, accountName: revenueAcc.name, accountCode: revenueAcc.code, debit: grandTotal, credit: 0 },
              { accountId: refundAcc.id, accountName: refundAcc.name, accountCode: refundAcc.code, debit: 0, credit: grandTotal },
              { accountId: inventoryAcc.id, accountName: inventoryAcc.name, accountCode: inventoryAcc.code, debit: totalCOGS, credit: 0 },
              { accountId: cogsAcc.id, accountName: cogsAcc.name, accountCode: cogsAcc.code, debit: 0, credit: totalCOGS }
            ]
          }
        }
      });

      const posReturn = await tx.pOSReturn.create({
        data: {
          id: `ret-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
          originalSaleId, returnNumber, shiftId,
          subtotal, discountTotal: 0, taxTotal: 0, grandTotal,
          refundedAmount: grandTotal, refundMethod, reason, approvedBy,
          companyId, createdBy,
          items: { create: returnItemsData }
        },
        include: { items: true }
      });

      // Check if full return
      const allReturned = originalSale.items.every(origItem => {
        const returnedQty = returnItems.filter(ri => ri.productId === origItem.productId).reduce((s, ri) => s + ri.quantity, 0);
        return returnedQty >= origItem.quantity;
      });
      if (allReturned) {
        await tx.pOSSale.update({ where: { id: originalSaleId }, data: { status: 'Returned' } });
      }

      await tx.pOSAuditLog.create({
        data: { action: 'Return', details: `POS Return ${returnNumber} — Refund: ${grandTotal}`, companyId, createdBy }
      });

      return { posReturn, journalEntry };
    });
  }

  // ============================================================
  // VOID COMPLETED SALE (restore stock + reverse JE)
  // ============================================================
  static async voidSale({ saleId, companyId, createdBy, reason }) {
    return await prisma.$transaction(async (tx) => {
      const sale = await tx.pOSSale.findFirst({
        where: { id: saleId, companyId },
        include: { items: true, payments: true }
      });
      if (!sale) throw new Error('Sale not found');
      if (sale.status !== 'Completed') {
        throw new Error(`Only completed sales can be voided (current: ${sale.status})`);
      }
      if (sale.invoiceId) {
        throw new Error('Sale already converted to invoice — void the invoice instead');
      }

      let totalCOGS = 0;
      for (const item of sale.items) {
        const product = await tx.product.findFirst({ where: { id: item.productId, companyId } });
        if (!product) continue;
        const prevStock = product.currentStock;
        const newStock = prevStock + item.quantity;
        await tx.product.update({
          where: { id: product.id },
          data: {
            currentStock: newStock,
            availableStock: newStock,
            totalValue: newStock * product.costPrice
          }
        });
        totalCOGS += product.costPrice * item.quantity;
        await tx.stockMovement.create({
          data: {
            productId: product.id,
            productName: product.name,
            type: 'stock_in',
            quantity: item.quantity,
            previousStock: prevStock,
            newStock,
            reason: 'POS Void',
            reference: sale.invoiceNumber,
            notes: `Void ${sale.invoiceNumber}: ${reason || ''}`,
            createdBy,
            companyId
          }
        });
      }

      const revenueAcc = await findOrCreateSalesRevenueAccount(tx, companyId, createdBy);
      const cogsAcc = await findOrCreateCOGSAccount(tx, companyId, createdBy);
      const inventoryAcc = await findOrCreateInventoryAccount(tx, companyId, createdBy);

      const jeLines = [];
      // Reverse payments: credit cash/bank (money leaves drawer conceptually)
      for (const pmt of sale.payments) {
        const debitAcc = await resolveDebitAccountForPayment(tx, companyId, createdBy, pmt.paymentMethod);
        jeLines.push({
          accountId: debitAcc.id,
          accountName: debitAcc.name,
          accountCode: debitAcc.code,
          debit: 0,
          credit: pmt.amount
        });
      }
      jeLines.push({
        accountId: revenueAcc.id,
        accountName: revenueAcc.name,
        accountCode: revenueAcc.code,
        debit: sale.grandTotal,
        credit: 0
      });
      if (totalCOGS > 0) {
        jeLines.push({
          accountId: inventoryAcc.id,
          accountName: inventoryAcc.name,
          accountCode: inventoryAcc.code,
          debit: totalCOGS,
          credit: 0
        });
        jeLines.push({
          accountId: cogsAcc.id,
          accountName: cogsAcc.name,
          accountCode: cogsAcc.code,
          debit: 0,
          credit: totalCOGS
        });
      }

      const journalEntry = await tx.journalEntry.create({
        data: {
          entryNumber: generateJENumber(),
          date: new Date(),
          description: `POS Void ${sale.invoiceNumber} — ${reason || 'Voided'}`,
          reference: sale.invoiceNumber,
          status: 'Posted',
          createdBy,
          postedBy: createdBy,
          postedAt: new Date(),
          companyId,
          lines: { create: jeLines }
        }
      });

      const updated = await tx.pOSSale.update({
        where: { id: saleId },
        data: {
          status: 'Cancelled',
          notes: `${sale.notes || ''}\nVOIDED: ${reason || ''}`.trim()
        },
        include: { items: true, payments: true }
      });

      if (sale.customerId) {
        const loyaltyRevoke = Math.max(0, Math.floor(sale.grandTotal));
        await tx.customer.update({
          where: { id: sale.customerId },
          data: {
            totalOrders: { decrement: 1 },
            totalSpent: { decrement: sale.grandTotal },
            loyaltyPoints: { decrement: loyaltyRevoke }
          }
        }).catch(() => {});
      }

      await tx.pOSAuditLog.create({
        data: {
          action: 'Void',
          details: `Voided POS sale ${sale.invoiceNumber} — ${reason || ''}`,
          companyId,
          createdBy
        }
      });

      return { sale: updated, journalEntry };
    });
  }

  // ============================================================
  // BATCH SYNC (Idempotent — skips already-synced IDs)
  // ============================================================
  static async batchSync(transactions, companyId, createdBy) {
    const results = [];
    for (const tx of transactions) {
      try {
        // Idempotency check
        const existing = await prisma.pOSSale.findFirst({ where: { id: tx.id, companyId } });
        if (existing) {
          results.push({ id: tx.id, status: 'skipped', reason: 'Already synced' });
          continue;
        }
        const result = await POSSaleModel.completeSale({ ...tx, companyId, createdBy });
        results.push({ id: tx.id, invoiceNumber: result.sale.invoiceNumber, status: 'success' });
      } catch (err) {
        results.push({ id: tx.id, status: 'failed', reason: err.message });
      }
    }
    return results;
  }

  // ============================================================
  // GETTERS
  // ============================================================
  static async findById(id, companyId) {
    return prisma.pOSSale.findFirst({
      where: { id, companyId },
      include: {
        items: { include: { product: { select: { id: true, name: true, sku: true, sellingPrice: true, mainImage: true } } } },
        payments: true,
        shift: { include: { cashier: { select: { id: true, firstName: true, lastName: true } }, terminal: true } },
        terminal: true,
        customer: true,
        journalEntry: { include: { lines: { include: { account: true } } } },
        returns: { include: { items: true } }
      }
    });
  }

  static async findAll(filter = {}, options = {}) {
    const { skip, take, orderBy = { createdAt: 'desc' } } = options;
    return prisma.pOSSale.findMany({
      where: filter,
      skip, take, orderBy,
      include: {
        items: true, payments: true,
        customer: { select: { id: true, name: true, phone: true } },
        shift: { include: { cashier: { select: { id: true, firstName: true, lastName: true } }, terminal: true } }
      }
    });
  }

  static async count(filter = {}) {
    return prisma.pOSSale.count({ where: filter });
  }
}

module.exports = POSSaleModel;
