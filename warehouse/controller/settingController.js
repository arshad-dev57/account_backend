
const Setting = require('../models/Setting');
const prisma = require('../../prisma/client');

const formatMetadata = (category, body) => {
  const metadata = {};
  
  // Product Settings
  if (category === 'rackLocation' && body.zone) {
    metadata.zone = body.zone;
  }
  
  // Currency settings
  if (category === 'currency') {
    if (body.symbol) metadata.symbol = body.symbol;
    if (body.code) metadata.code = body.code;
  }
  
  return metadata;
};

const formatResponse = (setting) => {
  const result = {
    id: setting.id,
    name: setting.name,
    category: setting.category,
    isDefault: setting.isDefault,
    displayOrder: setting.displayOrder,
    isActive: setting.isActive,
    createdAt: setting.createdAt,
    updatedAt: setting.updatedAt
  };
  
  if (setting.metadata && typeof setting.metadata === 'object') {
    Object.assign(result, setting.metadata);
  }
  
  return result;
};

// ─── GET SETTINGS - ✅ FIXED
const getSettings = async (req, res) => {
  try {
    const userId = req.user.id;
    const companyId = req.user.companyId;  // ✅ Get companyId from user
    const { category } = req.query;
    
    if (!category) {
      return res.status(400).json({
        success: false,
        message: 'Category is required'
      });
    }

    console.log('🔵 [getSettings] Category:', category);
    console.log('🔵 [getSettings] Company ID:', companyId);

    // ✅ FIXED: Pass companyId instead of userId
    const settings = await Setting.findByCategory(category, companyId, true);
    
    const formatted = settings.map(item => formatResponse(item));

    console.log(`✅ [getSettings] Found ${formatted.length} settings`);

    res.status(200).json({
      success: true,
      data: formatted
    });
  } catch (error) {
    console.error('❌ [getSettings] Error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Server error',
      error: error.message 
    });
  }
};

// ─── GET ALL SETTINGS (Admin) - ✅ FIXED
const getAllSettings = async (req, res) => {
  try {
    const userId = req.user.id;
    const companyId = req.user.companyId;  // ✅ Get companyId
    const { category, isActive, page = 1, limit = 50 } = req.query;
    
    // ✅ FIXED: Use companyId instead of userId
    const filter = { companyId: companyId };
    if (category) filter.category = category;
    if (isActive !== undefined) filter.isActive = isActive === 'true';
    
    const pageNum = parseInt(page);
    const limitNum = parseInt(limit);
    const skip = (pageNum - 1) * limitNum;
    
    const settings = await Setting.findAll(filter, {
      skip,
      take: limitNum,
      orderBy: { category: 'asc' }
    });
    
    const total = await prisma.setting.count({ where: filter });

    res.status(200).json({
      success: true,
      count: settings.length,
      data: settings,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        pages: Math.ceil(total / limitNum)
      }
    });
  } catch (error) {
    console.error('❌ [getAllSettings] Error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message
    });
  }
};

// ─── GET SETTING BY ID ──────────────────────────────
const getSettingById = async (req, res) => {
  try {
    const { id } = req.params;
    const setting = await Setting.findById(id);
    
    if (!setting) {
      return res.status(404).json({
        success: false,
        message: 'Setting not found'
      });
    }
    
    res.status(200).json({
      success: true,
      data: setting
    });
  } catch (error) {
    console.error('❌ [getSettingById] Error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message
    });
  }
};

// ─── CREATE SETTING - ✅ FIXED
const createSetting = async (req, res) => {
  try {
    const userId = req.user.id;
    const companyId = req.user.companyId;  // ✅ Get companyId
    const { category, name, isDefault, displayOrder, ...rest } = req.body;

    console.log('🔵 [createSetting] Called');
    console.log('🔵 [createSetting] Category:', category);
    console.log('🔵 [createSetting] Name:', name);
    console.log('🔵 [createSetting] Company ID:', companyId);

    if (!category || !name) {
      return res.status(400).json({
        success: false,
        message: 'Category and name are required'
      });
    }

    // ✅ FIXED: Pass companyId instead of userId
    const existing = await Setting.findByCategoryAndName(category, name, companyId);
    if (existing) {
      console.log('❌ [createSetting] Setting already exists');
      return res.status(400).json({
        success: false,
        message: 'A setting with this name already exists in this category'
      });
    }

    const metadata = formatMetadata(category, rest);
    console.log('🔵 [createSetting] Metadata:', metadata);

    // ✅ FIXED: Pass companyId instead of userId
    const setting = await Setting.create({
      category,
      name,
      metadata,
      isDefault: isDefault || false,
      displayOrder: displayOrder || 0,
      createdBy: userId,
      companyId: companyId
    });

    console.log('✅ [createSetting] Setting created successfully:', setting.id);

    res.status(201).json({
      success: true,
      message: 'Setting created successfully',
      data: formatResponse(setting)
    });
  } catch (error) {
    console.error('❌ [createSetting] Error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message
    });
  }
};

