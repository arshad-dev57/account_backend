const prisma = require('../prisma/client');
const {
  ensureCurrenciesSeeded,
  getCompanyBaseCurrency,
  toDecimal,
} = require('../utils/multiCurrency');

// ─── Currencies ───────────────────────────────────────────────

exports.listCurrencies = async (req, res) => {
  try {
    await ensureCurrenciesSeeded();
    const activeOnly = String(req.query.activeOnly || 'true') !== 'false';
    const currencies = await prisma.currency.findMany({
      where: activeOnly ? { isActive: true } : undefined,
      orderBy: { code: 'asc' },
    });
    res.json({ success: true, data: currencies });
  } catch (error) {
    console.error('listCurrencies:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.getCurrency = async (req, res) => {
  try {
    const currency = await prisma.currency.findUnique({ where: { id: req.params.id } });
    if (!currency) {
      return res.status(404).json({ success: false, message: 'Currency not found' });
    }
    res.json({ success: true, data: currency });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.createCurrency = async (req, res) => {
  try {
    const { code, name, symbol, decimalPlaces, isActive } = req.body;
    if (!code || !name || !symbol) {
      return res.status(400).json({
        success: false,
        message: 'code, name and symbol are required',
      });
    }
    const currency = await prisma.currency.create({
      data: {
        code: String(code).toUpperCase().trim(),
        name: String(name).trim(),
        symbol: String(symbol).trim(),
        decimalPlaces: decimalPlaces != null ? Number(decimalPlaces) : 2,
        isActive: isActive !== false,
      },
    });
    res.status(201).json({ success: true, data: currency });
  } catch (error) {
    if (error.code === 'P2002') {
      return res.status(409).json({ success: false, message: 'Currency code already exists' });
    }
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.updateCurrency = async (req, res) => {
  try {
    const { name, symbol, decimalPlaces, isActive } = req.body;
    const data = {};
    if (name !== undefined) data.name = String(name).trim();
    if (symbol !== undefined) data.symbol = String(symbol).trim();
    if (decimalPlaces !== undefined) data.decimalPlaces = Number(decimalPlaces);
    if (isActive !== undefined) data.isActive = Boolean(isActive);

    const currency = await prisma.currency.update({
      where: { id: req.params.id },
      data,
    });
    res.json({ success: true, data: currency });
  } catch (error) {
    if (error.code === 'P2025') {
      return res.status(404).json({ success: false, message: 'Currency not found' });
    }
    res.status(500).json({ success: false, message: error.message });
  }
};

// ─── Company base currency ────────────────────────────────────

exports.getCompanyBaseCurrency = async (req, res) => {
  try {
    const companyId = req.user?.companyId || req.companyId;
    if (!companyId) {
      return res.status(400).json({ success: false, message: 'Company context required' });
    }
    const base = await getCompanyBaseCurrency(companyId);
    res.json({ success: true, data: base });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.setCompanyBaseCurrency = async (req, res) => {
  try {
    const companyId = req.user?.companyId || req.companyId;
    const { currencyId, currencyCode } = req.body;
    if (!companyId) {
      return res.status(400).json({ success: false, message: 'Company context required' });
    }

    let currency = null;
    if (currencyId) {
      currency = await prisma.currency.findUnique({ where: { id: currencyId } });
    } else if (currencyCode) {
      currency = await prisma.currency.findUnique({
        where: { code: String(currencyCode).toUpperCase() },
      });
    }

    if (!currency || !currency.isActive) {
      return res.status(400).json({ success: false, message: 'Active currency required' });
    }

    const company = await prisma.company.update({
      where: { id: companyId },
      data: { baseCurrencyId: currency.id },
      include: { baseCurrency: true },
    });

    res.json({
      success: true,
      message: 'Company base currency updated',
      data: company.baseCurrency,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// ─── Exchange rates ───────────────────────────────────────────

exports.listExchangeRates = async (req, res) => {
  try {
    const companyId = req.user?.companyId || req.companyId;
    if (!companyId) {
      return res.status(400).json({ success: false, message: 'Company context required' });
    }

    const where = {
      companyId,
      ...(req.query.fromCurrencyId ? { fromCurrencyId: req.query.fromCurrencyId } : {}),
      ...(req.query.toCurrencyId ? { toCurrencyId: req.query.toCurrencyId } : {}),
      ...(String(req.query.activeOnly) === 'true' ? { isActive: true } : {}),
    };

    const rates = await prisma.exchangeRate.findMany({
      where,
      include: {
        fromCurrency: true,
        toCurrency: true,
        creator: { select: { id: true, firstName: true, lastName: true } },
      },
      orderBy: [{ effectiveDate: 'desc' }, { createdAt: 'desc' }],
    });

    res.json({ success: true, data: rates });
  } catch (error) {
    console.error('listExchangeRates:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.createExchangeRate = async (req, res) => {
  try {
    const companyId = req.user?.companyId || req.companyId;
    const userId = req.user?.id || req.user?._id;
    const { fromCurrencyId, toCurrencyId, rate, effectiveDate, notes, isActive } = req.body;

    if (!companyId) {
      return res.status(400).json({ success: false, message: 'Company context required' });
    }
    if (!fromCurrencyId || !toCurrencyId || rate == null || !effectiveDate) {
      return res.status(400).json({
        success: false,
        message: 'fromCurrencyId, toCurrencyId, rate and effectiveDate are required',
      });
    }

    const rateDec = toDecimal(rate);
    if (rateDec.lte(0)) {
      return res.status(400).json({ success: false, message: 'Exchange rate must be greater than zero' });
    }
    if (fromCurrencyId === toCurrencyId) {
      return res.status(400).json({ success: false, message: 'From and to currencies must differ' });
    }

    const [from, to] = await Promise.all([
      prisma.currency.findUnique({ where: { id: fromCurrencyId } }),
      prisma.currency.findUnique({ where: { id: toCurrencyId } }),
    ]);
    if (!from?.isActive || !to?.isActive) {
      return res.status(400).json({ success: false, message: 'Both currencies must be active' });
    }

    const day = new Date(effectiveDate);
    day.setHours(0, 0, 0, 0);

    const created = await prisma.exchangeRate.create({
      data: {
        companyId,
        fromCurrencyId,
        toCurrencyId,
        rate: rateDec,
        effectiveDate: day,
        notes: notes || null,
        isActive: isActive !== false,
        createdBy: userId || null,
      },
      include: { fromCurrency: true, toCurrency: true },
    });

    res.status(201).json({ success: true, data: created });
  } catch (error) {
    if (error.code === 'P2002') {
      return res.status(409).json({
        success: false,
        message: 'An exchange rate for this pair and date already exists',
      });
    }
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.updateExchangeRate = async (req, res) => {
  try {
    const companyId = req.user?.companyId || req.companyId;
    const { rate, notes, isActive, effectiveDate } = req.body;

    const existing = await prisma.exchangeRate.findFirst({
      where: { id: req.params.id, companyId },
    });
    if (!existing) {
      return res.status(404).json({ success: false, message: 'Exchange rate not found' });
    }

    const data = {};
    if (rate !== undefined) {
      const rateDec = toDecimal(rate);
      if (rateDec.lte(0)) {
        return res.status(400).json({ success: false, message: 'Exchange rate must be greater than zero' });
      }
      data.rate = rateDec;
    }
    if (notes !== undefined) data.notes = notes;
    if (isActive !== undefined) data.isActive = Boolean(isActive);
    if (effectiveDate !== undefined) {
      const day = new Date(effectiveDate);
      day.setHours(0, 0, 0, 0);
      data.effectiveDate = day;
    }

    const updated = await prisma.exchangeRate.update({
      where: { id: req.params.id },
      data,
      include: { fromCurrency: true, toCurrency: true },
    });

    res.json({ success: true, data: updated });
  } catch (error) {
    if (error.code === 'P2002') {
      return res.status(409).json({
        success: false,
        message: 'An exchange rate for this pair and date already exists',
      });
    }
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.deleteExchangeRate = async (req, res) => {
  try {
    const companyId = req.user?.companyId || req.companyId;
    const existing = await prisma.exchangeRate.findFirst({
      where: { id: req.params.id, companyId },
    });
    if (!existing) {
      return res.status(404).json({ success: false, message: 'Exchange rate not found' });
    }

    // Soft-deactivate — historical rates should remain auditable
    const updated = await prisma.exchangeRate.update({
      where: { id: req.params.id },
      data: { isActive: false },
    });
    res.json({ success: true, data: updated, message: 'Exchange rate deactivated' });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * Lookup rate for document forms: GET /api/currencies/rates/lookup?from=&to=&date=
 */
exports.lookupExchangeRate = async (req, res) => {
  try {
    const companyId = req.user?.companyId || req.companyId;
    const { fromCurrencyId, toCurrencyId, date } = req.query;
    if (!companyId || !fromCurrencyId || !toCurrencyId) {
      return res.status(400).json({
        success: false,
        message: 'company, fromCurrencyId and toCurrencyId are required',
      });
    }

    const { getExchangeRate } = require('../utils/multiCurrency');
    const found = await getExchangeRate({
      companyId,
      fromCurrencyId,
      toCurrencyId,
      asOfDate: date ? new Date(date) : new Date(),
    });

    if (!found) {
      return res.status(404).json({
        success: false,
        message: 'No exchange rate found for the selected pair and date',
      });
    }

    res.json({
      success: true,
      data: {
        rate: found.rate.toString(),
        effectiveDate: found.effectiveDate,
        fromCurrencyId: found.fromCurrencyId,
        toCurrencyId: found.toCurrencyId,
        fromCurrency: found.fromCurrency || null,
        toCurrency: found.toCurrency || null,
        isIdentity: !!found.isIdentity,
      },
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};
