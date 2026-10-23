'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  normalizeCustomsStatus,
  CUSTOMS_STATUS_TRANSITIONS,
} = require('../services/importCustomsService');
const { parseDateOnly, toDbDateOnly, toDateInputValue } = require('../utils/importFx');

describe('import customs lifecycle', () => {
  it('normalizes Cleared aliases to Released/Cleared', () => {
    assert.equal(normalizeCustomsStatus('Cleared'), 'Released/Cleared');
    assert.equal(normalizeCustomsStatus('Out of Charge'), 'Released/Cleared');
  });

  it('enforces Draft → Under Assessment → Assessed → Pending Payment → Duty Paid → Pending Approval → Approved → Released', () => {
    assert.ok(CUSTOMS_STATUS_TRANSITIONS.Draft.includes('Under Assessment'));
    assert.ok(CUSTOMS_STATUS_TRANSITIONS['Under Assessment'].includes('Assessed'));
    assert.ok(CUSTOMS_STATUS_TRANSITIONS.Assessed.includes('Pending Payment'));
    assert.ok(CUSTOMS_STATUS_TRANSITIONS['Pending Payment'].includes('Duty Paid'));
    assert.ok(CUSTOMS_STATUS_TRANSITIONS['Duty Paid'].includes('Pending Approval'));
    assert.ok(CUSTOMS_STATUS_TRANSITIONS['Pending Approval'].includes('Approved'));
    assert.ok(CUSTOMS_STATUS_TRANSITIONS.Approved.includes('Released/Cleared'));
  });

  it('blocks release before duty paid / approval', () => {
    assert.ok(!CUSTOMS_STATUS_TRANSITIONS.Assessed.includes('Released/Cleared'));
    assert.ok(!CUSTOMS_STATUS_TRANSITIONS.Assessed.includes('Duty Paid'));
    assert.ok(!CUSTOMS_STATUS_TRANSITIONS['Duty Paid'].includes('Released/Cleared'));
    assert.ok(!CUSTOMS_STATUS_TRANSITIONS['Under Assessment'].includes('Duty Paid'));
  });

  it('stores and reads calendar dates as YYYY-MM-DD via UTC noon (no month+1 / day swap)', () => {
    const stored = toDbDateOnly('2026-10-17');
    assert.equal(stored.toISOString(), '2026-10-17T12:00:00.000Z');
    assert.equal(toDateInputValue(stored), '2026-10-17');
    // 1-based month in string — Nov 30 must not become Dec
    assert.equal(toDateInputValue('2026-11-30'), '2026-11-30');
    const local = parseDateOnly('2026-10-17');
    const today = parseDateOnly(new Date());
    assert.ok(local);
    assert.ok(today);
    assert.ok(local.getTime() <= today.getTime());
  });
});
