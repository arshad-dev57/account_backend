// warehouse/models/Setting.js - COMPLETE CORRECTED

const prisma = require('../../prisma/client');

class SettingModel {
  // ============================================================
  // GET SETTINGS BY CATEGORY - ✅ FIXED
  // ============================================================
  static async findByCategory(category, companyId, activeOnly = true) {
    // ✅ FIXED: Use companyId instead of userId
    const filter = { 
      category: category,
      companyId: companyId
    };
    if (activeOnly) {
      filter.isActive = true;
    }
    
    return await prisma.setting.findMany({
      where: filter,
      orderBy: [
        { displayOrder: 'asc' },
        { name: 'asc' }
      ]
    });
  }

  // ============================================================
  // GET ALL SETTINGS WITH FILTERS - ✅ FIXED
  // ============================================================
  static async findAll(filter = {}, options = {}) {
    const { skip, take, orderBy = { displayOrder: 'asc' } } = options;
    
    // ✅ FIXED: Map userId to createdBy if present
    const cleanFilter = { ...filter };
    if (cleanFilter.userId) {
      cleanFilter.createdBy = cleanFilter.userId;
      delete cleanFilter.userId;
    }
    
    return await prisma.setting.findMany({
      where: cleanFilter,
      skip,
      take,
      orderBy,
      include: {
        creator: {
          select: { id: true, firstName: true, lastName: true, email: true }
        }
      }
    });
  }

  // ============================================================
  // GET SETTING BY ID
  // ============================================================
  static async findById(id) {
    return await prisma.setting.findUnique({
      where: { id },
      include: {
        creator: {
          select: { id: true, firstName: true, lastName: true, email: true }
        }
      }
    });
  }

  // ============================================================
  // GET SETTING BY CATEGORY AND NAME - ✅ FIXED
  // ============================================================
  static async findByCategoryAndName(category, name, companyId) {
    // ✅ FIXED: Use companyId instead of userId
    return await prisma.setting.findFirst({
      where: {
        category: category,
        name: name,
        companyId: companyId
      }
    });
  }

  // ============================================================
  // GET DEFAULT SETTING FOR CATEGORY - ✅ FIXED
  // ============================================================
  static async findDefaultByCategory(category, companyId) {
    // ✅ FIXED: Use companyId instead of userId
    return await prisma.setting.findFirst({
      where: {
        category: category,
        companyId: companyId,
        isDefault: true,
        isActive: true
      }
    });
  }

  // ============================================================
  // CREATE SETTING - ✅ FIXED
  // ============================================================
  static async create(data) {
    // If this is default, unset other defaults in same category
    if (data.isDefault) {
      await prisma.setting.updateMany({
        where: {
          category: data.category,
          companyId: data.companyId,
          isDefault: true
        },
        data: {
          isDefault: false
        }
      });
    }

    return await prisma.setting.create({
      data: {
        category: data.category,
        name: data.name,
        metadata: data.metadata || {},
        isDefault: data.isDefault || false,
        displayOrder: data.displayOrder || 0,
        isActive: data.isActive !== undefined ? data.isActive : true,
        createdBy: data.createdBy,
        companyId: data.companyId  // ✅ Use companyId instead of userId
      },
      include: {
        creator: {
          select: { id: true, firstName: true, lastName: true, email: true }
        }
      }
    });
  }

  // ============================================================
  // UPDATE SETTING
  // ============================================================
  static async update(id, data) {
    // Get existing setting
    const existing = await prisma.setting.findUnique({
      where: { id }
    });
    if (!existing) return null;

    // If making this default, unset other defaults in same category
    if (data.isDefault && data.isDefault !== existing.isDefault) {
      await prisma.setting.updateMany({
        where: {
          category: existing.category,
          companyId: existing.companyId,
          isDefault: true,
          id: { not: id }
        },
        data: {
          isDefault: false
        }
      });
    }

    return await prisma.setting.update({
      where: { id },
      data: {
        name: data.name,
        metadata: data.metadata,
        isDefault: data.isDefault,
        displayOrder: data.displayOrder,
        isActive: data.isActive,
        updatedBy: data.updatedBy
      },
      include: {
        creator: {
          select: { id: true, firstName: true, lastName: true, email: true }
        }
      }
    });
  }

  // ============================================================
  // SOFT DELETE (Deactivate)
  // ============================================================
  static async deactivate(id, updatedBy) {
    return await prisma.setting.update({
      where: { id },
      data: {
        isActive: false,
        updatedBy: updatedBy
      }
    });
  }

  // ============================================================
  // HARD DELETE
  // ============================================================
  static async delete(id) {
    return await prisma.setting.delete({
      where: { id }
    });
  }

  // ============================================================
  // GET CATEGORIES LIST - ✅ FIXED
  // ============================================================
  static async getCategories(companyId) {
    // ✅ FIXED: Use companyId instead of userId
    const categories = await prisma.setting.findMany({
      where: {
        companyId: companyId
      },
      select: {
        category: true
      },
      distinct: ['category'],
      orderBy: {
        category: 'asc'
      }
    });
    
    return categories.map(c => c.category);
  }

  // ============================================================
  // BULK CREATE (for seeding) - ✅ FIXED
  // ============================================================
  static async bulkCreate(settings, companyId, createdBy) {
    // ✅ FIXED: Use companyId instead of userId
    const results = [];
    for (const setting of settings) {
      try {
        const created = await this.create({
          ...setting,
          createdBy: createdBy,
          companyId: companyId
        });
        results.push(created);
      } catch (error) {
        console.error(`Failed to create setting: ${setting.name}`, error);
      }
    }
    return results;
  }
}

module.exports = SettingModel;