'use strict';

/* Read-only check: resolves every export account inside a rolled-back
 * transaction so no COA rows are persisted. */

const prisma = require('../prisma/client');
const accounting = require('../services/exportAccountingService');

const COMPANY_ID = 'b276083a-ee59-4fca-b9bb-4ac7c720576d';
const USER_ID = '896af3fc-7609-42e6-8aed-42b21f98742a';
const ROLLBACK = new Error('__ROLLBACK__');

(async () => {
  try {
    await prisma.$transaction(
      async (tx) => {
        const accounts = {
          customerAdvances: await accounting.getCustomerAdvancesAccount(tx, COMPANY_ID, USER_ID),
          fxGain: await accounting.getFxGainAccount(tx, COMPANY_ID, USER_ID),
          fxLoss: await accounting.getFxLossAccount(tx, COMPANY_ID, USER_ID),
          bankCharges: await accounting.getBankChargesAccount(tx, COMPANY_ID, USER_ID),
          exportDuty: await accounting.getExportDutyAccount(tx, COMPANY_ID, USER_ID),
          freight: await accounting.getFreightAccount(tx, COMPANY_ID, USER_ID),
          misc: await accounting.getMiscAccount(tx, COMPANY_ID, USER_ID),
        };
        for (const [key, account] of Object.entries(accounts)) {
          console.log(`${key.padEnd(16)} -> ${account.code} ${account.name} (${account.type})`);
        }
        throw ROLLBACK;
      },
      { timeout: 30000 }
    );
  } catch (err) {
    if (err !== ROLLBACK) throw err;
    console.log('transaction rolled back — no COA rows persisted');
  } finally {
    await prisma.$disconnect();
  }
})();
