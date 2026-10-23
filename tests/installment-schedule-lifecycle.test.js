'use strict';

const assert = require('assert');
const {
  buildInstallmentPlan,
  summarizeSchedule,
  markOverdueInstallments,
  applyPaymentToSalesInstallments,
  reversePaymentFromSalesInstallments,
  applyPaymentToPurchaseInstallments,
  reversePaymentFromPurchaseInstallments,
  createSalesInstallmentSchedule,
  createPurchaseInstallmentSchedule,
} = require('../services/installmentScheduleService');
const { seedCompanyBusinessConfig } = require('../utils/companyBusinessConfig');

function testSummarizeAndOverdueMath() {
  const plan = buildInstallmentPlan({
    grandTotal: 1100,
    downPaymentAmount: 100,
    installmentCount: 4,
    installmentFrequency: 'monthly',
    startDate: new Date('2025-01-01'),
  });
  const lines = plan.schedule.map((row, i) => ({
    ...row,
    paidAmount: i === 0 ? row.amount : 0,
    status: i === 0 ? 'Paid' : 'Pending',
  }));
  const summary = summarizeSchedule(lines);
  assert.strictEqual(summary.scheduledTotal, 1000);
  assert.ok(summary.paidTotal > 0);
  assert.ok(summary.outstandingTotal < 1000);
}

async function testSalesPurchasePaymentLifecycle() {
  const prisma = require('../prisma/client');
  if (!prisma.salesInstallmentSchedule || !prisma.purchaseInstallmentSchedule) {
    console.log('skip lifecycle — prisma models missing');
    return;
  }

  const actor = await prisma.user.findFirst({ select: { id: true } });
  if (!actor) {
    console.log('skip lifecycle — no user row for createdBy FK');
    return;
  }

  const suffix = Date.now();
  const company = await prisma.company.create({
    data: {
      name: `Inst Co ${suffix}`,
      email: `inst-${suffix}@test.local`,
      subscriptionPlan: 'trial',
      subscriptionStatus: 'active',
    },
  });

  await seedCompanyBusinessConfig(company.id, {
    salesModel: 'both',
    purchaseModel: 'installment',
    operationalBusinessType: 'Trading',
  });

  const customer = await prisma.customer.create({
    data: {
      customerNumber: `CUST-INST-${suffix}`,
      name: `Cust ${suffix}`,
      email: `cust-${suffix}@test.local`,
      companyId: company.id,
      createdBy: actor.id,
    },
  });

  const salesInvoice = await prisma.salesInvoice.create({
    data: {
      invoiceNumber: `SI-INST-${suffix}`,
      customerId: customer.id,
      customerName: customer.name,
      dueDate: new Date(),
      grandTotal: 1000,
      outstanding: 1000,
      isInstallmentSale: true,
      downPaymentAmount: 100,
      companyId: company.id,
      createdBy: actor.id,
    },
  });

  await createSalesInstallmentSchedule({
    companyId: company.id,
    invoiceId: salesInvoice.id,
    grandTotal: 1000,
    invoiceDate: new Date(),
    planInput: {
      downPaymentAmount: 100,
      installmentCount: 3,
      installmentFrequency: 'monthly',
    },
  });

  const applied = await applyPaymentToSalesInstallments({
    companyId: company.id,
    invoiceId: salesInvoice.id,
    amount: 300,
    salesPaymentId: null,
  });
  assert.ok(applied.applied > 0);

  const reversed = await reversePaymentFromSalesInstallments({
    companyId: company.id,
    invoiceId: salesInvoice.id,
    amount: 300,
  });
  assert.ok(reversed.reversed > 0);

  const supplier = await prisma.supplier.create({
    data: {
      name: `Supp ${suffix}`,
      email: `supp-${suffix}@test.local`,
      code: `SUP-INST-${suffix}`,
      companyId: company.id,
      createdBy: actor.id,
    },
  });

  const purchaseInvoice = await prisma.purchaseInvoice.create({
    data: {
      invoiceNumber: `PI-INST-${suffix}`,
      supplierId: supplier.id,
      supplierName: supplier.name,
      dueDate: new Date(),
      grandTotal: 800,
      outstanding: 800,
      isInstallmentPurchase: true,
      companyId: company.id,
      createdBy: actor.id,
    },
  });

  await createPurchaseInstallmentSchedule({
    companyId: company.id,
    invoiceId: purchaseInvoice.id,
    grandTotal: 800,
    invoiceDate: new Date(),
    planInput: {
      downPaymentAmount: 80,
      installmentCount: 4,
      installmentFrequency: 'monthly',
    },
  });

  const pApplied = await applyPaymentToPurchaseInstallments({
    companyId: company.id,
    invoiceId: purchaseInvoice.id,
    amount: 200,
  });
  assert.ok(pApplied.applied > 0);

  const pReversed = await reversePaymentFromPurchaseInstallments({
    companyId: company.id,
    invoiceId: purchaseInvoice.id,
    amount: 200,
  });
  assert.ok(pReversed.reversed > 0);

  // Force overdue then mark
  await prisma.salesInstallmentSchedule.updateMany({
    where: { invoiceId: salesInvoice.id },
    data: { dueDate: new Date('2020-01-01'), status: 'Pending', paidAmount: 0 },
  });
  const overdue = await markOverdueInstallments(company.id);
  assert.ok(overdue.salesUpdated >= 1);

  // Cleanup
  await prisma.salesInstallmentSchedule.deleteMany({ where: { companyId: company.id } });
  await prisma.purchaseInstallmentSchedule.deleteMany({ where: { companyId: company.id } });
  await prisma.salesInvoice.deleteMany({ where: { id: salesInvoice.id } });
  await prisma.purchaseInvoice.deleteMany({ where: { id: purchaseInvoice.id } });
  await prisma.customer.deleteMany({ where: { id: customer.id } }).catch(() => {});
  await prisma.supplier.deleteMany({ where: { id: supplier.id } }).catch(() => {});
  await prisma.companyBusinessConfig.deleteMany({ where: { companyId: company.id } });
  await prisma.company.delete({ where: { id: company.id } });
}

testSummarizeAndOverdueMath();

testSalesPurchasePaymentLifecycle()
  .then(() => {
    console.log('installment-schedule-lifecycle tests passed');
    process.exit(0);
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
