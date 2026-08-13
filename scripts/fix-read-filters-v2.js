/**
 * fix-read-filters-v2.js
 *
 * Comprehensive company-scoping fix for LIST/READ endpoints across ALL
 * controllers.
 *
 * Problem
 * -------
 * Many controllers still build their read filters from the individual creator
 * (`createdBy: userId`, `userId: userId`, `where: { userId }`) instead of the
 * company (`companyId`). Because of this a newly-created company user (e.g. a
 * manager) only sees rows they personally created, NOT the data created by the
 * admin — even though they share the same companyId.
 *
 * What this codemod does
 * ----------------------
 * It walks each target file character-by-character, tracking a small brace
 * stack that remembers whether the CURRENT object literal is a READ context
 * (`where:` / `const filter =` / `const where =` / `const query =` /
 * `let query =` / `accountsQuery =`) or a WRITE context (`data:`).
 *
 * Inside a READ context it rewrites the FIRST scoping key it sees:
 *   - `createdBy: userId`   ->  `companyId: companyId`
 *   - `userId: userId`      ->  `companyId: companyId`
 *   - `userId,`  / `userId ` (shorthand)  ->  `companyId: companyId`
 *
 * Inside a WRITE context (`data: { ... createdBy: userId ... }`) it leaves
 * everything untouched so the audit trail (who created the row) is preserved.
 *
 * To keep the transform SAFE and predictable we do NOT try to be a full JS
 * parser. Instead we use a line-based pass with a context stack that is good
 * enough for the hand-written, consistently-formatted controllers in this repo.
 *
 * Usage
 * -----
 *   node scripts/fix-read-filters-v2.js --dry     (preview, no writes)
 *   node scripts/fix-read-filters-v2.js            (apply, writes .bak backups)
 */

const fs = require('fs');
const path = require('path');

const DRY = process.argv.includes('--dry');
const ROOT = path.resolve(__dirname, '..');

// Every controller that reads business data. (Skip subscription/stripe/
// notification which are legitimately per-user, and userManagement which is
// already fixed by hand.)
const TARGETS = [
  'controllers/chartOfAccountController.js',
  'controllers/journalEntryController.js',
  'controllers/trialBalanceController.js',
  'controllers/generalLedgerController.js',
  'controllers/transactionController.js',
  'controllers/reportsController.js',
  'controllers/equityController.js',
  'controllers/creditNoteController.js',
  'controllers/fixedAssetController.js',
  'controllers/loanController.js',
  'controllers/accountsPayableController.js',
  'controllers/accountsReceivableController.js',
  'controllers/paymentMadeController.js',
  'controllers/paymentReceivedController.js',
  'controllers/bankAccountController.js',
  'controllers/bankReconciliationController.js',
  'controllers/fiscalYearController.js',
  'controllers/expenseController.js',
  'controllers/incomeController.js',
];

// Keys that open a READ context object.
const READ_OPENERS = [
  /\bwhere\s*:\s*\{/,          // where: {
  /\bconst\s+filter\s*=\s*\{/, // const filter = {
  /\bconst\s+where\s*=\s*\{/,  // const where = {
  /\bconst\s+query\s*=\s*\{/,  // const query = {
  /\blet\s+query\s*=\s*\{/,    // let query = {
  /\blet\s+where\s*=\s*\{/,    // let where = {
  /\bfilter\s*=\s*\{/,         // filter = {
  /\bwhereClause\s*=\s*\{/,    // whereClause = {
  /\baccountsQuery\s*=\s*\{/,  // accountsQuery = {
];

// Key that opens a WRITE context object.
const WRITE_OPENER = /\bdata\s*:\s*\{/;

function transform(src) {
  const lines = src.split('\n');
  let replacements = 0;

  // Context stack of booleans: true = READ, false = WRITE, null = neutral.
  // We push on '{' and pop on '}'. We only need coarse tracking so we scan
  // each line, adjust stack, and decide whether replacements are allowed.
  const stack = [];
  let currentIsRead = () => (stack.length ? stack[stack.length - 1] === 'read' : false);
  let insideWrite = () => stack.includes('write');

  const out = lines.map((line) => {
    // Determine the context that a scoping key ON THIS LINE would belong to.
    // Peek: does this line open a read/write context before the key?
    let lineOpensRead = READ_OPENERS.some((re) => re.test(line));
    let lineOpensWrite = WRITE_OPENER.test(line);

    const eligible =
      (lineOpensRead || currentIsRead()) && !insideWrite();

    let newLine = line;
    if (eligible) {
      // Replace explicit `createdBy: userId` -> companyId
      newLine = newLine.replace(
        /createdBy:\s*userId(\b)/,
        () => {
          replacements++;
          return 'companyId: companyId$1'.replace('$1', '');
        }
      );
      // Replace explicit `userId: userId` -> companyId
      newLine = newLine.replace(
        /\buserId:\s*userId(\b)/,
        () => {
          replacements++;
          return 'companyId: companyId';
        }
      );
      // Replace shorthand `{ userId }` / `where: { userId ,` etc.
      // Only the standalone shorthand `userId` property (not userId used as a
      // value like `createdBy: userId`, already handled above).
      newLine = newLine.replace(
        /([\{,]\s*)userId(\s*[}])/,
        (m, pre, post) => {
          replacements++;
          return `${pre}companyId: companyId${post}`;
        }
      );
    }

    // Now update the brace stack based on the ORIGINAL line's braces so the
    // context is correct for subsequent lines.
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '{') {
        // Determine what kind of context this brace opens by looking at the
        // text immediately preceding it on this line.
        const upto = line.slice(0, i + 1);
        if (WRITE_OPENER.test(upto) && !/\bwhere\s*:\s*\{$/.test(upto)) {
          // crude: last opener match wins
        }
        if (/\bdata\s*:\s*\{$/.test(upto)) {
          stack.push('write');
        } else if (
          /\bwhere\s*:\s*\{$/.test(upto) ||
          /\b(?:const|let)\s+(?:filter|where|query)\s*=\s*\{$/.test(upto) ||
          /\b(?:filter|whereClause|accountsQuery)\s*=\s*\{$/.test(upto)
        ) {
          stack.push('read');
        } else {
          stack.push('neutral');
        }
      } else if (ch === '}') {
        stack.pop();
      }
    }

    return newLine;
  });

  return { src: out.join('\n'), replacements };
}

let totalFiles = 0;
let totalReplacements = 0;

for (const rel of TARGETS) {
  const abs = path.join(ROOT, rel);
  if (!fs.existsSync(abs)) {
    console.log(`⚠️  skip (not found): ${rel}`);
    continue;
  }

  const before = fs.readFileSync(abs, 'utf8');
  const { src: after, replacements } = transform(before);

  if (after !== before) {
    totalFiles++;
    totalReplacements += replacements;
    console.log(`✏️  ${rel}: ${replacements} replacement(s)`);
    if (!DRY) {
      fs.writeFileSync(abs + '.bak', before, 'utf8');
      fs.writeFileSync(abs, after, 'utf8');
    }
  } else {
    console.log(`✅${rel}: nothing to change`);
  }
}

console.log('──────────────────────────────────────────────');
console.log(
  `${DRY ? '[DRY RUN] ' : ''}Files changed: ${totalFiles}, replacements: ${totalReplacements}`
);
if (DRY) console.log('Run without --dry to apply. Backups (.bak) will be written.');
