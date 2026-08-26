const prisma = require('../../prisma/client');
const { recordCategoryChange, recordCategoryDeletes } = require('../../pos/sync/masterDataChangeLog');

class CategoryModel {
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
  static async findBySlug(slug) {
    return await prisma.category.findUnique({
      where: { slug }
    });
  }

  static async findByCode(code) {
    return await prisma.category.findUnique({
      where: { code }
    });
  }

  static async getTree() {
    // Get all active categories
    const categories = await prisma.category.findMany({
      where: { isActive: true },
      orderBy: { name: 'asc' }
    });

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

  static async create(data) {
    let slug = data.name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');

    const existingSlug = await prisma.category.findUnique({
      where: { slug }
    });
    if (existingSlug) {
      slug = `${slug}-${Math.random().toString(36).substring(2, 6)}`;
    }

    let code = data.code;
    if (!code) {
      const prefix = data.name.substring(0, 3).toUpperCase();
      const random = Math.random().toString(36).substring(2, 6).toUpperCase();
      code = `CAT-${prefix}-${random}`;
    }
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
      companyId: data.companyId || null,
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

    await recordCategoryChange(category);
    return category;
  }
  static async update(id, data) {
     const existing = await prisma.category.findUnique({
      where: { id }
    });
    if (!existing) return null;

    if (data.parentId !== undefined && data.parentId !== existing.parentId) {
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
        data.parentName = '';
        data.level = 1;
        data.path = '';
      }
    }
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
    const updated = await prisma.category.update({
      where: { id },
      data
    });
    await recordCategoryChange(updated);
    return updated;
  }
  static async delete(id) {
    const allIds = await this.getAllChildrenIds(id);
    const category = await prisma.category.findUnique({
      where: { id }
    });
    if (category && category.parentId) {
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
    const toDelete = await prisma.category.findMany({
      where: { id: { in: allIds } },
    });
    const result = await prisma.category.deleteMany({
      where: {
        id: { in: allIds }
      }
    });
    await recordCategoryDeletes(toDelete);
    return { deletedCount: result.count, ids: allIds };
  }
  static async deactivate(id) {
    const updated = await prisma.category.update({
      where: { id },
      data: { isActive: false }
    });
    await recordCategoryChange(updated, { isDeleted: true });
    return updated;
  }
  static async hasProducts(categoryId) {
    const count = await prisma.product.count({
      where: {
        categoryId,
        isActive: true
      }
    });
    return count > 0;
  }
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