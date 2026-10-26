'use strict';

const prisma = require('../prisma/client');

async function main() {
  const email = process.argv[2] || 'customer461@gmail.com';
  const users = await prisma.user.findMany({
    where: { email: { equals: email, mode: 'insensitive' } },
    select: {
      id: true,
      email: true,
      firstName: true,
      lastName: true,
      role: true,
      companyId: true,
      isActive: true,
      createdAt: true,
    },
  });

  console.log('users:', JSON.stringify(users, null, 2));
  if (!users.length) return;

  const userId = users[0].id;
  const memberships = await prisma.companyMembership.findMany({
    where: { userId, isActive: true },
    select: { companyId: true, role: true, isOwner: true, createdAt: true },
  });
  console.log('memberships:', JSON.stringify(memberships, null, 2));

  const companyIds = [
    ...new Set([users[0].companyId, ...memberships.map((m) => m.companyId)].filter(Boolean)),
  ];
  const companies = await prisma.company.findMany({
    where: { id: { in: companyIds } },
    select: {
      id: true,
      name: true,
      isActive: true,
      parentCompanyId: true,
      baseCurrencyId: true,
      createdAt: true,
      baseCurrency: { select: { code: true, name: true } },
    },
  });
  console.log('companies:', JSON.stringify(companies, null, 2));

  const currencyCount = await prisma.currency.count();
  console.log('currency master count:', currencyCount);

  for (const companyId of companyIds) {
    const [rateCount, pairCount] = await Promise.all([
      prisma.exchangeRate.count({ where: { companyId } }),
      prisma.exchangeRate.groupBy({ by: ['fromCurrencyId'], where: { companyId } }).then((r) => r.length),
    ]);
    console.log(`company ${companyId}: rates=${rateCount} distinctFrom=${pairCount}`);
  }

  const rates = await prisma.exchangeRate.findMany({
    where: { companyId: { in: companyIds } },
    select: {
      companyId: true,
      rate: true,
      effectiveDate: true,
      isActive: true,
      fromCurrency: { select: { code: true } },
      toCurrency: { select: { code: true } },
    },
    orderBy: { effectiveDate: 'desc' },
    take: 40,
  });
  console.log('sample rates:', JSON.stringify(rates, null, 2));
}

main()
  .catch((err) => {
    console.error('inspect failed:', err.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
