const prisma = require('../prisma/client');
const {
  ensureCurrenciesSeeded,
  getExchangeRate,
  toDecimal,
} = require('../utils/multiCurrency');
const {
  initializeCompanyCurrencyConfiguration,
  refreshCompanyRates,
  getCompanyCurrencyOverview,
  convertAmountBetweenCurrencies,
  resolveBaseCurrency,
  parseRateValue,
  parseRateEffectiveDate,
  recordHistory,
} = require('../services/companyCurrencyService');
const { getProviderStatus } = require('../services/exchangeRateProvider');

function companyIdForRequest(req) {
  if (req.companyMode === 'all' || !req.user?.companyId) {
    const err = new Error('Select a specific company to manage currencies');
    err.status = 400;
    err.code = 'COMPANY_REQUIRED';
    throw err;
  }
  return req.user.companyId;
}

function sendError(res, error, fallback = 'Currency request failed') {
  const status = error?.status || error?.statusCode || (error?.code === 'P2002' ? 409 : 500);
  return res.status(status).json({
    success: false,
    code: error?.code || 'CURRENCY_ERROR',
    message: error?.message || fallback,
    ...(error?.field ? { field: error.field } : {}),
  });
}

function normalizeCode(value) {
  return String(value || '').trim().toUpperCase();
}

// ─── Currency master ─────────────────────────────────────────

exports.listCurrencies = async (req, res) => {
  try {
    await ensureCurrenciesSeeded();
    const activeOnly = String(req.query.activeOnly || 'true') !== 'false';
    const q = String(req.query.q || '').trim();

    const where = {
      ...(activeOnly ? { isActive: true } : {}),
      ...(q
        ? {
            OR: [
              { code: { contains: q, mode: 'insensitive' } },
              { name: { contains: q, mode: 'insensitive' } },
              { symbol: { contains: q, mode: 'insensitive' } },
            ],
          }
        : {}),
    };

    const currencies = await prisma.currency.findMany({
      where,
      orderBy: { code: 'asc' },
    });
    res.json({ success: true, data: currencies, count: currencies.length });
  } catch (error) {
    console.error('listCurrencies:', error);
    sendError(res, error, 'Failed to load currencies');
  }
};

exports.getCurrency = async (req, res) => {
  try {
    const currency = await prisma.currency.findUnique({ where: { id: req.params.id } });
    if (!currency) {
      return res.status(404).json({ success: false, code: 'CURRENCY_NOT_FOUND', message: 'Currency not found' });
    }
    res.json({ success: true, data: currency });
  } catch (error) {
    sendError(res, error);
  }
};

exports.createCurrency = async (req, res) => {
  try {
    const { code, name, symbol, decimalPlaces, isActive } = req.body || {};
    const normalizedCode = normalizeCode(code);
    if (!/^[A-Z]{3,8}$/.test(normalizedCode)) {
      return res.status(400).json({
        success: false,
        code: 'CURRENCY_CODE_INVALID',
        field: 'code',
        message: 'Currency code must be 3–8 letters (ISO 4217)',
      });
    }
    if (!String(name || '').trim() || !String(symbol || '').trim()) {
      return res.status(400).json({
        success: false,
        code: 'CURRENCY_METADATA_REQUIRED',
        message: 'Currency name and symbol are required',
      });
    }
    const decimals = decimalPlaces != null ? Number(decimalPlaces) : 2;
    if (!Number.isInteger(decimals) || decimals < 0 || decimals > 8) {
      return res.status(400).json({
        success: false,
        code: 'DECIMAL_PLACES_INVALID',
        field: 'decimalPlaces',
        message: 'Decimal places must be an integer between 0 and 8',
      });
    }

    const currency = await prisma.currency.create({
      data: {
        code: normalizedCode,
        name: String(name).trim(),
        symbol: String(symbol).trim(),
        decimalPlaces: decimals,
        isActive: isActive !== false,
      },
    });
    res.status(201).json({ success: true, data: currency });
  } catch (error) {
    if (error.code === 'P2002') {
      return res.status(409).json({
        success: false,
        code: 'CURRENCY_EXISTS',
        message: 'Currency code already exists',
      });
    }
    sendError(res, error, 'Failed to create currency');
  }
};

