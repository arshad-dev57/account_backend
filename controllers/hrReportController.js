'use strict';

/**
 * Serves the HR reports the workspace sidebars link under each workspace's
 * "Reports" section. Reads are company-scoped inside the report service, so a
 * caller can only ever see their own company's rows.
 */

const reports = require('../services/hrReports');
const { requireCompany, requireHrManager } = require('../utils/hrAccess');

function fail(res, error) {
  const status = error.status || 500;
  if (status >= 500) console.error('[hr-reports]', error);
  return res.status(status).json({
    success: false,
    message: error.message || 'Something went wrong',
    ...(error.code || error.extra
      ? {
          data: {
            code: error.code || error.extra?.code,
            hrSettingsPath: error.hrSettingsPath || error.extra?.hrSettingsPath || '/hr/hr-setup/hr-settings',
            ...(error.extra?.filterDefs ? { filterDefs: error.extra.filterDefs } : {}),
            ...(error.extra?.doctype ? { doctype: error.extra.doctype } : {})
          }
        }
      : {})
  });
}

function wrap(handler) {
  return async (req, res) => {
    const companyId = requireCompany(req, res);
    if (!companyId) return undefined;
    if (!requireHrManager(req, res)) return undefined;
    try {
      const payload = await handler(req, companyId);
      if (!res.headersSent) res.json({ success: true, data: payload });
      return undefined;
    } catch (error) {
      return fail(res, error);
    }
  };
}

exports.index = wrap(async () => ({
  reports: Object.entries(reports.reports).map(([name, report]) => ({
    name,
    doctype: report.doctype,
    filters: report.filters || (report.filterDefs || []).map((d) => d.key),
    columns: (report.columns || []).map((column) => column.label)
  }))
}));

exports.run = wrap(async (req, companyId) =>
  reports.runReport(String(req.params.report), {
    companyId,
    query: { ...req.query }
  })
);
