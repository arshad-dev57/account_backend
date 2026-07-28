// controllers/balanceSheetController.js

const { buildBalanceSheetFromLedger } = require('../utils/balanceSheetHelper');
const { get, set, del, delPattern } = require('../utils/redisClient');

exports.getBalanceSheet = async (req, res) => {
  try {
    const { period, asOfDate, fiscalYearId, startDate, endDate } = req.query;
    const userId = req.user.id;
    const companyId = req.user.companyId;

    // Build cache key with parameters
    const cacheKey = `bs:balance-sheet:${userId}:${period || ''}:${asOfDate || ''}:${fiscalYearId || ''}:${startDate || ''}:${endDate || ''}`;
    
    // Try to get from cache
    const cached = await get(cacheKey);
    if (cached) {
      return res.status(200).json({
        success: true,
        data: cached,
        cached: true,
      });
    }

    const data = await buildBalanceSheetFromLedger(userId, companyId, period, asOfDate, fiscalYearId, startDate, endDate);

    // Cache the result (5 minutes TTL)
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
    const { fiscalYearId, startDate, endDate } = req.query;
    const userId = req.user.id;
    const companyId = req.user.companyId;

    // Build cache key with parameters
    const cacheKey = `bs:summary:${userId}:${fiscalYearId || ''}:${startDate || ''}:${endDate || ''}`;
    
    // Try to get from cache
    const cached = await get(cacheKey);
    if (cached) {
      return res.status(200).json({
        success: true,
        data: cached,
        cached: true,
      });
    }

    const data = await buildBalanceSheetFromLedger(userId, 'All Time', null, fiscalYearId, startDate, endDate);

    const summaryData = {
      asOfDate: data.asOfDate,
      totalAssets: data.totalAssets,
      totalLiabilities: data.totalLiabilities,
      totalEquity: data.totalEquity,
      isBalanced: data.isBalanced,
    };

    // Cache the result (2 minutes TTL)
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

    // Build cache key with parameters
    const cacheKey = `bs:by-date:${userId}:${date}:${fiscalYearId || ''}:${startDate || ''}:${endDate || ''}`;
    
    // Try to get from cache
    const cached = await get(cacheKey);
    if (cached) {
      return res.status(200).json({
        success: true,
        data: cached,
        cached: true,
      });
    }

    const data = await buildBalanceSheetFromLedger(userId, 'All Time', date, fiscalYearId, startDate, endDate);

    const assets = [];
    const liabilities = [];
    const equity = [];

    Object.entries(data.assets).forEach(([category, items]) => {
      Object.entries(items).forEach(([name, balance]) => {
        assets.push({ code: '', name: `${category} - ${name}`, balance });
      });
    });

    Object.entries(data.liabilities).forEach(([category, items]) => {
      Object.entries(items).forEach(([name, balance]) => {
        liabilities.push({ code: '', name: `${category} - ${name}`, balance });
      });
    });

    Object.entries(data.equityDetails).forEach(([category, items]) => {
      Object.entries(items).forEach(([name, balance]) => {
        equity.push({ code: '', name: `${category} - ${name}`, balance });
      });
    });

    const responseData = {
      asOfDate: data.asOfDate,
      assets: { total: data.totalAssets, items: assets },
      liabilities: { total: data.totalLiabilities, items: liabilities },
      equity: { total: data.totalEquity, items: equity },
    };

    // Cache the result (5 minutes TTL)
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

    const cacheKey = `bs:assets:${userId}:${asOfDate || ''}:${fiscalYearId || ''}:${startDate || ''}:${endDate || ''}`;
    
    const cached = await get(cacheKey);
    if (cached) {
      return res.status(200).json({
        success: true,
        data: cached,
        cached: true,
      });
    }

    const data = await buildBalanceSheetFromLedger(userId, 'All Time', asOfDate, fiscalYearId, startDate, endDate);

    let currentAssets = 0;
    let fixedAssets = 0;
    let otherAssets = 0;
    const assetDetails = [];

    Object.entries(data.assets).forEach(([category, items]) => {
      Object.entries(items).forEach(([name, balance]) => {
        assetDetails.push({ code: '', name, parentAccount: category, balance });
        if (category === 'Current Assets') currentAssets += balance;
        else if (category === 'Fixed Assets') fixedAssets += balance;
        else otherAssets += balance;
      });
    });

    const responseData = {
      asOfDate: data.asOfDate,
      currentAssets,
      fixedAssets,
      otherAssets,
      totalAssets: data.totalAssets,
      details: assetDetails,
    };

    // Cache the result (5 minutes TTL)
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

    // Build cache key with parameters
    const cacheKey = `bs:liabilities:${userId}:${asOfDate || ''}:${fiscalYearId || ''}:${startDate || ''}:${endDate || ''}`;
    
    // Try to get from cache
    const cached = await get(cacheKey);
    if (cached) {
      return res.status(200).json({
        success: true,
        data: cached,
        cached: true,
      });
    }

    const data = await buildBalanceSheetFromLedger(userId, 'All Time', asOfDate, fiscalYearId, startDate, endDate);

    let currentLiabilities = 0;
    let longTermLiabilities = 0;
    const liabilityDetails = [];

    Object.entries(data.liabilities).forEach(([category, items]) => {
      Object.entries(items).forEach(([name, balance]) => {
        liabilityDetails.push({ code: '', name, parentAccount: category, balance });
        if (category === 'Current Liabilities') currentLiabilities += balance;
        else if (category === 'Long Term Liabilities') longTermLiabilities += balance;
      });
    });

    const responseData = {
      asOfDate: data.asOfDate,
      currentLiabilities,
      longTermLiabilities,
      equity: data.totalEquity,
      totalLiabilities: data.totalLiabilities,
      totalEquityAndLiabilities: data.totalLiabilities + data.totalEquity,
      details: liabilityDetails,
    };

    // Cache the result (5 minutes TTL)
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
