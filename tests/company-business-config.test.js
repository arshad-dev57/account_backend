'use strict';

const assert = require('assert');
const {
  DEFAULT_CONFIG,
  validateConfigPatch,
  toPublicConfig,
  configFieldsFromRow,
  OPERATIONAL_BUSINESS_TYPES,
  SALES_MODELS,
  PURCHASE_MODELS,
  parseBusinessConfigFromRequestBody,
  assertInstallmentSalesAllowed,
  assertInstallmentPurchaseAllowed,
} = require('../utils/companyBusinessConfig');
const {
  buildInstallmentPlan,
  normalizeInstallmentSaleInput,
  normalizeInstallmentPurchaseInput,
  roundMoney,
} = require('../services/installmentScheduleService');

function testDefaultsPreserveStandardWorkflow() {
  assert.strictEqual(DEFAULT_CONFIG.salesModel, 'standard');
  assert.strictEqual(DEFAULT_CONFIG.purchaseModel, 'standard');
  assert.strictEqual(DEFAULT_CONFIG.operationalBusinessType, 'Other');
  const pub = toPublicConfig({ companyId: 'x', ...DEFAULT_CONFIG });
  assert.strictEqual(pub.capabilities.allowStandardSales, true);
  assert.strictEqual(pub.capabilities.allowInstallmentSales, false);
  assert.strictEqual(pub.capabilities.showInstallmentSalesUi, false);
  assert.strictEqual(pub.capabilities.allowInstallmentPurchase, false);
}

function testInstallmentAndBothCapabilities() {
  const installment = toPublicConfig({
    companyId: 'a',
    salesModel: 'installment',
    purchaseModel: 'installment',
    operationalBusinessType: 'Retail',
  });
  assert.strictEqual(installment.capabilities.allowInstallmentSales, true);
  assert.strictEqual(installment.capabilities.allowStandardSales, false);
  assert.strictEqual(installment.capabilities.showInstallmentSalesUi, true);
  assert.strictEqual(installment.capabilities.allowInstallmentPurchase, true);

  const both = toPublicConfig({
    companyId: 'b',
    salesModel: 'both',
    purchaseModel: 'standard',
    operationalBusinessType: 'Manufacturing',
  });
  assert.strictEqual(both.capabilities.allowStandardSales, true);
  assert.strictEqual(both.capabilities.allowInstallmentSales, true);
}

function testManufacturingPlusInstallmentValidation() {
  const { ok, data, errors } = validateConfigPatch(
    {
      operationalBusinessType: 'Manufacturing',
      salesModel: 'installment',
      purchaseModel: 'standard',
      installmentRevenuePolicy: 'full_on_sale',
    },
    { partial: false }
  );
  assert.ok(ok, errors.join('; '));
  assert.strictEqual(data.operationalBusinessType, 'Manufacturing');
  assert.strictEqual(data.salesModel, 'installment');
}

function testRejectInvalidEnums() {
  const bad = validateConfigPatch({ salesModel: 'lease' }, { partial: true });
  assert.strictEqual(bad.ok, false);
  assert.ok(bad.errors.some((e) => /salesModel/i.test(e)));
}

function testParseRegistrationBody() {
  const parsed = parseBusinessConfigFromRequestBody({
    operationalBusinessType: 'Trading',
    salesModel: 'both',
    purchase_model: 'installment',
  });
  assert.strictEqual(parsed.operationalBusinessType, 'Trading');
  assert.strictEqual(parsed.salesModel, 'both');
  assert.strictEqual(parsed.purchaseModel, 'installment');
}

function testApiEnforcementHelpers() {
  const standard = toPublicConfig({ companyId: 'c', ...DEFAULT_CONFIG });
  assert.throws(
    () => assertInstallmentSalesAllowed(standard, { isInstallment: true }),
    /Installment-based sales are not enabled/
  );
  assert.doesNotThrow(() =>
    assertInstallmentSalesAllowed(standard, { isInstallment: false })
  );

  const enabled = toPublicConfig({
    companyId: 'd',
    salesModel: 'both',
    purchaseModel: 'installment',
  });
  assert.doesNotThrow(() =>
    assertInstallmentSalesAllowed(enabled, { isInstallment: true })
  );
  assert.doesNotThrow(() =>
    assertInstallmentPurchaseAllowed(enabled, { isInstallment: true })
  );
}

function testInstallmentScheduleMath() {
  const plan = buildInstallmentPlan({
    grandTotal: 1000,
    downPaymentAmount: 100,
    installmentCount: 3,
    installmentFrequency: 'monthly',
    startDate: new Date('2026-01-15'),
  });
  assert.strictEqual(plan.financedAmount, 900);
  assert.strictEqual(plan.schedule.length, 3);
  const sum = roundMoney(plan.schedule.reduce((s, r) => s + r.amount, 0));
  assert.strictEqual(sum, 900);
  assert.strictEqual(plan.schedule[0].installmentNumber, 1);
  assert.ok(plan.schedule[0].dueDate instanceof Date);
}

