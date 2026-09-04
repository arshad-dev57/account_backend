const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const prisma = require('../prisma/client');

function assertUuid(id) {
  if (!id || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(id))) {
    throw new Error('Invalid id');
  }
  return String(id);
}

async function anonymizeUser(userId) {
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
      managerId: null,
      createdBy: null,
      assignedTerminalId: null,
    },
  });
}

async function wipeEntireCompany(companyId) {
  const id = assertUuid(companyId);
  console.log('[deleteMyAccount] Wiping company', id);

  await prisma.$executeRawUnsafe(`
    DO $wipe$
    DECLARE
      cid text := '${id}';
      rec RECORD;
      pass int := 0;
      deleted bigint;
      total_deleted bigint;
    BEGIN
      BEGIN
        PERFORM set_config('statement_timeout', '0', true);
      EXCEPTION WHEN OTHERS THEN
        NULL;
      END;

      LOOP
        pass := pass + 1;
        total_deleted := 0;

        FOR rec IN
          SELECT
            src.relname AS child_table,
            att.attname AS child_col,
            tgt.relname AS parent_table
          FROM pg_constraint con
          JOIN pg_class src ON src.oid = con.conrelid
          JOIN pg_class tgt ON tgt.oid = con.confrelid
          JOIN pg_namespace nsp ON nsp.oid = src.relnamespace
          JOIN pg_attribute att
            ON att.attrelid = con.conrelid
           AND att.attnum = ANY (con.conkey)
          JOIN information_schema.columns pc
            ON pc.table_schema = 'public'
           AND pc.table_name = tgt.relname
           AND pc.column_name = 'company_id'
          WHERE con.contype = 'f'
            AND nsp.nspname = 'public'
            AND src.relname NOT IN ('users', 'companies')
        LOOP
          BEGIN
            EXECUTE format(
              'DELETE FROM %I WHERE %I IN (SELECT id FROM %I WHERE company_id = %L)',
              rec.child_table,
              rec.child_col,
              rec.parent_table,
              cid::text
            );
            GET DIAGNOSTICS deleted = ROW_COUNT;
            total_deleted := total_deleted + deleted;
          EXCEPTION WHEN OTHERS THEN
            NULL;
          END;
        END LOOP;

        FOR rec IN
          SELECT c.table_name
          FROM information_schema.columns c
          JOIN information_schema.tables t
            ON t.table_schema = c.table_schema
           AND t.table_name = c.table_name
          WHERE c.table_schema = 'public'
            AND t.table_type = 'BASE TABLE'
            AND c.column_name = 'company_id'
            AND c.table_name NOT IN ('users', 'companies')
        LOOP
          BEGIN
            EXECUTE format(
              'DELETE FROM %I WHERE company_id = %L',
              rec.table_name,
              cid::text
            );
            GET DIAGNOSTICS deleted = ROW_COUNT;
            total_deleted := total_deleted + deleted;
          EXCEPTION WHEN OTHERS THEN
            NULL;
          END;
        END LOOP;

        FOR rec IN
          SELECT
            src.relname AS child_table,
            att.attname AS child_col
          FROM pg_constraint con
          JOIN pg_class src ON src.oid = con.conrelid
          JOIN pg_class tgt ON tgt.oid = con.confrelid
          JOIN pg_namespace nsp ON nsp.oid = src.relnamespace
          JOIN pg_attribute att
            ON att.attrelid = con.conrelid
           AND att.attnum = ANY (con.conkey)
          WHERE con.contype = 'f'
            AND nsp.nspname = 'public'
            AND tgt.relname = 'users'
            AND src.relname NOT IN ('users', 'companies')
        LOOP
          BEGIN
            EXECUTE format(
              'DELETE FROM %I WHERE %I IN (SELECT id FROM users WHERE company_id = %L)',
              rec.child_table,
              rec.child_col,
              cid::text
            );
            GET DIAGNOSTICS deleted = ROW_COUNT;
            total_deleted := total_deleted + deleted;
          EXCEPTION
            WHEN foreign_key_violation OR not_null_violation THEN
              BEGIN
                EXECUTE format(
                  'UPDATE %I SET %I = NULL WHERE %I IN (SELECT id FROM users WHERE company_id = %L)',
                  rec.child_table,
                  rec.child_col,
                  rec.child_col,
                  cid::text
                );
              EXCEPTION WHEN OTHERS THEN
                NULL;
              END;
            WHEN OTHERS THEN
              NULL;
          END;
        END LOOP;

        EXIT WHEN pass >= 60 OR total_deleted = 0;
      END LOOP;

      BEGIN
        UPDATE users
           SET manager_id = NULL,
               created_by = NULL,
               assigned_terminal_id = NULL,
               role_id = NULL
         WHERE company_id = cid;

        DELETE FROM users WHERE company_id = cid;
        DELETE FROM companies WHERE id = cid;
      EXCEPTION WHEN OTHERS THEN
        NULL;
      END;
    END
    $wipe$;
  `);

  const leftoverUsers = await prisma.user.count({ where: { companyId: id } });
  const company = await prisma.company.findUnique({
    where: { id },
    select: { id: true },
  });

  if (leftoverUsers > 0) {
    const users = await prisma.user.findMany({
      where: { companyId: id },
      select: { id: true },
    });
    for (const user of users) {
      await anonymizeUser(user.id);
    }
  }

  if (company) {
    await prisma.company.update({
      where: { id },
      data: { isActive: false },
    });
  }

  console.log('[deleteMyAccount] Wipe finished', {
    leftoverUsers,
    companyGone: !company,
  });

  return { usersDeleted: leftoverUsers === 0, companyDeleted: !company };
}

