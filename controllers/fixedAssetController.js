const prisma = require('../prisma/client');
const FixedAssetModel = require('../models/FixedAsset');

// ============================================================
// HELPER FUNCTIONS
// ============================================================

// Helper: Get or create Fixed Asset account
async function getOrCreateFixedAssetAccount(userId) {
  console.log('🔍 [FA] Getting/Creating Fixed Asset account');
  let assetAccount = await prisma.chartOfAccount.findFirst({
    where: {
      code: '1500',
      createdBy: userId
    }
  });

  if (!assetAccount) {
    console.log('📝 [FA] Creating new Fixed Asset account');
    const existingCode = await prisma.chartOfAccount.findFirst({
      where: { code: '1500' }
    });
    
    let newCode = '1500';
    if (existingCode) {
      let counter = 1;
      let codeExists = true;
      while (codeExists) {
        newCode = `15${counter}0`;
        const existing = await prisma.chartOfAccount.findFirst({
          where: { code: newCode, createdBy: userId }
        });
        if (!existing) {
          codeExists = false;
        }
        counter++;
      }
    }

    assetAccount = await prisma.chartOfAccount.create({
      data: {
        code: newCode,
        name: 'Fixed Assets',
        type: 'Assets',
        parentAccount: 'Non-Current Assets',
        openingBalance: 0,
        currentBalance: 0,
        description: 'Property, plant and equipment',
        taxCode: 'N/A',
        balanceType: 'Debit',
        isActive: true,
        createdBy: userId
      }
    });
    console.log('✅ [FA] Fixed Asset account created');
  }
  return assetAccount;
}

// Helper: Get or create Accumulated Depreciation account
async function getOrCreateAccumulatedDepreciationAccount(userId) {
  console.log('🔍 [FA] Getting/Creating Accumulated Depreciation account');
  let accDepAccount = await prisma.chartOfAccount.findFirst({
    where: {
      code: '1510',
      createdBy: userId
    }
  });

  if (!accDepAccount) {
    console.log('📝 [FA] Creating new Accumulated Depreciation account');
    const existingCode = await prisma.chartOfAccount.findFirst({
      where: { code: '1510' }
    });
    
    let newCode = '1510';
    if (existingCode) {
      let counter = 1;
      let codeExists = true;
      while (codeExists) {
        newCode = `151${counter}`;
        const existing = await prisma.chartOfAccount.findFirst({
          where: { code: newCode, createdBy: userId }
        });
        if (!existing) {
          codeExists = false;
        }
        counter++;
      }
    }

    accDepAccount = await prisma.chartOfAccount.create({
      data: {
        code: newCode,
        name: 'Accumulated Depreciation',
        type: 'Assets',
        parentAccount: 'Non-Current Assets',
        openingBalance: 0,
        currentBalance: 0,
        description: 'Accumulated depreciation on fixed assets',
        taxCode: 'N/A',
        balanceType: 'Credit',
        isActive: true,
        createdBy: userId
      }
    });
    console.log('✅ [FA] Accumulated Depreciation account created');
  }
  return accDepAccount;
}

// Helper: Get or create Depreciation Expense account
async function getOrCreateDepreciationExpenseAccount(userId) {
  console.log('🔍 [FA] Getting/Creating Depreciation Expense account');
  let depExpAccount = await prisma.chartOfAccount.findFirst({
    where: {
      code: '6100',
      createdBy: userId
    }
  });

  if (!depExpAccount) {
    console.log('📝 [FA] Creating new Depreciation Expense account');
    const existingCode = await prisma.chartOfAccount.findFirst({
      where: { code: '6100' }
    });
    
    let newCode = '6100';
    if (existingCode) {
      let counter = 1;
      let codeExists = true;
      while (codeExists) {
        newCode = `61${counter}0`;
        const existing = await prisma.chartOfAccount.findFirst({
          where: { code: newCode, createdBy: userId }
        });
        if (!existing) {
          codeExists = false;
        }
        counter++;
      }
    }

    depExpAccount = await prisma.chartOfAccount.create({
      data: {
        code: newCode,
        name: 'Depreciation Expense',
        type: 'Expenses',
        parentAccount: 'Operating Expenses',
        openingBalance: 0,
        currentBalance: 0,
        description: 'Depreciation expense on fixed assets',
        taxCode: 'N/A',
        balanceType: 'Debit',
        isActive: true,
        createdBy: userId
      }
    });
    console.log('✅ [FA] Depreciation Expense account created');
  }
  return depExpAccount;
}

