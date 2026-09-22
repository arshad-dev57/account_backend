'use strict';

const prisma = require('../prisma/client');

async function findPayrollAccounts(companyId) {
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
  return { expense, payable };
}

function groupPayrollByCostCenter(items) {
  const groups = new Map();
  let unassigned = 0;
  items.forEach((item) => {
    const net = Math.round(Number(item.net || 0) * 100) / 100;
    if (!(net > 0)) return;
    const key = item.costCenterId || 'unassigned';
    if (!groups.has(key)) {
      groups.set(key, {
        costCenterId: item.costCenterId || null,
        costCenterCode: item.costCenterCode || '',
        costCenterName: item.costCenterName || '',
        amount: 0,
        itemIds: []
      });
    }
    const bucket = groups.get(key);
    bucket.amount = Math.round((bucket.amount + net) * 100) / 100;
    bucket.itemIds.push(item.id);
    if (!item.costCenterId) unassigned += net;
  });
  return { groups, unassigned: Math.round(unassigned * 100) / 100 };
}

async function postPayrollJournal({
  companyId,
  userId,
  period,
  periodLabel,
  payrollItems = [],
  netTotal
}) {
  const items = Array.isArray(payrollItems) ? payrollItems : [];
  const totalFromItems = items.reduce((s, r) => s + Number(r.net || 0), 0);
  const amount = Math.round(Number(totalFromItems || netTotal || 0) * 100) / 100;
  if (!(amount > 0) || !companyId) return null;

  const existing = await prisma.journalEntry.findFirst({
    where: {
      companyId,
      reference: `HR-PAY-${period}`,
      type: 'Payroll',
      status: 'Posted'
    },
    select: { id: true, entryNumber: true }
  });
  if (existing) {
    return { id: existing.id, entryNumber: existing.entryNumber, reused: true };
  }

  const { expense, payable } = await findPayrollAccounts(companyId);
  if (!expense || !payable) {
    return { skipped: true, reason: 'Salary / Salaries Payable accounts not found' };
  }

  const { groups } = groupPayrollByCostCenter(items);
  const debitLines = [];
  if (groups.size === 0) {
    debitLines.push({
      accountId: expense.id,
      accountName: expense.name,
      accountCode: expense.code,
      debit: amount,
      credit: 0,
      costCenterId: null
    });
  } else {
    groups.forEach((group) => {
      if (!(group.amount > 0)) return;
      debitLines.push({
        accountId: expense.id,
        accountName: expense.name,
        accountCode: expense.code,
        debit: group.amount,
        credit: 0,
        costCenterId: group.costCenterId
      });
    });
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
          ...debitLines,
          {
            accountId: payable.id,
            accountName: payable.name,
            accountCode: payable.code,
            debit: 0,
            credit: amount,
            costCenterId: null
          }
        ]
      }
    }
  });

  if (items.length) {
    await prisma.hrPayrollItem.updateMany({
      where: { id: { in: items.map((i) => i.id) } },
      data: { journalEntryId: entry.id }
    });
  }

  return { id: entry.id, entryNumber: entry.entryNumber, lineCount: debitLines.length + 1 };
}

module.exports = { postPayrollJournal, groupPayrollByCostCenter };
