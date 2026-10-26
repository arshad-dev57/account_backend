'use strict';

/* One-off correction for E2E data posted before the COA resolver fix.
 * Moves the 557 bank charges from Office Expense (6300) to Bank Charges (6800). */

const prisma = require('../prisma/client');
const accounting = require('../services/exportAccountingService');
const { resolveExportFiscalYear } = require('../services/exportHelpers');

const COMPANY_ID = 'b276083a-ee59-4fca-b9bb-4ac7c720576d';
const USER_ID = '896af3fc-7609-42e6-8aed-42b21f98742a';
const REFERENCE = 'XRCP-2026-0001-RECLASS';

(async () => {
  const existing = await prisma.journalEntry.findFirst({
    where: { companyId: COMPANY_ID, reference: REFERENCE },
  });
  if (existing) {
    console.log('reclassification already posted', existing.entryNumber);
    await prisma.$disconnect();
    return;
  }

  const [office, bankCharges] = await Promise.all([
    prisma.chartOfAccount.findFirst({ where: { companyId: COMPANY_ID, code: '6300' } }),
    prisma.chartOfAccount.findFirst({ where: { companyId: COMPANY_ID, code: '6800' } }),
  ]);
  if (!office || !bankCharges) throw new Error('Expected COA accounts 6300/6800 not found');

  const amount = 557;
  const je = await prisma.$transaction(async (tx) => {
    const fiscalYearId = await resolveExportFiscalYear(COMPANY_ID, new Date(), tx);
    const line = (account, debit, credit) => ({
      accountId: account.id,
      accountName: account.name,
      accountCode: account.code,
      debit,
      credit,
    });
    return accounting.postJournal(tx, {
      companyId: COMPANY_ID,
      userId: USER_ID,
      date: new Date(),
      description:
        'Reclassification XRCP-2026-0001 — bank charges moved from Office Expense to Bank Charges',
      reference: REFERENCE,
      fiscalYearId,
      lines: [line(bankCharges, amount, 0), line(office, 0, amount)],
    });
  });

  console.log('posted', je.entryNumber, je.reference);
  await prisma.$disconnect();
})();
