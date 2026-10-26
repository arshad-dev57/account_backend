const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/authMiddleware');
const {
  requirePermission,
  requireAnyPermission,
} = require('../middleware/rbacMiddleware');
const {
  listCurrencies,
  getCurrency,
  createCurrency,
  updateCurrency,
  getCompanyBaseCurrency,
  setCompanyBaseCurrency,
  listExchangeRates,
  createExchangeRate,
  updateExchangeRate,
  deleteExchangeRate,
  lookupExchangeRate,
  getCurrencyOverview,
  initializeCompanyCurrencies,
  refreshExchangeRates,
  getExchangeRateProviderStatus,
  convertCurrencyAmount,
  listExchangeRateHistory,
} = require('../controllers/currencyController');

router.use(protect);

const canManageRates = requireAnyPermission([
  'accounting.exchange_rates.create',
  'accounting.exchange_rates.edit',
]);
const canEditRates = requirePermission('accounting.exchange_rates.edit');

// Currency master (shared read; edits are permission-gated)
router.get('/', listCurrencies);
router.get('/base', getCompanyBaseCurrency);
router.put(
  '/base',
  requireAnyPermission(['accounting.currencies.edit', 'accounting.exchange_rates.edit']),
  setCompanyBaseCurrency
);

// Company overview / initialization / provider diagnostics
router.get('/overview', getCurrencyOverview);
router.get('/provider', getExchangeRateProviderStatus);
router.get('/convert', convertCurrencyAmount);
router.post('/initialize', canManageRates, initializeCompanyCurrencies);

// Exchange rates
router.get('/rates/lookup', lookupExchangeRate);
router.get('/rates/history', listExchangeRateHistory);
router.get('/rates/:id/history', listExchangeRateHistory);
router.post('/rates/refresh', canEditRates, refreshExchangeRates);
router.get('/rates', listExchangeRates);
router.post('/rates', requirePermission('accounting.exchange_rates.create'), createExchangeRate);
router.put('/rates/:id', canEditRates, updateExchangeRate);
router.delete('/rates/:id', requirePermission('accounting.exchange_rates.delete'), deleteExchangeRate);

// Single currency (must stay after /rates and named routes)
router.get('/:id', getCurrency);
router.post('/', requirePermission('accounting.currencies.create'), createCurrency);
router.put('/:id', requirePermission('accounting.currencies.edit'), updateCurrency);

module.exports = router;