// ─── UPDATE SETTING ──────────────────────────────────
const updateSetting = async (req, res) => {
  try {
    const userId = req.user.id;
    const { id } = req.params;
    const { name, isDefault, displayOrder, isActive, ...rest } = req.body;

    console.log('🔵 [updateSetting] Called');
    console.log('🔵 [updateSetting] ID:', id);

    const existing = await Setting.findById(id);
    if (!existing) {
      console.log('❌ [updateSetting] Setting not found');
      return res.status(404).json({
        success: false,
        message: 'Setting not found'
      });
    }

    // Check duplicate name
    if (name && name !== existing.name) {
      const duplicate = await Setting.findByCategoryAndName(
        existing.category, 
        name, 
        existing.companyId  // ✅ Use companyId from existing
      );
      if (duplicate && duplicate.id !== id) {
        console.log('❌ [updateSetting] Duplicate name found');
        return res.status(400).json({
          success: false,
          message: 'A setting with this name already exists in this category'
        });
      }
    }

    const metadata = formatMetadata(existing.category, rest);
    
    const mergedMetadata = {
      ...(existing.metadata || {}),
      ...metadata
    };

    const updateData = {
      name: name || existing.name,
      metadata: Object.keys(mergedMetadata).length > 0 ? mergedMetadata : undefined,
      isDefault: isDefault !== undefined ? isDefault : existing.isDefault,
      displayOrder: displayOrder !== undefined ? displayOrder : existing.displayOrder,
      isActive: isActive !== undefined ? isActive : existing.isActive,
      updatedBy: userId
    };

    console.log('🔵 [updateSetting] Update Data:', updateData);

    const setting = await Setting.update(id, updateData);

    console.log('✅ [updateSetting] Setting updated successfully');

    res.status(200).json({
      success: true,
      message: 'Setting updated successfully',
      data: formatResponse(setting)
    });
  } catch (error) {
    console.error('❌ [updateSetting] Error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message
    });
  }
};

// ─── DELETE SETTING (Soft Delete) ──────────────────
const deleteSetting = async (req, res) => {
  try {
    const userId = req.user.id;
    const { id } = req.params;
    
    console.log('🔵 [deleteSetting] Called');
    console.log('🔵 [deleteSetting] ID:', id);

    const setting = await Setting.findById(id);
    if (!setting) {
      console.log('❌ [deleteSetting] Setting not found');
      return res.status(404).json({
        success: false,
        message: 'Setting not found'
      });
    }

    if (setting.isDefault) {
      console.log('❌ [deleteSetting] Cannot delete default');
      return res.status(400).json({
        success: false,
        message: 'Cannot delete default item. Set another item as default first.'
      });
    }

    await Setting.deactivate(id, userId);

    console.log('✅ [deleteSetting] Setting deactivated successfully');

    res.status(200).json({
      success: true,
      message: 'Setting deleted successfully'
    });
  } catch (error) {
    console.error('❌ [deleteSetting] Error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message
    });
  }
};

// ─── HARD DELETE SETTING ─────────────────────────────
const hardDeleteSetting = async (req, res) => {
  try {
    const { id } = req.params;
    
    console.log('🔵 [hardDeleteSetting] Called');
    console.log('🔵 [hardDeleteSetting] ID:', id);

    const setting = await Setting.findById(id);
    if (!setting) {
      console.log('❌ [hardDeleteSetting] Setting not found');
      return res.status(404).json({
        success: false,
        message: 'Setting not found'
      });
    }

    if (setting.isDefault) {
      console.log('❌ [hardDeleteSetting] Cannot delete default');
      return res.status(400).json({
        success: false,
        message: 'Cannot delete default item'
      });
    }

    await Setting.delete(id);

    console.log('✅ [hardDeleteSetting] Setting permanently deleted');

    res.status(200).json({
      success: true,
      message: 'Setting permanently deleted'
    });
  } catch (error) {
    console.error('❌ [hardDeleteSetting] Error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message
    });
  }
};

