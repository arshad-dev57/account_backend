

const fs = require('fs');
const path = require('path');

const DRY = process.argv.includes('--dry');

const ROOT = path.resolve(__dirname, '..');

// Files known to contain the buggy read filter.
const TARGETS = [
  'models/Bill.js',
  'controllers/incomeController.js',
  'controllers/paymentReceivedController.js',
  'controllers/paymentMadeController.js',
  'controllers/loanController.js',
  'controllers/fixedAssetController.js',
  'controllers/creditNoteController.js',
  'controllers/accountsReceivableController.js',
  'controllers/accountsPayableController.js',
];

// 1) `const filter = { createdBy: userId };`  ->  companyId-scoped
const RE_SIMPLE = /const filter = \{\s*createdBy:\s*userId\s*\};/g;

// 2) multi-line object that STARTS with createdBy: userId, e.g.
//    const filter = {
//      createdBy: userId,
//      status: 'Posted'
//    };
//    We only swap the leading `createdBy: userId` line to `companyId: companyId`
//    keeping any additional constraints (status, etc.).
const RE_MULTILINE_FIRSTLINE = /(const filter = \{\s*\n\s*)createdBy:\s*userId(,?)/g;

let totalFiles = 0;
let totalReplacements = 0;

for (const rel of TARGETS) {
  const abs = path.join(ROOT, rel);
  if (!fs.existsSync(abs)) {
    console.log(`⚠️  skip (not found): ${rel}`);
    continue;
  }

  let src = fs.readFileSync(abs, 'utf8');
  const before = src;
  let fileReplacements = 0;

  src = src.replace(RE_SIMPLE, () => {
    fileReplacements++;
    return 'const filter = { companyId: companyId };';
  });

  src = src.replace(RE_MULTILINE_FIRSTLINE, (m, head, comma) => {
    fileReplacements++;
    return `${head}companyId: companyId${comma}`;
  });

  if (src !== before) {
    totalFiles++;
    totalReplacements += fileReplacements;
    console.log(`✏️  ${rel}: ${fileReplacements} replacement(s)`);
    if (!DRY) {
      fs.writeFileSync(abs + '.bak', before, 'utf8');
      fs.writeFileSync(abs, src, 'utf8');
    }
  } else {
    console.log(`✅ ${rel}: nothing to change`);
  }
}

console.log('──────────────────────────────────────────────');
console.log(`${DRY ? '[DRY RUN] ' : ''}Files changed: ${totalFiles}, replacements: ${totalReplacements}`);
if (DRY) console.log('Run without --dry to apply. Backups (.bak) will be written.');
