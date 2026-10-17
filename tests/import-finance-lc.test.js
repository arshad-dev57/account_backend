'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  LC_STATUS_TRANSITIONS,
  normalizeLcStatus,
} = require('../services/importEnterpriseService');

describe('import finance LC lifecycle', () => {
  it('normalizes legacy statuses', () => {
    assert.equal(normalizeLcStatus('Application Submitted'), 'Draft');
    assert.equal(normalizeLcStatus('Settled'), 'Paid/Settled');
    assert.equal(normalizeLcStatus('Issued'), 'Issued');
  });

  it('allows Draft → Issued and Issued → Amended', () => {
    assert.ok(LC_STATUS_TRANSITIONS.Draft.includes('Issued'));
    assert.ok(LC_STATUS_TRANSITIONS.Issued.includes('Amended'));
    assert.ok(LC_STATUS_TRANSITIONS.Issued.includes('Documents Presented'));
    assert.ok(LC_STATUS_TRANSITIONS.Accepted.includes('Paid/Settled'));
  });

  it('blocks invalid jumps', () => {
    assert.ok(!LC_STATUS_TRANSITIONS.Draft.includes('Paid/Settled'));
    assert.ok(!LC_STATUS_TRANSITIONS['Paid/Settled'].includes('Issued'));
  });
});
