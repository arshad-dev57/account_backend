'use strict';

const fs = require('fs');
const path = require('path');
const prisma = require('../prisma/client');

async function main() {
  const sqlPath = path.join(__dirname, '../prisma/migrations/20261016160000_add_import_module/migration.sql');
  const sql = fs.readFileSync(sqlPath, 'utf8');

  // Split SQL while preserving DO $$ ... $$; blocks
  const statements = [];
  let current = '';
  let inDollarBlock = false;

  const lines = sql.split('\n');
  for (const line of lines) {
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

  console.log('✅ Import module tables, indexes, and constraints successfully created in database!');
}

main()
  .catch((err) => {
    console.error('Migration failed:', err.message);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
