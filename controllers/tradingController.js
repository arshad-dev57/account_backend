'use strict';

const { companyIdForQuery, requireSingleCompany } = require('../utils/companyAccess');
const tradingService = require('../services/tradingService');

function companyIdFrom(req) {
  return req.method === 'GET' || req.method === 'HEAD'
    ? companyIdForQuery(req) ?? req.user?.companyId
    : req.user?.companyId;
}

function handleError(res, error, fallback = 'Trading request failed') {
  const status = error.statusCode || error.status || 500;
  if (status >= 500) {
    console.error('[trading]', error);
  }
  return res.status(status).json({
    success: false,
    message: status >= 500 ? fallback : error.message || fallback,
    code: error.code || undefined,
  });
}

const getDashboard = async (req, res) => {
  try {
    const companyId = companyIdFrom(req);
    if (!companyId) {
      return res.status(400).json({ success: false, message: 'Company context required' });
    }
    const data = await tradingService.getDashboardKpis({
      companyId,
      fromDate: req.query.fromDate,
      toDate: req.query.toDate,
    });
    return res.json({ success: true, data });
  } catch (error) {
    return handleError(res, error, 'Failed to load trading dashboard');
  }
};

const listDocuments = async (req, res) => {
  try {
    const companyId = companyIdFrom(req);
    if (!companyId) {
      return res.status(400).json({ success: false, message: 'Company context required' });
    }
    const result = await tradingService.listDocuments({
      companyId,
      documentType: req.query.documentType,
      tradeChannel: req.query.tradeChannel,
      search: req.query.search,
      page: req.query.page,
      pageSize: req.query.pageSize || req.query.limit,
      fromDate: req.query.fromDate,
      toDate: req.query.toDate,
    });
    return res.json({ success: true, ...result });
  } catch (error) {
    return handleError(res, error, 'Failed to list trading documents');
  }
};

const linkDocument = async (req, res) => {
  try {
    const companyId = requireSingleCompany(req);
    const { documentType, documentId, tradeChannel, tradeRef, metadata } = req.body || {};
    if (!documentType || !documentId) {
      return res.status(400).json({
        success: false,
        message: 'documentType and documentId are required',
      });
    }
    const data = await tradingService.linkDocument({
      companyId,
      userId: req.user.id,
      documentType,
      documentId,
      tradeChannel,
      tradeRef,
      metadata,
    });
    return res.status(201).json({ success: true, data });
  } catch (error) {
    return handleError(res, error, 'Failed to link trading document');
  }
};

const unlinkDocument = async (req, res) => {
  try {
    const companyId = requireSingleCompany(req);
    await tradingService.unlinkDocument({
      companyId,
      userId: req.user.id,
      tradingDocumentId: req.params.id,
    });
    return res.json({ success: true, message: 'Unlinked' });
  } catch (error) {
    return handleError(res, error, 'Failed to unlink trading document');
  }
};

const refreshDocument = async (req, res) => {
  try {
    const companyId = requireSingleCompany(req);
    const data = await tradingService.refreshDocumentSnapshot({
      companyId,
      tradingDocumentId: req.params.id,
    });
    return res.json({ success: true, data });
  } catch (error) {
    return handleError(res, error, 'Failed to refresh trading document');
  }
};

const listPriceLists = async (req, res) => {
  try {
    const companyId = companyIdFrom(req);
    if (!companyId) {
      return res.status(400).json({ success: false, message: 'Company context required' });
    }
    const data = await tradingService.listPriceLists({ companyId });
    return res.json({ success: true, data });
  } catch (error) {
    return handleError(res, error, 'Failed to list price lists');
  }
};

const createPriceList = async (req, res) => {
  try {
    const companyId = requireSingleCompany(req);
    const { code, name } = req.body || {};
    if (!code || !name) {
      return res.status(400).json({ success: false, message: 'code and name are required' });
    }
    const data = await tradingService.createPriceList({
      companyId,
      userId: req.user.id,
      data: req.body,
    });
    return res.status(201).json({ success: true, data });
  } catch (error) {
    return handleError(res, error, 'Failed to create price list');
  }
};

const getPriceList = async (req, res) => {
  try {
    const companyId = companyIdFrom(req);
    if (!companyId) {
      return res.status(400).json({ success: false, message: 'Company context required' });
    }
    const data = await tradingService.getPriceList({ companyId, id: req.params.id });
    return res.json({ success: true, data });
  } catch (error) {
    return handleError(res, error, 'Failed to load price list');
  }
};

