'use strict';

/* Exercises postAdvanceAccounting with real order/receipt data inside a
 * transaction that is always rolled back. */

const prisma = require('../prisma/client');
const accounting = require('../services/exportAccountingService');

const COMPANY_ID = 'b276083a-ee59-4fca-b9bb-4ac7c720576d';
const USER_ID = '896af3fc-7609-42e6-8aed-42b21f98742a';
const ROLLBACK = new Error('__ROLLBACK__');

(async () => {
  const receipt = await prisma.exportReceipt.findFirst({
    where: { companyId: COMPANY_ID, receiptNumber: 'XRCP-2026-0001' },
  });
  const order = await prisma.exportSalesOrder.findFirst({
    where: { companyId: COMPANY_ID, orderNumber: 'ESO-2026-0001' },
  });
  if (!receipt || !order) throw new Error('E2E receipt/order not found');

  try {
    await prisma.$transaction(
      async (tx) => {
        const { journalEntry, netBase } = await accounting.postAdvanceAccounting(tx, {
          companyId: COMPANY_ID,
          userId: USER_ID,
          receipt,
          order,
          proforma: null,
          bankAccountId: receipt.bankAccountId,
        });
        console.log('netBase', netBase);
        for (const line of journalEntry.lines) {
          console.log(
            line.accountCode,
            line.accountName,
            'D',
            line.debit,
            'C',
            line.credit
          );
        }
        const debit = journalEntry.lines.reduce((s, l) => s + Number(l.debit || 0), 0);
        const credit = journalEntry.lines.reduce((s, l) => s + Number(l.credit || 0), 0);
        console.log('balanced', debit.toFixed(2) === credit.toFixed(2));
        throw ROLLBACK;
      },
      { timeout: 30000 }
    );
  } catch (err) {
    if (err !== ROLLBACK) throw err;
    console.log('transaction rolled back — no postings persisted');
  } finally {
    await prisma.$disconnect();
  }
})();
