
const fs = require('fs');
const path = require('path');

const dirs = [
  path.join(__dirname, '..', 'controllers'),
  path.join(__dirname, '..', 'warehouse', 'controller'),
];

const buckets = {
  whereUserId: [],        // `userId: <x>` used inside a where/filter context (BREAKS visibility)
  dataUserIdCreate: [],   // `userId: <x>` as an audit field on create (KEEP)
  targetUserIdDecl: [],   // `const targetUserId = ...` (manager/createdBy logic - REMOVE)
  reqUserId: [],          // `const userId = req.user.id` (KEEP)
  other: []
};

for (const dir of dirs) {
  if (!fs.existsSync(dir)) continue;
  for (const f of fs.readdirSync(dir).filter(f => f.endsWith('.js'))) {
    const full = path.join(dir, f);
    const rel = path.relative(path.join(__dirname, '..'), full);
    const lines = fs.readFileSync(full, 'utf8').split(/\r?\n/);
    lines.forEach((line, i) => {
      const t = line.trim();
      if (!/userId/.test(t)) return;
      const entry = `${rel}:${i + 1}: ${t}`;
      if (/const\s+targetUserId/.test(t)) buckets.targetUserIdDecl.push(entry);
      else if (/const\s+userId\s*=\s*req\.user\.id/.test(t)) buckets.reqUserId.push(entry);
      else if (/^userId:\s/.test(t) || /,\s*userId:\s/.test(t)) buckets.other.push(entry);
      else if (/userId/.test(t)) buckets.other.push(entry);
    });
  }
}

let out = '';
for (const [k, arr] of Object.entries(buckets)) {
  out += `\n===== ${k} (${arr.length}) =====\n`;
  arr.forEach(e => { out += e + '\n'; });
}
fs.writeFileSync(path.join(__dirname, 'userid-report.txt'), out);
console.log('Report written to scripts/userid-report.txt');
console.log('other bucket size =', buckets.other.length, '| targetUserIdDecl =', buckets.targetUserIdDecl.length);


