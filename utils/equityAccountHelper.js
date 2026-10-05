// utils/equityAccountHelper.js
// Keep EquityAccount rows in sync with ChartOfAccount Equity accounts.
// Source of truth for balances / journals is ChartOfAccount (code 3001 Owner's Capital).

const prisma = require('../prisma/client');

function deriveAccountType(name, explicitType) {
  const fromExplicit = String(explicitType || '').toLowerCase();
  if (fromExplicit.includes('drawing')) return 'Drawings';
  if (fromExplicit.includes('retained') || fromExplicit.includes('retention')) {
    return 'Retained Earnings';
  }
  if (fromExplicit.includes('reserve')) return 'Reserves';
  if (fromExplicit.includes('share')) return 'Share Capital';
  if (fromExplicit.includes('capital')) return 'Capital';

  const n = (name || '').toLowerCase();
  if (n.includes('drawing')) return 'Drawings';
  if (n.includes('retained') || n.includes('retention') || n.includes('current year')) {
    return 'Retained Earnings';
  }
  if (n.includes('reserve')) return 'Reserves';
  if (n.includes('share')) return 'Share Capital';
  return 'Capital';
}

async function ensureEquityAccountForChart(chartAccount, userId, companyId, client) {
  const db = client || prisma;
  if (!chartAccount || !companyId) return null;

  const accountType = deriveAccountType(chartAccount.name, chartAccount.accountType);
  const existing = await db.equityAccount.findFirst({
    where: { accountCode: chartAccount.code, companyId },
  });

  if (existing) {
    return db.equityAccount.update({
      where: { id: existing.id },
      data: {
        accountName: chartAccount.name,
        accountType,
        openingBalance: chartAccount.openingBalance || 0,
        currentBalance: chartAccount.currentBalance || 0,
        lastUpdated: new Date(),
      },
    });
  }

  return db.equityAccount.create({
    data: {
      accountName: chartAccount.name,
      accountCode: chartAccount.code,
      accountType,
      openingBalance: chartAccount.openingBalance || 0,
      currentBalance: chartAccount.currentBalance || 0,
      additions: 0,
      withdrawals: 0,
      notes: '',
      createdBy: userId || 'SYSTEM',
      companyId,
    },
  });
}

async function syncCompanyEquityAccounts(companyId, userId, client) {
  const db = client || prisma;
  if (!companyId) return [];

  // Ensure Owner's Drawings exists (IAS 1 contra-equity for sole prop / SME)
  const drawings = await db.chartOfAccount.findFirst({
    where: {
      companyId,
      type: 'Equity',
      OR: [
        { code: '3300' },
        { name: { contains: 'drawing', mode: 'insensitive' } },
      ],
    },
  });
  if (!drawings) {
    try {
      await db.chartOfAccount.create({
        data: {
          code: '3300',
          name: "Owner's Drawings",
          type: 'Equity',
          parentAccount: 'Equity',
          openingBalance: 0,
          currentBalance: 0,
          description: 'Owner withdrawals (contra-equity)',
          taxCode: 'N/A',
          balanceType: 'Debit',
          isActive: true,
          createdBy: userId || 'SYSTEM',
          companyId,
        },
      });
    } catch (_) {
      // race / unique — ignore
    }
  }

  const equityCharts = await db.chartOfAccount.findMany({
    where: { companyId, type: 'Equity', isActive: true },
  });

  const synced = [];
  for (const chart of equityCharts) {
    synced.push(await ensureEquityAccountForChart(chart, userId, companyId, db));
  }
  return synced;
}

async function findLinkedChartAccount(equityOrChartId, companyId) {
  const byId = await prisma.chartOfAccount.findFirst({
    where: { id: equityOrChartId, companyId, type: 'Equity' },
  });
  if (byId) return byId;

  const equity = await prisma.equityAccount.findFirst({
    where: { id: equityOrChartId, companyId },
  });
  if (!equity) return null;

  return prisma.chartOfAccount.findFirst({
    where: { code: equity.accountCode, companyId, type: 'Equity' },
  });
}

module.exports = {
  deriveAccountType,
  ensureEquityAccountForChart,
  syncCompanyEquityAccounts,
  findLinkedChartAccount,
};
