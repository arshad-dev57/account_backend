'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  normalizeShipmentStatus,
  SHIPMENT_STATUS_TRANSITIONS,
  resolveLoadType,
  optionalMetric,
} = require('../services/importService');

describe('import shipment lifecycle', () => {
  it('normalizes legacy statuses', () => {
    assert.equal(normalizeShipmentStatus('Arrived at Port'), 'Arrived');
    assert.equal(normalizeShipmentStatus('Customs Cleared'), 'Cleared');
    assert.equal(normalizeShipmentStatus('Delivered'), 'Delivered/Received');
    assert.equal(normalizeShipmentStatus('Departed (Loaded)'), 'Departed');
  });

  it('allows Booking Confirmed → Departed → In Transit → Arrived', () => {
    assert.ok(SHIPMENT_STATUS_TRANSITIONS['Booking Confirmed'].includes('Departed'));
    assert.ok(SHIPMENT_STATUS_TRANSITIONS.Departed.includes('In Transit'));
    assert.ok(SHIPMENT_STATUS_TRANSITIONS['In Transit'].includes('Arrived'));
    assert.ok(SHIPMENT_STATUS_TRANSITIONS.Arrived.includes('Customs Clearance'));
  });

  it('blocks Departed → Arrived (must go via In Transit)', () => {
    assert.ok(!SHIPMENT_STATUS_TRANSITIONS.Departed.includes('Arrived'));
    assert.ok(!SHIPMENT_STATUS_TRANSITIONS['Booking Confirmed'].includes('Arrived'));
  });

  it('infers FCL from container type like 40ft HC', () => {
    assert.equal(resolveLoadType(null, '40ft HC'), 'FCL');
    assert.equal(resolveLoadType('LCL', '40GP'), 'LCL');
    assert.equal(resolveLoadType(null, null), null);
  });

  it('treats empty metrics as null', () => {
    assert.equal(optionalMetric(''), null);
    assert.equal(optionalMetric(null), null);
    assert.equal(optionalMetric(12.5), 12.5);
  });
});
