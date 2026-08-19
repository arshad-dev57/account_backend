/**
 * Stock Movement ↔ General Ledger bridge.
 * Direct stock in/out posts journal entries based on business reason.
 */

const prisma = require('../../prisma/client');
const BalanceCalculator = require('../../utils/balanceCalculator');
const { getOrCreateApAccount } = require('../../utils/apAccountHelper');
const { resolveFiscalYearId } = require('../../utils/fiscalYearHelper');

const STOCK_IN_REASONS = {
  opening_stock: {
    label: 'Opening Stock',
    requiresAccounting: true,
    requiresSupplier: false,
    requiresBankAccount: false,
  },
  owner_contribution: {
    label: 'Owner Contribution',
    requiresAccounting: true,
    requiresSupplier: false,
    requiresBankAccount: false,
  },
  supplier_credit: {
    label: 'Supplier Credit (Pay Later)',
    requiresAccounting: true,
    requiresSupplier: true,
    requiresBankAccount: false,
  },
  cash_purchase: {
    label: 'Cash / Bank Purchase',
    requiresAccounting: true,
    requiresSupplier: false,
    requiresBankAccount: true,
  },
  free_sample: {
    label: 'Free / Sample / Gift',
    requiresAccounting: true,
    requiresSupplier: false,
    requiresBankAccount: false,
  },
  physical_adjustment_in: {
    label: 'Physical Count Adjustment (+)',
    requiresAccounting: true,
    requiresSupplier: false,
    requiresBankAccount: false,
  },
  transfer_in: {
    label: 'Transfer In (No Accounting)',
    requiresAccounting: false,
    requiresSupplier: false,
    requiresBankAccount: false,
  },
};

const STOCK_OUT_REASONS = {
  damage_expiry: { label: 'Damage / Expiry / Write-off' },
  sample_gift: { label: 'Sample / Gift / Promotion' },
  physical_adjustment_out: { label: 'Physical Count Adjustment (-)' },
  internal_use: { label: 'Internal / Office Use' },
};

function listStockReasons() {
  return {
    stockIn: Object.entries(STOCK_IN_REASONS).map(([key, meta]) => ({
      value: key,
      ...meta,
    })),
    stockOut: Object.entries(STOCK_OUT_REASONS).map(([key, meta]) => ({
      value: key,
      ...meta,
    })),
  };
}

function validateStockInReason(reasonKey) {
  const meta = STOCK_IN_REASONS[reasonKey];
  if (!meta) {
    const err = new Error(
      `Invalid stock source reason. Allowed: ${Object.keys(STOCK_IN_REASONS).join(', ')}`
    );
    err.statusCode = 400;
    throw err;
  }
  return meta;
}

function validateStockOutReason(reasonKey) {
  const meta = STOCK_OUT_REASONS[reasonKey];
  if (!meta) {
    const err = new Error(
      `Invalid stock out reason. Allowed: ${Object.keys(STOCK_OUT_REASONS).join(', ')}`
    );
    err.statusCode = 400;
    throw err;
  }
  return meta;
}

async function findOrCreateInventoryAccount(tx, companyId, userId) {
  let account = await tx.chartOfAccount.findFirst({
    where: {
      companyId,
      isActive: true,
      OR: [
        { code: '1300' },
        { code: '1200' },
        { name: { contains: 'Inventory', mode: 'insensitive' } },
        { name: { contains: 'Stock', mode: 'insensitive' } },
      ],
    },
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
        description: 'Inventory — auto-created for stock movements',
        isActive: true,
        createdBy: userId || 'SYSTEM',
        companyId,
      },
    });
  }
  return account;
}

async function findOrCreateEquityAccount(tx, companyId, userId, preferCode) {
  const codes = preferCode ? [preferCode, '3010', '3001'] : ['3010', '3001'];
  let account = await tx.chartOfAccount.findFirst({
    where: {
      companyId,
      isActive: true,
      OR: [
        ...codes.map((code) => ({ code })),
        { name: { contains: 'Opening Balance Equity', mode: 'insensitive' } },
        { name: { contains: "Owner's Capital", mode: 'insensitive' } },
        { name: { contains: 'Owner Capital', mode: 'insensitive' } },
      ],
    },
  });

  if (!account) {
    account = await tx.chartOfAccount.create({
      data: {
        code: preferCode || '3010',
        name: 'Opening Balance Equity',
        type: 'Equity',
        parentAccount: 'Equity',
        openingBalance: 0,
        currentBalance: 0,
        balanceType: 'Credit',
        description: 'Opening balance equity — stock movements',
        isActive: true,
        createdBy: userId || 'SYSTEM',
        companyId,
      },
    });
  }
  return account;
}

