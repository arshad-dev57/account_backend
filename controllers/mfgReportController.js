'use strict';

const reports = require('../services/mfgReports');

function fail(res, error) {
  const status = error.status || 500;
  if (status >= 500) console.error('[mfg-reports]', error);
  return res.status(status).json({ success: false, message: error.message || 'Report failed' });
}

function wrap(handler) {
  return async (req, res) => {
    const companyId = req.user?.companyId;
    if (!companyId) {
      return res.status(401).json({ success: false, message: 'Company context required' });
    }
    try {
      const payload = await handler(req, res, companyId);
      if (!res.headersSent) res.json({ success: true, data: payload });
      return undefined;
    } catch (error) {
      return fail(res, error);
    }
  };
}

module.exports = {
  index: wrap(async () => ({
    reports: reports.reportNames().map((name) => ({
      report: name,
      doctype: reports.reports[name].doctype
    }))
  })),
  run: wrap((req, _res, companyId) => reports.runReport(req.params.report, companyId, req.query))
};