exports.updateCurrency = async (req, res) => {
  try {
    const { name, symbol, decimalPlaces, isActive } = req.body || {};
    const data = {};
    if (name !== undefined) {
      if (!String(name).trim()) {
        return res.status(400).json({ success: false, code: 'NAME_REQUIRED', message: 'Currency name is required' });
      }
      data.name = String(name).trim();
    }
    if (symbol !== undefined) {
      if (!String(symbol).trim()) {
        return res.status(400).json({ success: false, code: 'SYMBOL_REQUIRED', message: 'Currency symbol is required' });
      }
      data.symbol = String(symbol).trim();
    }
    if (decimalPlaces !== undefined) {
      const decimals = Number(decimalPlaces);
      if (!Number.isInteger(decimals) || decimals < 0 || decimals > 8) {
        return res.status(400).json({
          success: false,
          code: 'DECIMAL_PLACES_INVALID',
          field: 'decimalPlaces',
          message: 'Decimal places must be an integer between 0 and 8',
        });
      }
      data.decimalPlaces = decimals;
    }
    if (isActive !== undefined) {
      if (!Boolean(isActive)) {
        const baseUse = await prisma.company.count({
          where: { baseCurrencyId: req.params.id },
        });
        if (baseUse > 0) {
          return res.status(409).json({
            success: false,
            code: 'CURRENCY_IN_USE_AS_BASE',
            message: `This currency is the base currency for ${baseUse} company${baseUse === 1 ? '' : 'ies'}. Change the base currency first.`,
          });
        }
      }
      data.isActive = Boolean(isActive);
    }

    if (Object.keys(data).length === 0) {
      return res.status(400).json({ success: false, code: 'NO_CHANGES', message: 'No changes provided' });
    }

    const currency = await prisma.currency.update({
      where: { id: req.params.id },
      data,
    });
    res.json({ success: true, data: currency });
  } catch (error) {
    if (error.code === 'P2025') {
      return res.status(404).json({ success: false, code: 'CURRENCY_NOT_FOUND', message: 'Currency not found' });
    }
    sendError(res, error, 'Failed to update currency');
  }
};

// ─── Company base currency ───────────────────────────────────

exports.getCompanyBaseCurrency = async (req, res) => {
  try {
    const companyId = companyIdForRequest(req);
    const base = await resolveBaseCurrency({
      companyId,
      client: prisma,
      allowFallback: true,
    });
    res.json({ success: true, data: base });
  } catch (error) {
    sendError(res, error, 'Failed to load company base currency');
  }
};

exports.setCompanyBaseCurrency = async (req, res) => {
  try {
    const companyId = companyIdForRequest(req);
    const userId = req.user?.id || req.user?._id || null;
    const { currencyId, currencyCode } = req.body || {};
    if (!currencyId && !currencyCode) {
      return res.status(400).json({
        success: false,
        code: 'BASE_CURRENCY_REQUIRED',
        message: 'currencyId or currencyCode is required',
      });
    }

    const currency = await resolveBaseCurrency({
      companyId,
      baseCurrencyId: currencyId || null,
      baseCurrencyCode: currencyCode || null,
      client: prisma,
      allowFallback: false,
    });

    let initialization = null;
    let initializationError = null;
    try {
      initialization = await initializeCompanyCurrencyConfiguration({
        companyId,
        userId,
        baseCurrencyId: currency.id,
        fetchRates: true,
        overwrite: false,
        client: prisma,
      });
    } catch (err) {
      initializationError = err.message;
      console.error('setCompanyBaseCurrency initialization:', err.message);
    }

    res.json({
      success: true,
      message: 'Company base currency updated',
      data: currency,
      initialization,
      ...(initializationError ? { warning: initializationError } : {}),
    });
  } catch (error) {
    sendError(res, error, 'Failed to set company base currency');
  }
};

// ─── Exchange rates ──────────────────────────────────────────

exports.listExchangeRates = async (req, res) => {
  try {
    const companyId = companyIdForRequest(req);
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
    sendError(res, error, 'Failed to load exchange rates');
  }
};