async function findOrCreateExpenseAccount(tx, companyId, userId, name, code) {
  let account = await tx.chartOfAccount.findFirst({
    where: {
      companyId,
      isActive: true,
      OR: [{ code }, { name: { contains: name, mode: 'insensitive' } }],
    },
  });
  if (!account) {
    account = await tx.chartOfAccount.create({
      data: {
        code,
        name,
        type: 'Expense',
        parentAccount: 'Operating Expenses',
        openingBalance: 0,
        currentBalance: 0,
        balanceType: 'Debit',
        description: `${name} — auto-created for stock out`,
        isActive: true,
        createdBy: userId || 'SYSTEM',
        companyId,
      },
    });
  }
  return account;
}

async function findOrCreateOtherIncomeAccount(tx, companyId, userId) {
  let account = await tx.chartOfAccount.findFirst({
    where: {
      companyId,
      isActive: true,
      OR: [
        { code: '4900' },
        { name: { contains: 'Other Income', mode: 'insensitive' } },
      ],
    },
  });
  if (!account) {
    account = await tx.chartOfAccount.create({
      data: {
        code: '4900',
        name: 'Other Income',
        type: 'Revenue',
        parentAccount: 'Other Income',
        openingBalance: 0,
        currentBalance: 0,
        balanceType: 'Credit',
        isActive: true,
        createdBy: userId || 'SYSTEM',
        companyId,
      },
    });
  }
  return account;
}

async function resolveCreditAccount(tx, reasonKey, ctx) {
  const { companyId, userId, supplierId, bankAccountId } = ctx;

  switch (reasonKey) {
    case 'opening_stock':
      return findOrCreateEquityAccount(tx, companyId, userId, '3010');
    case 'owner_contribution':
      return findOrCreateEquityAccount(tx, companyId, userId, '3001');
    case 'supplier_credit': {
      if (!supplierId) {
        const err = new Error('Supplier is required for Supplier Credit stock in');
        err.statusCode = 400;
        throw err;
      }
      return getOrCreateApAccount(userId, companyId, tx);
    }
    case 'cash_purchase': {
      if (!bankAccountId) {
        const err = new Error('Bank account is required for Cash / Bank Purchase');
        err.statusCode = 400;
        throw err;
      }
      const bank = await tx.bankAccount.findFirst({
        where: { id: bankAccountId, companyId },
        include: { chartOfAccount: true },
      });
      if (!bank?.chartOfAccount) {
        const err = new Error('Bank account not found or not linked to chart of accounts');
        err.statusCode = 404;
        throw err;
      }
      return bank.chartOfAccount;
    }
    case 'free_sample':
      return findOrCreateOtherIncomeAccount(tx, companyId, userId);
    case 'physical_adjustment_in':
      return findOrCreateOtherIncomeAccount(tx, companyId, userId);
    default:
      return null;
  }
}

async function resolveDebitAccountForStockOut(tx, reasonKey, companyId, userId) {
  switch (reasonKey) {
    case 'damage_expiry':
      return findOrCreateExpenseAccount(
        tx,
        companyId,
        userId,
        'Inventory Write-off',
        '5105'
      );
    case 'sample_gift':
      return findOrCreateExpenseAccount(
        tx,
        companyId,
        userId,
        'Promotional Expense',
        '5106'
      );
    case 'physical_adjustment_out':
      return findOrCreateExpenseAccount(
        tx,
        companyId,
        userId,
        'Inventory Adjustment Loss',
        '5107'
      );
    case 'internal_use':
      return findOrCreateExpenseAccount(
        tx,
        companyId,
        userId,
        'Internal Consumption',
        '5108'
      );
    default:
      return findOrCreateExpenseAccount(
        tx,
        companyId,
        userId,
        'Inventory Adjustment',
        '5100'
      );
  }
}

async function createStockJournalEntry(tx, {
  companyId,
  userId,
  description,
  reference,
  debitAccount,
  creditAccount,
  amount,
  postingDate,
}) {
  const amt = Math.round((Number(amount) + Number.EPSILON) * 100) / 100;
  if (amt <= 0) return null;

  const fiscalYearId = await resolveFiscalYearId(userId, postingDate || new Date());
  const entryNumber = `JE-SM-${Date.now()}-${Math.floor(Math.random() * 10000)}`;

  const journalEntry = await tx.journalEntry.create({
    data: {
      entryNumber,
      date: postingDate || new Date(),
      description,
      reference,
      status: 'Posted',
      createdBy: userId,
      postedBy: userId,
      postedAt: new Date(),
      companyId,
      fiscalYearId,
      lines: {
        create: [
          {
            accountId: debitAccount.id,
            accountName: debitAccount.name,
            accountCode: debitAccount.code,
            debit: amt,
            credit: 0,
          },
          {
            accountId: creditAccount.id,
            accountName: creditAccount.name,
            accountCode: creditAccount.code,
            debit: 0,
            credit: amt,
          },
        ],
      },
    },
    include: { lines: true },
  });

  await BalanceCalculator.applyJournalLines(tx, journalEntry.lines);
  return journalEntry;
}

