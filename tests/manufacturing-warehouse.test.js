'use strict';

const assert = require('assert');
const {
  resolveMaterialWarehouseId,
  SOURCE_WAREHOUSE_REQUIRED,
  SOURCE_WAREHOUSE_STOCK_MISSING
} = require('../utils/manufacturingWorkflow');

function casePrefersReservationLocation() {
  assert.strictEqual(
    resolveMaterialWarehouseId(
      { sourceWarehouseId: 'src', locationId: 'loc' },
      { locationId: 'res' }
    ),
    'res'
  );
}

function caseFallsBackToSourceWarehouse() {
  assert.strictEqual(
    resolveMaterialWarehouseId(
      { sourceWarehouseId: 'src', locationId: 'loc' },
      { locationId: null }
    ),
    'src'
  );
}

function caseFallsBackToOrderLocation() {
  assert.strictEqual(
    resolveMaterialWarehouseId(
      { sourceWarehouseId: '', locationId: 'loc' },
      {}
    ),
    'loc'
  );
}

function caseUnresolvedWhenNoWarehouse() {
  assert.strictEqual(
    resolveMaterialWarehouseId({ sourceWarehouseId: null, locationId: null }, { locationId: '' }),
    null
  );
}

function caseExistingMoKeepsReservationWarehouse() {
  const existing = resolveMaterialWarehouseId(
    { sourceWarehouseId: 'main', locationId: 'main' },
    { locationId: 'main' }
  );
  assert.strictEqual(existing, 'main');
}

function caseMessagesAreExplicit() {
  assert.ok(SOURCE_WAREHOUSE_REQUIRED.includes('Source warehouse is required'));
  assert.ok(SOURCE_WAREHOUSE_STOCK_MISSING.includes('Source warehouse is missing'));
}

casePrefersReservationLocation();
caseFallsBackToSourceWarehouse();
caseFallsBackToOrderLocation();
caseUnresolvedWhenNoWarehouse();
caseExistingMoKeepsReservationWarehouse();
caseMessagesAreExplicit();
console.log('manufacturing-warehouse tests passed');
