'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  CUSTOMS_STATUS_TRANSITIONS,
  normalizeCustomsStatus,
} = require('../services/importCustomsService');

describe('import customs approval lifecycle', () => {
  it('requires Assessed → Pending Payment before duty payment, then Duty Paid → Pending Approval → Approved → Released', () => {
    assert.ok(CUSTOMS_STATUS_TRANSITIONS.Assessed.includes('Pending Payment'));
    assert.ok(!CUSTOMS_STATUS_TRANSITIONS.Assessed.includes('Duty Paid'));
    assert.ok(CUSTOMS_STATUS_TRANSITIONS['Pending Payment'].includes('Duty Paid'));
    assert.ok(CUSTOMS_STATUS_TRANSITIONS['Duty Paid'].includes('Pending Approval'));
    assert.ok(!CUSTOMS_STATUS_TRANSITIONS['Duty Paid'].includes('Released/Cleared'));
    assert.ok(CUSTOMS_STATUS_TRANSITIONS['Pending Approval'].includes('Approved'));
    assert.ok(CUSTOMS_STATUS_TRANSITIONS.Approved.includes('Released/Cleared'));
  });

  it('normalizes status labels for approval states', () => {
    assert.equal(normalizeCustomsStatus('Pending Approval'), 'Pending Approval');
    assert.equal(normalizeCustomsStatus('Approved'), 'Approved');
  });
});