/**
 * Post GL for stock in. Returns journal entry or null (transfer_in).
 */
async function postStockInAccounting(tx, params) {
  const {
    reasonKey,
    companyId,
    userId,
    productName,
    quantity,
    unitCost,
    reference,
    supplierId,
    bankAccountId,
    movementId,
  } = params;

  const meta = validateStockInReason(reasonKey);
  if (!meta.requiresAccounting) return null;

  const amount = (Number(quantity) || 0) * (Number(unitCost) || 0);
  if (amount <= 0) return null;

  const inventoryAccount = await findOrCreateInventoryAccount(tx, companyId, userId);
  const creditAccount = await resolveCreditAccount(tx, reasonKey, {
    companyId,
    userId,
    supplierId,
    bankAccountId,
  });

  if (!creditAccount) return null;

  const jeRef = reference?.trim()
    ? `${reference.trim()} | SM:${movementId}`
    : `SM:${movementId}`;

  return createStockJournalEntry(tx, {
    companyId,
    userId,
    description: `Stock In (${meta.label}) — ${productName} × ${quantity} @ ${unitCost}`,
    reference: jeRef,
    debitAccount: inventoryAccount,
    creditAccount,
    amount,
  });
}

/**
 * Post GL for stock out.
 */
async function postStockOutAccounting(tx, params) {
  const {
    reasonKey,
    companyId,
    userId,
    productName,
    quantity,
    unitCost,
    reference,
    movementId,
  } = params;

  const meta = validateStockOutReason(reasonKey);
  const amount = (Number(quantity) || 0) * (Number(unitCost) || 0);
  if (amount <= 0) return null;

  const inventoryAccount = await findOrCreateInventoryAccount(tx, companyId, userId);
  const debitAccount = await resolveDebitAccountForStockOut(
    tx,
    reasonKey,
    companyId,
    userId
  );

  const jeRef = reference?.trim()
    ? `${reference.trim()} | SM:${movementId}`
    : `SM:${movementId}`;

  return createStockJournalEntry(tx, {
    companyId,
    userId,
    description: `Stock Out (${meta.label}) — ${productName} × ${quantity} @ ${unitCost}`,
    reference: jeRef,
    debitAccount,
    creditAccount: inventoryAccount,
    amount,
  });
}

/**
 * Creates an AP subledger bill for supplier-credit stock in.
 * GL is already posted (Dr Inventory / Cr AP) — no duplicate journal entry.
 */
async function createStockCreditPayableBill(tx, params) {
  const {
    companyId,
    userId,
    supplierId,
    supplierName,
    productName,
    quantity,
    unitCost,
    amount,
    movementId,
    reference,
  } = params;

  if (!supplierId || amount <= 0) return null;

  const supplier = await tx.supplier.findFirst({
    where: { id: supplierId, companyId },
    select: { id: true, name: true },
  });
  if (!supplier) return null;

  const billNumber = `AP-SM-${String(movementId).replace(/-/g, '').slice(0, 12).toUpperCase()}`;
  const existing = await tx.bill.findFirst({
    where: { billNumber, companyId },
  });
  if (existing) return existing;

  const dueDate = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
  const lineAmount = Number(amount) || quantity * unitCost;
  const items = [
    {
      description: `Stock In (Supplier Credit): ${productName} × ${quantity} @ ${unitCost}`,
      quantity: Number(quantity) || 1,
      unitPrice: Number(unitCost) || lineAmount,
      amount: lineAmount,
      taxRate: 0,
      taxAmount: 0,
    },
  ];

  return tx.bill.create({
    data: {
      billNumber,
      vendorId: supplier.id,
      vendorName: supplierName || supplier.name,
      date: new Date(),
      dueDate,
      items,
      subtotal: lineAmount,
      taxTotal: 0,
      discount: 0,
      totalAmount: lineAmount,
      paidAmount: 0,
      outstanding: lineAmount,
      status: 'Unpaid',
      notes: `Auto from Stock Movement. GL posted (Dr Inventory / Cr AP). Ref: ${reference || movementId}`,
      posted: true,
      postedAt: new Date(),
      createdBy: userId,
      companyId,
    },
  });
}

module.exports = {
  STOCK_IN_REASONS,
  STOCK_OUT_REASONS,
  listStockReasons,
  validateStockInReason,
  validateStockOutReason,
  postStockInAccounting,
  postStockOutAccounting,
  createStockCreditPayableBill,
  findOrCreateInventoryAccount,
};
