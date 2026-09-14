'use strict';

const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/authMiddleware');
const mfg = require('../controllers/manufacturingController');

router.use(protect);

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

router.get('/production-orders/:id/materials', mfg.orderMaterials);
router.get('/production-orders/:id/operations', mfg.orderOperations);
router.get('/production-orders/:id/costing', mfg.orderCosting);
router.post('/production-orders/:id/release', mfg.releaseOrder);
router.post('/production-orders/:id/pause', mfg.pauseOrder);
router.post('/production-orders/:id/resume', mfg.resumeOrder);
router.post('/production-orders/:id/complete', mfg.completeOrder);
router.post('/production-orders/:id/close', mfg.closeOrder);
router.post('/production-orders/:id/cancel', mfg.cancelOrder);
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
