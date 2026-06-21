// controllers/balanceSheetController.js

const { buildBalanceSheetFromLedger } = require('../utils/balanceSheetHelper');

exports.getBalanceSheet = async (req, res) => {
  try {
    const { period, asOfDate } = req.query;
    const data = await buildBalanceSheetFromLedger(req.user.id, period, asOfDate);

    res.status(200).json({
      success: true,
      data,
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
    const data = await buildBalanceSheetFromLedger(req.user.id, 'All Time', null);

    res.status(200).json({
      success: true,
      data: {
        asOfDate: data.asOfDate,
        totalAssets: data.totalAssets,
        totalLiabilities: data.totalLiabilities,
        totalEquity: data.totalEquity,
        isBalanced: data.isBalanced,
      },
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
    const data = await buildBalanceSheetFromLedger(req.user.id, 'All Time', date);

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

    res.status(200).json({
      success: true,
      data: {
        asOfDate: data.asOfDate,
        assets: { total: data.totalAssets, items: assets },
        liabilities: { total: data.totalLiabilities, items: liabilities },
        equity: { total: data.totalEquity, items: equity },
      },
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
    const { asOfDate } = req.query;
    const data = await buildBalanceSheetFromLedger(req.user.id, 'All Time', asOfDate);

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

    res.status(200).json({
      success: true,
      data: {
        asOfDate: data.asOfDate,
        currentAssets,
        fixedAssets,
        otherAssets,
        totalAssets: data.totalAssets,
        details: assetDetails,
      },
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
    const { asOfDate } = req.query;
    const data = await buildBalanceSheetFromLedger(req.user.id, 'All Time', asOfDate);

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

    res.status(200).json({
      success: true,
      data: {
        asOfDate: data.asOfDate,
        currentLiabilities,
        longTermLiabilities,
        equity: data.totalEquity,
        totalLiabilities: data.totalLiabilities,
        totalEquityAndLiabilities: data.totalLiabilities + data.totalEquity,
        details: liabilityDetails,
      },
    });
  } catch (error) {
    console.error('Error generating liabilities breakdown:', error);
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};