exports.createExchangeRate = async (req, res) => {
  try {
    const companyId = companyIdForRequest(req);
    const userId = req.user?.id || req.user?._id || null;
    const { fromCurrencyId, toCurrencyId, rate, effectiveDate, notes, isActive } = req.body || {};

    if (!fromCurrencyId || !toCurrencyId) {
      return res.status(400).json({
        success: false,
        code: 'CURRENCY_PAIR_REQUIRED',
        message: 'fromCurrencyId and toCurrencyId are required',
      });
    }
    if (fromCurrencyId === toCurrencyId) {
      return res.status(400).json({
        success: false,
        code: 'CURRENCY_PAIR_SAME',
        message: 'From and to currencies must differ',
      });
    }

    const rateDec = parseRateValue(rate);
    const day = parseRateEffectiveDate(effectiveDate);

    const [from, to] = await Promise.all([
      prisma.currency.findUnique({ where: { id: fromCurrencyId } }),
      prisma.currency.findUnique({ where: { id: toCurrencyId } }),
    ]);
    if (!from || !to) {
      return res.status(404).json({
        success: false,
        code: 'CURRENCY_NOT_FOUND',
        message: 'One or both currencies were not found',
      });
    }
    if (!from.isActive || !to.isActive) {
      return res.status(400).json({
        success: false,
        code: 'CURRENCY_INACTIVE',
        message: 'Both currencies must be active',
      });
    }

    const created = await prisma.$transaction(async (tx) => {
      const row = await tx.exchangeRate.create({
        data: {
          companyId,
          fromCurrencyId,
          toCurrencyId,
          rate: rateDec,
          effectiveDate: day,
          notes: notes || null,
          isActive: isActive !== false,
          source: 'MANUAL',
          fetchedAt: null,
          createdBy: userId,
        },
        include: { fromCurrency: true, toCurrency: true },
      });
      await recordHistory(tx, {
        companyId,
        exchangeRateId: row.id,
        fromCurrencyId,
        toCurrencyId,
        oldRate: null,
        newRate: rateDec,
        effectiveDate: day,
        action: 'CREATE',
        source: 'MANUAL',
        changedBy: userId,
      });
      return row;
    });

    res.status(201).json({ success: true, data: created });
  } catch (error) {
    if (error.code === 'P2002') {
      return res.status(409).json({
        success: false,
        code: 'RATE_EXISTS',
        message: 'An exchange rate for this pair and date already exists. Edit that rate instead.',
      });
    }
    sendError(res, error, 'Failed to create exchange rate');
  }
};

exports.updateExchangeRate = async (req, res) => {
  try {
    const companyId = companyIdForRequest(req);
    const userId = req.user?.id || req.user?._id || null;
    const { rate, notes, isActive, effectiveDate, fromCurrencyId, toCurrencyId } = req.body || {};

    const existing = await prisma.exchangeRate.findFirst({
      where: { id: req.params.id, companyId },
    });
    if (!existing) {
      return res.status(404).json({
        success: false,
        code: 'RATE_NOT_FOUND',
        message: 'Exchange rate not found for this company',
      });
    }

    if (
      (fromCurrencyId && fromCurrencyId !== existing.fromCurrencyId) ||
      (toCurrencyId && toCurrencyId !== existing.toCurrencyId)
    ) {
      return res.status(400).json({
        success: false,
        code: 'RATE_PAIR_IMMUTABLE',
        message: 'The currency pair cannot be changed. Create a new rate instead.',
      });
    }

    const data = {};
    let nextRate = null;
    if (rate !== undefined) {
      nextRate = parseRateValue(rate);
      if (!nextRate.equals(toDecimal(existing.rate))) {
        data.rate = nextRate;
        data.source = 'MANUAL';
        data.fetchedAt = null;
      }
    }
    if (notes !== undefined) data.notes = notes || null;
    const nextActive = isActive !== undefined ? Boolean(isActive) : existing.isActive;
    if (isActive !== undefined) data.isActive = nextActive;
    if (effectiveDate !== undefined) {
      data.effectiveDate = parseRateEffectiveDate(effectiveDate);
    }

    if (Object.keys(data).length === 0) {
      return res.json({ success: true, data: existing, message: 'No changes' });
    }

    const updated = await prisma.$transaction(async (tx) => {
      const row = await tx.exchangeRate.update({
        where: { id: existing.id },
        data,
        include: { fromCurrency: true, toCurrency: true },
      });

      const oldRate = toDecimal(existing.rate);
      const newRate = data.rate !== undefined ? nextRate : oldRate;
      const rateChanged = !oldRate.equals(newRate);
      const deactivated = existing.isActive && nextActive === false;
      const reactivated = !existing.isActive && nextActive === true;

      if (rateChanged || deactivated || reactivated) {
        await recordHistory(tx, {
          companyId,
          exchangeRateId: row.id,
          fromCurrencyId: existing.fromCurrencyId,
          toCurrencyId: existing.toCurrencyId,
          oldRate,
          newRate: deactivated ? null : newRate,
          effectiveDate: row.effectiveDate,
          action: deactivated ? 'DEACTIVATE' : reactivated ? 'CREATE' : 'UPDATE',
          source: deactivated ? existing.source : data.source || existing.source,
          reason: 'Manual rate edit',
          changedBy: userId,
        });
      }
      return row;
    });

    res.json({ success: true, data: updated });
  } catch (error) {
    if (error.code === 'P2002') {
      return res.status(409).json({
        success: false,
        code: 'RATE_EXISTS',
        message: 'An exchange rate for this pair and date already exists',
      });
    }
    sendError(res, error, 'Failed to update exchange rate');
  }
};

