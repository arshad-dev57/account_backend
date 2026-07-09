// warehouse/models/Setting.js - Prisma Version (COMPLETE FIXED)

const prisma = require('../../prisma/client');

class SettingModel {
  // ============================================================
  // GET SETTINGS BY CATEGORY
  // ============================================================
  static async findByCategory(category, userId, activeOnly = true) {
    const filter = { 
      category: category,
      userId: userId
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
  // GET ALL SETTINGS WITH FILTERS
  // ============================================================
  static async findAll(filter = {}, options = {}) {
    const { skip, take, orderBy = { displayOrder: 'asc' } } = options;
    
    return await prisma.setting.findMany({
      where: filter,
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
  // GET SETTING BY CATEGORY AND NAME - FIXED
  // ============================================================
  static async findByCategoryAndName(category, name, userId) {
    return await prisma.setting.findFirst({
      where: {
        category: category,
        name: name,
        userId: userId
      }
    });
  }

  // ============================================================
  // GET DEFAULT SETTING FOR CATEGORY
  // ============================================================
  static async findDefaultByCategory(category, userId) {
    return await prisma.setting.findFirst({
      where: {
        category: category,
        userId: userId,
        isDefault: true,
        isActive: true
      }
    });
  }

  // ============================================================
  // CREATE SETTING
  // ============================================================
  static async create(data) {
    // If this is default, unset other defaults in same category
    if (data.isDefault) {
      await prisma.setting.updateMany({
        where: {
          category: data.category,
          userId: data.userId,
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
        userId: data.userId || data.createdBy
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
          userId: existing.userId,
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
  // GET CATEGORIES LIST
  // ============================================================
  static async getCategories(userId) {
    const categories = await prisma.setting.findMany({
      where: {
        userId: userId
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
  // BULK CREATE (for seeding)
  // ============================================================
  static async bulkCreate(settings, userId) {
    const results = [];
    for (const setting of settings) {
      try {
        const created = await this.create({
          ...setting,
          createdBy: userId,
          userId: userId
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