const updatePriceList = async (req, res) => {
  try {
    const companyId = requireSingleCompany(req);
    const data = await tradingService.updatePriceList({
      companyId,
      userId: req.user.id,
      id: req.params.id,
      data: req.body || {},
    });
    return res.json({ success: true, data });
  } catch (error) {
    return handleError(res, error, 'Failed to update price list');
  }
};

const listCustomerPrices = async (req, res) => {
  try {
    const companyId = companyIdFrom(req);
    if (!companyId) {
      return res.status(400).json({ success: false, message: 'Company context required' });
    }
    const data = await tradingService.listCustomerPrices({ companyId });
    return res.json({ success: true, data });
  } catch (error) {
    return handleError(res, error, 'Failed to list customer prices');
  }
};

const upsertCustomerPrice = async (req, res) => {
  try {
    const companyId = requireSingleCompany(req);
    const { customerId, productId, listPrice, negotiatedPrice } = req.body || {};
    if (!customerId || !productId || listPrice == null || negotiatedPrice == null) {
      return res.status(400).json({
        success: false,
        message: 'customerId, productId, listPrice and negotiatedPrice are required',
      });
    }
    const data = await tradingService.upsertCustomerPrice({
      companyId,
      userId: req.user.id,
      data: req.body,
    });
    return res.json({ success: true, data });
  } catch (error) {
    return handleError(res, error, 'Failed to save customer price');
  }
};

const getMargins = async (req, res) => {
  try {
    const companyId = companyIdFrom(req);
    if (!companyId) {
      return res.status(400).json({ success: false, message: 'Company context required' });
    }
    const data = await tradingService.getMarginAnalysis({
      companyId,
      costBasis: req.query.costBasis || 'CostPrice',
      targetMarginPct: req.query.targetMarginPct != null ? Number(req.query.targetMarginPct) : 20,
    });
    return res.json({ success: true, data });
  } catch (error) {
    return handleError(res, error, 'Failed to load margin analysis');
  }
};

const getDocumentTypes = async (_req, res) => {
  return res.json({
    success: true,
    data: {
      documentTypes: Object.values(tradingService.DOCUMENT_TYPES),
      tradeChannels: Array.from(tradingService.TRADE_CHANNELS),
    },
  });
};

const resolvePrice = async (req, res) => {
  try {
    const companyId = companyIdFrom(req);
    if (!companyId) {
      return res.status(400).json({ success: false, message: 'Company context required' });
    }
    const customerId = req.query.customerId || req.body?.customerId;
    const productId = req.query.productId || req.body?.productId;
    const quantity =
      req.query.quantity != null
        ? Number(req.query.quantity)
        : req.body?.quantity != null
          ? Number(req.body.quantity)
          : 1;
    const asOfDate =
      req.query.asOfDate || req.body?.asOfDate
        ? new Date(req.query.asOfDate || req.body.asOfDate)
        : new Date();

    if (!productId) {
      return res.status(400).json({ success: false, message: 'productId is required' });
    }

    const data = await tradingService.resolveSellPrice({
      companyId,
      customerId: customerId || null,
      productId,
      quantity,
      asOfDate,
    });
    return res.json({ success: true, data });
  } catch (error) {
    return handleError(res, error, 'Failed to resolve sell price');
  }
};

const resolvePricesBatch = async (req, res) => {
  try {
    const companyId = companyIdFrom(req);
    if (!companyId) {
      return res.status(400).json({ success: false, message: 'Company context required' });
    }
    const customerId = req.body?.customerId || null;
    const asOfDate = req.body?.asOfDate ? new Date(req.body.asOfDate) : new Date();
    const lines = Array.isArray(req.body?.lines) ? req.body.lines : [];
    if (!lines.length) {
      return res.status(400).json({ success: false, message: 'lines[] is required' });
    }

    const data = [];
    for (const line of lines) {
      if (!line?.productId) {
        return res.status(400).json({ success: false, message: 'Each line requires productId' });
      }
      const resolved = await tradingService.resolveSellPrice({
        companyId,
        customerId: line.customerId || customerId,
        productId: line.productId,
        quantity: line.quantity != null ? Number(line.quantity) : 1,
        asOfDate,
      });
      data.push(resolved);
    }
    return res.json({ success: true, data });
  } catch (error) {
    return handleError(res, error, 'Failed to resolve sell prices');
  }
};

module.exports = {
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
};
