const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const prisma = require('../prisma/client');

function isNullable(value) {
  return value === true || value === 't' || value === 'YES';
}

async function releaseUserForeignKeys(userId, replacementUserId) {
  const rows = await prisma.$queryRaw`
    SELECT
      src.relname AS table_name,
      att.attname AS column_name,
      NOT att.attnotnull AS is_nullable
    FROM pg_constraint con
    JOIN pg_class src ON src.oid = con.conrelid
    JOIN pg_attribute att
      ON att.attrelid = con.conrelid
     AND att.attnum = ANY (con.conkey)
    WHERE con.contype = 'f'
      AND con.confrelid = 'users'::regclass
  `;

  for (const row of rows) {
    const table = String(row.table_name);
    const column = String(row.column_name);

    if (table === 'users') {
      await prisma.$executeRawUnsafe(
        `UPDATE "users" SET "${column}" = NULL WHERE "${column}" = $1`,
        userId
      );
      continue;
    }

    if (isNullable(row.is_nullable)) {
      await prisma.$executeRawUnsafe(
        `UPDATE "${table}" SET "${column}" = NULL WHERE "${column}" = $1`,
        userId
      );
      continue;
    }

    if (replacementUserId) {
      await prisma.$executeRawUnsafe(
        `UPDATE "${table}" SET "${column}" = $1 WHERE "${column}" = $2`,
        replacementUserId,
        userId
      );
    }
  }
}

async function destroyLoginIdentity(userId) {
  const password = await bcrypt.hash(crypto.randomBytes(32).toString('hex'), 10);
  await prisma.user.update({
    where: { id: userId },
    data: {
      email: `deleted-${userId}@deleted.invalid`,
      password,
      firstName: 'Deleted',
      lastName: 'Account',
      phone: '',
      address: '',
      contactNo: '',
      websiteLink: '',
      organizationName: '',
      isActive: false,
      loginOtp: null,
      loginOtpExpiry: null,
      resetOtp: null,
      resetOtpExpiry: null,
      requiresLoginOtp: false,
      companyId: null,
    },
  });
}

async function deleteMyAccount(userId) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, companyId: true },
  });

  if (!user) {
    const err = new Error('User not found');
    err.status = 404;
    throw err;
  }

  let replacementUserId = null;
  let isLastCompanyUser = true;

  if (user.companyId) {
    const other = await prisma.user.findFirst({
      where: { companyId: user.companyId, id: { not: userId } },
      select: { id: true },
      orderBy: { createdAt: 'asc' },
    });
    replacementUserId = other?.id || null;
    isLastCompanyUser = !replacementUserId;
  }

  await releaseUserForeignKeys(userId, replacementUserId);

  let hardDeleted = false;
  try {
    await prisma.user.delete({ where: { id: userId } });
    hardDeleted = true;
  } catch (error) {
    console.error('[deleteMyAccount] Hard delete failed, anonymizing login:', error.message);
    await destroyLoginIdentity(userId);
  }

  if (isLastCompanyUser && user.companyId) {
    try {
      if (hardDeleted) {
        await prisma.company.delete({ where: { id: user.companyId } });
      } else {
        await prisma.company.update({
          where: { id: user.companyId },
          data: { isActive: false },
        });
      }
    } catch (error) {
      console.error('[deleteMyAccount] Company cleanup:', error.message);
      try {
        await prisma.company.update({
          where: { id: user.companyId },
          data: { isActive: false },
        });
      } catch (_) {
        /* company may already be gone */
      }
    }
  }

  return { hardDeleted };
}

module.exports = { deleteMyAccount };
