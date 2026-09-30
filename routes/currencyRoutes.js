const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/authMiddleware');
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
} = require('../controllers/currencyController');

router.use(protect);

router.get('/', listCurrencies);
router.get('/base', getCompanyBaseCurrency);
router.put('/base', setCompanyBaseCurrency);
router.get('/rates/lookup', lookupExchangeRate);
router.get('/rates', listExchangeRates);
router.post('/rates', createExchangeRate);
router.put('/rates/:id', updateExchangeRate);
router.delete('/rates/:id', deleteExchangeRate);
router.get('/:id', getCurrency);
router.post('/', createCurrency);
router.put('/:id', updateCurrency);

module.exports = router;
