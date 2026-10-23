'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  assertRfqStatusTransition,
  normalizeRfqStatus,
  IMPORT_RFQ_STATUS_TRANSITIONS,
  isValidHsCode,
} = require('../services/importService');

describe('Import RFQ lifecycle', () => {
  it('defines Draft → Sent → Quotes Received → Under Comparison → Awarded → Pending Approval → Approved → Converted to PO', () => {
    assert.deepEqual(IMPORT_RFQ_STATUS_TRANSITIONS.Draft, ['Sent', 'Cancelled']);
    assert.ok(IMPORT_RFQ_STATUS_TRANSITIONS.Sent.includes('Quotes Received'));
    assert.ok(IMPORT_RFQ_STATUS_TRANSITIONS['Quotes Received'].includes('Under Comparison'));
    assert.ok(IMPORT_RFQ_STATUS_TRANSITIONS['Under Comparison'].includes('Awarded'));
    assert.ok(IMPORT_RFQ_STATUS_TRANSITIONS.Awarded.includes('Pending Approval'));
    assert.ok(!IMPORT_RFQ_STATUS_TRANSITIONS.Awarded.includes('Approved'));
    assert.ok(IMPORT_RFQ_STATUS_TRANSITIONS['Pending Approval'].includes('Approved'));
    assert.ok(IMPORT_RFQ_STATUS_TRANSITIONS['Pending Approval'].includes('Awarded'));
    assert.ok(IMPORT_RFQ_STATUS_TRANSITIONS.Approved.includes('Converted to PO'));
  });

  it('rejects skipping Approve from Draft', () => {
    assert.throws(() => assertRfqStatusTransition('Draft', 'Approved'), /Invalid RFQ status transition/);
  });

  it('rejects skipping Pending Approval from Awarded to Approved', () => {
    assert.throws(
      () => assertRfqStatusTransition('Awarded', 'Approved'),
      /Invalid RFQ status transition/
    );
  });

  it('allows Awarded → Pending Approval → Approved', () => {
    assert.deepEqual(assertRfqStatusTransition('Awarded', 'Pending Approval'), {
      from: 'Awarded',
      to: 'Pending Approval',
    });
    assert.deepEqual(assertRfqStatusTransition('Pending Approval', 'Approved'), {
      from: 'Pending Approval',
      to: 'Approved',
    });
  });

  it('allows reject/withdraw Pending Approval → Awarded', () => {
    assert.deepEqual(assertRfqStatusTransition('Pending Approval', 'Awarded'), {
      from: 'Pending Approval',
      to: 'Awarded',
    });
  });

  it('normalizes legacy statuses', () => {
    assert.equal(normalizeRfqStatus('PO Created'), 'Converted to PO');
    assert.equal(normalizeRfqStatus('Quotation Selected'), 'Awarded');
    assert.equal(normalizeRfqStatus('Sent to Supplier'), 'Sent');
  });

  it('validates HS codes (6–10 digits, optional dots)', () => {
    assert.equal(isValidHsCode('1006.30'), true);
    assert.equal(isValidHsCode('100630'), true);
    assert.equal(isValidHsCode('GCC-8471'), false);
    assert.equal(isValidHsCode('8471'), false);
    assert.equal(isValidHsCode(''), true);
  });
});
