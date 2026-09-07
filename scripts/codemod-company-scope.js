
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const DIRS = [
  path.join(ROOT, 'controllers'),
  path.join(ROOT, 'warehouse', 'controller'),
];

const args = process.argv.slice(2);
const DRY = args.includes('--dry');
const RESTORE = args.includes('--restore');

function listFiles() {
  const files = [];
  for (const dir of DIRS) {
    if (!fs.existsSync(dir)) continue;
    for (const f of fs.readdirSync(dir)) {
      if (f.endsWith('.js')) files.push(path.join(dir, f));
    }
  }
  return files;
}

if (RESTORE) {
  let restored = 0;
  for (const file of listFiles()) {
    const bak = file + '.bak';
    if (fs.existsSync(bak)) {
      fs.copyFileSync(bak, file);
      fs.unlinkSync(bak);
      restored++;
    }
  }
  console.log(`Restored ${restored} files from .bak`);
  process.exit(0);
}

function matchBrace(src, open) {
  let depth = 0;
  let i = open;
  let inStr = null;
  for (; i < src.length; i++) {
    const c = src[i];
    const prev = src[i - 1];
    if (inStr) {
      if (c === inStr && prev !== '\\') inStr = null;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') { inStr = c; continue; }
    if (c === '/' && src[i + 1] === '/') { // line comment
      while (i < src.length && src[i] !== '\n') i++;
      continue;
    }
    if (c === '/' && src[i + 1] === '*') { // block comment
      i += 2;
      while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) i++;
      i++;
      continue;
    }
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) return i; }
  }
  return -1;
}
function hasTopLevelCompanyId(src, open, close) {
  let depth = 0;
  let inStr = null;
  for (let i = open; i <= close; i++) {
    const c = src[i];
    const prev = src[i - 1];
    if (inStr) { if (c === inStr && prev !== '\\') inStr = null; continue; }
    if (c === '"' || c === "'" || c === '`') { inStr = c; continue; }
    if (c === '{') { depth++; continue; }
    if (c === '}') { depth--; continue; }
    if (depth === 1 && src.startsWith('companyId', i)) {
      // ensure it's a key (preceded by non-word, followed by optional ws then ':')
      const before = src[i - 1];
      let j = i + 'companyId'.length;
      while (/\s/.test(src[j])) j++;
      if (!/\w/.test(before) && src[j] === ':') return true;
    }
  }
  return false;
}

let totalFilters = 0;
let totalDropped = 0;
let touchedFiles = 0;

for (const file of listFiles()) {
  let src = fs.readFileSync(file, 'utf8');
  const original = src;
  const edits = [];
  const whereRanges = [];
  {
    const re = /\bwhere\s*:\s*\{/g;
    let m;
    while ((m = re.exec(src))) {
      const open = src.indexOf('{', m.index);
      const close = matchBrace(src, open);
      if (close !== -1) whereRanges.push([open, close]);
    }
  }
  const inWhere = (idx) => whereRanges.some(([o, c]) => idx > o && idx < c);
  const CUR_USER_VALUES = /^(userId|req\.user\.id|targetUserId|creatorId|adminId)\b/;
  const keyRe = /(^|[\s{,(])(userId|createdBy)(\s*):/g;
  let km;
  while ((km = keyRe.exec(src))) {
    const keyName = km[2];
    const keyStart = km.index + km[1].length; 
    const colonIdx = keyRe.lastIndex - 1;     
    if (!inWhere(keyStart)) continue;         
    let i = colonIdx + 1;
    let depth = 0;
    let inStr = null;
    while (i < src.length) {
      const c = src[i];
      const prev = src[i - 1];
      if (inStr) { if (c === inStr && prev !== '\\') inStr = null; i++; continue; }
      if (c === '"' || c === "'" || c === '`') { inStr = c; i++; continue; }
      if (c === '{' || c === '[' || c === '(') { depth++; i++; continue; }
      if (c === '}' || c === ']' || c === ')') { if (depth === 0) break; depth--; i++; continue; }
      if (c === ',' && depth === 0) break;
      i++;
    }
    const valueEnd = i; 
    if (keyName === 'createdBy') {
      const valText = src.slice(colonIdx + 1, valueEnd).trim();
      if (!CUR_USER_VALUES.test(valText)) continue;
    }
    let encl = null;
    for (const [o, c] of whereRanges) {
      if (keyStart > o && keyStart < c) {
        if (!encl || o > encl[0]) encl = [o, c];
      }
    }
    const siblingHasCompany = encl && hasTopLevelCompanyId(src, encl[0], encl[1]);

    if (siblingHasCompany) {
      let delStart = keyStart;
      let delEnd = valueEnd;
      if (src[delEnd] === ',') delEnd++;     
      edits.push({ start: delStart, end: delEnd, text: '' });
      totalDropped++;
    } else {
      edits.push({ start: keyStart, end: valueEnd, text: 'companyId: companyId' });
      totalFilters++;
    }
  }

  if (edits.length === 0) continue;
  edits.sort((a, b) => b.start - a.start);
  for (const e of edits) {
    src = src.slice(0, e.start) + e.text + src.slice(e.end);
  }

  
  src = src.replace(
    /(const\s+userId\s*=\s*req\.user\.id;)(\s*\n)(?![^\n]*companyId\s*=\s*req\.user\.companyId)/g,
    (mm, decl, nl) => `${decl}${nl}    const companyId = req.user.companyId;\n`
  );

  if (src !== original) {
    touchedFiles++;
    if (!DRY) {
      if (!fs.existsSync(file + '.bak')) fs.writeFileSync(file + '.bak', original);
      fs.writeFileSync(file, src);
    }
  }
}

console.log(`${DRY ? '[DRY] ' : ''}Files changed: ${touchedFiles}`);
console.log(`userId filters rewritten to companyId: ${totalFilters}`);
console.log(`duplicate userId filters dropped (companyId sibling existed): ${totalDropped}`);
console.log(RESTORE ? '' : 'Backups written as <file>.bak (undo: node codemod-company-scope.js --restore)');
