'use strict';

const fs = require('fs');
const path = require('path');
const prisma = require('../prisma/client');

async function main() {
  const sqlPath = path.join(
    __dirname,
    '../prisma/migrations/20261017180000_import_finance_lc_ucp/migration.sql'
  );
  const sql = fs.readFileSync(sqlPath, 'utf8');

  const statements = [];
  let current = '';
  let inDollarBlock = false;

  for (const line of sql.split('\n')) {
    if (line.includes('DO $$')) inDollarBlock = true;
    current += `${line}\n`;
    if (inDollarBlock && line.includes('END $$;')) {
      inDollarBlock = false;
      statements.push(current.trim());
      current = '';
    } else if (!inDollarBlock && line.trim().endsWith(';')) {
      statements.push(current.trim());
      current = '';
    }
  }
  if (current.trim()) statements.push(current.trim());

  console.log(`Executing ${statements.length} migration statements...`);
  for (let i = 0; i < statements.length; i++) {
    const stmt = statements[i];
    // Strip leading SQL comments — do not skip the whole statement when it starts with `--`
    const executable = String(stmt || '')
      .split('\n')
      .filter((line) => !/^\s*--/.test(line))
      .join('\n')
      .trim();
    if (!executable) continue;
    try {
      await prisma.$executeRawUnsafe(executable);
    } catch (e) {
      console.error(`Error on statement #${i + 1}:\n${executable}\n`, e.message);
      throw e;
    }
  }
  console.log('✅ Import Finance LC UCP migration applied');
}

main()
  .catch((err) => {
    console.error('Migration failed:', err.message);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