async function wipeSingleUser(userId) {
  const id = assertUuid(userId);
  await prisma.$executeRawUnsafe(`
    DO $wipe$
    DECLARE
      uid text := '${id}';
      rec RECORD;
      pass int := 0;
      deleted bigint;
      total_deleted bigint;
    BEGIN
      LOOP
        pass := pass + 1;
        total_deleted := 0;

        FOR rec IN
          SELECT
            src.relname AS child_table,
            att.attname AS child_col
          FROM pg_constraint con
          JOIN pg_class src ON src.oid = con.conrelid
          JOIN pg_class tgt ON tgt.oid = con.confrelid
          JOIN pg_namespace nsp ON nsp.oid = src.relnamespace
          JOIN pg_attribute att
            ON att.attrelid = con.conrelid
           AND att.attnum = ANY (con.conkey)
          WHERE con.contype = 'f'
            AND nsp.nspname = 'public'
            AND tgt.relname = 'users'
            AND src.relname <> 'users'
        LOOP
          BEGIN
            EXECUTE format(
              'DELETE FROM %I WHERE %I = %L',
              rec.child_table,
              rec.child_col,
              uid::text
            );
            GET DIAGNOSTICS deleted = ROW_COUNT;
            total_deleted := total_deleted + deleted;
          EXCEPTION
            WHEN foreign_key_violation OR not_null_violation THEN
              BEGIN
                EXECUTE format(
                  'UPDATE %I SET %I = NULL WHERE %I = %L',
                  rec.child_table,
                  rec.child_col,
                  rec.child_col,
                  uid::text
                );
              EXCEPTION WHEN OTHERS THEN
                NULL;
              END;
            WHEN OTHERS THEN
              NULL;
          END;
        END LOOP;

        EXIT WHEN pass >= 40 OR total_deleted = 0;
      END LOOP;

      UPDATE users
         SET manager_id = NULL,
             created_by = NULL,
             assigned_terminal_id = NULL
       WHERE id = uid;

      DELETE FROM users WHERE id = uid;
    END
    $wipe$;
  `);
}

async function deleteMyAccount(userId) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, companyId: true, role: true },
  });

  if (!user) {
    const err = new Error('User not found');
    err.status = 404;
    throw err;
  }

  if (!user.companyId) {
    try {
      await wipeSingleUser(userId);
      return { hardDeleted: true, companyDeleted: false };
    } catch (error) {
      console.error('[deleteMyAccount] User delete failed, anonymizing:', error.message);
      await anonymizeUser(userId);
      return { hardDeleted: false, companyDeleted: false };
    }
  }

  const isAdmin = String(user.role || '').toLowerCase() === 'admin';
  if (!isAdmin) {
    const err = new Error('Only the company admin can delete the company and all users.');
    err.status = 403;
    throw err;
  }

  try {
    const result = await wipeEntireCompany(user.companyId);
    return { hardDeleted: result.usersDeleted, companyDeleted: true };
  } catch (error) {
    console.error('[deleteMyAccount] Company wipe failed:', error.message);
    throw error;
  }
}

module.exports = { deleteMyAccount };