// Helper: Get or create Cash account
async function getOrCreateCashAccount(userId) {
  console.log('🔍 [FA] Getting/Creating Cash account');
  let cashAccount = await prisma.chartOfAccount.findFirst({
    where: {
      code: '1010',
      createdBy: userId
    }
  });

  if (!cashAccount) {
    console.log('📝 [FA] Creating new Cash account');
    const existingCode = await prisma.chartOfAccount.findFirst({
      where: { code: '1010' }
    });
    
    let newCode = '1010';
    if (existingCode) {
      let counter = 1;
      let codeExists = true;
      while (codeExists) {
        newCode = `101${counter}`;
        const existing = await prisma.chartOfAccount.findFirst({
          where: { code: newCode, createdBy: userId }
        });
        if (!existing) {
          codeExists = false;
        }
        counter++;
      }
    }

    cashAccount = await prisma.chartOfAccount.create({
      data: {
        code: newCode,
        name: 'Cash in Hand',
        type: 'Assets',
        parentAccount: 'Current Assets',
        openingBalance: 0,
        currentBalance: 0,
        description: 'Physical cash in office',
        taxCode: 'N/A',
        balanceType: 'Debit',
        isActive: true,
        createdBy: userId
      }
    });
    console.log('✅ [FA] Cash account created');
  }
  return cashAccount;
}

// Helper: Get or create Gain/Loss account
async function getOrCreateGainLossAccount(userId, isGain) {
  const code = isGain ? '5100' : '5200';
  console.log(`🔍 [FA] Getting/Creating ${isGain ? 'Gain' : 'Loss'} account`);
  
  let account = await prisma.chartOfAccount.findFirst({
    where: {
      code: code,
      createdBy: userId
    }
  });

  if (!account) {
    const existingCode = await prisma.chartOfAccount.findFirst({
      where: { code: code }
    });
    
    let newCode = code;
    if (existingCode) {
      let counter = 1;
      let codeExists = true;
      while (codeExists) {
        newCode = code.substring(0, 2) + counter + '0';
        const existing = await prisma.chartOfAccount.findFirst({
          where: { code: newCode, createdBy: userId }
        });
        if (!existing) {
          codeExists = false;
        }
        counter++;
      }
    }

    account = await prisma.chartOfAccount.create({
      data: {
        code: newCode,
        name: isGain ? 'Gain on Disposal' : 'Loss on Disposal',
        type: isGain ? 'Income' : 'Expenses',
        parentAccount: isGain ? 'Other Income' : 'Other Expenses',
        openingBalance: 0,
        currentBalance: 0,
        description: isGain ? 'Gain on asset disposal' : 'Loss on asset disposal',
        taxCode: 'N/A',
        balanceType: isGain ? 'Credit' : 'Debit',
        isActive: true,
        createdBy: userId
      }
    });
    console.log(`✅ [FA] ${isGain ? 'Gain' : 'Loss'} account created`);
  }
  return account;
}

// Helper: Validate Supplier (returns null if not found instead of throwing)
async function validateSupplier(supplierId, userId) {
  if (!supplierId || supplierId === 'null' || supplierId.trim() === '') {
    return null;
  }
  
  console.log(`🔍 [FA] Validating supplier: ${supplierId}`);
  const supplier = await prisma.supplier.findFirst({
    where: {
      id: supplierId,
      createdBy: userId
    }
  });

  if (!supplier) {
    console.log('⚠️ [FA] Supplier not found, returning null');
    return null;
  }
  console.log(`✅ [FA] Supplier found: ${supplier.name}`);
  return supplier;
}

