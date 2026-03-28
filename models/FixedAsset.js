const mongoose = require('mongoose');

const FixedAssetSchema = new mongoose.Schema(
  {
    assetCode: {
      type: String,
      unique: true,
    },
    name: {
      type: String,
      required: true,
    },
    category: {
      type: String,
      enum: ['Building', 'Vehicle', 'IT Equipment', 'Furniture', 'Machinery', 'Equipment'],
      required: true,
    },
    purchaseDate: {
      type: Date,
      required: true,
    },
    purchaseCost: {
      type: Number,
      required: true,
      min: 0,
    },
    usefulLife: {
      type: Number,
      required: true,
      min: 1,
    },
    salvageValue: {
      type: Number,
      default: 0,
      min: 0,
    },
    depreciationMethod: {
      type: String,
      enum: ['Straight Line', 'Declining Balance', 'Units of Production'],
      default: 'Straight Line',
    },
    currentDepreciation: {
      type: Number,
      default: 0,
    },
    accumulatedDepreciation: {
      type: Number,
      default: 0,
    },
    netBookValue: {
      type: Number,
      default: function() {
        return this.purchaseCost - this.accumulatedDepreciation;
      },
    },
    status: {
      type: String,
      enum: ['Active', 'Fully Depreciated', 'Disposed'],
      default: 'Active',
    },
    location: {
      type: String,
      default: '',
    },
    supplierId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Vendor',
    },
    supplierName: {
      type: String,
      default: '',
    },
    warrantyExpiry: {
      type: Date,
    },
    notes: {
      type: String,
      default: '',
    },
    lastDepreciationDate: {
      type: Date,
    },
    disposedDate: {
      type: Date,
    },
    disposalAmount: {
      type: Number,
      default: 0,
    },
    disposalReason: {
      type: String,
      default: '',
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
  },
  {
    timestamps: true,
  }
);

// Generate asset code before save
FixedAssetSchema.pre('save', async function() {
  if (this.isNew) {
    const count = await mongoose.model('FixedAsset').countDocuments();
    const year = new Date().getFullYear();
    this.assetCode = `FA-${year}-${String(count + 1).padStart(4, '0')}`;
  }
});

// Calculate monthly depreciation
FixedAssetSchema.methods.calculateMonthlyDepreciation = function() {
  if (this.depreciationMethod === 'Straight Line') {
    const depreciableAmount = this.purchaseCost - this.salvageValue;
    const totalMonths = this.usefulLife * 12;
    return depreciableAmount / totalMonths;
  }
  return 0;
};

// Run monthly depreciation
FixedAssetSchema.methods.runDepreciation = async function(depreciationDate) {
  const monthlyDepreciation = this.calculateMonthlyDepreciation();
  
  // Check if already fully depreciated
  if (this.netBookValue <= this.salvageValue) {
    this.status = 'Fully Depreciated';
    await this.save();
    return { message: 'Asset already fully depreciated', amount: 0 };
  }
  
  // Calculate new values
  const newDepreciation = monthlyDepreciation;
  const newAccumulatedDepreciation = this.accumulatedDepreciation + newDepreciation;
  const newNetBookValue = this.purchaseCost - newAccumulatedDepreciation;
  
  // Update asset
  this.currentDepreciation = newDepreciation;
  this.accumulatedDepreciation = newAccumulatedDepreciation;
  this.netBookValue = newNetBookValue;
  this.lastDepreciationDate = depreciationDate;
  
  // Update status if fully depreciated
  if (newNetBookValue <= this.salvageValue) {
    this.status = 'Fully Depreciated';
  }
  
  await this.save();
  
  return {
    amount: newDepreciation,
    accumulatedDepreciation: this.accumulatedDepreciation,
    netBookValue: this.netBookValue,
    status: this.status,
  };
};

module.exports = mongoose.model('FixedAsset', FixedAssetSchema);