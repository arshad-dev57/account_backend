'use strict';

const fs = require('fs');
const path = require('path');
const prisma = require('../prisma/client');

async function main() {
  const sqlPath = path.join(
    __dirname,
    '../prisma/migrations/20261017210000_import_customs_null_charges/migration.sql'
  );
  const sql = fs.readFileSync(sqlPath, 'utf8');
  const statements = sql
    .split(';')
    .map((s) =>
      s
        .split('\n')
        .filter((line) => !/^\s*--/.test(line))
        .join('\n')
        .trim()
    )
    .filter(Boolean);

  console.log(`Executing ${statements.length} statements...`);
  for (let i = 0; i < statements.length; i++) {
    try {
      await prisma.$executeRawUnsafe(statements[i]);
    } catch (e) {
      console.error(`Error on statement #${i + 1}:\n${statements[i].slice(0, 400)}\n`, e.message);
      throw e;
    }
  }
  console.log('✅ Import customs null-charges migration applied');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
