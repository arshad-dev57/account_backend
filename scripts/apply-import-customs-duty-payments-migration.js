'use strict';

const fs = require('fs');
const path = require('path');
const prisma = require('../prisma/client');

async function main() {
  const sqlPath = path.join(
    __dirname,
    '../prisma/migrations/20261017220000_import_customs_duty_payments/migration.sql'
  );
  const sql = fs.readFileSync(sqlPath, 'utf8');
  const statements = [];
  let current = '';
  let inDo = false;
  for (const line of sql.split('\n')) {
    current += `${line}\n`;
    if (/^\s*DO\s+\$\$/i.test(line)) inDo = true;
    if (inDo && /END\s+\$\$\s*;/i.test(line)) {
      statements.push(current.trim());
      current = '';
      inDo = false;
      continue;
    }
    if (!inDo && line.trim().endsWith(';')) {
      statements.push(current.trim());
      current = '';
    }
  }
  if (current.trim()) statements.push(current.trim());

  console.log(`Executing ${statements.length} migration statements...`);
  for (let i = 0; i < statements.length; i++) {
    const executable = String(statements[i] || '')
      .split('\n')
      .filter((line) => !/^\s*--/.test(line))
      .join('\n')
      .trim();
    if (!executable) continue;
    try {
      await prisma.$executeRawUnsafe(executable);
    } catch (e) {
      console.error(`Error on statement #${i + 1}:\n${executable.slice(0, 400)}\n`, e.message);
      throw e;
    }
  }
  console.log('✅ Import customs duty payments migration applied');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
