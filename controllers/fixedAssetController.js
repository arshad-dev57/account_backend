const FixedAsset = require('../models/FixedAsset');
const Vendor = require('../models/Vendor');
const JournalEntry = require('../models/JournalEntry');
const ChartOfAccount = require('../models/ChartOfAccount');

// Helper: Get or create Fixed Asset account
async function getOrCreateFixedAssetAccount(userId) {
  let assetAccount = await ChartOfAccount.findOne({ code: '1500' });
  if (!assetAccount) {
    assetAccount = await ChartOfAccount.create({
      code: '1500',
      name: 'Fixed Assets',
      type: 'Assets',
      parentAccount: 'Non-Current Assets',
      openingBalance: 0,
      description: 'Property, plant and equipment',
      taxCode: 'N/A',
      createdBy: userId,
    });
  }
  return assetAccount;
}

// Helper: Get or create Accumulated Depreciation account
async function getOrCreateAccumulatedDepreciationAccount(userId) {
  let accDepAccount = await ChartOfAccount.findOne({ code: '1510' });
  if (!accDepAccount) {
    accDepAccount = await ChartOfAccount.create({
      code: '1510',
      name: 'Accumulated Depreciation',
      type: 'Assets',
      parentAccount: 'Non-Current Assets',
      openingBalance: 0,
      description: 'Accumulated depreciation on fixed assets',
      taxCode: 'N/A',
      createdBy: userId,
    });
  }
  return accDepAccount;
}

// Helper: Get or create Depreciation Expense account
async function getOrCreateDepreciationExpenseAccount(userId) {
  let depExpAccount = await ChartOfAccount.findOne({ code: '6100' });
  if (!depExpAccount) {
    depExpAccount = await ChartOfAccount.create({
      code: '6100',
      name: 'Depreciation Expense',
      type: 'Expenses',
      parentAccount: 'Operating Expenses',
      openingBalance: 0,
      description: 'Depreciation expense on fixed assets',
      taxCode: 'N/A',
      createdBy: userId,
    });
  }
  return depExpAccount;
}

