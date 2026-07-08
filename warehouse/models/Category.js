// warehouse/models/Category.js - Prisma Version
const prisma = require('../../prisma/client');

class CategoryModel {
  // ============================================================
  // GET ALL CATEGORIES
  // ============================================================
  static async findAll(filter = {}, options = {}) {
    const { orderBy = { name: 'asc' } } = options;
    
    return await prisma.category.findMany({
      where: filter,
      orderBy,
      include: {
        parent: {
          select: { id: true, name: true }
        },
        creator: {
          select: { id: true, firstName: true, lastName: true, email: true }
        }
      }
    });
  }

  // ============================================================
  // GET CATEGORY BY ID
  // ============================================================
  static async findById(id) {
    return await prisma.category.findUnique({
      where: { id },
      include: {
        parent: {
          select: { id: true, name: true }
        },
        children: {
          select: { id: true, name: true, level: true, isActive: true }
        },
        creator: {
          select: { id: true, firstName: true, lastName: true, email: true }
        }
      }
    });
  }

  // ============================================================
  // FIND BY SLUG
  // ============================================================
  static async findBySlug(slug) {
    return await prisma.category.findUnique({
      where: { slug }
    });
  }

  // ============================================================
  // FIND BY CODE
  // ============================================================
  static async findByCode(code) {
    return await prisma.category.findUnique({
      where: { code }
    });
  }

  // ============================================================
  // GET CATEGORY TREE (Hierarchical)
  // ============================================================
  static async getTree() {
    // Get all active categories
    const categories = await prisma.category.findMany({
      where: { isActive: true },
      orderBy: { name: 'asc' }
    });

    // Build tree function
    const buildTree = (parentId = null) => {
      return categories
        .filter(c => c.parentId === parentId)
        .map(c => ({
          ...c,
          children: buildTree(c.id)
        }));
    };

    return buildTree(null);
  }

  // ============================================================
  // GET BREADCRUMB
  // ============================================================
  static async getBreadcrumb(categoryId) {
    const breadcrumb = [];
    let current = await prisma.category.findUnique({
      where: { id: categoryId }
    });

    while (current) {
      breadcrumb.unshift({
        id: current.id,
        name: current.name,
        slug: current.slug
      });
      
      if (current.parentId) {
        current = await prisma.category.findUnique({
          where: { id: current.parentId }
        });
      } else {
        current = null;
      }
    }

    return breadcrumb;
  }

  // ============================================================
  // GET ALL CHILDREN IDs (including self)
  // ============================================================
  static async getAllChildrenIds(categoryId) {
    const ids = [categoryId];
    const children = await prisma.category.findMany({
      where: { parentId: categoryId }
    });

    for (const child of children) {
      const childIds = await this.getAllChildrenIds(child.id);
      ids.push(...childIds);
    }

    return ids;
  }

  // ============================================================
  // CREATE CATEGORY
  // ============================================================
  static async create(data) {
    // Generate slug from name
    let slug = data.name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');

    // Check if slug exists, if yes add random suffix
    const existingSlug = await prisma.category.findUnique({
      where: { slug }
    });
    if (existingSlug) {
      slug = `${slug}-${Math.random().toString(36).substring(2, 6)}`;
    }

    // Auto-generate code if not provided
    let code = data.code;
    if (!code) {
      const prefix = data.name.substring(0, 3).toUpperCase();
      const random = Math.random().toString(36).substring(2, 6).toUpperCase();
      code = `CAT-${prefix}-${random}`;
    }

    // Calculate level and path based on parent
    let level = 1;
    let parentName = '';
    let path = '';

    if (data.parentId) {
      const parent = await prisma.category.findUnique({
        where: { id: data.parentId }
      });
      if (parent) {
        level = parent.level + 1;
        parentName = parent.name;
        path = parent.path ? `${parent.path}/${parent.id}` : parent.id;
      } else {
        // if parent not found, treat as top-level
        data.parentId = null;
      }
    }

    const categoryData = {
      name: data.name,
      slug,
      code,
      description: data.description || '',
      parentId: data.parentId || null,
      parentName,
      level,
      path,
      createdBy: data.createdBy,
      isActive: data.isActive !== undefined ? data.isActive : true
    };

    const category = await prisma.category.create({
      data: categoryData
    });

    // Update parent's subCategoryCount
    if (category.parentId) {
      await prisma.category.update({
        where: { id: category.parentId },
        data: {
          subCategoryCount: {
            increment: 1
          }
        }
      });
    }

    return category;
  }

