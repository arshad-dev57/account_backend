'use strict';

const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/authMiddleware');
const mfg = require('../controllers/manufacturingController');
const mfgDocs = require('../controllers/mfgDocumentController');
const mfgReports = require('../controllers/mfgReportController');

router.use(protect);

// ERPNext-shaped Manufacturing workspace + document API (mirrors /api/hr/docs)
router.get('/workspaces', mfgDocs.workspaces);
router.get('/workspaces/:slug/dashboard', mfgDocs.dashboard);
router.get('/workspaces/:slug/charts', mfgDocs.charts);
router.get('/docs', mfgDocs.documents);
router.get('/link-options/:target', mfgDocs.options);
router.get('/docs/:resource/meta', mfgDocs.document);
router.get('/docs/:resource', mfgDocs.list);
router.post('/docs/:resource', mfgDocs.create);
router.get('/docs/:resource/:id', mfgDocs.detail);
router.put('/docs/:resource/:id', mfgDocs.update);
router.delete('/docs/:resource/:id', mfgDocs.remove);
router.get('/docs/:resource/:id/timeline', mfgDocs.timeline);
router.post('/docs/:resource/:id/comment', mfgDocs.comment);
router.post('/docs/:resource/:id/action/:key', mfgDocs.action);
router.post('/docs/:resource/:id/button/:key', mfgDocs.button);
router.get('/reports', mfgReports.index);
router.get('/reports/:report', mfgReports.run);

router.get('/dashboard', mfg.dashboard);
router.get('/settings', mfg.settingsGet);
router.put('/settings', mfg.settingsUpdate);

router.get('/mrp', mfg.runMrp);
router.get('/material-shortage', mfg.materialShortage);
router.get('/mps/explode', mfg.mpsExplode);

router.get('/costing/product/:productId', mfg.productCost);
router.get('/costing/standard', mfg.costList('Standard'));
router.get('/costing/actual', mfg.actualCost);
router.get('/costing/variance', mfg.costVariance);

router.get('/reports/production', mfg.report('production'));
router.get('/reports/material', mfg.report('material'));
router.get('/reports/quality', mfg.report('quality'));
router.get('/reports/machine', mfg.report('machine'));
router.get('/reports/efficiency', mfg.report('efficiency'));
router.get('/reports/cost', mfg.report('cost'));

router.get('/product-defaults', mfg.productDefaults);
router.get('/boms/:id/explode', mfg.explodeBom);

router.get('/production-orders/:id/materials', mfg.orderMaterials);
router.get('/production-orders/:id/operations', mfg.orderOperations);
router.get('/production-orders/:id/costing', mfg.orderCosting);
router.get('/production-orders/:id/history', mfg.orderHistory);
router.post('/production-orders/:id/release', mfg.releaseOrder);
router.post('/production-orders/:id/start', mfg.startOrder);
router.post('/production-orders/:id/pause', mfg.pauseOrder);
router.post('/production-orders/:id/resume', mfg.resumeOrder);
router.post('/production-orders/:id/complete', mfg.completeOrder);
router.post('/production-orders/:id/close', mfg.closeOrder);
router.post('/production-orders/:id/close-short', mfg.closeShortOrder);
router.post('/production-orders/:id/cancel', mfg.cancelOrder);
router.post('/production-orders/:id/issue-materials', mfg.issueMaterials);
router.post('/production-orders/:id/record-scrap', mfg.recordScrap);
router.post('/production-orders/:id/record-byproducts', mfg.recordByproducts);
router.post('/production-orders/:id/record-output', mfg.recordOutput);
router.get('/production-orders/:id', mfg.getProductionOrder);

['start', 'pause', 'resume', 'complete', 'report'].forEach((action) => {
  router.post(`/work-orders/:id/${action}`, mfg.workOrderAction(action));
  router.post(`/shop-floor/:id/${action}`, mfg.workOrderAction(action));
});

router.get('/operations', mfg.listOperations);
router.get('/production-tracking', mfg.listTracking);
router.get('/shop-floor', (req, res, next) => {
  req.mfgResource = 'work-orders';
  req.params.resource = 'work-orders';
  return mfg.listResource(req, res, next);
});
router.get('/bom-versions', (req, res, next) => {
  req.mfgResource = 'boms';
  req.params.resource = 'boms';
  return mfg.listResource(req, res, next);
});
router.get('/inspection-plans', mfg.emptyList);
router.get('/defects', mfg.emptyList);
router.get('/spare-parts', mfg.emptyList);
router.get('/preventive-maintenance', mfg.filteredRequests('Preventive'));
router.get('/breakdowns', mfg.filteredRequests('Breakdown'));

function withResource(resource, handler) {
  return (req, res, next) => {
    req.mfgResource = resource;
    req.params.resource = resource;
    return handler(req, res, next);
  };
}

Object.keys(mfg.RESOURCES).forEach((resource) => {
  router.get(`/${resource}`, withResource(resource, mfg.listResource));
  router.post(`/${resource}`, withResource(resource, mfg.createResource));
  router.get(`/${resource}/:id`, withResource(resource, mfg.getResource));
  router.put(`/${resource}/:id`, withResource(resource, mfg.updateResource));
  router.delete(`/${resource}/:id`, withResource(resource, mfg.removeResource));
});

module.exports = router;
