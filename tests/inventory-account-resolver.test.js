'use strict';

const assert = require('assert');
const {
  scoreInventoryCandidate,
  preferInventoryAccount,
  findOrCreateInventoryAccount,
} = require('../warehouse/services/stockAccountingService');

function testScoresPreferInventoryOverPrepaid() {
  const prepaid = { code: '1300', name: 'Prepaid Expenses' };
  const inventory = { code: '1200', name: 'Inventory' };
  assert.ok(scoreInventoryCandidate(inventory) > scoreInventoryCandidate(prepaid));
  assert.ok(scoreInventoryCandidate(prepaid) < 0);
  assert.ok(scoreInventoryCandidate(inventory) > 0);
}

function testPreferInventoryAccountDefaultChart() {
  const chosen = preferInventoryAccount([
    { id: 'a', code: '1300', name: 'Prepaid Expenses' },
    { id: 'b', code: '1200', name: 'Inventory' },
    { id: 'c', code: '1001', name: 'Cash in Hand' },
  ]);
  assert.strictEqual(chosen.code, '1200');
  assert.strictEqual(chosen.name, 'Inventory');
}

function testPreferInventoryByNameWhenNo1200() {
  const chosen = preferInventoryAccount([
    { id: 'a', code: '1300', name: 'Prepaid Expenses' },
    { id: 'b', code: '1405', name: 'Finished Goods Stock' },
  ]);
  assert.strictEqual(chosen.code, '1405');
}

function testNeverPickBarePrepaid1300() {
  const chosen = preferInventoryAccount([
    { id: 'a', code: '1300', name: 'Prepaid Expenses' },
  ]);
  assert.strictEqual(chosen, null);
}

async function testFindOrCreateAgainstLiveCompanyChart() {
  const prisma = require('../prisma/client');
  const companyId = '73bf6455-9670-48e3-b1d6-2c05f0a5d9e4';
  const company = await prisma.company.findUnique({ where: { id: companyId } });
  if (!company) {
    console.log('skip live inventory resolver — company not found');
    return;
  }
  const account = await findOrCreateInventoryAccount(prisma, companyId, 'SYSTEM');
  assert.ok(account);
  assert.strictEqual(account.code, '1200');
  assert.ok(!/prepaid/i.test(account.name));
}

testScoresPreferInventoryOverPrepaid();
testPreferInventoryAccountDefaultChart();
testPreferInventoryByNameWhenNo1200();
testNeverPickBarePrepaid1300();

testFindOrCreateAgainstLiveCompanyChart()
  .then(() => {
    console.log('inventory-account-resolver tests passed');
    process.exit(0);
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
