'use strict';

const prisma = require('../prisma/client');
const { companyIdOf } = require('../utils/manufacturingAccess');

/**
 * Ensures the active company is configured for TEXTILE_WEAVING workflow.
 * STANDARD (default) companies receive 403.
 */
async function requireTextileWeaving(req, res, next) {
  try {
    const companyId = companyIdOf(req);
    if (!companyId) {
      return res.status(400).json({
        success: false,
        message: 'Company is required for textile weaving',
      });
    }

    const cached = req.user?.company;
    let workflow = cached?.manufacturingWorkflow;
    if (!workflow || cached?.id !== companyId) {
      const company = await prisma.company.findUnique({
        where: { id: companyId },
        select: { id: true, manufacturingWorkflow: true, name: true },
      });
      if (!company) {
        return res.status(404).json({
          success: false,
          message: 'Company not found',
        });
      }
      workflow = company.manufacturingWorkflow;
      req.user = req.user || {};
      req.user.company = { ...(req.user.company || {}), ...company };
    }

    if (String(workflow || 'STANDARD') !== 'TEXTILE_WEAVING') {
      return res.status(403).json({
        success: false,
        message:
          'Textile weaving workflow is not enabled for this company. Set manufacturingWorkflow to TEXTILE_WEAVING.',
        code: 'TEXTILE_WEAVING_REQUIRED',
      });
    }

    req.textileWeaving = { companyId, enabled: true };
    return next();
  } catch (err) {
    console.error('[requireTextileWeaving]', err);
    return res.status(500).json({
      success: false,
      message: err.message || 'Failed to verify textile weaving workflow',
    });
  }
}

module.exports = { requireTextileWeaving };
