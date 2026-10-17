'use strict';

const fs = require('fs');
const path = require('path');
const prisma = require('../prisma/client');

async function main() {
  const sqlPath = path.join(
    __dirname,
    '../prisma/migrations/20261017160000_import_po_item_hs_code/migration.sql'
  );
  const sql = fs.readFileSync(sqlPath, 'utf8');
  await prisma.$executeRawUnsafe(sql);
  console.log('✅ import_purchase_order_items.hs_code column ready');
}

main()
  .catch((err) => {
    console.error('Migration failed:', err.message);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
