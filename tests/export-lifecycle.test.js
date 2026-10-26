'use strict';

/**
 * Export lifecycle — pure helper tests (no database required).
 * Run: node --test tests/export-lifecycle.test.js
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  ApiError,
  assertTransition,
  canonicalStatus,
  positiveNumber,
  nonNegativeNumber,
  requiredString,
  requiredDate,
  buildPagination,
  nextNumber,
  resolveExportFiscalYear,
  toPlain,
  TRANSITIONS,
  ALLOWED_STATUSES,
} = require('../services/exportHelpers');

describe('export status machine', () => {
  it('allows the documented display order path', () => {
    assert.equal(assertTransition('order', 'Draft', 'Confirmed'), 'Confirmed');
    assert.equal(
      assertTransition('order', 'On Board Vessel', 'Delivered'),
      'Delivered'
    );
  });

  it('rejects skipping workflow steps', () => {
    assert.throws(
      () => assertTransition('order', 'Draft', 'Dispatched'),
      (err) => err.status === 409 && err.code === 'INVALID_TRANSITION'
    );
    assert.throws(
      () => assertTransition('lc', 'LC Advised', 'Settlement Received'),
      /Cannot move lc/
    );
  });

  it('rejects any transition out of a terminal status', () => {
    assert.throws(() => assertTransition('order', 'Completed', 'Draft'));
    assert.throws(() => assertTransition('receipt', 'Cancelled', 'Realized & Credited'));
  });

  it('allows same-status updates (e.g. LC discrepancy notes)', () => {
    assert.equal(assertTransition('lc', 'Confirmed', 'Confirmed'), 'Confirmed');
  });

  it('normalizes status casing and rejects unknown values', () => {
    assert.equal(canonicalStatus('receipt', 'realized & credited'), 'Realized & Credited');
    assert.throws(
      () => canonicalStatus('receipt', 'Paid'),
      (err) => err.status === 400 && err.code === 'INVALID_STATUS'
    );
  });

  it('exposes the allowed statuses for filters', () => {
    assert.deepEqual(ALLOWED_STATUSES.receipt, [
      'Funds In Transit',
      'Realized & Credited',
      'Forex Hedged',
      'Cancelled',
    ]);
    assert.ok(TRANSITIONS.customs['Let Export Order (LEO) Granted'].includes('Sailed & Completed'));
  });
});

describe('export input validation', () => {
  it('requires positive amounts', () => {
    assert.equal(positiveNumber('125.5', 'amount'), 125.5);
    assert.throws(
      () => positiveNumber(0, 'amount'),
      (err) => err.status === 400 && err.field === 'amount'
    );
    assert.throws(() => positiveNumber('abc', 'amount'), /greater than 0/);
  });

  it('allows zero but rejects negative non-negative amounts', () => {
    assert.equal(nonNegativeNumber(null, 'charges'), 0);
    assert.equal(nonNegativeNumber(0, 'charges'), 0);
    assert.throws(() => nonNegativeNumber(-1, 'charges'), /zero or greater/);
  });

  it('trims required strings and enforces max length', () => {
    assert.equal(requiredString('  LC-1  ', 'lcNumber'), 'LC-1');
    assert.throws(() => requiredString('   ', 'lcNumber'), /required/);
    assert.throws(() => requiredString('abcd', 'code', { max: 3 }), /3 characters/);
  });

  it('rejects invalid dates', () => {
    assert.ok(requiredDate('2026-10-26', 'receiptDate') instanceof Date);
    assert.throws(() => requiredDate('not-a-date', 'receiptDate'), /not a valid date/);
    assert.throws(() => requiredDate(null, 'receiptDate'), /required/);
  });

  it('clamps pagination', () => {
    assert.deepEqual(buildPagination({ page: '2', limit: '25' }), {
      page: 2,
      limit: 25,
      skip: 25,
    });
    assert.deepEqual(buildPagination({ page: '-3', limit: '9999' }), {
      page: 1,
      limit: 200,
      skip: 0,
    });
  });
});

describe('export numbering', () => {
  it('increments the highest number in the current year', async () => {
    const year = new Date().getFullYear();
    const tx = {
      exportOrder: {
        findMany: async () => [
          { orderNumber: `EXP-${year}-0002` },
          { orderNumber: `EXP-${year}-0011` },
        ],
      },
    };
    const value = await nextNumber(tx, 'exportOrder', 'orderNumber', 'company-1', 'EXP');
    assert.equal(value, `EXP-${year}-0012`);
  });

  it('starts at 0001 when the company has no documents this year', async () => {
    const year = new Date().getFullYear();
    const tx = { exportOrder: { findMany: async () => [] } };
    const value = await nextNumber(tx, 'exportOrder', 'orderNumber', 'company-1', 'EXP');
    assert.equal(value, `EXP-${year}-0001`);
  });
});

describe('export fiscal period guard', () => {
  it('returns null when the company has no configured fiscal years', async () => {
    const client = { fiscalYear: { count: async () => 0 } };
    assert.equal(await resolveExportFiscalYear('c1', new Date('2026-10-26'), client), null);
  });

  it('returns the covering open fiscal year', async () => {
    const client = {
      fiscalYear: {
        count: async () => 1,
        findFirst: async () => ({ id: 'fy-2026' }),
      },
    };
    assert.equal(await resolveExportFiscalYear('c1', new Date('2026-10-26'), client), 'fy-2026');
  });

  it('blocks posting when no open period covers the date', async () => {
    const client = {
      fiscalYear: {
        count: async () => 1,
        findFirst: async () => null,
      },
    };
    await assert.rejects(
      () => resolveExportFiscalYear('c1', new Date('2026-10-26'), client),
      (err) => err.status === 400 && err.code === 'PERIOD_CLOSED'
    );
  });
});

describe('export serialization', () => {
  it('serializes dates and Prisma-like decimals', () => {
    class Decimal {
      constructor(value) {
        this.value = value;
      }
      toString() {
        return this.value;
      }
      toNumber() {
        return Number(this.value);
      }
    }
    const out = toPlain({
      when: new Date('2026-10-26T00:00:00.000Z'),
      amount: new Decimal('1234.5000'),
      nested: [{ amount: new Decimal('2.25') }],
      name: 'LC-1',
    });
    assert.equal(out.when, '2026-10-26T00:00:00.000Z');
    assert.equal(out.amount, 1234.5);
    assert.equal(out.nested[0].amount, 2.25);
    assert.equal(out.name, 'LC-1');
  });

  it('ApiError carries status, code and field', () => {
    const err = ApiError('nope', { status: 409, code: 'X', field: 'amount' });
    assert.equal(err.status, 409);
    assert.equal(err.code, 'X');
    assert.equal(err.field, 'amount');
  });
});
