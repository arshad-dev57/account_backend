/**
 * Sales-side GL helpers (invoice COGS, returns, refunds).
 */

const BalanceCalculator = require('../../utils/balanceCalculator');
const { getOrCreateArAccount } = require('../../utils/arAccountHelper');
const { getOrCreateCashAccount } = require('../../utils/cashAccountHelper');
const { findOrCreateInventoryAccount } = require('./stockAccountingService');

async function findOrCreateCOGSAccount(tx, companyId, userId) {
  let acc = await tx.chartOfAccount.findFirst({
    where: {
      companyId,
      isActive: true,
      OR: [
        { code: '5000' },
        { name: { contains: 'Cost of Goods', mode: 'insensitive' } },
        { name: { contains: 'COGS', mode: 'insensitive' } },
      ],
    },
  });
  if (!acc) {
    acc = await tx.chartOfAccount.create({
      data: {
        code: '5000',
        name: 'Cost of Goods Sold',
        type: 'Expense',
        parentAccount: 'Cost of Sales',
        openingBalance: 0,
        currentBalance: 0,
        balanceType: 'Debit',
        description: 'Cost of Goods Sold',
        isActive: true,
        createdBy: userId,
        companyId,
      },
    });
  }
  return acc;
}

async function findOrCreateSalesReturnsAccount(tx, companyId, userId) {
  let acc = await tx.chartOfAccount.findFirst({
    where: {
      companyId,
      isActive: true,
      OR: [
        { code: '4100' },
        { name: { contains: 'Sales Return', mode: 'insensitive' } },
        { name: { contains: 'Allowances', mode: 'insensitive' } },
      ],
    },
  });
  if (!acc) {
    acc = await tx.chartOfAccount.create({
      data: {
        code: '4100',
        name: 'Sales Returns & Allowances',
        type: 'Revenue',
        parentAccount: 'Operating Revenue',
        openingBalance: 0,
        currentBalance: 0,
        balanceType: 'Credit',
        description: 'Contra revenue for returns',
        isActive: true,
        createdBy: userId,
        companyId,
      },
    });
  }
  return acc;
}

async function computeItemsCOGS(tx, items) {
  let total = 0;
  for (const item of items) {
    let cost = Number(item.unitCost) || 0;
    if (!cost && item.productId) {
      const product =
        item.product ||
        (await tx.product.findUnique({
          where: { id: item.productId },
          select: { costPrice: true },
        }));
      cost = Number(product?.costPrice) || 0;
    }
    const qty = Number(item.quantity ?? item.returnQuantity) || 0;
    total += cost * qty;
  }
  return total;
}

async function postSalesInvoiceCOGS(tx, { invoice, userId, companyId }) {
  const items = invoice.items || [];
  const totalCOGS = await computeItemsCOGS(tx, items);
  if (totalCOGS <= 0) return null;

  const reference = `${invoice.invoiceNumber}-COGS`;
  const existing = await tx.journalEntry.findFirst({
    where: { companyId, reference, status: 'Posted' },
  });
  if (existing) return existing;

  const cogsAcc = await findOrCreateCOGSAccount(tx, companyId, userId);
  const inventoryAcc = await findOrCreateInventoryAccount(tx, companyId, userId);

  const journalEntry = await tx.journalEntry.create({
    data: {
      entryNumber: `JE-COGS-${Date.now()}`,
      date: invoice.invoiceDate || new Date(),
      description: `COGS — Sales Invoice #${invoice.invoiceNumber}`,
      reference,
      status: 'Posted',
      createdBy: userId,
      postedBy: userId,
      postedAt: new Date(),
      companyId,
      fiscalYearId: invoice.fiscalYearId || null,
      lines: {
        create: [
          {
            accountId: cogsAcc.id,
            accountName: cogsAcc.name,
            accountCode: cogsAcc.code,
            debit: totalCOGS,
            credit: 0,
          },
          {
            accountId: inventoryAcc.id,
            accountName: inventoryAcc.name,
            accountCode: inventoryAcc.code,
            debit: 0,
            credit: totalCOGS,
          },
        ],
      },
    },
    include: { lines: true },
  });

  await BalanceCalculator.applyJournalLines(tx, journalEntry.lines);
  return journalEntry;
}

