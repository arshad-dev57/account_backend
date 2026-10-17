'use strict';

/**
 * Import enterprise lifecycle — pure + optional DB tests.
 * Run: node --test tests/import-enterprise-lifecycle.test.js
 * Live: IMPORT_ENTERPRISE_DB_TESTS=1 node --test tests/import-enterprise-lifecycle.test.js
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  toNumber,
  allocateLandedByValue,
  validateReceiveQty,
  assertPoStatusTransition,
  IMPORT_GRN_POSTED_STATUSES,
} = require('../services/importService');
const { resolveImportExchangeRate } = require('../utils/importFx');
const { PROFORMA_STATUS_TRANSITIONS } = require('../services/importEnterpriseService');

describe('import enterprise — helpers', () => {
  it('allocateLandedByValue distributes by line value', () => {
    const rows = allocateLandedByValue(
      [
        { productName: 'A', qty: 10, unitFobUsd: 2 },
        { productName: 'B', qty: 5, unitFobUsd: 4 },
      ],
      30
    );
    assert.equal(rows.length, 2);
    const totalExpense = rows.reduce((s, r) => s + r.allocatedExpensePerUnitUsd * r.qty, 0);
    assert.ok(Math.abs(totalExpense - 30) < 0.05);
  });

  it('validateReceiveQty blocks over-receive', () => {
    assert.throws(
      () =>
        validateReceiveQty({
          orderedQty: 100,
          alreadyReceivedQty: 80,
          receiveQty: 30,
        }),
      /Over-receiving/
    );
  });

  it('PO status machine rejects skip of approvals', () => {
    assert.throws(() => assertPoStatusTransition('Draft', 'Received'), /Invalid Import PO/);
  });

  it('proforma status transitions include Draft → Submitted → Approved', () => {
    assert.deepEqual(PROFORMA_STATUS_TRANSITIONS.Draft, ['Submitted', 'Cancelled']);
    assert.ok(PROFORMA_STATUS_TRANSITIONS.Submitted.includes('Approved'));
    assert.ok(IMPORT_GRN_POSTED_STATUSES.includes('Inspected & Received'));
  });
});

describe('import FX resolver', () => {
  it('identity rate when currency equals base', async () => {
    // Unit-style: mock via same-currency path needs DB; skip if no DATABASE_URL
    if (!process.env.DATABASE_URL && !process.env.IMPORT_ENTERPRISE_DB_TESTS) {
      return;
    }
    const prisma = require('../prisma/client');
    const company = await prisma.company.findFirst({
      where: { baseCurrencyId: { not: null } },
      include: { baseCurrency: true },
    });
    if (!company?.baseCurrency) return;
    const fx = await resolveImportExchangeRate({
      companyId: company.id,
      currencyCode: company.baseCurrency.code,
      foreignAmount: 1000,
    });
    assert.equal(fx.exchangeRate, 1);
    assert.equal(fx.baseAmount, 1000);
    assert.equal(fx.rateSource, 'IDENTITY');
  });

  it('rejects missing foreign rate without silent 1:1', async () => {
    if (process.env.IMPORT_ENTERPRISE_DB_TESTS !== '1') return;
    const prisma = require('../prisma/client');
    const company = await prisma.company.findFirst({
      where: { id: '73bf6455-9670-48e3-b1d6-2c05f0a5d9e4' },
      include: { baseCurrency: true },
    });
    if (!company || company.baseCurrency?.code === 'USD') return;
    await assert.rejects(
      () =>
        resolveImportExchangeRate({
          companyId: company.id,
          currencyCode: 'USD',
          foreignAmount: 2000,
          // no explicit rate, and company has empty rate table
        }),
      /No exchange rate found/
    );
  });

  it('accepts authorized explicit rate', async () => {
    if (process.env.IMPORT_ENTERPRISE_DB_TESTS !== '1') return;
    const prisma = require('../prisma/client');
    const company = await prisma.company.findFirst({
      where: { id: '73bf6455-9670-48e3-b1d6-2c05f0a5d9e4' },
    });
    if (!company) return;
    const fx = await resolveImportExchangeRate({
      companyId: company.id,
      currencyCode: 'USD',
      foreignAmount: 2000,
      explicitRate: 278.5,
    });
    assert.equal(fx.exchangeRate, 278.5);
    assert.equal(fx.baseAmount, 557000);
    assert.equal(fx.rateSource, 'EXPLICIT');
  });
});

describe('import GRN preservation IPO-2026-003', () => {
  it('preserves IGRN-2026-003 1000kg posted receipt', async () => {
    if (process.env.IMPORT_ENTERPRISE_DB_TESTS !== '1') return;
    const prisma = require('../prisma/client');
    const po = await prisma.importPurchaseOrder.findFirst({
      where: { poNumber: 'IPO-2026-003' },
      include: { items: true, grns: { include: { items: true } } },
    });
    assert.ok(po, 'IPO-2026-003 must exist');
    const grn = po.grns.find((g) => g.grnNumber === 'IGRN-2026-003');
    assert.ok(grn, 'IGRN-2026-003 must exist');
    assert.ok(IMPORT_GRN_POSTED_STATUSES.includes(grn.status));
    assert.ok(grn.stockPostedAt, 'stock must remain posted');
    const accepted = grn.items.reduce((s, i) => s + toNumber(i.acceptedQty), 0);
    assert.equal(accepted, 1000);
    const item = po.items[0];
    assert.equal(toNumber(item.receivedQty), 1000);
  });
});
