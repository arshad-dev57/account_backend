
const prisma = require('../../prisma/client');
const { randomUUID } = require('crypto');
const { getOrCreateCashAccount } = require('../../utils/cashAccountHelper');
const {
  resolveLocationId,
  adjustLocationStock,
} = require('../../warehouse/services/locationService');

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
async function findOrCreateCustomerCreditAccount(tx, companyId, userId) {
  let acc = await tx.chartOfAccount.findFirst({
    where: {
      companyId,
      isActive: true,
      OR: [
        { code: '2150' },
        { name: { contains: 'Store Credit', mode: 'insensitive' } },
        { name: { contains: 'Customer Credit', mode: 'insensitive' } },
      ],
    },
  });
  if (!acc) {
    acc = await tx.chartOfAccount.create({
      data: {
        code: '2150',
        name: 'Customer Store Credit',
        type: 'Liability',
        parentAccount: 'Current Liabilities',
        openingBalance: 0,
        currentBalance: 0,
        balanceType: 'Credit',
        description: 'POS store credit owed to customers',
        isActive: true,
        createdBy: userId,
        companyId,
      },
    });
  }
  return acc;
}

async function resolveDebitAccountForPayment(tx, companyId, userId, paymentMethod) {
  const method = (paymentMethod || 'Cash').toLowerCase();
  if (method === 'cash') return findOrCreateCashAccount(tx, companyId, userId);
  if (['card', 'bank', 'bank transfer', 'mobile wallet', 'cheque'].includes(method)) return findOrCreateBankAccount(tx, companyId, userId);
  if (method.includes('store credit') || method.includes('credit')) {
    return findOrCreateCustomerCreditAccount(tx, companyId, userId);
  }
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
      companyId, createdBy, isOffline = false, offlineCreatedAt = null,
      locationId: locationIdInput,
      // When true (offline batch-sync): skip availability check and clamp
      // stock to 0 instead of throwing if server stock is already depleted.
      skipStockChecks = false,
    } = data;

    if (id) {
      const existing = await prisma.pOSSale.findFirst({
        where: { id, companyId },
        include: { items: true, payments: true },
      });
      if (existing) {
        return { sale: existing, journalEntry: null, duplicate: true };
      }
    }

    const taxProfile = await prisma.companyTaxProfile.findUnique({ where: { companyId } }).catch(() => null);
    const taxOn = Boolean(taxProfile?.taxEnabled);

    // Pre-compute totals — quantity must be a whole unit (tax must never change qty)
    let subtotal = 0;
    const processedItems = [];
    for (const item of items) {
      const quantity = Math.max(0, Math.round(Number(item.quantity) || 0));
      const isCustom = Boolean(item.isCustom) || !item.productId || String(item.productId).startsWith('custom-');
      if (quantity <= 0) continue;
      if (!isCustom && !item.productId) continue;
      if (!String(item.productName || '').trim()) continue;
      const lineTotal = parseFloat((quantity * item.unitPrice).toFixed(2));
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
      processedItems.push({
        ...item,
        quantity,
        isCustom,
        productId: isCustom ? null : item.productId,
        sku: isCustom ? (item.sku || 'CUSTOM') : (item.sku || ''),
        productName: String(item.productName || 'Custom item').trim(),
        lineTotal: finalLineTotal,
        taxAmount,
        discountAmount: discountAmt,
        inclusive,
      });
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
      let resolvedLocationId = locationIdInput || null;
      if (!resolvedLocationId && terminalId) {
        const terminal = await tx.pOSTerminal.findFirst({
          where: { id: terminalId, companyId },
          select: { locationId: true },
        });
        resolvedLocationId = terminal?.locationId || null;
      }
      const locationId = await resolveLocationId(
        tx,
        companyId,
        resolvedLocationId,
        createdBy
      );

      // ── 1. Validate products + Reduce Stock ──────────────────
      let totalCOGS = 0;
      for (const item of processedItems) {
        if (item.isCustom || !item.productId) continue;
        const product = await tx.product.findFirst({
          where: { id: item.productId, companyId, isActive: true }
        });
        if (!product) throw new Error(`Product not found or inactive: ${item.productName || item.productId}`);

        const qty = Math.max(0, Math.round(Number(item.quantity) || 0));
        const adj = await adjustLocationStock(tx, {
          companyId,
          productId: product.id,
          locationId,
          delta: -qty,
          checkAvailable: !skipStockChecks,
          allowNegative: skipStockChecks,
          productName: product.name,
        });

        await tx.stockMovement.create({
          data: {
            productId: product.id,
            productName: product.name,
            type: 'stock_out',
            quantity: qty,
            previousStock: adj.previousLocationStock,
            newStock: adj.newLocationStock,
            reason: 'POS Sale',
            customerName: customerName || 'Walk-in',
            reference: invoiceNumber,
            notes: `POS Sale — ${invoiceNumber}`,
            createdBy,
            companyId,
            locationId,
          }
        });

        totalCOGS += product.costPrice * qty;
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

      // Get current fiscal year for the company
      const currentFiscalYear = await tx.fiscalYear.findFirst({
        where: { 
          companyId, 
          status: 'Open',
          startDate: { lte: new Date() },
          endDate: { gte: new Date() }
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
          fiscalYearId: currentFiscalYear?.id || null,
          syncStatus: isOffline ? 'Completed' : 'Completed',
          isOffline,
          offlineCreatedAt: offlineCreatedAt ? new Date(offlineCreatedAt) : null,
          companyId,
          createdBy,
          items: {
            create: processedItems.map(item => ({
              productId: item.productId || null,
              productName: item.productName,
              sku: item.sku || (item.isCustom ? 'CUSTOM' : ''),
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
      const isStoreCredit = String(refundMethod || '').toLowerCase().includes('store credit');
      if (isStoreCredit && !originalSale.customerId) {
        throw new Error('Store credit requires a named customer on the original sale');
      }

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

        if (product) {
          let returnLocationId = null;
          if (originalSale.terminalId) {
            const terminal = await tx.pOSTerminal.findFirst({
              where: { id: originalSale.terminalId, companyId },
              select: { locationId: true },
            });
            returnLocationId = terminal?.locationId || null;
          }
          const locationId = await resolveLocationId(
            tx,
            companyId,
            returnLocationId,
            createdBy
          );
          const adj = await adjustLocationStock(tx, {
            companyId,
            productId: product.id,
            locationId,
            delta: ri.quantity,
          });
          totalCOGS += product.costPrice * ri.quantity;

          await tx.stockMovement.create({
            data: {
              productId: product.id, productName: product.name,
              type: 'stock_in', quantity: ri.quantity,
              previousStock: adj.previousLocationStock,
              newStock: adj.newLocationStock,
              reason: 'POS Return', reference: originalSale.invoiceNumber,
              notes: `POS Return from ${originalSale.invoiceNumber}`, createdBy, companyId,
              locationId,
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
        if (!item.productId) continue;
        const product = await tx.product.findFirst({ where: { id: item.productId, companyId } });
        if (!product) continue;

        let voidLocationId = null;
        if (sale.terminalId) {
          const terminal = await tx.pOSTerminal.findFirst({
            where: { id: sale.terminalId, companyId },
            select: { locationId: true },
          });
          voidLocationId = terminal?.locationId || null;
        }
        const locationId = await resolveLocationId(
          tx,
          companyId,
          voidLocationId,
          createdBy
        );
        const adj = await adjustLocationStock(tx, {
          companyId,
          productId: product.id,
          locationId,
          delta: item.quantity,
        });
        totalCOGS += product.costPrice * item.quantity;
        await tx.stockMovement.create({
          data: {
            productId: product.id,
            productName: product.name,
            type: 'stock_in',
            quantity: item.quantity,
            previousStock: adj.previousLocationStock,
            newStock: adj.newLocationStock,
            reason: 'POS Void',
            reference: sale.invoiceNumber,
            notes: `Void ${sale.invoiceNumber}: ${reason || ''}`,
            createdBy,
            companyId,
            locationId,
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
        // ── OFFLINE RETURN ─────────────────────────────────────────────
        // Desktop queues returns as { saleId, items, shiftId } plus a local
        // client id. Route them through the same bookkeeping as processReturn
        // (restore stock, create POSReturn, reverse journal entry) and dedupe
        // so a partial/interrupted sync never double-applies a refund.
        if (String(tx.type || '').toUpperCase() === 'RETURN') {
          const originalSaleId = tx.originalSaleId || tx.saleId;
          if (!originalSaleId) throw new Error('Return is missing originalSaleId/saleId');
          const returnItems = (tx.returnItems || tx.items || []).map((ri) => ({
            productId: ri.productId,
            quantity: ri.quantity,
          }));
          if (returnItems.length === 0) throw new Error('Return has no items to refund');

          const existingReturn = await POSSaleModel.findExistingReturnForItems(
            originalSaleId,
            companyId,
            returnItems
          );
          if (existingReturn) {
            results.push({
              id: tx.id,
              returnNumber: existingReturn.returnNumber,
              status: 'skipped',
              reason: 'Return already synced',
            });
            continue;
          }

          const result = await POSSaleModel.processReturn({
            originalSaleId,
            returnItems,
            refundMethod: tx.refundMethod || 'Cash',
            reason: tx.reason || 'Returned at POS (offline sync)',
            approvedBy: createdBy,
            companyId,
            createdBy,
            shiftId: tx.shiftId,
          });
          results.push({
            id: tx.id,
            returnNumber: result.posReturn.returnNumber,
            status: 'success',
          });
          continue;
        }

        // ── NORMAL SALE ────────────────────────────────────────────────
        // Idempotency check
        const existing = await prisma.pOSSale.findFirst({ where: { id: tx.id, companyId } });
        if (existing) {
          results.push({ id: tx.id, status: 'skipped', reason: 'Already synced' });
          continue;
        }
        
        // For desktop sync, handle shift and terminal assignment
        let shiftId = tx.shiftId;
        let terminalId = tx.terminalId;
        
        // Get or create valid terminal
        if (!terminalId || terminalId === 'default-terminal') {
          const existingTerminal = await prisma.pOSTerminal.findFirst({
            where: { companyId }
          });
          if (existingTerminal) {
            terminalId = existingTerminal.id;
          } else {
            // Create a default terminal if none exists
            const newTerminal = await prisma.pOSTerminal.create({
              data: {
                companyId,
                name: 'Default Terminal',
                locationId: null,
                isActive: true
              }
            });
            terminalId = newTerminal.id;
          }
        }
        
        // Handle shift assignment
        if (!shiftId || String(shiftId).startsWith('local-shift-')) {
          // If no valid shift ID or local shift ID, get/create active shift
          const activeShift = await prisma.pOSShift.findFirst({
            where: { cashierId: createdBy, companyId, status: 'Open' }
          });
          if (activeShift) {
            shiftId = activeShift.id;
            // Use the shift's terminal if available
            if (activeShift.terminalId) {
              terminalId = activeShift.terminalId;
            }
          } else {
            // Create a new shift if none exists
            const newShift = await prisma.pOSShift.create({
              data: {
                cashierId: createdBy,
                companyId,
                terminalId: terminalId,
                status: 'Open',
                openingCash: 0,
                openingAt: new Date()
              }
            });
            shiftId = newShift.id;
          }
        }
        
        const result = await POSSaleModel.completeSale({
          ...tx,
          shiftId,
          terminalId,
          companyId,
          createdBy,
          isOffline: true,
          skipStockChecks: true,
        });
        results.push({ id: tx.id, invoiceNumber: result.sale.invoiceNumber, status: 'success' });
      } catch (err) {
        results.push({ id: tx.id || tx.saleId, status: 'failed', reason: err.message });
      }
    }
    return results;
  }

  // Returns an existing POSReturn for the original sale that refunds the exact
  // same set of products/quantities — used to make offline return sync idempotent.
  static async findExistingReturnForItems(originalSaleId, companyId, returnItems) {
    const returns = await prisma.pOSReturn.findMany({
      where: { originalSaleId, companyId },
      include: { items: true },
    });
    if (!returns.length) return null;
    const signature = (items) =>
      items
        .filter((i) => i.quantity > 0)
        .map((i) => `${i.productId}:${i.quantity}`)
        .sort()
        .join('|');
    const targetSig = signature(returnItems);
    return (
      returns.find(
        (r) => signature(r.items.map((i) => ({ productId: i.productId, quantity: i.quantity }))) === targetSig
      ) || null
    );
  }

  // ============================================================
  // GETTERS
  // ============================================================
  static async findByInvoice(invoiceNumber, companyId) {
    return prisma.pOSSale.findFirst({
      where: { invoiceNumber: String(invoiceNumber).trim(), companyId },
      include: {
        items: { include: { product: { select: { id: true, name: true, sku: true, sellingPrice: true, mainImage: true } } } },
        payments: true,
        shift: { include: { cashier: { select: { id: true, firstName: true, lastName: true } }, terminal: true } },
        terminal: true,
        customer: true,
        returns: { include: { items: true } },
      },
    });
  }

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
        shift: {
          include: {
            cashier: { select: { id: true, firstName: true, lastName: true } },
            terminal: {
              select: {
                id: true,
                name: true,
                code: true,
                locationId: true,
                location: { select: { id: true, name: true, code: true, type: true } },
              },
            },
          },
        },
      }
    });
  }

  static async count(filter = {}) {
    return prisma.pOSSale.count({ where: filter });
  }
}

module.exports = POSSaleModel;