// ============================================================
// @desc    Create a new fixed asset
// @route   POST /api/fixed-assets
// @access  Private
// ============================================================
exports.createFixedAsset = async (req, res) => {
  console.log('📦 [FA] createFixedAsset called');
  console.log('🔍 [FA] Request body:', JSON.stringify(req.body, null, 2));

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

    const userId = req.user.id;
    console.log('👤 [FA] User ID:', userId);

    // ─── 1. Validate Supplier (only if provided) ──────────────────
    let supplierName = '';
    let finalSupplierId = null;
    
    if (supplierId && supplierId !== 'null' && supplierId.trim() !== '') {
      const supplier = await validateSupplier(supplierId, userId);
      if (supplier) {
        supplierName = supplier.name;
        finalSupplierId = supplier.id;
        console.log(`✅ [FA] Supplier found: ${supplierName}`);
      } else {
        console.log('⚠️ [FA] Supplier not found, creating asset without supplier');
      }
    } else {
      console.log('ℹ️ [FA] No supplier provided, creating asset without supplier');
    }

    // ─── 2. Create Fixed Asset ──────────────────────────────────
    const fixedAsset = await FixedAssetModel.create({
      name,
      category,
      purchaseDate: new Date(purchaseDate),
      purchaseCost: parseFloat(purchaseCost),
      usefulLife: parseInt(usefulLife),
      salvageValue: parseFloat(salvageValue || 0),
      depreciationMethod: depreciationMethod || 'Straight Line',
      location: location || '',
      supplierId: finalSupplierId,
      supplierName: supplierName,
      warrantyExpiry: warrantyExpiry ? new Date(warrantyExpiry) : null,
      notes: notes || '',
      createdBy: userId
    });

    console.log(`✅ [FA] Fixed asset created: ${fixedAsset.assetCode}`);

    // ─── 3. Create Journal Entry ──────────────────────────────
    const assetAccount = await getOrCreateFixedAssetAccount(userId);
    const cashAccount = await getOrCreateCashAccount(userId);

    console.log('📝 [FA] Creating journal entry...');

    await prisma.journalEntry.create({
      data: {
        entryNumber: `JE-${Date.now()}`,
        date: new Date(purchaseDate),
        description: `Purchase of fixed asset: ${name} (${fixedAsset.assetCode})`,
        reference: fixedAsset.assetCode,
        status: 'Posted',
        createdBy: userId,
        postedBy: userId,
        postedAt: new Date(),
        lines: {
          create: [
            {
              accountId: assetAccount.id,
              accountName: assetAccount.name,
              accountCode: assetAccount.code,
              debit: parseFloat(purchaseCost),
              credit: 0,
              isReconciled: false
            },
            {
              accountId: cashAccount.id,
              accountName: cashAccount.name,
              accountCode: cashAccount.code,
              debit: 0,
              credit: parseFloat(purchaseCost),
              isReconciled: false
            }
          ]
        }
      }
    });

    console.log('✅ [FA] Journal entry created');

    res.status(201).json({
      success: true,
      data: fixedAsset,
      message: 'Fixed asset created successfully',
    });
  } catch (error) {
    console.error('❌ [FA] Create fixed asset error:', error);
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

// ============================================================
// @desc    Get all fixed assets
// @route   GET /api/fixed-assets
// @access  Private
// ============================================================
exports.getFixedAssets = async (req, res) => {
  console.log('📦 [FA] getFixedAssets called');
  console.log('🔍 [FA] Query params:', req.query);

  try {
    const { category, status, search } = req.query;
    const userId = req.user.id;
    console.log('👤 [FA] User ID:', userId);

    const filter = { createdBy: userId };

    if (category) {
      filter.category = category;
    }

    if (status) {
      filter.status = status;
    }

    if (search) {
      filter.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { assetCode: { contains: search, mode: 'insensitive' } },
        { category: { contains: search, mode: 'insensitive' } }
      ];
    }

    const assets = await FixedAssetModel.findAll(filter);

    console.log(`✅ [FA] Found ${assets.length} fixed assets`);

    res.status(200).json({
      success: true,
      count: assets.length,
      data: assets,
    });
  } catch (error) {
    console.error('❌ [FA] Get fixed assets error:', error);
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

// ============================================================
// @desc    Get single fixed asset
// @route   GET /api/fixed-assets/:id
// @access  Private
// ============================================================
exports.getFixedAsset = async (req, res) => {
  console.log('📦 [FA] getFixedAsset called');
  console.log('🔍 [FA] Asset ID:', req.params.id);

  try {
    const { id } = req.params;
    const userId = req.user.id;

    const asset = await prisma.fixedAsset.findFirst({
      where: {
        id,
        createdBy: userId
      },
      include: {
        supplier: {
          select: {
            id: true,
            name: true,
            email: true,
            phone: true,
            address: true
          }
        },
        creator: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true
          }
        }
      }
    });

    if (!asset) {
      console.log('❌ [FA] Fixed asset not found:', id);
      return res.status(404).json({
        success: false,
        message: 'Fixed asset not found',
      });
    }

    console.log(`✅ [FA] Fixed asset found: ${asset.assetCode}`);

    res.status(200).json({
      success: true,
      data: asset,
    });
  } catch (error) {
    console.error('❌ [FA] Get fixed asset error:', error);
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

// ============================================================
// @desc    Update fixed asset
// @route   PUT /api/fixed-assets/:id
// @access  Private
// ============================================================
exports.updateFixedAsset = async (req, res) => {
  console.log('📦 [FA] updateFixedAsset called');
  console.log('🔍 [FA] Asset ID:', req.params.id);

  try {
    const { id } = req.params;
    const userId = req.user.id;
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

    // ─── Check if asset exists ──────────────────────────────
    const existingAsset = await prisma.fixedAsset.findFirst({
      where: {
        id,
        createdBy: userId
      }
    });

    if (!existingAsset) {
      console.log('❌ [FA] Fixed asset not found:', id);
      return res.status(404).json({
        success: false,
        message: 'Fixed asset not found',
      });
    }

    // ─── Validate Supplier ──────────────────────────────────
    let supplierName = existingAsset.supplierName;
    let finalSupplierId = existingAsset.supplierId;
    
    if (supplierId && supplierId !== 'null' && supplierId.trim() !== '') {
      const supplier = await validateSupplier(supplierId, userId);
      if (supplier) {
        supplierName = supplier.name;
        finalSupplierId = supplier.id;
      }
    } else if (supplierId === 'null' || supplierId === '') {
      finalSupplierId = null;
      supplierName = '';
    }

    // ─── Update Asset ──────────────────────────────────────────
    const updatedAsset = await FixedAssetModel.update(id, {
      name: name || existingAsset.name,
      category: category || existingAsset.category,
      purchaseDate: purchaseDate ? new Date(purchaseDate) : existingAsset.purchaseDate,
      purchaseCost: purchaseCost ? parseFloat(purchaseCost) : existingAsset.purchaseCost,
      usefulLife: usefulLife ? parseInt(usefulLife) : existingAsset.usefulLife,
      salvageValue: salvageValue !== undefined ? parseFloat(salvageValue) : existingAsset.salvageValue,
      location: location !== undefined ? location : existingAsset.location,
      supplierId: finalSupplierId,
      supplierName: supplierName,
      warrantyExpiry: warrantyExpiry ? new Date(warrantyExpiry) : existingAsset.warrantyExpiry,
      notes: notes !== undefined ? notes : existingAsset.notes
    });

    console.log(`✅ [FA] Fixed asset updated: ${updatedAsset.assetCode}`);

    res.status(200).json({
      success: true,
      data: updatedAsset,
      message: 'Fixed asset updated successfully',
    });
  } catch (error) {
    console.error('❌ [FA] Update fixed asset error:', error);
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

// ============================================================
// @desc    Run depreciation for a single asset
// @route   POST /api/fixed-assets/depreciate
// @access  Private
// ============================================================
exports.runDepreciation = async (req, res) => {
  console.log('📦 [FA] runDepreciation called');
  console.log('🔍 [FA] Request body:', JSON.stringify(req.body, null, 2));

  try {
    const { assetId, depreciationDate } = req.body;
    const userId = req.user.id;
    const date = depreciationDate ? new Date(depreciationDate) : new Date();

    // ─── Check if asset exists ──────────────────────────────
    const asset = await prisma.fixedAsset.findFirst({
      where: {
        id: assetId,
        createdBy: userId
      }
    });

    if (!asset) {
      console.log('❌ [FA] Fixed asset not found:', assetId);
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

    // ─── Run Depreciation ──────────────────────────────────
    const result = await FixedAssetModel.runDepreciation(assetId, date);

    // ─── Create Journal Entry ──────────────────────────────
    const depExpAccount = await getOrCreateDepreciationExpenseAccount(userId);
    const accDepAccount = await getOrCreateAccumulatedDepreciationAccount(userId);

    await prisma.journalEntry.create({
      data: {
        entryNumber: `JE-${Date.now()}`,
        date: date,
        description: `Depreciation for ${asset.name} (${asset.assetCode})`,
        reference: asset.assetCode,
        status: 'Posted',
        createdBy: userId,
        postedBy: userId,
        postedAt: new Date(),
        lines: {
          create: [
            {
              accountId: depExpAccount.id,
              accountName: depExpAccount.name,
              accountCode: depExpAccount.code,
              debit: result.amount,
              credit: 0,
              isReconciled: false
            },
            {
              accountId: accDepAccount.id,
              accountName: accDepAccount.name,
              accountCode: accDepAccount.code,
              debit: 0,
              credit: result.amount,
              isReconciled: false
            }
          ]
        }
      }
    });

    console.log(`✅ [FA] Depreciation recorded: ${result.amount}`);

    res.status(200).json({
      success: true,
      data: {
        asset: {
          id: result.asset.id,
          name: result.asset.name,
          assetCode: result.asset.assetCode,
          depreciationAmount: result.amount,
          accumulatedDepreciation: result.accumulatedDepreciation,
          netBookValue: result.netBookValue,
          status: result.status,
        },
      },
      message: `Depreciation of ${result.amount} recorded successfully`,
    });
  } catch (error) {
    console.error('❌ [FA] Run depreciation error:', error);
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

// ============================================================
// @desc    Run monthly depreciation for all assets
// @route   POST /api/fixed-assets/depreciate-all
// @access  Private
// ============================================================
exports.runMonthlyDepreciation = async (req, res) => {
  console.log('📦 [FA] runMonthlyDepreciation called');

  try {
    const { depreciationDate } = req.body;
    const userId = req.user.id;
    const date = depreciationDate ? new Date(depreciationDate) : new Date();

    // ─── Get active assets ──────────────────────────────────
    const assets = await prisma.fixedAsset.findMany({
      where: {
        createdBy: userId,
        status: { in: ['Active', 'Fully Depreciated'] },
        OR: [
          { lastDepreciationDate: null },
          { lastDepreciationDate: { lt: date } }
        ]
      }
    });

    const results = [];
    for (const asset of assets) {
      if (asset.status !== 'Fully Depreciated') {
        const result = await FixedAssetModel.runDepreciation(asset.id, date);
        results.push({
          assetId: result.asset.id,
          assetCode: result.asset.assetCode,
          name: result.asset.name,
          depreciationAmount: result.amount,
          accumulatedDepreciation: result.accumulatedDepreciation,
          netBookValue: result.netBookValue,
          status: result.status,
        });
      }
    }

    console.log(`✅ [FA] Depreciation processed for ${results.length} assets`);

    res.status(200).json({
      success: true,
      data: {
        processed: results.length,
        details: results,
      },
      message: `Depreciation processed for ${results.length} assets`,
    });
  } catch (error) {
    console.error('❌ [FA] Run monthly depreciation error:', error);
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

// ============================================================
// @desc    Dispose fixed asset
// @route   POST /api/fixed-assets/dispose
// @access  Private
// ============================================================
exports.disposeFixedAsset = async (req, res) => {
  console.log('📦 [FA] disposeFixedAsset called');
  console.log('🔍 [FA] Request body:', JSON.stringify(req.body, null, 2));

  try {
    const { assetId, disposalDate, disposalAmount, disposalReason } = req.body;
    const userId = req.user.id;

    // ─── Check if asset exists ──────────────────────────────
    const asset = await prisma.fixedAsset.findFirst({
      where: {
        id: assetId,
        createdBy: userId
      }
    });

    if (!asset) {
      console.log('❌ [FA] Fixed asset not found:', assetId);
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

    // ─── Calculate gain/loss ──────────────────────────────────
    const disposalAmt = parseFloat(disposalAmount || 0);
    const gainLoss = disposalAmt - asset.netBookValue;

    // ─── Dispose Asset ──────────────────────────────────────────
    const result = await FixedAssetModel.dispose(assetId, {
      disposalDate: disposalDate ? new Date(disposalDate) : new Date(),
      disposalAmount: disposalAmt,
      disposalReason: disposalReason || ''
    });

    // ─── Create Journal Entry ──────────────────────────────────
    const assetAccount = await getOrCreateFixedAssetAccount(userId);
    const accDepAccount = await getOrCreateAccumulatedDepreciationAccount(userId);
    const cashAccount = await getOrCreateCashAccount(userId);
    const gainLossAccount = await getOrCreateGainLossAccount(userId, gainLoss >= 0);

    // ─── Build journal lines ──────────────────────────────────
    const journalLines = [
      {
        accountId: accDepAccount.id,
        accountName: accDepAccount.name,
        accountCode: accDepAccount.code,
        debit: asset.accumulatedDepreciation,
        credit: 0,
        isReconciled: false
      },
      {
        accountId: assetAccount.id,
        accountName: assetAccount.name,
        accountCode: assetAccount.code,
        debit: 0,
        credit: asset.purchaseCost,
        isReconciled: false
      }
    ];

    if (disposalAmt > 0) {
      journalLines.push({
        accountId: cashAccount.id,
        accountName: cashAccount.name,
        accountCode: cashAccount.code,
        debit: disposalAmt,
        credit: 0,
        isReconciled: false
      });
    }

    if (gainLoss !== 0) {
      if (gainLoss > 0) {
        journalLines.push({
          accountId: gainLossAccount.id,
          accountName: gainLossAccount.name,
          accountCode: gainLossAccount.code,
          debit: 0,
          credit: gainLoss,
          isReconciled: false
        });
      } else {
        journalLines.push({
          accountId: gainLossAccount.id,
          accountName: gainLossAccount.name,
          accountCode: gainLossAccount.code,
          debit: Math.abs(gainLoss),
          credit: 0,
          isReconciled: false
        });
      }
    }

    await prisma.journalEntry.create({
      data: {
        entryNumber: `JE-${Date.now()}`,
        date: disposalDate ? new Date(disposalDate) : new Date(),
        description: `Disposal of ${asset.name} (${asset.assetCode})`,
        reference: asset.assetCode,
        status: 'Posted',
        createdBy: userId,
        postedBy: userId,
        postedAt: new Date(),
        lines: {
          create: journalLines
        }
      }
    });

    console.log(`✅ [FA] Asset disposed: ${asset.assetCode}`);

    res.status(200).json({
      success: true,
      data: {
        asset: {
          id: result.asset.id,
          name: result.asset.name,
          assetCode: result.asset.assetCode,
          netBookValue: asset.netBookValue,
          disposalAmount: disposalAmt,
          gainLoss: gainLoss,
          status: result.asset.status,
        },
      },
      message: `Asset disposed successfully. ${gainLoss >= 0 ? 'Gain' : 'Loss'} of ${Math.abs(gainLoss)} recorded`,
    });
  } catch (error) {
    console.error('❌ [FA] Dispose fixed asset error:', error);
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

// ============================================================
// @desc    Get fixed asset summary
// @route   GET /api/fixed-assets/summary
// @access  Private
// ============================================================
exports.getSummary = async (req, res) => {
  console.log('📦 [FA] getSummary called');

  try {
    const userId = req.user.id;

    const stats = await FixedAssetModel.getStats(userId);

    console.log('✅ [FA] Summary generated');

    res.status(200).json({
      success: true,
      data: stats,
    });
  } catch (error) {
    console.error('❌ [FA] Get summary error:', error);
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

// ============================================================
// @desc    Delete fixed asset
// @route   DELETE /api/fixed-assets/:id
// @access  Private
// ============================================================
exports.deleteFixedAsset = async (req, res) => {
  console.log('📦 [FA] deleteFixedAsset called');
  console.log('🔍 [FA] Asset ID:', req.params.id);

  try {
    const { id } = req.params;
    const userId = req.user.id;

    // ─── Check if asset exists ──────────────────────────────
    const asset = await prisma.fixedAsset.findFirst({
      where: {
        id,
        createdBy: userId
      }
    });

    if (!asset) {
      console.log('❌ [FA] Fixed asset not found:', id);
      return res.status(404).json({
        success: false,
        message: 'Fixed asset not found',
      });
    }

    // ─── Check if can delete ──────────────────────────────────
    if (asset.status === 'Active' && asset.accumulatedDepreciation > 0) {
      return res.status(400).json({
        success: false,
        message: 'Cannot delete asset with accumulated depreciation',
      });
    }

    // ─── Delete Asset ──────────────────────────────────────────
    await FixedAssetModel.delete(id);

    console.log(`✅ [FA] Fixed asset deleted: ${asset.assetCode}`);

    res.status(200).json({
      success: true,
      message: 'Fixed asset deleted successfully',
    });
  } catch (error) {
    console.error('❌ [FA] Delete fixed asset error:', error);
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};