async function postSalesReturnAccounting(tx, params) {
  const {
    returnRecord,
    items,
    userId,
    companyId,
  } = params;

  const refundAmount = Number(returnRecord.totalRefund) || 0;
  if (refundAmount <= 0) return null;

  const reference = `${returnRecord.returnNumber}-RET`;
  const existing = await tx.journalEntry.findFirst({
    where: { companyId, reference, status: 'Posted' },
  });
  if (existing) return existing;

  const arAccount = await getOrCreateArAccount(userId, companyId, tx);
  const returnsAccount = await findOrCreateSalesReturnsAccount(
    tx,
    companyId,
    userId
  );

  const lines = [
    {
      accountId: returnsAccount.id,
      accountName: returnsAccount.name,
      accountCode: returnsAccount.code,
      debit: refundAmount,
      credit: 0,
    },
    {
      accountId: arAccount.id,
      accountName: arAccount.name,
      accountCode: arAccount.code,
      debit: 0,
      credit: refundAmount,
    },
  ];

  const totalCOGS = await computeItemsCOGS(tx, items);
  if (totalCOGS > 0) {
    const cogsAcc = await findOrCreateCOGSAccount(tx, companyId, userId);
    const inventoryAcc = await findOrCreateInventoryAccount(
      tx,
      companyId,
      userId
    );
    lines.push(
      {
        accountId: inventoryAcc.id,
        accountName: inventoryAcc.name,
        accountCode: inventoryAcc.code,
        debit: totalCOGS,
        credit: 0,
      },
      {
        accountId: cogsAcc.id,
        accountName: cogsAcc.name,
        accountCode: cogsAcc.code,
        debit: 0,
        credit: totalCOGS,
      }
    );
  }

  const journalEntry = await tx.journalEntry.create({
    data: {
      entryNumber: `JE-RET-${Date.now()}`,
      date: returnRecord.returnDate || new Date(),
      description: `Sales Return #${returnRecord.returnNumber}`,
      reference,
      status: 'Posted',
      createdBy: userId,
      postedBy: userId,
      postedAt: new Date(),
      companyId,
      lines: { create: lines },
    },
    include: { lines: true },
  });

  await BalanceCalculator.applyJournalLines(tx, journalEntry.lines);

  if (returnRecord.customerId) {
    await tx.customer.update({
      where: { id: returnRecord.customerId },
      data: { outstandingBalance: { decrement: refundAmount } },
    });
  }

  return journalEntry;
}

async function postRefundPaymentAccounting(tx, params) {
  const { refund, userId, companyId, bankAccountId } = params;
  const amount = Number(refund.amount) || 0;
  if (amount <= 0) return null;

  const reference = `${refund.refundNumber}-PAY`;
  const existing = await tx.journalEntry.findFirst({
    where: { companyId, reference, status: 'Posted' },
  });
  if (existing) return existing;

  const arAccount = await getOrCreateArAccount(userId, companyId, tx);
  let creditAccount;

  if (bankAccountId) {
    const bank = await tx.bankAccount.findFirst({
      where: { id: bankAccountId, companyId, status: 'Active' },
      include: { chartOfAccount: true },
    });
    creditAccount = bank?.chartOfAccount;
  }
  if (!creditAccount) {
    creditAccount = await getOrCreateCashAccount(userId, companyId, tx);
  }

  const journalEntry = await tx.journalEntry.create({
    data: {
      entryNumber: `JE-RFD-${Date.now()}`,
      date: refund.refundDate || new Date(),
      description: `Refund #${refund.refundNumber} to ${refund.customerName || 'Customer'}`,
      reference,
      status: 'Posted',
      createdBy: userId,
      postedBy: userId,
      postedAt: new Date(),
      companyId,
      lines: {
        create: [
          {
            accountId: arAccount.id,
            accountName: arAccount.name,
            accountCode: arAccount.code,
            debit: amount,
            credit: 0,
          },
          {
            accountId: creditAccount.id,
            accountName: creditAccount.name,
            accountCode: creditAccount.code,
            debit: 0,
            credit: amount,
          },
        ],
      },
    },
    include: { lines: true },
  });

  await BalanceCalculator.applyJournalLines(tx, journalEntry.lines);
  return journalEntry;
}

module.exports = {
  findOrCreateCOGSAccount,
  postSalesInvoiceCOGS,
  postSalesReturnAccounting,
  postRefundPaymentAccounting,
  computeItemsCOGS,
};
