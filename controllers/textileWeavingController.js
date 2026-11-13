'use strict';

const { requireCompany, userIdOf } = require('../utils/manufacturingAccess');
const svc = require('../services/textileWeavingService');

function fail(res, status, message, extra = {}) {
  return res.status(status).json({ success: false, message, ...extra });
}

function ok(res, data, extra = {}) {
  return res.json({ success: true, data, ...extra });
}

function wrap(handler) {
  return async (req, res) => {
    try {
      const companyId = requireCompany(req, res);
      if (!companyId) return;
      req.tw = { companyId, userId: userIdOf(req) };
      if (!req.tw.userId) {
        return fail(res, 401, 'User is required');
      }
      await handler(req, res);
    } catch (error) {
      const status = error.status || error.statusCode || 500;
      if (error.code === 'P2021' || /does not exist/i.test(error.message || '')) {
        return fail(
          res,
          503,
          'Textile weaving tables are not migrated yet. Run prisma migrate deploy / generate.'
        );
      }
      if (error.code === 'P2002') {
        return fail(res, 409, 'Duplicate record — unique constraint violated');
      }
      console.error('[textile-weaving]', error);
      return fail(res, status, error.message || 'Textile weaving request failed');
    }
  };
}

exports.getSummary = wrap(async (req, res) => {
  ok(res, await svc.getSummary(req.tw.companyId));
});

exports.listGodownStocks = wrap(async (req, res) => {
  ok(res, await svc.listGodownStocks(req.tw.companyId, req.query));
});

exports.listGodownLedger = wrap(async (req, res) => {
  ok(res, await svc.listGodownLedger(req.tw.companyId, req.query));
});

exports.postGodownLedger = wrap(async (req, res) => {
  ok(res, await svc.postGodownLedger(req.tw.companyId, req.tw.userId, req.body || {}));
});

exports.listTwistingBatches = wrap(async (req, res) => {
  ok(res, await svc.listTwistingBatches(req.tw.companyId, req.query));
});

exports.createTwistingBatch = wrap(async (req, res) => {
  ok(res, await svc.createTwistingBatch(req.tw.companyId, req.tw.userId, req.body || {}));
});

exports.addTwistingReceipt = wrap(async (req, res) => {
  ok(
    res,
    await svc.addTwistingReceipt(req.tw.companyId, req.tw.userId, req.params.id, req.body || {})
  );
});

exports.completeTwistingBatch = wrap(async (req, res) => {
  ok(
    res,
    await svc.completeTwistingBatch(req.tw.companyId, req.tw.userId, req.params.id, req.body || {})
  );
});

exports.listWeftIssues = wrap(async (req, res) => {
  ok(res, await svc.listWeftIssues(req.tw.companyId, req.query));
});

exports.createWeftIssue = wrap(async (req, res) => {
  ok(res, await svc.createWeftIssue(req.tw.companyId, req.tw.userId, req.body || {}));
});

exports.listBeams = wrap(async (req, res) => {
  ok(res, await svc.listBeams(req.tw.companyId, req.query));
});

exports.createBeam = wrap(async (req, res) => {
  ok(res, await svc.createBeam(req.tw.companyId, req.tw.userId, req.body || {}));
});

exports.listWarpingSets = wrap(async (req, res) => {
  ok(res, await svc.listWarpingSets(req.tw.companyId, req.query));
});

exports.createWarpingSet = wrap(async (req, res) => {
  ok(res, await svc.createWarpingSet(req.tw.companyId, req.tw.userId, req.body || {}));
});

exports.listLooms = wrap(async (req, res) => {
  ok(res, await svc.listLooms(req.tw.companyId, req.query));
});

exports.createLoom = wrap(async (req, res) => {
  ok(res, await svc.createLoom(req.tw.companyId, req.tw.userId, req.body || {}));
});

exports.allocateBeam = wrap(async (req, res) => {
  ok(
    res,
    await svc.allocateBeam(req.tw.companyId, req.tw.userId, req.params.id, req.body || {})
  );
});

exports.listDailyProduction = wrap(async (req, res) => {
  ok(res, await svc.listDailyProduction(req.tw.companyId, req.query));
});

exports.postDailyProduction = wrap(async (req, res) => {
  ok(res, await svc.postDailyProduction(req.tw.companyId, req.tw.userId, req.body || {}));
});

exports.wagesReport = wrap(async (req, res) => {
  ok(res, await svc.wagesReport(req.tw.companyId, req.query));
});
