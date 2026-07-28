// Utility: scan controllers for userId usage to help audit company-scoping
const fs = require('fs');
const path = require('path');

const dirs = [
  path.join(__dirname, '..', 'controllers'),
  path.join(__dirname, '..', 'warehouse', 'controller'),
];

let grand = 0;
for (const dir of dirs) {
  if (!fs.existsSync(dir)) continue;
  const files = fs.readdirSync(dir).filter(f => f.endsWith('.js'));
  for (const f of files) {
    const content = fs.readFileSync(path.join(dir, f), 'utf8');
    const matches = content.match(/userId/g);
    const count = matches ? matches.length : 0;
    if (count > 0) {
      console.log(`${path.relative(path.join(__dirname, '..'), path.join(dir, f))} = ${count}`);
      grand += count;
    }
  }
}
console.log('TOTAL userId occurrences =', grand);