  // ============================================================
  // UPDATE CATEGORY
  // ============================================================
  static async update(id, data) {
    // Get existing category
    const existing = await prisma.category.findUnique({
      where: { id }
    });
    if (!existing) return null;

    // Check if moving to new parent
    if (data.parentId !== undefined && data.parentId !== existing.parentId) {
      // Remove from old parent's count
      if (existing.parentId) {
        await prisma.category.update({
          where: { id: existing.parentId },
          data: {
            subCategoryCount: {
              decrement: 1
            }
          }
        });
      }

      // Add to new parent's count
      if (data.parentId) {
        const parent = await prisma.category.findUnique({
          where: { id: data.parentId }
        });
        if (parent) {
          data.parentName = parent.name;
          data.level = parent.level + 1;
          data.path = parent.path ? `${parent.path}/${parent.id}` : parent.id;
        }

        await prisma.category.update({
          where: { id: data.parentId },
          data: {
            subCategoryCount: {
              increment: 1
            }
          }
        });
      } else {
        // Moving to top level
        data.parentName = '';
        data.level = 1;
        data.path = '';
      }
    }

    // Update slug if name changed
    if (data.name && data.name !== existing.name) {
      let slug = data.name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');

      const existingSlug = await prisma.category.findUnique({
        where: { slug }
      });
      if (existingSlug && existingSlug.id !== id) {
        slug = `${slug}-${Math.random().toString(36).substring(2, 6)}`;
      }
      data.slug = slug;
    }

    return await prisma.category.update({
      where: { id },
      data
    });
  }

  // ============================================================
  // DELETE CATEGORY (Hard Delete with Cascade)
  // ============================================================
  static async delete(id) {
    // Get all descendant IDs
    const allIds = await this.getAllChildrenIds(id);
    
    // Get the category to check parent
    const category = await prisma.category.findUnique({
      where: { id }
    });

    // Remove from parent's subCategoryCount
    if (category && category.parentId) {
      // Count how many descendants (excluding self)
      const descendantCount = allIds.length - 1;
      
      await prisma.category.update({
        where: { id: category.parentId },
        data: {
          subCategoryCount: {
            decrement: allIds.length
          }
        }
      });
    }

    // Delete all descendants (including self)
    const result = await prisma.category.deleteMany({
      where: {
        id: { in: allIds }
      }
    });

    return { deletedCount: result.count, ids: allIds };
  }

  // ============================================================
  // SOFT DELETE (Deactivate)
  // ============================================================
  static async deactivate(id) {
    return await prisma.category.update({
      where: { id },
      data: { isActive: false }
    });
  }

  // ============================================================
  // CHECK IF CATEGORY HAS PRODUCTS
  // ============================================================
  static async hasProducts(categoryId) {
    const count = await prisma.product.count({
      where: {
        categoryId,
        isActive: true
      }
    });
    return count > 0;
  }

  // ============================================================
  // GET CATEGORY WITH PRODUCT COUNT
  // ============================================================
  static async getWithProductCount(categoryId) {
    const category = await prisma.category.findUnique({
      where: { id: categoryId },
      include: {
        _count: {
          select: {
            products: {
              where: { isActive: true }
            }
          }
        }
      }
    });
    
    return {
      ...category,
      productCount: category._count.products
    };
  }
}

module.exports = CategoryModel;