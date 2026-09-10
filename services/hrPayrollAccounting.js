'use strict';

const prisma = require('../prisma/client');

async function postPayrollJournal({ companyId, userId, period, periodLabel, netTotal }) {
  const amount = Math.round(Number(netTotal || 0) * 100) / 100;
  if (!(amount > 0) || !companyId) return null;

  const [expense, payable] = await Promise.all([
    prisma.chartOfAccount.findFirst({
      where: {
        companyId,
        OR: [{ code: '6100' }, { name: { contains: 'Salary', mode: 'insensitive' } }]
      }
    }),
    prisma.chartOfAccount.findFirst({
      where: {
        companyId,
        OR: [{ code: '2200' }, { name: { contains: 'Salaries Payable', mode: 'insensitive' } }]
      }
    })
  ]);
  if (!expense || !payable) {
    return { skipped: true, reason: 'Salary / Salaries Payable accounts not found' };
  }

  const year = new Date().getFullYear();
  const count = await prisma.journalEntry.count({ where: { companyId } });
  const entryNumber = `JE-PAY-${year}-${String(count + 1).padStart(4, '0')}`;

  const entry = await prisma.journalEntry.create({
    data: {
      entryNumber,
      date: new Date(),
      description: `Payroll ${periodLabel || period}`,
      reference: `HR-PAY-${period}`,
      status: 'Posted',
      type: 'Payroll',
      createdBy: userId,
      postedBy: userId,
      postedAt: new Date(),
      companyId,
      lines: {
        create: [
          {
            accountId: expense.id,
            accountName: expense.name,
            accountCode: expense.code,
            debit: amount,
            credit: 0
          },
          {
            accountId: payable.id,
            accountName: payable.name,
            accountCode: payable.code,
            debit: 0,
            credit: amount
          }
        ]
      }
    }
  });
  return { id: entry.id, entryNumber: entry.entryNumber };
}

module.exports = { postPayrollJournal };