exports.deleteExchangeRate = async (req, res) => {
  try {
    const companyId = companyIdForRequest(req);
    const userId = req.user?.id || req.user?._id || null;
    const existing = await prisma.exchangeRate.findFirst({
      where: { id: req.params.id, companyId },
    });
    if (!existing) {
      return res.status(404).json({
        success: false,
        code: 'RATE_NOT_FOUND',
        message: 'Exchange rate not found for this company',
      });
    }

    const updated = await prisma.$transaction(async (tx) => {
      const row = await tx.exchangeRate.update({
        where: { id: existing.id },
        data: { isActive: false },
        include: { fromCurrency: true, toCurrency: true },
      });
      await recordHistory(tx, {
        companyId,
        exchangeRateId: row.id,
        fromCurrencyId: existing.fromCurrencyId,
        toCurrencyId: existing.toCurrencyId,
        oldRate: toDecimal(existing.rate),
        newRate: null,
        effectiveDate: row.effectiveDate,
        action: 'DEACTIVATE',
        source: existing.source,
        reason: 'Rate deactivated',
        changedBy: userId,
      });
      return row;
    });

    res.json({ success: true, data: updated, message: 'Exchange rate deactivated' });
  } catch (error) {
    sendError(res, error, 'Failed to deactivate exchange rate');
  }
};

exports.lookupExchangeRate = async (req, res) => {
  try {
    const companyId = companyIdForRequest(req);
    const { fromCurrencyId, toCurrencyId, date } = req.query;
    if (!fromCurrencyId || !toCurrencyId) {
      return res.status(400).json({
        success: false,
        code: 'CURRENCY_PAIR_REQUIRED',
        message: 'fromCurrencyId and toCurrencyId are required',
      });
    }

    const found = await getExchangeRate({
      companyId,
      fromCurrencyId,
      toCurrencyId,
      asOfDate: date ? new Date(date) : new Date(),
    });

    if (!found) {
      return res.status(404).json({
        success: false,
        code: 'EXCHANGE_RATE_REQUIRED',
        message: 'No exchange rate found for the selected pair and date',
      });
    }

    res.json({
      success: true,
      data: {
        rate: found.rate.toString(),
        effectiveDate: found.effectiveDate,
        source: found.source || null,
        fetchedAt: found.fetchedAt || null,
        fromCurrencyId: found.fromCurrencyId,
        toCurrencyId: found.toCurrencyId,
        fromCurrency: found.fromCurrency || null,
        toCurrency: found.toCurrency || null,
        isIdentity: !!found.isIdentity,
      },
    });
  } catch (error) {
    sendError(res, error, 'Failed to look up exchange rate');
  }
};

