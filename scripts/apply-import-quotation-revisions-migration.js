'use strict';

const fs = require('fs');
const path = require('path');
const prisma = require('../prisma/client');

async function main() {
  const sqlPath = path.join(
    __dirname,
    '../prisma/migrations/20261017150000_import_quotation_revisions_sod/migration.sql'
  );
  const sql = fs.readFileSync(sqlPath, 'utf8');

  const statements = [];
  let current = '';
  let inDollarBlock = false;

  for (const line of sql.split('\n')) {
    if (line.includes('DO $$')) inDollarBlock = true;
    current += line + '\n';
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
    if (!stmt) continue;
    try {
      await prisma.$executeRawUnsafe(stmt);
    } catch (e) {
      console.error(`Error on statement #${i + 1}:\n${stmt}\n`, e.message);
      throw e;
    }
  }
  console.log('✅ Import quotation revisions + SOD default applied');
}

main()
  .catch((err) => {
    console.error('Migration failed:', err.message);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