// ─── GET CATEGORIES - ✅ FIXED
const getCategories = async (req, res) => {
  try {
    const userId = req.user.id;
    const companyId = req.user.companyId;  // ✅ Get companyId
    
    // ✅ FIXED: Pass companyId instead of userId
    const categories = await Setting.getCategories(companyId);
    
    res.status(200).json({
      success: true,
      data: categories
    });
  } catch (error) {
    console.error('❌ [getCategories] Error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message
    });
  }
};

// ─── SEED DEFAULT SETTINGS - ✅ FIXED
const seedDefaultSettings = async (req, res) => {
  try {
    const userId = req.user.id;
    const companyId = req.user.companyId;  // ✅ Get companyId
    
    const defaultSettings = [
      // Product Settings
      { category: 'productType', name: 'Physical', isDefault: true },
      { category: 'productType', name: 'Digital' },
      { category: 'productType', name: 'Service' },
      { category: 'productType', name: 'Hybrid' },
      
      { category: 'rackLocation', name: 'A-1-B1', metadata: { zone: 'Zone A' } },
      { category: 'rackLocation', name: 'B-2-C3', metadata: { zone: 'Zone B' } },
      { category: 'rackLocation', name: 'C-3-D5', metadata: { zone: 'Zone C' } },
      
      { category: 'weightUnit', name: 'KG', isDefault: true },
      { category: 'weightUnit', name: 'G' },
      { category: 'weightUnit', name: 'LB' },
      
      { category: 'dimensionUnit', name: 'cm', isDefault: true },
      { category: 'dimensionUnit', name: 'm' },
      { category: 'dimensionUnit', name: 'inch' },
      
      { category: 'stockUnit', name: 'Pcs', isDefault: true },
      { category: 'stockUnit', name: 'Box' },
      { category: 'stockUnit', name: 'Carton' },
      
      { category: 'taxType', name: 'Exclusive', isDefault: true },
      { category: 'taxType', name: 'Inclusive' },
      
      { category: 'orderType', name: 'Standard', isDefault: true },
      { category: 'orderType', name: 'Bulk' },
      { category: 'orderType', name: 'Wholesale' },
      { category: 'orderType', name: 'Express' },
      
      { category: 'priority', name: 'Normal', isDefault: true },
      { category: 'priority', name: 'High' },
      { category: 'priority', name: 'Urgent' },
      
      { category: 'paymentMethod', name: 'Cash', isDefault: true },
      { category: 'paymentMethod', name: 'Bank Transfer' },
      { category: 'paymentMethod', name: 'Credit Card' },
      { category: 'paymentMethod', name: 'COD' },
      
      { category: 'shippingMethod', name: 'Standard', isDefault: true },
      { category: 'shippingMethod', name: 'Express' },
      { category: 'shippingMethod', name: 'Pickup' },
      
      { category: 'customerType', name: 'Individual', isDefault: true },
      { category: 'customerType', name: 'Business' },
      { category: 'customerType', name: 'Wholesale' },
      { category: 'customerType', name: 'Distributor' },
      { category: 'customerType', name: 'Retailer' },
      { category: 'customerType', name: 'Manufacturer' },
    ];

    console.log(`🔵 [seedDefaultSettings] Seeding ${defaultSettings.length} settings`);

    // ✅ FIXED: Pass companyId instead of userId
    const results = await Setting.bulkCreate(defaultSettings, companyId, userId);

    console.log(`✅ [seedDefaultSettings] ${results.length} settings seeded successfully`);

    res.status(201).json({
      success: true,
      message: `${results.length} default settings seeded successfully`,
      data: results
    });
  } catch (error) {
    console.error('❌ [seedDefaultSettings] Error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message
    });
  }
};

module.exports = {
  getSettings,
  getAllSettings,
  getSettingById,
  createSetting,
  updateSetting,
  deleteSetting,
  hardDeleteSetting,
  getCategories,
  seedDefaultSettings
};