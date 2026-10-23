'use strict';

const { describe, it } = require('node:test');
const assert = require('assert');
const {
  validateReceiveQty,
  isCustomsReleased,
  isBlOriginal,
  CUSTOMS_RELEASED_STATUSES,
  IMPORT_GRN_POSTED_STATUSES,
} = require('../services/importGrnService');

describe('import GRN shipment gate helpers', () => {
  it('treats Released/Cleared aliases as released', () => {
    assert.ok(isCustomsReleased('Released/Cleared'));
    assert.ok(isCustomsReleased('Cleared'));
    assert.ok(isCustomsReleased('Out of Charge'));
    assert.ok(!isCustomsReleased('Assessed'));
    assert.ok(!isCustomsReleased('Duty Paid'));
    assert.ok(CUSTOMS_RELEASED_STATUSES.includes('Released/Cleared'));
  });

  it('detects Original B/L type', () => {
    assert.ok(isBlOriginal('Original'));
    assert.ok(isBlOriginal('Original B/L'));
    assert.ok(!isBlOriginal('Telex Release'));
    assert.ok(!isBlOriginal('Express / Seaway'));
  });

  it('blocks over-receive with Remaining shipped quantity message', () => {
    let err = null;
    try {
      validateReceiveQty({
        orderedQty: 100,
        alreadyReceivedQty: 60,
        receiveQty: 50,
      });
    } catch (e) {
      err = e;
    }
    assert.ok(err);
    assert.equal(err.code, 'OVER_RECEIVE');
    assert.match(err.message, /Remaining shipped quantity: 40/);
  });

  it('allows exact remaining', () => {
    const r = validateReceiveQty({
      orderedQty: 100,
      alreadyReceivedQty: 60,
      receiveQty: 40,
    });
    assert.equal(r.remaining, 40);
    assert.equal(r.recv, 40);
  });

  it('Posted is a posted status', () => {
    assert.ok(IMPORT_GRN_POSTED_STATUSES.includes('Posted'));
    assert.ok(IMPORT_GRN_POSTED_STATUSES.includes('Inspected & Received'));
  });
});
