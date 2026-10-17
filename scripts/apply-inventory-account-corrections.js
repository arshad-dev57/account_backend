#!/usr/bin/env node
'use strict';

/**
 * Approval-gated inventory account mapping corrections.
 *
 * Preview / dry-run (default):
 *   AUTHORIZE_INVENTORY_CORRECTIONS=YES node scripts/apply-inventory-account-corrections.js
 *
 * Execute (requires double confirmation):
 *   AUTHORIZE_INVENTORY_CORRECTIONS=YES CONFIRM_POST=YES node scripts/apply-inventory-account-corrections.js --execute
 *
 * Optional: --company=<companyId> --limit=N
 */

const {
  buildCorrectionPreview,
  applyCorrections,
  PREVIEW_PATH,
} = require('../services/inventoryAccountCorrectionService');

async function main() {
  const args = process.argv.slice(2);
  const execute = args.includes('--execute');
  const companyArg = args.find((a) => a.startsWith('--company='));
  const limitArg = args.find((a) => a.startsWith('--limit='));
  const companyId = companyArg ? companyArg.split('=')[1] : null;
  const limit = limitArg ? Number(limitArg.split('=')[1]) : null;

  const authorized = process.env.AUTHORIZE_INVENTORY_CORRECTIONS === 'YES';
  const confirmPost = process.env.CONFIRM_POST === 'YES';

  if (!authorized) {
    console.error(
      'Refused. Set AUTHORIZE_INVENTORY_CORRECTIONS=YES after reviewing reports/inventory-account-correction-preview.json'
    );
    process.exit(2);
  }

  const preview = await buildCorrectionPreview({ writeFile: true });
  console.log('Preview written to', PREVIEW_PATH);
  console.log('Summary:', preview.summary);
  if (preview.knownSaleExample) {
    console.log('Known sale example:', {
      source: preview.knownSaleExample.sourceEntryNumber,
      amount: preview.knownSaleExample.amount,
      correctionReference: preview.knownSaleExample.correctionReference,
    });
  }

  const result = await applyCorrections({
    authorize: true,
    confirmPost: execute && confirmPost,
    dryRun: !(execute && confirmPost),
    companyId,
    limit,
    userId: process.env.CORRECTION_USER_ID || 'SYSTEM-CORRECTION',
  });
  console.log(JSON.stringify(result, null, 2));
  if (execute && !confirmPost) {
    console.error('Execute requested but CONFIRM_POST=YES was not set — dry run only.');
    process.exit(3);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