// ─── Company currency overview / repair / provider ───────────

exports.getCurrencyOverview = async (req, res) => {
  try {
    const companyId = companyIdForRequest(req);
    const overview = await getCompanyCurrencyOverview({
      companyId,
      asOfDate: req.query.date ? new Date(req.query.date) : new Date(),
      includeInactive: String(req.query.includeInactive) === 'true',
      client: prisma,
    });
    res.json({ success: true, data: overview });
  } catch (error) {
    sendError(res, error, 'Failed to load company currency overview');
  }
};

exports.initializeCompanyCurrencies = async (req, res) => {
  try {
    const companyId = companyIdForRequest(req);
    const userId = req.user?.id || req.user?._id || null;
    const body = req.body || {};
    const report = await initializeCompanyCurrencyConfiguration({
      companyId,
      userId,
      baseCurrencyCode: body.baseCurrencyCode || body.currencyCode || null,
      baseCurrencyId: body.baseCurrencyId || null,
      fetchRates: body.fetchRates !== false,
      overwrite: Boolean(body.overwrite),
      client: prisma,
    });
    res.json({
      success: true,
      data: report,
      warnings: report.missing.length
        ? [`${report.missing.length} currency rate(s) could not be initialized`]
        : [],
    });
  } catch (error) {
    sendError(res, error, 'Failed to initialize company currencies');
  }
};

exports.refreshExchangeRates = async (req, res) => {
  try {
    const companyId = companyIdForRequest(req);
    const userId = req.user?.id || req.user?._id || null;
    const body = req.body || {};
    const report = await refreshCompanyRates({
      companyId,
      userId,
      overwrite: Boolean(body.overwrite),
      client: prisma,
    });

    if (report.provider.error) {
      return res.status(502).json({
        success: false,
        code: 'PROVIDER_UNAVAILABLE',
        message: report.provider.error,
        data: report,
      });
    }

    res.json({
      success: true,
      data: report,
      message:
        report.updated.length > 0
          ? `Updated ${report.updated.length} exchange rate${report.updated.length === 1 ? '' : 's'}`
          : 'No exchange rates were updated',
    });
  } catch (error) {
    sendError(res, error, 'Failed to refresh exchange rates');
  }
};

exports.getExchangeRateProviderStatus = async (req, res) => {
  try {
    res.json({ success: true, data: getProviderStatus() });
  } catch (error) {
    sendError(res, error, 'Failed to read provider status');
  }
};

exports.convertCurrencyAmount = async (req, res) => {
  try {
    const companyId = companyIdForRequest(req);
    const result = await convertAmountBetweenCurrencies({
      companyId,
      fromCurrencyId: req.query.fromCurrencyId || null,
      fromCode: req.query.fromCode || req.query.from || null,
      toCurrencyId: req.query.toCurrencyId || null,
      toCode: req.query.toCode || req.query.to || null,
      amount: req.query.amount ?? 0,
      asOfDate: req.query.date ? new Date(req.query.date) : new Date(),
      client: prisma,
    });
    res.json({ success: true, data: result });
  } catch (error) {
    sendError(res, error, 'Failed to convert amount');
  }
};

exports.listExchangeRateHistory = async (req, res) => {
  try {
    const companyId = companyIdForRequest(req);
    const where = {
      companyId,
      ...(req.params.id ? { exchangeRateId: req.params.id } : {}),
      ...(req.query.fromCurrencyId ? { fromCurrencyId: req.query.fromCurrencyId } : {}),
      ...(req.query.toCurrencyId ? { toCurrencyId: req.query.toCurrencyId } : {}),
    };
    const rows = await prisma.exchangeRateHistory.findMany({
      where,
      include: {
        changedByUser: { select: { id: true, firstName: true, lastName: true } },
        fromCurrency: true,
        toCurrency: true,
      },
      orderBy: { changedAt: 'desc' },
      take: Math.min(Number(req.query.limit) || 100, 500),
    });
    res.json({ success: true, data: rows });
  } catch (error) {
    sendError(res, error, 'Failed to load exchange-rate history');
  }
};
