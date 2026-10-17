'use strict';

const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/authMiddleware');
const { requirePermission, requireAnyPermission } = require('../middleware/rbacMiddleware');
const {
  getDashboard,
  listDocuments,
  linkDocument,
  unlinkDocument,
  refreshDocument,
  listPriceLists,
  getPriceList,
  createPriceList,
  updatePriceList,
  listCustomerPrices,
  upsertCustomerPrice,
  getMargins,
  getDocumentTypes,
  resolvePrice,
  resolvePricesBatch,
} = require('../controllers/tradingController');

router.use(protect);

router.get('/meta', requirePermission('trading.documents.view'), getDocumentTypes);
router.get('/dashboard', requirePermission('trading.dashboard.view'), getDashboard);
router.get('/documents', requirePermission('trading.documents.view'), listDocuments);
router.post('/documents/link', requirePermission('trading.documents.create'), linkDocument);
router.post('/documents/:id/refresh', requirePermission('trading.documents.edit'), refreshDocument);
router.delete('/documents/:id', requirePermission('trading.documents.delete'), unlinkDocument);

router.get('/price-lists', requirePermission('trading.price_lists.view'), listPriceLists);
router.post('/price-lists', requirePermission('trading.price_lists.create'), createPriceList);
router.get('/price-lists/:id', requirePermission('trading.price_lists.view'), getPriceList);
router.put('/price-lists/:id', requirePermission('trading.price_lists.edit'), updatePriceList);

router.get('/customer-prices', requirePermission('trading.customer_pricing.view'), listCustomerPrices);
router.post('/customer-prices', requirePermission('trading.customer_pricing.create'), upsertCustomerPrice);
router.put('/customer-prices', requirePermission('trading.customer_pricing.edit'), upsertCustomerPrice);

router.get(
  '/resolve-price',
  requireAnyPermission([
    'trading.customer_pricing.view',
    'sales.quotations.view',
    'sales.quotations.create',
    'sales.quotations.edit',
    'sales.orders.create',
    'sales.orders.edit',
  ]),
  resolvePrice
);
router.post(
  '/resolve-prices',
  requireAnyPermission([
    'trading.customer_pricing.view',
    'sales.quotations.view',
    'sales.quotations.create',
    'sales.quotations.edit',
    'sales.orders.create',
    'sales.orders.edit',
  ]),
  resolvePricesBatch
);

router.get('/margins', requirePermission('trading.margins.view'), getMargins);

module.exports = router;
