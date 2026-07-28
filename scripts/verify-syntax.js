const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const DIRS = [
  path.join(ROOT, 'controllers'),
  path.join(ROOT, 'warehouse', 'controller'),
];
let ok = 0, bad = 0;
for (const dir of DIRS) {
  if (!fs.existsSync(dir)) continue;
  for (const f of fs.readdirSync(dir).filter(f => f.endsWith('.js'))) {
    const full = path.join(dir, f);
    try {
      require(full);
      ok++;
    } catch (e) {
    
      if (e instanceof SyntaxError) {
        bad++;
        console.log('SYNTAX ERROR:', path.relative(ROOT, full));
        console.log('   ', e.message);
      } else {
        ok++; 
      }
    }
  }
}
console.log(`\nParsed OK (or non-syntax): ${ok} | Syntax errors: ${bad}`);
