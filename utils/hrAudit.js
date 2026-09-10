'use strict';

const prisma = require('../prisma/client');

async function writeAudit(companyId, actorId, action, entity, entityId, detail) {
  try {
    await prisma.hrAuditLog.create({
      data: {
        companyId,
        actorId: String(actorId || ''),
        action,
        entity,
        entityId: String(entityId || ''),
        detail: String(detail || '')
      }
    });
  } catch (error) {
    console.error('[hr] audit', error.message);
  }
}

module.exports = { writeAudit };