// ==================== CREATE FIXED ASSET ====================
exports.createFixedAsset = async (req, res) => {
  try {
    const {
      name,
      category,
      purchaseDate,
      purchaseCost,
      usefulLife,
      salvageValue,
      depreciationMethod,
      location,
      supplierId,
      warrantyExpiry,
      notes,
    } = req.body;

    // Validate supplier if provided
    let supplierName = '';
    if (supplierId) {
      const supplier = await Vendor.findById(supplierId);
      if (supplier) {
        supplierName = supplier.name;
      }
    }

    // Create fixed asset
    const fixedAsset = await FixedAsset.create({
      name,
      category,
      purchaseDate,
      purchaseCost,
      usefulLife,
      salvageValue: salvageValue || 0,
      depreciationMethod: depreciationMethod || 'Straight Line',
      location: location || '',
      supplierId: supplierId || null,
      supplierName,
      warrantyExpiry: warrantyExpiry || null,
      notes: notes || '',
      createdBy: req.user.id,
    });

    // Create journal entry for asset purchase
    const assetAccount = await getOrCreateFixedAssetAccount(req.user.id);
    const cashAccount = await ChartOfAccount.findOne({ code: '1010' }); // Cash account

    await JournalEntry.create({
      entryNumber: `JE-${Date.now()}`,
      date: new Date(purchaseDate),
      description: `Purchase of fixed asset: ${name} (${fixedAsset.assetCode})`,
      reference: fixedAsset.assetCode,
      lines: [
        {
          accountId: assetAccount._id,
          accountName: assetAccount.name,
          accountCode: assetAccount.code,
          debit: purchaseCost,
          credit: 0,
        },
        {
          accountId: cashAccount ? cashAccount._id : assetAccount._id,
          accountName: cashAccount ? cashAccount.name : 'Cash',
          accountCode: cashAccount ? cashAccount.code : '1010',
          debit: 0,
          credit: purchaseCost,
        },
      ],
      status: 'Posted',
      createdBy: req.user.id,
      postedBy: req.user.id,
      postedAt: new Date(),
    });

    res.status(201).json({
      success: true,
      data: fixedAsset,
      message: 'Fixed asset created successfully',
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

// ==================== GET ALL FIXED ASSETS ====================
exports.getFixedAssets = async (req, res) => {
  try {
    const { category, status, search } = req.query;
    let query = {};

    if (category) query.category = category;
    if (status) query.status = status;

    if (search) {
      query.$or = [
        { name: { $regex: search, $options: 'i' } },
        { assetCode: { $regex: search, $options: 'i' } },
        { category: { $regex: search, $options: 'i' } },
      ];
    }

    const assets = await FixedAsset.find(query)
      .populate('supplierId', 'name email phone')
      .sort({ createdAt: -1 });

    res.status(200).json({
      success: true,
      count: assets.length,
      data: assets,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

// ==================== GET SINGLE FIXED ASSET ====================
exports.getFixedAsset = async (req, res) => {
  try {
    const asset = await FixedAsset.findById(req.params.id)
      .populate('supplierId', 'name email phone address');

    if (!asset) {
      return res.status(404).json({
        success: false,
        message: 'Fixed asset not found',
      });
    }

    res.status(200).json({
      success: true,
      data: asset,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

// ==================== UPDATE FIXED ASSET ====================
exports.updateFixedAsset = async (req, res) => {
  try {
    const {
      name,
      category,
      purchaseDate,
      purchaseCost,
      usefulLife,
      salvageValue,
      location,
      supplierId,
      warrantyExpiry,
      notes,
    } = req.body;

    let supplierName = '';
    if (supplierId) {
      const supplier = await Vendor.findById(supplierId);
      if (supplier) {
        supplierName = supplier.name;
      }
    }

    const fixedAsset = await FixedAsset.findById(req.params.id);

    if (!fixedAsset) {
      return res.status(404).json({
        success: false,
        message: 'Fixed asset not found',
      });
    }

    // Update fields
    if (name) fixedAsset.name = name;
    if (category) fixedAsset.category = category;
    if (purchaseDate) fixedAsset.purchaseDate = purchaseDate;
    if (purchaseCost) fixedAsset.purchaseCost = purchaseCost;
    if (usefulLife) fixedAsset.usefulLife = usefulLife;
    if (salvageValue !== undefined) fixedAsset.salvageValue = salvageValue;
    if (location !== undefined) fixedAsset.location = location;
    if (supplierId) {
      fixedAsset.supplierId = supplierId;
      fixedAsset.supplierName = supplierName;
    }
    if (warrantyExpiry) fixedAsset.warrantyExpiry = warrantyExpiry;
    if (notes !== undefined) fixedAsset.notes = notes;

    await fixedAsset.save();

    res.status(200).json({
      success: true,
      data: fixedAsset,
      message: 'Fixed asset updated successfully',
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

// ==================== RUN DEPRECIATION ====================
exports.runDepreciation = async (req, res) => {
  try {
    const { assetId, depreciationDate } = req.body;
    const date = depreciationDate ? new Date(depreciationDate) : new Date();

    const asset = await FixedAsset.findById(assetId);

    if (!asset) {
      return res.status(404).json({
        success: false,
        message: 'Fixed asset not found',
      });
    }

    if (asset.status === 'Disposed') {
      return res.status(400).json({
        success: false,
        message: 'Cannot depreciate a disposed asset',
      });
    }

    if (asset.status === 'Fully Depreciated') {
      return res.status(400).json({
        success: false,
        message: 'Asset is already fully depreciated',
      });
    }

    const result = await asset.runDepreciation(date);

    // Create journal entry for depreciation
    const depExpAccount = await getOrCreateDepreciationExpenseAccount(req.user.id);
    const accDepAccount = await getOrCreateAccumulatedDepreciationAccount(req.user.id);

    await JournalEntry.create({
      entryNumber: `JE-${Date.now()}`,
      date: date,
      description: `Depreciation for ${asset.name} (${asset.assetCode})`,
      reference: asset.assetCode,
      lines: [
        {
          accountId: depExpAccount._id,
          accountName: depExpAccount.name,
          accountCode: depExpAccount.code,
          debit: result.amount,
          credit: 0,
        },
        {
          accountId: accDepAccount._id,
          accountName: accDepAccount.name,
          accountCode: accDepAccount.code,
          debit: 0,
          credit: result.amount,
        },
      ],
      status: 'Posted',
      createdBy: req.user.id,
      postedBy: req.user.id,
      postedAt: new Date(),
    });

    res.status(200).json({
      success: true,
      data: {
        asset: {
          id: asset._id,
          name: asset.name,
          assetCode: asset.assetCode,
          depreciationAmount: result.amount,
          accumulatedDepreciation: result.accumulatedDepreciation,
          netBookValue: result.netBookValue,
          status: result.status,
        },
      },
      message: `Depreciation of ${result.amount} recorded successfully`,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

// ==================== RUN MONTHLY DEPRECIATION FOR ALL ASSETS ====================
exports.runMonthlyDepreciation = async (req, res) => {
  try {
    const { depreciationDate } = req.body;
    const date = depreciationDate ? new Date(depreciationDate) : new Date();

    const activeAssets = await FixedAsset.find({
      status: { $in: ['Active', 'Fully Depreciated'] },
      $or: [
        { lastDepreciationDate: { $exists: false } },
        { lastDepreciationDate: { $lt: date } },
      ],
    });

    const results = [];
    for (const asset of activeAssets) {
      if (asset.status !== 'Fully Depreciated') {
        const result = await asset.runDepreciation(date);
        results.push({
          assetId: asset._id,
          assetCode: asset.assetCode,
          name: asset.name,
          depreciationAmount: result.amount,
          accumulatedDepreciation: result.accumulatedDepreciation,
          netBookValue: result.netBookValue,
          status: result.status,
        });
      }
    }

    res.status(200).json({
      success: true,
      data: {
        processed: results.length,
        details: results,
      },
      message: `Depreciation processed for ${results.length} assets`,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

// ==================== DISPOSE FIXED ASSET ====================
exports.disposeFixedAsset = async (req, res) => {
  try {
    const { assetId, disposalDate, disposalAmount, disposalReason } = req.body;

    const asset = await FixedAsset.findById(assetId);

    if (!asset) {
      return res.status(404).json({
        success: false,
        message: 'Fixed asset not found',
      });
    }

    if (asset.status === 'Disposed') {
      return res.status(400).json({
        success: false,
        message: 'Asset already disposed',
      });
    }

    // Calculate gain/loss on disposal
    const gainLoss = disposalAmount - asset.netBookValue;

    // Update asset
    asset.status = 'Disposed';
    asset.disposedDate = disposalDate || new Date();
    asset.disposalAmount = disposalAmount || 0;
    asset.disposalReason = disposalReason || '';

    await asset.save();

    // Create journal entry for disposal
    const assetAccount = await getOrCreateFixedAssetAccount(req.user.id);
    const accDepAccount = await getOrCreateAccumulatedDepreciationAccount(req.user.id);
    const gainLossAccount = await ChartOfAccount.findOne({ code: gainLoss >= 0 ? '5100' : '5200' }); // Gain/Loss account

    const journalLines = [
      {
        accountId: accDepAccount._id,
        accountName: accDepAccount.name,
        accountCode: accDepAccount.code,
        debit: asset.accumulatedDepreciation,
        credit: 0,
      },
      {
        accountId: assetAccount._id,
        accountName: assetAccount.name,
        accountCode: assetAccount.code,
        debit: 0,
        credit: asset.purchaseCost,
      },
    ];

    if (disposalAmount > 0) {
      journalLines.push({
        accountId: await getOrCreateCashAccount(req.user.id),
        accountName: 'Cash/Bank',
        accountCode: '1010',
        debit: disposalAmount,
        credit: 0,
      });
    }

    if (gainLoss !== 0) {
      if (gainLoss > 0) {
        // Gain on disposal
        journalLines.push({
          accountId: gainLossAccount ? gainLossAccount._id : assetAccount._id,
          accountName: 'Gain on Disposal',
          accountCode: '5100',
          debit: 0,
          credit: gainLoss,
        });
      } else {
        // Loss on disposal
        journalLines.push({
          accountId: gainLossAccount ? gainLossAccount._id : assetAccount._id,
          accountName: 'Loss on Disposal',
          accountCode: '5200',
          debit: Math.abs(gainLoss),
          credit: 0,
        });
      }
    }

    await JournalEntry.create({
      entryNumber: `JE-${Date.now()}`,
      date: disposalDate || new Date(),
      description: `Disposal of ${asset.name} (${asset.assetCode})`,
      reference: asset.assetCode,
      lines: journalLines,
      status: 'Posted',
      createdBy: req.user.id,
      postedBy: req.user.id,
      postedAt: new Date(),
    });

    res.status(200).json({
      success: true,
      data: {
        asset: {
          id: asset._id,
          name: asset.name,
          assetCode: asset.assetCode,
          netBookValue: asset.netBookValue,
          disposalAmount: asset.disposalAmount,
          gainLoss: gainLoss,
          status: asset.status,
        },
      },
      message: `Asset disposed successfully. ${gainLoss >= 0 ? 'Gain' : 'Loss'} of ${Math.abs(gainLoss)} recorded`,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

// Helper: Get cash account
async function getOrCreateCashAccount(userId) {
  let cashAccount = await ChartOfAccount.findOne({ code: '1010' });
  if (!cashAccount) {
    cashAccount = await ChartOfAccount.create({
      code: '1010',
      name: 'Cash in Hand',
      type: 'Assets',
      parentAccount: 'Current Assets',
      openingBalance: 0,
      description: 'Physical cash in office',
      taxCode: 'N/A',
      createdBy: userId,
    });
  }
  return cashAccount;
}

// ==================== GET SUMMARY ====================
exports.getSummary = async (req, res) => {
  try {
    const assets = await FixedAsset.find();

    const totalAssets = assets.length;
    const totalCost = assets.reduce((sum, a) => sum + a.purchaseCost, 0);
    const accumulatedDepreciation = assets.reduce((sum, a) => sum + a.accumulatedDepreciation, 0);
    const netBookValue = totalCost - accumulatedDepreciation;

    const activeCount = assets.filter(a => a.status === 'Active').length;
    const fullyDepreciatedCount = assets.filter(a => a.status === 'Fully Depreciated').length;
    const disposedCount = assets.filter(a => a.status === 'Disposed').length;

    res.status(200).json({
      success: true,
      data: {
        totalAssets,
        totalCost,
        accumulatedDepreciation,
        netBookValue,
        activeCount,
        fullyDepreciatedCount,
        disposedCount,
      },
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

// ==================== DELETE FIXED ASSET ====================
exports.deleteFixedAsset = async (req, res) => {
  try {
    const asset = await FixedAsset.findById(req.params.id);

    if (!asset) {
      return res.status(404).json({
        success: false,
        message: 'Fixed asset not found',
      });
    }

    if (asset.status === 'Active' && asset.accumulatedDepreciation > 0) {
      return res.status(400).json({
        success: false,
        message: 'Cannot delete asset with accumulated depreciation',
      });
    }

    await asset.deleteOne();

    res.status(200).json({
      success: true,
      message: 'Fixed asset deleted successfully',
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};