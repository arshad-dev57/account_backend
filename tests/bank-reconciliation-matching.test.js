'use strict';

/**
 * Pure matching allocation tests (no DB).
 * Run: node --test tests/bank-reconciliation-matching.test.js
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  buildAllocationPairs,
  nearlyEqual,
  stmtDirection,
  lineDirection,
} = require('../services/bankReconciliationMatching');

describe('buildAllocationPairs', () => {
  it('supports 1:1', () => {
    const pairs = buildAllocationPairs(
      [{ id: 's1', remaining: 100 }],
      [{ id: 'j1', remaining: 100 }]
    );
    assert.equal(pairs.length, 1);
    assert.equal(pairs[0].allocatedAmount, 100);
  });

  it('supports 1:N', () => {
    const pairs = buildAllocationPairs(
      [{ id: 's1', remaining: 150 }],
      [
        { id: 'j1', remaining: 100 },
        { id: 'j2', remaining: 50 },
      ]
    );
    assert.equal(pairs.length, 2);
    assert.ok(nearlyEqual(pairs.reduce((a, p) => a + p.allocatedAmount, 0), 150));
  });

  it('supports N:1', () => {
    const pairs = buildAllocationPairs(
      [
        { id: 's1', remaining: 40 },
        { id: 's2', remaining: 60 },
      ],
      [{ id: 'j1', remaining: 100 }]
    );
    assert.equal(pairs.length, 2);
    assert.ok(pairs.every((p) => p.journalLineId === 'j1'));
  });

  it('rejects unbalanced amounts', () => {
    assert.throws(
      () =>
        buildAllocationPairs(
          [{ id: 's1', remaining: 100 }],
          [{ id: 'j1', remaining: 90 }]
        ),
      /must balance/
    );
  });

  it('rejects unsupported N:M with unequal pairwise amounts', () => {
    assert.throws(
      () =>
        buildAllocationPairs(
          [
            { id: 's1', remaining: 30 },
            { id: 's2', remaining: 70 },
          ],
          [
            { id: 'j1', remaining: 40 },
            { id: 'j2', remaining: 60 },
          ]
        ),
      /Many-to-many|pairwise/
    );
  });
});

describe('direction helpers', () => {
  it('maps bank credit to inflow and book debit to inflow', () => {
    assert.equal(stmtDirection({ credit: 10, debit: 0, amount: 10 }), 'in');
    assert.equal(stmtDirection({ credit: 0, debit: 10, amount: -10 }), 'out');
    assert.equal(lineDirection({ debit: 10, credit: 0 }), 'in');
    assert.equal(lineDirection({ debit: 0, credit: 10 }), 'out');
  });
});
