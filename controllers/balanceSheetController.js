// controllers/balanceSheetController.js

const { buildBalanceSheetFromLedger } = require('../utils/balanceSheetHelper');
const { get, set } = require('../utils/redisClient');

exports.getBalanceSheet = async (req, res) => {
  try {
    const { period, asOfDate, fiscalYearId, startDate, endDate } = req.query;
    const userId = req.user.id;
    const companyId = req.user.companyId;

    if (!companyId) {
      return res.status(400).json({
        success: false,
        message: 'Company context is required',
      });
    }

    const cacheKey = `bs:balance-sheet:${companyId}:${period || ''}:${asOfDate || ''}:${fiscalYearId || ''}:${startDate || ''}:${endDate || ''}`;

    const cached = await get(cacheKey);
    if (cached) {
      return res.status(200).json({
        success: true,
        data: cached,
        cached: true,
      });
    }

    // Correct argument order: userId, companyId, period, asOfDate, fiscalYearId, startDate, endDate
    const data = await buildBalanceSheetFromLedger(
      userId,
      companyId,
      period || 'All Time',
      asOfDate || null,
      fiscalYearId || null,
      startDate || null,
      endDate || null
    );

    await set(cacheKey, data, 300);

    res.status(200).json({
      success: true,
      data,
      cached: false,
    });
  } catch (error) {
    console.error('Error generating balance sheet:', error);
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

exports.getSummary = async (req, res) => {
  try {
    const { fiscalYearId, startDate, endDate, asOfDate } = req.query;
    const userId = req.user.id;
    const companyId = req.user.companyId;

    if (!companyId) {
      return res.status(400).json({
        success: false,
        message: 'Company context is required',
      });
    }

    const cacheKey = `bs:summary:${companyId}:${fiscalYearId || ''}:${startDate || ''}:${endDate || ''}:${asOfDate || ''}`;

    const cached = await get(cacheKey);
    if (cached) {
      return res.status(200).json({
        success: true,
        data: cached,
        cached: true,
      });
    }

    const data = await buildBalanceSheetFromLedger(
      userId,
      companyId,
      'All Time',
      asOfDate || null,
      fiscalYearId || null,
      startDate || null,
      endDate || null
    );

    const summaryData = {
      asOfDate: data.asOfDate,
      totalAssets: data.totals.totalAssets,
      totalLiabilities: data.totals.totalLiabilities,
      totalEquity: data.totals.totalEquity,
      isBalanced: data.isBalanced,
      difference: data.difference,
    };

    await set(cacheKey, summaryData, 120);

    res.status(200).json({
      success: true,
      data: summaryData,
      cached: false,
    });
  } catch (error) {
    console.error('Error generating balance sheet summary:', error);
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

exports.getBalanceSheetByDate = async (req, res) => {
  try {
    const { date } = req.params;
    const { fiscalYearId, startDate, endDate } = req.query;
    const userId = req.user.id;
    const companyId = req.user.companyId;

    if (!companyId) {
      return res.status(400).json({
        success: false,
        message: 'Company context is required',
      });
    }

    const cacheKey = `bs:by-date:${companyId}:${date}:${fiscalYearId || ''}:${startDate || ''}:${endDate || ''}`;

    const cached = await get(cacheKey);
    if (cached) {
      return res.status(200).json({
        success: true,
        data: cached,
        cached: true,
      });
    }

    const data = await buildBalanceSheetFromLedger(
      userId,
      companyId,
      'All Time',
      date,
      fiscalYearId || null,
      startDate || null,
      endDate || null
    );

    const assets = [];
    const liabilities = [];
    const equity = [];

    Object.entries(data.assets).forEach(([category, items]) => {
      items.forEach((item) => {
        assets.push({
          code: item.code,
          name: `${category} - ${item.name}`,
          balance: item.balance,
        });
      });
    });

    Object.entries(data.liabilities).forEach(([category, items]) => {
      items.forEach((item) => {
        liabilities.push({
          code: item.code,
          name: `${category} - ${item.name}`,
          balance: item.balance,
        });
      });
    });

    (data.equity.owners || []).forEach((item) => {
      equity.push({
        code: item.code,
        name: item.name,
        balance: item.balance,
      });
    });

    const responseData = {
      asOfDate: data.asOfDate,
      assets: { total: data.totals.totalAssets, items: assets },
      liabilities: { total: data.totals.totalLiabilities, items: liabilities },
      equity: { total: data.totals.totalEquity, items: equity },
      isBalanced: data.isBalanced,
      difference: data.difference,
    };

    await set(cacheKey, responseData, 300);

    res.status(200).json({
      success: true,
      data: responseData,
      cached: false,
    });
  } catch (error) {
    console.error('Error generating balance sheet by date:', error);
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

exports.getAssetsBreakdown = async (req, res) => {
  try {
    const { asOfDate, fiscalYearId, startDate, endDate } = req.query;
    const userId = req.user.id;
    const companyId = req.user.companyId;

    if (!companyId) {
      return res.status(400).json({
        success: false,
        message: 'Company context is required',
      });
    }

    const cacheKey = `bs:assets:${companyId}:${asOfDate || ''}:${fiscalYearId || ''}:${startDate || ''}:${endDate || ''}`;

    const cached = await get(cacheKey);
    if (cached) {
      return res.status(200).json({
        success: true,
        data: cached,
        cached: true,
      });
    }

    const data = await buildBalanceSheetFromLedger(
      userId,
      companyId,
      'All Time',
      asOfDate || null,
      fiscalYearId || null,
      startDate || null,
      endDate || null
    );

    let currentAssets = 0;
    let fixedAssets = 0;
    let otherAssets = 0;
    const assetDetails = [];

    Object.entries(data.assets).forEach(([category, items]) => {
      items.forEach((item) => {
        assetDetails.push({
          code: item.code,
          name: item.name,
          parentAccount: item.parent || category,
          balance: item.balance,
        });
        if (category === 'current') currentAssets += item.balance;
        else if (category === 'fixed') fixedAssets += item.balance;
        else otherAssets += item.balance;
      });
    });

    const responseData = {
      asOfDate: data.asOfDate,
      currentAssets,
      fixedAssets,
      otherAssets,
      totalAssets: data.totals.totalAssets,
      details: assetDetails,
    };

    await set(cacheKey, responseData, 300);

    res.status(200).json({
      success: true,
      data: responseData,
      cached: false,
    });
  } catch (error) {
    console.error('Error generating assets breakdown:', error);
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

exports.getLiabilitiesBreakdown = async (req, res) => {
  try {
    const { asOfDate, fiscalYearId, startDate, endDate } = req.query;
    const userId = req.user.id;
    const companyId = req.user.companyId;

    if (!companyId) {
      return res.status(400).json({
        success: false,
        message: 'Company context is required',
      });
    }

    const cacheKey = `bs:liabilities:${companyId}:${asOfDate || ''}:${fiscalYearId || ''}:${startDate || ''}:${endDate || ''}`;

    const cached = await get(cacheKey);
    if (cached) {
      return res.status(200).json({
        success: true,
        data: cached,
        cached: true,
      });
    }

    const data = await buildBalanceSheetFromLedger(
      userId,
      companyId,
      'All Time',
      asOfDate || null,
      fiscalYearId || null,
      startDate || null,
      endDate || null
    );

    let currentLiabilities = 0;
    let longTermLiabilities = 0;
    const liabilityDetails = [];

    Object.entries(data.liabilities).forEach(([category, items]) => {
      items.forEach((item) => {
        liabilityDetails.push({
          code: item.code,
          name: item.name,
          parentAccount: item.parent || category,
          balance: item.balance,
        });
        if (category === 'current') currentLiabilities += item.balance;
        else if (category === 'longTerm') longTermLiabilities += item.balance;
      });
    });

    const responseData = {
      asOfDate: data.asOfDate,
      currentLiabilities,
      longTermLiabilities,
      equity: data.totals.totalEquity,
      totalLiabilities: data.totals.totalLiabilities,
      totalEquityAndLiabilities: data.totals.totalLiabilitiesAndEquity,
      details: liabilityDetails,
    };

    await set(cacheKey, responseData, 300);

    res.status(200).json({
      success: true,
      data: responseData,
      cached: false,
    });
  } catch (error) {
    console.error('Error generating liabilities breakdown:', error);
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};
