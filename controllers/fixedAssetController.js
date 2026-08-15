const prisma = require('../prisma/client');
const FixedAssetModel = require('../models/FixedAsset');
const { fiscalYearGuard } = require('../middleware/fiscalYearMiddleware');
const { resolveFiscalYearId } = require('../utils/fiscalYearHelper');
const { getOrCreateCashAccount } = require('../utils/cashAccountHelper');
const { getOrCreateApAccount } = require('../utils/apAccountHelper');
// ============================================================
// HELPER FUNCTIONS
// ============================================================

// Helper: Get or create Fixed Asset account
async function getOrCreateFixedAssetAccount(userId, companyId) {
  console.log('🔍 [FA] Getting/Creating Fixed Asset account');
  let assetAccount = await prisma.chartOfAccount.findFirst({
    where: {
      code: '1500',
      companyId: companyId
    }
  });

  if (!assetAccount) {
    console.log('📝 [FA] Creating new Fixed Asset account');
    const existingCode = await prisma.chartOfAccount.findFirst({
      where: { code: '1500', companyId: companyId }
    });
    
    let newCode = '1500';
    if (existingCode) {
      let counter = 1;
      let codeExists = true;
      while (codeExists) {
        newCode = `15${counter}0`;
        const existing = await prisma.chartOfAccount.findFirst({
          where: { code: newCode, companyId: companyId }
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
        createdBy: userId,
        companyId: companyId
      }
    });
    console.log('✅ [FA] Fixed Asset account created');
  }
  return assetAccount;
}

// Helper: Get or create Accumulated Depreciation account
async function getOrCreateAccumulatedDepreciationAccount(userId, companyId) {
  console.log('🔍 [FA] Getting/Creating Accumulated Depreciation account');
  let accDepAccount = await prisma.chartOfAccount.findFirst({
    where: {
      code: '1510',
      companyId: companyId
    }
  });

  if (!accDepAccount) {
    console.log('📝 [FA] Creating new Accumulated Depreciation account');
    const existingCode = await prisma.chartOfAccount.findFirst({
      where: { code: '1510', companyId: companyId }
    });
    
    let newCode = '1510';
    if (existingCode) {
      let counter = 1;
      let codeExists = true;
      while (codeExists) {
        newCode = `151${counter}`;
        const existing = await prisma.chartOfAccount.findFirst({
          where: { code: newCode, companyId: companyId }
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
        createdBy: userId,
        companyId: companyId
      }
    });
    console.log('✅ [FA] Accumulated Depreciation account created');
  }
  return accDepAccount;
}

// Helper: Get or create Depreciation Expense account (default COA uses 6700)
async function getOrCreateDepreciationExpenseAccount(userId, companyId) {
  console.log('🔍 [FA] Getting/Creating Depreciation Expense account');
  let depExpAccount = await prisma.chartOfAccount.findFirst({
    where: {
      companyId: companyId,
      OR: [
        { code: '6700' },
        { name: { equals: 'Depreciation Expense', mode: 'insensitive' } },
      ]
    }
  });

  if (!depExpAccount) {
    console.log('📝 [FA] Creating new Depreciation Expense account');
    depExpAccount = await prisma.chartOfAccount.create({
      data: {
        code: '6700',
        name: 'Depreciation Expense',
        type: 'Expenses',
        parentAccount: 'Operating Expenses',
        openingBalance: 0,
        currentBalance: 0,
        description: 'Depreciation expense on fixed assets',
        taxCode: 'N/A',
        balanceType: 'Debit',
        isActive: true,
        createdBy: userId,
        companyId: companyId
      }
    });
    console.log('✅ [FA] Depreciation Expense account created');
  }
  return depExpAccount;
}

async function getOrCreatePayableAccount(userId, companyId) {
  return getOrCreateApAccount(userId, companyId);
}

// Helper: Get or create Opening Balance Equity account
async function getOrCreateOpeningBalanceEquity(userId, companyId) {
  let equityAccount = await prisma.chartOfAccount.findFirst({
    where: {
      companyId: companyId,
      OR: [
        { code: '3000' },
        { name: { contains: 'Opening Balance Equity', mode: 'insensitive' } },
      ]
    }
  });

  if (!equityAccount) {
    equityAccount = await prisma.chartOfAccount.create({
      data: {
        code: '3000',
        name: 'Opening Balance Equity',
        type: 'Equity',
        parentAccount: 'Equity',
        openingBalance: 0,
        currentBalance: 0,
        description: 'Opening balance equity account',
        taxCode: 'N/A',
        balanceType: 'Credit',
        isActive: true,
        createdBy: userId,
        companyId: companyId
      }
    });
  }
  return equityAccount;
}

function journalLine(account, debit, credit) {
  return {
    accountId: account.id,
    accountName: account.name,
    accountCode: account.code,
    debit,
    credit,
    isReconciled: false
  };
}

async function postDepreciationJournal({
  userId,
  companyId,
  asset,
  amount,
  date
}) {
  if (!amount || amount <= 0) return null;
  const depExpAccount = await getOrCreateDepreciationExpenseAccount(userId, companyId);
  const accDepAccount = await getOrCreateAccumulatedDepreciationAccount(userId, companyId);

  await prisma.chartOfAccount.update({
    where: { id: depExpAccount.id },
    data: { currentBalance: { increment: amount } }
  });
  await prisma.chartOfAccount.update({
    where: { id: accDepAccount.id },
    data: { currentBalance: { increment: amount } }
  });

  return prisma.journalEntry.create({
    data: {
      entryNumber: `JE-${Date.now()}-${Math.floor(Math.random() * 999)}`,
      date,
      description: `Depreciation for ${asset.name} (${asset.assetCode})`,
      reference: asset.assetCode,
      status: 'Posted',
      createdBy: userId,
      postedBy: userId,
      postedAt: new Date(),
      companyId,
      lines: {
        create: [
          journalLine(depExpAccount, amount, 0),
          journalLine(accDepAccount, 0, amount)
        ]
      }
    }
  });
}

function isAcquisitionJournal(je) {
  const d = je.description || '';
  if (/^reversal of/i.test(d)) return false;
  if (/depreciation/i.test(d)) return false;
  if (/dispos/i.test(d)) return false;
  return true;
}

async function reverseAcquisitionJournals(asset, userId, companyId) {
  const journals = await prisma.journalEntry.findMany({
    where: {
      companyId,
      status: 'Posted',
      reference: asset.assetCode
    },
    include: { lines: true }
  });

  for (const je of journals.filter(isAcquisitionJournal)) {
    await prisma.journalEntry.create({
      data: {
        entryNumber: `JE-${Date.now()}-${Math.floor(Math.random() * 999)}`,
        date: asset.purchaseDate || new Date(),
        description: `Reversal of ${je.entryNumber} (${asset.assetCode})`,
        reference: asset.assetCode,
        status: 'Posted',
        createdBy: userId,
        postedBy: userId,
        postedAt: new Date(),
        fiscalYearId: je.fiscalYearId || asset.fiscalYearId || null,
        companyId,
        lines: {
          create: je.lines.map((line) => ({
            accountId: line.accountId,
            accountName: line.accountName,
            accountCode: line.accountCode,
            debit: line.credit,
            credit: line.debit,
            isReconciled: false
          }))
        }
      }
    });
  }
}

async function reverseAcquisitionBalances(asset, userId, companyId) {
  const cost = Number(asset.purchaseCost) || 0;
  if (cost <= 0) return;

  const openingAccDep = Number(asset.openingAccumulatedDepreciation) || 0;
  const acquisitionType = asset.acquisitionType || 'purchase';
  const paymentMethod = asset.paymentMethod || 'Cash';
  const assetAccount = await getOrCreateFixedAssetAccount(userId, companyId);

  if (acquisitionType === 'opening_balance') {
    const equityAccount = await getOrCreateOpeningBalanceEquity(userId, companyId);
    const accDepAccount = await getOrCreateAccumulatedDepreciationAccount(userId, companyId);
    const netBook = Math.max(0, cost - openingAccDep);

    await prisma.chartOfAccount.update({
      where: { id: assetAccount.id },
      data: { currentBalance: { decrement: cost } }
    });
    if (openingAccDep > 0) {
      await prisma.chartOfAccount.update({
        where: { id: accDepAccount.id },
        data: { currentBalance: { decrement: openingAccDep } }
      });
    }
    await prisma.chartOfAccount.update({
      where: { id: equityAccount.id },
      data: { currentBalance: { decrement: netBook } }
    });
    return;
  }

  if (paymentMethod === 'Bank' && asset.bankAccountId) {
    const bankAccountData = await prisma.bankAccount.findFirst({
      where: { id: asset.bankAccountId, companyId },
      include: { chartOfAccount: true }
    });
    if (bankAccountData) {
      await prisma.bankAccount.update({
        where: { id: asset.bankAccountId },
        data: { currentBalance: { increment: cost } }
      });
      if (bankAccountData.chartOfAccountId) {
        await prisma.chartOfAccount.update({
          where: { id: bankAccountData.chartOfAccountId },
          data: { currentBalance: { increment: cost } }
        });
      }
    }
    await prisma.chartOfAccount.update({
      where: { id: assetAccount.id },
      data: { currentBalance: { decrement: cost } }
    });
    return;
  }

  if (paymentMethod === 'Credit') {
    const payableAccount = await getOrCreatePayableAccount(userId, companyId);
    await prisma.chartOfAccount.update({
      where: { id: assetAccount.id },
      data: { currentBalance: { decrement: cost } }
    });
    await prisma.chartOfAccount.update({
      where: { id: payableAccount.id },
      data: { currentBalance: { decrement: cost } }
    });
    return;
  }

  const cashAccount = await getOrCreateCashAccount(userId, companyId);
  await prisma.chartOfAccount.update({
    where: { id: assetAccount.id },
    data: { currentBalance: { decrement: cost } }
  });
  await prisma.chartOfAccount.update({
    where: { id: cashAccount.id },
    data: { currentBalance: { increment: cost } }
  });
}

async function postAcquisitionAccounting({
  userId,
  companyId,
  asset,
  cost,
  openingAccDep = 0,
  postingDate,
  fiscalYearId,
  bankAccountData = null
}) {
  const assetAccount = await getOrCreateFixedAssetAccount(userId, companyId);
  const lines = [];
  let creditAccount = null;
  let description = '';
  const acquisitionType = asset.acquisitionType || 'purchase';
  const paymentMethod = asset.paymentMethod || 'Cash';
  const name = asset.name;
  const code = asset.assetCode;

  if (acquisitionType === 'opening_balance') {
    const equityAccount = await getOrCreateOpeningBalanceEquity(userId, companyId);
    const accDepAccount = await getOrCreateAccumulatedDepreciationAccount(userId, companyId);
    const netBook = Math.max(0, cost - openingAccDep);

    lines.push(journalLine(assetAccount, cost, 0));
    if (openingAccDep > 0) {
      lines.push(journalLine(accDepAccount, 0, openingAccDep));
    }
    lines.push(journalLine(equityAccount, 0, netBook));
    creditAccount = equityAccount;
    description = `Opening balance fixed asset: ${name} (${code})`;

    await prisma.chartOfAccount.update({
      where: { id: assetAccount.id },
      data: { currentBalance: { increment: cost } }
    });
    if (openingAccDep > 0) {
      await prisma.chartOfAccount.update({
        where: { id: accDepAccount.id },
        data: { currentBalance: { increment: openingAccDep } }
      });
    }
    await prisma.chartOfAccount.update({
      where: { id: equityAccount.id },
      data: { currentBalance: { increment: netBook } }
    });
  } else if (paymentMethod === 'Bank' && bankAccountData) {
    creditAccount = bankAccountData.chartOfAccount;
    lines.push(journalLine(assetAccount, cost, 0));
    lines.push(journalLine(creditAccount, 0, cost));
    description = `Purchase of fixed asset via bank: ${name} (${code})`;

    await prisma.bankAccount.update({
      where: { id: bankAccountData.id },
      data: { currentBalance: { decrement: cost } }
    });
    await prisma.chartOfAccount.update({
      where: { id: creditAccount.id },
      data: { currentBalance: { decrement: cost } }
    });
    await prisma.chartOfAccount.update({
      where: { id: assetAccount.id },
      data: { currentBalance: { increment: cost } }
    });
  } else if (paymentMethod === 'Credit') {
    creditAccount = await getOrCreatePayableAccount(userId, companyId);
    lines.push(journalLine(assetAccount, cost, 0));
    lines.push(journalLine(creditAccount, 0, cost));
    description = `Credit purchase of fixed asset: ${name} (${code})`;

    await prisma.chartOfAccount.update({
      where: { id: assetAccount.id },
      data: { currentBalance: { increment: cost } }
    });
    await prisma.chartOfAccount.update({
      where: { id: creditAccount.id },
      data: { currentBalance: { increment: cost } }
    });
  } else {
    creditAccount = await getOrCreateCashAccount(userId, companyId);
    lines.push(journalLine(assetAccount, cost, 0));
    lines.push(journalLine(creditAccount, 0, cost));
    description = `Cash purchase of fixed asset: ${name} (${code})`;

    await prisma.chartOfAccount.update({
      where: { id: assetAccount.id },
      data: { currentBalance: { increment: cost } }
    });
    await prisma.chartOfAccount.update({
      where: { id: creditAccount.id },
      data: { currentBalance: { decrement: cost } }
    });
  }

  await prisma.journalEntry.create({
    data: {
      entryNumber: `JE-${Date.now()}`,
      date: postingDate,
      description,
      reference: code,
      status: 'Posted',
      createdBy: userId,
      postedBy: userId,
      postedAt: new Date(),
      fiscalYearId,
      companyId,
      lines: { create: lines }
    }
  });
}

// Helper: Get or create Gain/Loss account
async function getOrCreateGainLossAccount(userId, companyId, isGain) {
  const code = isGain ? '5100' : '5200';
  console.log(`🔍 [FA] Getting/Creating ${isGain ? 'Gain' : 'Loss'} account`);
  
  let account = await prisma.chartOfAccount.findFirst({
    where: {
      code: code,
      companyId: companyId
    }
  });

  if (!account) {
    const existingCode = await prisma.chartOfAccount.findFirst({
      where: { code: code, companyId: companyId }
    });
    
    let newCode = code;
    if (existingCode) {
      let counter = 1;
      let codeExists = true;
      while (codeExists) {
        newCode = code.substring(0, 2) + counter + '0';
        const existing = await prisma.chartOfAccount.findFirst({
          where: { code: newCode, companyId: companyId }
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
        createdBy: userId,
        companyId: companyId
      }
    });
    console.log(`✅ [FA] ${isGain ? 'Gain' : 'Loss'} account created`);
  }
  return account;
}

// Helper: Validate Supplier (returns null if not found instead of throwing)
async function validateSupplier(supplierId, userId, companyId) {
  if (!supplierId || supplierId === 'null' || supplierId.trim() === '') {
    return null;
  }
  
  console.log(`🔍 [FA] Validating supplier: ${supplierId}`);
  const supplier = await prisma.supplier.findFirst({
    where: {
      id: supplierId,
      companyId: companyId
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
      acquisitionType: rawAcquisitionType,
      paymentMethod: rawPaymentMethod,
      bankAccountId,
      openingAccumulatedDepreciation
    } = req.body;

    const userId = req.user.id;
    const companyId = req.user.companyId;
    const postingDate = purchaseDate ? new Date(purchaseDate) : new Date();
    const cost = parseFloat(purchaseCost);
    const openingAccDep = Math.max(0, parseFloat(openingAccumulatedDepreciation || 0));

    let acquisitionType = String(rawAcquisitionType || 'purchase').toLowerCase();
    if (acquisitionType === 'opening' || acquisitionType === 'existing') {
      acquisitionType = 'opening_balance';
    }
    if (!['purchase', 'opening_balance'].includes(acquisitionType)) {
      acquisitionType = 'purchase';
    }

    let paymentMethod = String(rawPaymentMethod || 'Cash');
    if (acquisitionType === 'opening_balance') {
      paymentMethod = 'Opening Balance';
    } else {
      const normalized = paymentMethod.toLowerCase();
      if (normalized === 'bank' || normalized === 'bank transfer') paymentMethod = 'Bank';
      else if (normalized === 'credit' || normalized === 'on credit' || normalized === 'accounts payable') {
        paymentMethod = 'Credit';
      } else {
        paymentMethod = 'Cash';
      }
    }

    if (!name || !category || !purchaseDate || !cost || cost <= 0) {
      return res.status(400).json({
        success: false,
        message: 'Name, category, purchase date and a valid purchase cost are required'
      });
    }

    if (openingAccDep > cost) {
      return res.status(400).json({
        success: false,
        message: 'Opening accumulated depreciation cannot exceed purchase cost'
      });
    }

    // ─── Fiscal Year Guard ────────────────────────────────────────
    try {
      await fiscalYearGuard(userId, postingDate);
    } catch (err) {
      if (err.code === 'FISCAL_YEAR_CLOSED') {
        return res.status(400).json({ success: false, message: err.message });
      }
      throw err;
    }

    const fiscalYearId = await resolveFiscalYearId(userId, postingDate);

    // ─── Supplier ─────────────────────────────────────────────────
    let supplierName = '';
    let finalSupplierId = null;

    if (supplierId && supplierId !== 'null' && String(supplierId).trim() !== '') {
      const supplier = await validateSupplier(supplierId, userId, companyId);
      if (supplier) {
        supplierName = supplier.name;
        finalSupplierId = supplier.id;
      }
    }

    if (paymentMethod === 'Credit' && !finalSupplierId) {
      return res.status(400).json({
        success: false,
        message: 'Supplier is required for credit purchases'
      });
    }

    // ─── Bank account (required for Bank) ─────────────────────────
    let bankAccountData = null;
    let finalBankAccountId = null;
    const rawBankId =
      bankAccountId !== null && bankAccountId !== undefined
        ? String(bankAccountId).trim()
        : '';

    if (paymentMethod === 'Bank') {
      if (!rawBankId || rawBankId === 'null') {
        return res.status(400).json({
          success: false,
          message: 'Bank account is required when payment method is Bank'
        });
      }
      bankAccountData = await prisma.bankAccount.findFirst({
        where: { id: rawBankId, companyId },
        include: { chartOfAccount: true }
      });
      if (!bankAccountData || !bankAccountData.chartOfAccount) {
        return res.status(404).json({
          success: false,
          message: 'Selected bank account not found'
        });
      }
      finalBankAccountId = bankAccountData.id;
    }

    // ─── Create Fixed Asset ───────────────────────────────────────
    const fixedAsset = await FixedAssetModel.create({
      name,
      category,
      purchaseDate: new Date(purchaseDate),
      purchaseCost: cost,
      usefulLife: parseInt(usefulLife),
      salvageValue: parseFloat(salvageValue || 0),
      depreciationMethod: depreciationMethod || 'Straight Line',
      location: location || '',
      supplierId: finalSupplierId,
      supplierName,
      acquisitionType,
      paymentMethod,
      bankAccountId: finalBankAccountId,
      openingAccumulatedDepreciation: acquisitionType === 'opening_balance' ? openingAccDep : 0,
      warrantyExpiry: warrantyExpiry ? new Date(warrantyExpiry) : null,
      notes: notes || '',
      createdBy: userId,
      companyId,
      fiscalYearId
    });

    console.log(`✅ [FA] Fixed asset created: ${fixedAsset.assetCode}`);

    await postAcquisitionAccounting({
      userId,
      companyId,
      asset: fixedAsset,
      cost,
      openingAccDep: acquisitionType === 'opening_balance' ? openingAccDep : 0,
      postingDate,
      fiscalYearId,
      bankAccountData
    });

    console.log('✅ [FA] Journal entry created');

res.status(201).json({
      success: true,
      data: fixedAsset,
      message: 'Fixed asset created successfully'
    });
  } catch (error) {
    console.error('❌ [FA] Create fixed asset error:', error);
    res.status(500).json({
      success: false,
      message: error.message
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
    const companyId = req.user.companyId;
    console.log('👤 [FA] User ID:', userId);

    const filter = { companyId: companyId };

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

    const responseData = {
      count: assets.length,
      data: assets
    };

    res.status(200).json({
      success: true,
      ...responseData
    });
  } catch (error) {
    console.error('❌ [FA] Get fixed assets error:', error);
    res.status(500).json({
      success: false,
      message: error.message
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
    const companyId = req.user.companyId;
    
    const asset = await prisma.fixedAsset.findFirst({
      where: {
        id,
        companyId: companyId
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
        message: 'Fixed asset not found'
      });
    }

    console.log(`✅ [FA] Fixed asset found: ${asset.assetCode}`);

    res.status(200).json({
      success: true,
      data: asset
    });
  } catch (error) {
    console.error('❌ [FA] Get fixed asset error:', error);
    res.status(500).json({
      success: false,
      message: error.message
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
    const companyId = req.user.companyId;
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
      notes
    } = req.body;

    // ─── Check if asset exists ──────────────────────────────
    const existingAsset = await prisma.fixedAsset.findFirst({
      where: {
        id,
        companyId: companyId
      }
    });

    if (!existingAsset) {
      console.log('❌ [FA] Fixed asset not found:', id);
      return res.status(404).json({
        success: false,
        message: 'Fixed asset not found'
      });
    }

    // ─── Fiscal Year Guard (Req 5) ────────────────────────────────────────
    const newDate = purchaseDate ? new Date(purchaseDate) : existingAsset.purchaseDate;
    try {
      await fiscalYearGuard(userId, newDate, existingAsset.purchaseDate);
    } catch (err) {
      if (err.code === 'FISCAL_YEAR_CLOSED') {
        return res.status(400).json({ success: false, message: err.message });
      }
      throw err;
    }

    // ─── Validate Supplier ──────────────────────────────────
    let supplierName = existingAsset.supplierName;
    let finalSupplierId = existingAsset.supplierId;
    
    if (supplierId && supplierId !== 'null' && supplierId.trim() !== '') {
      const supplier = await validateSupplier(supplierId, userId, companyId);
      if (supplier) {
        supplierName = supplier.name;
        finalSupplierId = supplier.id;
      }
    } else if (supplierId === 'null' || supplierId === '') {
      finalSupplierId = null;
      supplierName = '';
    }

    const oldCost = Number(existingAsset.purchaseCost) || 0;
    const newCost = purchaseCost !== undefined && purchaseCost !== null && purchaseCost !== ''
      ? parseFloat(purchaseCost)
      : oldCost;
    const newPurchaseDate = purchaseDate ? new Date(purchaseDate) : existingAsset.purchaseDate;
    const newUsefulLife = usefulLife ? parseInt(usefulLife, 10) : existingAsset.usefulLife;
    const newSalvage = salvageValue !== undefined ? parseFloat(salvageValue) : existingAsset.salvageValue;
    const accDep = Number(existingAsset.accumulatedDepreciation) || 0;

    if (newCost + 0.0001 < accDep) {
      return res.status(400).json({
        success: false,
        message: `Purchase cost cannot be below accumulated depreciation (${accDep})`
      });
    }
    if (newCost - (Number(newSalvage) || 0) + 0.0001 < accDep) {
      return res.status(400).json({
        success: false,
        message: 'Salvage value is too high for the remaining depreciable amount after existing depreciation'
      });
    }

    const schedule = FixedAssetModel.scheduleAfterChange(existingAsset, {
      purchaseCost: newCost,
      salvageValue: newSalvage,
      usefulLife: newUsefulLife
    });

    const costChanged = Math.abs(newCost - oldCost) > 0.0001;
    const dateChanged = new Date(newPurchaseDate).getTime() !== new Date(existingAsset.purchaseDate).getTime();
    const needsAccounting = costChanged || dateChanged;

    if (needsAccounting && existingAsset.status === 'Disposed') {
      return res.status(400).json({
        success: false,
        message: 'Cannot change cost or date of a disposed asset'
      });
    }

    // ─── Update Asset ──────────────────────────────────────────
    const updatedAsset = await FixedAssetModel.update(id, {
      name: name || existingAsset.name,
      category: category || existingAsset.category,
      purchaseDate: newPurchaseDate,
      purchaseCost: schedule.purchaseCost,
      usefulLife: schedule.usefulLife,
      salvageValue: schedule.salvageValue,
      location: location !== undefined ? location : existingAsset.location,
      supplierId: finalSupplierId,
      supplierName: supplierName,
      warrantyExpiry: warrantyExpiry ? new Date(warrantyExpiry) : existingAsset.warrantyExpiry,
      notes: notes !== undefined ? notes : existingAsset.notes,
      netBookValue: schedule.netBookValue,
      currentDepreciation: schedule.currentDepreciation,
      accumulatedDepreciation: schedule.accumulatedDepreciation,
      status: schedule.status
    });

    if (needsAccounting) {
      console.log('📝 [FA] Re-posting acquisition for cost/date change', {
        oldCost,
        newCost,
        dateChanged
      });
      await reverseAcquisitionJournals(existingAsset, userId, companyId);
      await reverseAcquisitionBalances(existingAsset, userId, companyId);

      let bankAccountData = null;
      if (existingAsset.paymentMethod === 'Bank' && existingAsset.bankAccountId) {
        bankAccountData = await prisma.bankAccount.findFirst({
          where: { id: existingAsset.bankAccountId, companyId },
          include: { chartOfAccount: true }
        });
      }

      const fiscalYearId = await resolveFiscalYearId(userId, newPurchaseDate);
      await postAcquisitionAccounting({
        userId,
        companyId,
        asset: updatedAsset,
        cost: newCost,
        openingAccDep: Number(existingAsset.openingAccumulatedDepreciation) || 0,
        postingDate: newPurchaseDate,
        fiscalYearId,
        bankAccountData
      });
    }

    console.log(`✅ [FA] Fixed asset updated: ${updatedAsset.assetCode}`);

res.status(200).json({
      success: true,
      data: updatedAsset,
      message: 'Fixed asset updated successfully'
    });
  } catch (error) {
    console.error('❌ [FA] Update fixed asset error:', error);
    res.status(500).json({
      success: false,
      message: error.message
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
    const companyId = req.user.companyId;
    const date = depreciationDate ? new Date(depreciationDate) : new Date();

    // ─── Check if asset exists ──────────────────────────────
    const asset = await prisma.fixedAsset.findFirst({
      where: {
        id: assetId,
        companyId: companyId
      }
    });

    if (!asset) {
      console.log('❌ [FA] Fixed asset not found:', assetId);
      return res.status(404).json({
        success: false,
        message: 'Fixed asset not found'
      });
    }

    if (asset.status === 'Disposed') {
      return res.status(400).json({
        success: false,
        message: 'Cannot depreciate a disposed asset'
      });
    }

    if (asset.status === 'Fully Depreciated') {
      return res.status(400).json({
        success: false,
        message: 'Asset is already fully depreciated'
      });
    }

    const result = await FixedAssetModel.runDepreciation(assetId, date);
    if (!result) {
      return res.status(404).json({ success: false, message: 'Fixed asset not found' });
    }
    if (result.skipped || !result.amount) {
      return res.status(400).json({
        success: false,
        message: result.message || 'No depreciation to record'
      });
    }

    await postDepreciationJournal({
      userId,
      companyId,
      asset: result.asset,
      amount: result.amount,
      date
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
          status: result.status
        }
      },
      message: `Depreciation of ${result.amount} recorded successfully`
    });
  } catch (error) {
    console.error('❌ [FA] Run depreciation error:', error);
    res.status(500).json({
      success: false,
      message: error.message
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
    const companyId = req.user.companyId;
    const date = depreciationDate ? new Date(depreciationDate) : new Date();

    // ─── Get active assets ──────────────────────────────────
    const assets = await prisma.fixedAsset.findMany({
      where: {
        companyId: companyId,
        status: { in: ['Active', 'Fully Depreciated'] },
        OR: [
          { lastDepreciationDate: null },
          { lastDepreciationDate: { lt: date } }
        ]
      }
    });

    const results = [];
    for (const asset of assets) {
      if (asset.status === 'Fully Depreciated' || asset.status === 'Disposed') continue;
      const result = await FixedAssetModel.runDepreciation(asset.id, date);
      if (!result || result.skipped || !result.amount) continue;

      await postDepreciationJournal({
        userId,
        companyId,
        asset: result.asset,
        amount: result.amount,
        date
      });

      results.push({
        assetId: result.asset.id,
        assetCode: result.asset.assetCode,
        name: result.asset.name,
        depreciationAmount: result.amount,
        accumulatedDepreciation: result.accumulatedDepreciation,
        netBookValue: result.netBookValue,
        status: result.status
      });
    }

    console.log(`✅ [FA] Depreciation processed for ${results.length} assets`);

res.status(200).json({
      success: true,
      data: {
        processed: results.length,
        details: results
      },
      message: `Depreciation processed for ${results.length} assets`
    });
  } catch (error) {
    console.error('❌ [FA] Run monthly depreciation error:', error);
    res.status(500).json({
      success: false,
      message: error.message
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
    const companyId = req.user.companyId;

    // ─── Check if asset exists ──────────────────────────────
    const asset = await prisma.fixedAsset.findFirst({
      where: {
        id: assetId,
        companyId: companyId
      }
    });

    if (!asset) {
      console.log('❌ [FA] Fixed asset not found:', assetId);
      return res.status(404).json({
        success: false,
        message: 'Fixed asset not found'
      });
    }

    if (asset.status === 'Disposed') {
      return res.status(400).json({
        success: false,
        message: 'Asset already disposed'
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
    const assetAccount = await getOrCreateFixedAssetAccount(userId, companyId);
    const accDepAccount = await getOrCreateAccumulatedDepreciationAccount(userId, companyId);
    const cashAccount = await getOrCreateCashAccount(userId, companyId);
    const gainLossAccount = await getOrCreateGainLossAccount(userId, companyId, gainLoss >= 0);

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
        companyId: companyId,
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
          status: result.asset.status
        }
      },
      message: `Asset disposed successfully. ${gainLoss >= 0 ? 'Gain' : 'Loss'} of ${Math.abs(gainLoss)} recorded`
    });
  } catch (error) {
    console.error('❌ [FA] Dispose fixed asset error:', error);
    res.status(500).json({
      success: false,
      message: error.message
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
    const companyId = req.user.companyId;
    
    const stats = await FixedAssetModel.getStats(companyId);

    console.log('✅ [FA] Summary generated');

    res.status(200).json({
      success: true,
      data: stats
    });
  } catch (error) {
    console.error('❌ [FA] Get summary error:', error);
    res.status(500).json({
      success: false,
      message: error.message
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
    const companyId = req.user.companyId;

    // ─── Check if asset exists ──────────────────────────────
    const asset = await prisma.fixedAsset.findFirst({
      where: {
        id,
        companyId: companyId
      }
    });

    if (!asset) {
      console.log('❌ [FA] Fixed asset not found:', id);
      return res.status(404).json({
        success: false,
        message: 'Fixed asset not found'
      });
    }

    // ─── Fiscal Year Guard (Req 5) ────────────────────────────────────────
    try {
      await fiscalYearGuard(userId, asset.purchaseDate);
    } catch (err) {
      if (err.code === 'FISCAL_YEAR_CLOSED') {
        return res.status(400).json({ success: false, message: err.message });
      }
      throw err;
    }

    // ─── Check if can delete ──────────────────────────────────
    if (asset.status === 'Active' && asset.accumulatedDepreciation > 0) {
      return res.status(400).json({
        success: false,
        message: 'Cannot delete asset with accumulated depreciation'
      });
    }

    // ─── Delete Asset ──────────────────────────────────────────
    await FixedAssetModel.delete(id);

    console.log(`✅ [FA] Fixed asset deleted: ${asset.assetCode}`);

res.status(200).json({
      success: true,
      message: 'Fixed asset deleted successfully'
    });
  } catch (error) {
    console.error('❌ [FA] Delete fixed asset error:', error);
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};