function testInstallmentInputNormalization() {
  assert.strictEqual(normalizeInstallmentSaleInput({}).isInstallmentSale, false);
  const yes = normalizeInstallmentSaleInput({
    isInstallmentSale: 'true',
    downPaymentAmount: '50',
    installmentCount: 12,
    installmentFrequency: 'monthly',
  });
  assert.strictEqual(yes.isInstallmentSale, true);
  assert.strictEqual(yes.downPaymentAmount, 50);
  assert.strictEqual(yes.installmentCount, 12);

  const purchase = normalizeInstallmentPurchaseInput({ purchaseType: 'installment' });
  assert.strictEqual(purchase.isInstallmentPurchase, true);
}

function testConfigFieldsCopyForInheritance() {
  const parent = {
    operationalBusinessType: 'Manufacturing',
    salesModel: 'installment',
    purchaseModel: 'standard',
    installmentRevenuePolicy: 'as_collected',
    allowChildConfigOverride: false,
  };
  const childSeed = configFieldsFromRow(parent);
  assert.strictEqual(childSeed.salesModel, 'installment');
  assert.strictEqual(childSeed.operationalBusinessType, 'Manufacturing');
  assert.strictEqual(childSeed.allowChildConfigOverride, false);
}

function testSupportedCatalogs() {
  assert.ok(OPERATIONAL_BUSINESS_TYPES.includes('Manufacturing'));
  assert.ok(OPERATIONAL_BUSINESS_TYPES.includes('Trading'));
  assert.ok(SALES_MODELS.includes('both'));
  assert.ok(PURCHASE_MODELS.includes('installment'));
}

async function testResolverInheritanceAgainstDb() {
  const prisma = require('../prisma/client');
  if (!prisma.companyBusinessConfig) {
    console.log('skip live resolver — prisma client missing companyBusinessConfig (run prisma generate)');
    return;
  }

  const {
    seedCompanyBusinessConfig,
    inheritBusinessConfigFromParent,
    resolveEffectiveCompanyConfig,
    updateCompanyBusinessConfig,
  } = require('../utils/companyBusinessConfig');

  const suffix = Date.now();
  const parent = await prisma.company.create({
    data: {
      name: `BC Parent ${suffix}`,
      email: `bc-parent-${suffix}@test.local`,
      subscriptionPlan: 'trial',
      subscriptionStatus: 'active',
    },
  });
  const child = await prisma.company.create({
    data: {
      name: `BC Child ${suffix}`,
      email: `bc-child-${suffix}@test.local`,
      parentCompanyId: parent.id,
      subscriptionPlan: 'trial',
      subscriptionStatus: 'active',
    },
  });
  const grandchild = await prisma.company.create({
    data: {
      name: `BC Grandchild ${suffix}`,
      email: `bc-grandchild-${suffix}@test.local`,
      parentCompanyId: child.id,
      subscriptionPlan: 'trial',
      subscriptionStatus: 'active',
    },
  });

  try {
    await seedCompanyBusinessConfig(parent.id, {
      operationalBusinessType: 'Manufacturing',
      salesModel: 'installment',
      purchaseModel: 'standard',
      allowChildConfigOverride: false,
    });

    const childCfg = await inheritBusinessConfigFromParent(child.id, parent.id);
    assert.strictEqual(childCfg.salesModel, 'installment');
    assert.strictEqual(childCfg.operationalBusinessType, 'Manufacturing');
    assert.strictEqual(childCfg.inheritedFromParent, true);
    assert.strictEqual(childCfg.sourceParentCompanyId, parent.id);

    // Multi-level: grandchild inherits from child (which itself has installment)
    const gcCfg = await inheritBusinessConfigFromParent(grandchild.id, child.id);
    assert.strictEqual(gcCfg.salesModel, 'installment', 'multi-level inheritance must keep installment');
    assert.strictEqual(gcCfg.operationalBusinessType, 'Manufacturing');

    // Parent policy locks child overrides
    let locked = false;
    try {
      await updateCompanyBusinessConfig(child.id, { salesModel: 'standard' });
    } catch (err) {
      locked = err.code === 'CHILD_CONFIG_LOCKED' || /does not allow/i.test(err.message);
    }
    assert.ok(locked, 'child override should be blocked when parent disallows');

    // Effective config never silently falls back to standard for child
    const effective = await resolveEffectiveCompanyConfig(child.id);
    assert.strictEqual(effective.salesModel, 'installment');

    // Isolation: different companies keep separate config rows
    const parentRow = await prisma.companyBusinessConfig.findUnique({
      where: { companyId: parent.id },
    });
    const childRow = await prisma.companyBusinessConfig.findUnique({
      where: { companyId: child.id },
    });
    assert.ok(parentRow && childRow);
    assert.notStrictEqual(parentRow.id, childRow.id);
  } finally {
    await prisma.companyBusinessConfig.deleteMany({
      where: { companyId: { in: [parent.id, child.id, grandchild.id] } },
    });
    await prisma.company.deleteMany({
      where: { id: { in: [grandchild.id, child.id, parent.id] } },
    });
  }
}

testDefaultsPreserveStandardWorkflow();
testInstallmentAndBothCapabilities();
testManufacturingPlusInstallmentValidation();
testRejectInvalidEnums();
testParseRegistrationBody();
testApiEnforcementHelpers();
testInstallmentScheduleMath();
testInstallmentInputNormalization();
testConfigFieldsCopyForInheritance();
testSupportedCatalogs();

testResolverInheritanceAgainstDb()
  .then(() => {
    console.log('company-business-config tests passed');
    process.exit(0);
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
