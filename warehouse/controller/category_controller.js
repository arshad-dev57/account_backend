// warehouse/controller/category_controller.js - WITH SUB-CATEGORY SUPPORT

const prisma = require('../../prisma/client');
const { recordCategoryChange, recordCategoryDeletes } = require('../../pos/sync/masterDataChangeLog');

// ─── HELPERS ────────────────────────────────────────────────
const buildCategoryTree = (categories, parentId = null) => {
  const filtered = categories.filter(c => c.parentId === parentId);
  
  return filtered.map(c => {
    const children = buildCategoryTree(categories, c.id);
    return {
      ...c,
      children,
      subCategoryCount: children.length
    };
  });
};

// ─── GET ALL CATEGORIES (User-specific) ──────────────────
const getCategories = async (req, res) => {
  try {
    const userId = req.user.id;
    const companyId = req.user.companyId;
    const { tree = 'false', includeInactive = 'false', parentId, locationId, stockedOnly } = req.query;

    const filter = {
      companyId: companyId,
      isDeleted: false,
    };
    
    if (includeInactive !== 'true') {
      filter.isActive = true;
    }

    // If parentId is provided, get only sub-categories of that parent
    if (parentId) {
      filter.parentId = parentId;
    }

    // POS: only categories that have products at this location.
    // Category admin / product forms must get the full company catalog.
    if (locationId && (stockedOnly === 'true' || stockedOnly === true)) {
      const loc = await prisma.location.findFirst({
        where: { id: String(locationId), companyId, isDeleted: false },
        select: { id: true },
      });
      if (!loc) {
        return res.status(400).json({ success: false, message: 'Location not found' });
      }
      const stocks = await prisma.productStock.findMany({
        where: { companyId, locationId: loc.id },
        select: { productId: true },
      });
      const productIds = [...new Set(stocks.map((s) => s.productId))];
      if (!productIds.length) {
        return res.status(200).json({ success: true, data: [] });
      }
      const products = await prisma.product.findMany({
        where: { companyId, isActive: true, id: { in: productIds } },
        select: { categoryId: true },
      });
      const leafIds = new Set(products.map((p) => p.categoryId).filter(Boolean));
      if (!leafIds.size) {
        return res.status(200).json({ success: true, data: [] });
      }
      const allCats = await prisma.category.findMany({
        where: { companyId, isDeleted: false },
        select: { id: true, parentId: true },
      });
      const byId = new Map(allCats.map((c) => [c.id, c]));
      const keep = new Set(leafIds);
      for (const id of [...keep]) {
        let cur = byId.get(id);
        while (cur?.parentId) {
          keep.add(cur.parentId);
          cur = byId.get(cur.parentId);
        }
      }
      filter.id = { in: [...keep] };
    }

    const categories = await prisma.category.findMany({
      where: filter,
      orderBy: { level: 'asc' },
      include: {
        _count: {
          select: {
            products: {
              where: { isActive: true }
            },
            children: {
              where: { isActive: true }
            }
          }
        }
      }
    });

    // Transform to include counts
    const transformed = categories.map(c => ({
      ...c,
      productCount: c._count.products,
      subCategoryCount: c._count.children
    }));

    // If tree=true, return nested structure
    if (tree === 'true') {
      const treeData = buildCategoryTree(transformed);
      return res.status(200).json({
        success: true,
        data: treeData
      });
    }

    res.status(200).json({
      success: true,
      data: transformed
    });
  } catch (error) {
    console.error('Get categories error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message
    });
  }
};

// ─── GET SINGLE CATEGORY (User-specific) ──────────────────
const getCategoryById = async (req, res) => {
  try {
    const userId = req.user.id;
    const companyId = req.user.companyId;
    const categoryId = req.params.id;

    const category = await prisma.category.findFirst({
      where: {
        id: categoryId,
        companyId: companyId
      },
      include: {
        parent: {
          select: { id: true, name: true }
        },
        children: {
          where: { isActive: true },
          select: { id: true, name: true, level: true }
        },
        _count: {
          select: {
            products: {
              where: { isActive: true }
            }
          }
        }
      }
    });

    if (!category) {
      return res.status(404).json({
        success: false,
        message: 'Category not found'
      });
    }

    res.status(200).json({
      success: true,
      data: {
        ...category,
        productCount: category._count.products
      }
    });
  } catch (error) {
    console.error('Get category error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message
    });
  }
};

// ─── CREATE CATEGORY (with Sub-category support) ──────────
const createCategory = async (req, res) => {
  try {
    const userId = req.user.id;
    const companyId = req.user.companyId;
    const { name, description, code, parentId } = req.body;

    // Validation
    if (!name) {
      return res.status(400).json({
        success: false,
        message: 'Category name is required'
      });
    }

    // Check duplicate name for this company
    const existing = await prisma.category.findFirst({
      where: {
        name: name,
        companyId: companyId
      }
    });

    if (existing) {
      // Soft-deleted leftover still holds unique(name, companyId) — remove it so name can be reused
      if (existing.isActive === false || existing.isDeleted === true) {
        const staleIds = await getAllChildrenIds(companyId, existing.id);
        const linkedProducts = await prisma.product.count({
          where: {
            companyId,
            OR: [
              { categoryId: { in: staleIds } },
              { subCategoryId: { in: staleIds } },
            ],
          },
        });
        if (linkedProducts > 0) {
          return res.status(400).json({
            success: false,
            message: `Category with this name already exists (inactive) and still has ${linkedProducts} linked products. Reassign products or use another name.`,
          });
        }
        await hardDeleteCategoryTree(companyId, staleIds, existing.parentId);
      } else {
        return res.status(400).json({
          success: false,
          message: 'Category with this name already exists for your company'
        });
      }
    }

    // If parentId is provided, validate parent
    let parentLevel = 0;
    let parentName = null;
    let path = '';

    if (parentId) {
      const parent = await prisma.category.findFirst({
        where: {
          id: parentId,
          companyId: companyId,
          isActive: true
        }
      });

      if (!parent) {
        return res.status(400).json({
          success: false,
          message: 'Parent category not found or does not belong to your company'
        });
      }

      parentLevel = parent.level || 0;
      parentName = parent.name;
      path = parent.path ? `${parent.path}/${parent.id}` : parent.id;
    }

    const level = parentLevel + 1;

    const category = await prisma.category.create({
      data: {
        name,
        description: description || '',
        code: code || undefined,
        parentId: parentId || null,
        parentName: parentName,
        level: level,
        path: path,
        createdBy: userId,
        companyId: companyId,
        isActive: true
      }
    });

    // Update parent's subCategoryCount
    if (parentId) {
      await prisma.category.update({
        where: { id: parentId },
        data: {
          subCategoryCount: {
            increment: 1
          }
        }
      });
    }

    await recordCategoryChange(category);

    res.status(201).json({
      success: true,
      message: parentId ? 'Sub-category created successfully' : 'Category created successfully',
      data: category
    });
  } catch (error) {
    console.error('Create category error:', error);
    if (error.code === 'P2002') {
      return res.status(400).json({
        success: false,
        message: 'Category with this name or code already exists'
      });
    }
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message
    });
  }
};

// ─── UPDATE CATEGORY (with Sub-category support) ──────────
const updateCategory = async (req, res) => {
  try {
    const userId = req.user.id;
    const companyId = req.user.companyId;
    const categoryId = req.params.id;
    const { name, description, code, parentId, isActive } = req.body;

    // Check if category exists AND belongs to this company
    const existing = await prisma.category.findFirst({
      where: {
        id: categoryId,
        companyId: companyId
      }
    });

    if (!existing) {
      return res.status(404).json({
        success: false,
        message: 'Category not found'
      });
    }

    // Check duplicate name
    if (name && name !== existing.name) {
      const duplicate = await prisma.category.findFirst({
        where: {
          name: name,
          companyId: companyId,
          NOT: { id: categoryId }
        }
      });

      if (duplicate) {
        return res.status(400).json({
          success: false,
          message: 'Category with this name already exists for your company'
        });
      }
    }

    // Handle parent change
    if (parentId !== undefined && parentId !== existing.parentId) {
      // Check if parent exists and belongs to company
      let parent = null;
      if (parentId) {
        parent = await prisma.category.findFirst({
          where: {
            id: parentId,
            companyId: companyId,
            isActive: true
          }
        });

        if (!parent) {
          return res.status(400).json({
            success: false,
            message: 'Parent category not found or does not belong to your company'
          });
        }

        // Prevent moving under own descendant
        const allChildrenIds = await getAllChildrenIds(companyId, categoryId);
        if (allChildrenIds.includes(parentId)) {
          return res.status(400).json({
            success: false,
            message: 'Cannot move a category under its own descendant'
          });
        }
      }

      // Update parent counts
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

      if (parentId) {
        await prisma.category.update({
          where: { id: parentId },
          data: {
            subCategoryCount: {
              increment: 1
            }
          }
        });
      }

      // Update level and path
      req.body.level = parent ? parent.level + 1 : 1;
      req.body.parentName = parent ? parent.name : null;
      req.body.path = parent ? `${parent.path}/${parent.id}` : '';
    }

    const updateData = {
      name: name || existing.name,
      description: description !== undefined ? description : existing.description,
      code: code || existing.code,
      parentId: parentId !== undefined ? parentId : existing.parentId,
      isActive: isActive !== undefined ? isActive : existing.isActive,
      updatedBy: userId,
      ...(req.body.level !== undefined && { level: req.body.level }),
      ...(req.body.parentName !== undefined && { parentName: req.body.parentName }),
      ...(req.body.path !== undefined && { path: req.body.path })
    };

    const category = await prisma.category.update({
      where: { id: categoryId },
      data: updateData
    });

    await recordCategoryChange(category);

    res.status(200).json({
      success: true,
      message: 'Category updated successfully',
      data: category
    });
  } catch (error) {
    console.error('Update category error:', error);
    if (error.code === 'P2002') {
      return res.status(400).json({
        success: false,
        message: 'Category with this name or code already exists'
      });
    }
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message
    });
  }
};

// ─── GET ALL CHILDREN IDS (Helper) ─────────────────────────
const getAllChildrenIds = async (companyId, categoryId) => {
  const allIds = [categoryId];
  const queue = [categoryId];

  while (queue.length > 0) {
    const currentId = queue.shift();
    const children = await prisma.category.findMany({
      where: {
        parentId: currentId,
        companyId: companyId
      },
      select: { id: true }
    });

    const childIds = children.map(c => c.id);
    allIds.push(...childIds);
    queue.push(...childIds);
  }

  return allIds;
};

const hardDeleteCategoryTree = async (companyId, allIds, parentIdToUpdate = null) => {
  await prisma.$transaction(async (tx) => {
    // Detach products so FK does not block delete
    await tx.product.updateMany({
      where: { categoryId: { in: allIds }, companyId },
      data: { categoryId: null, categoryName: null },
    });
    await tx.product.updateMany({
      where: { subCategoryId: { in: allIds }, companyId },
      data: { subCategoryId: null, subCategoryName: null },
    });

    // Break self-FK among the tree, then delete
    await tx.category.updateMany({
      where: { id: { in: allIds }, companyId },
      data: { parentId: null, parentName: null },
    });

    await tx.category.deleteMany({
      where: { id: { in: allIds }, companyId },
    });

    if (parentIdToUpdate) {
      const remaining = await tx.category.count({
        where: { parentId: parentIdToUpdate, companyId },
      });
      await tx.category.update({
        where: { id: parentIdToUpdate },
        data: { subCategoryCount: remaining },
      });
    }
  });
};

// ─── DELETE CATEGORY (hard delete + cascade sub-categories) ──
const deleteCategory = async (req, res) => {
  try {
    const companyId = req.user.companyId;
    const categoryId = String(req.params.id || '').trim();

    if (!categoryId || categoryId === 'undefined' || categoryId === 'null') {
      return res.status(400).json({
        success: false,
        message: 'Valid category id is required',
      });
    }

    const category = await prisma.category.findFirst({
      where: {
        id: categoryId,
        companyId: companyId
      }
    });

    if (!category) {
      return res.status(404).json({
        success: false,
        message: 'Category not found'
      });
    }

    const allIds = await getAllChildrenIds(companyId, categoryId);
    const descendantCount = allIds.length - 1;

    // Block only when active products still use these categories
    const hasProducts = await prisma.product.count({
      where: {
        companyId: companyId,
        isActive: true,
        OR: [
          { categoryId: { in: allIds } },
          { subCategoryId: { in: allIds } },
        ],
      }
    });

    if (hasProducts > 0) {
      return res.status(400).json({
        success: false,
        message: `Cannot delete category with ${hasProducts} products. Please reassign or delete products first.`
      });
    }

    const toDelete = await prisma.category.findMany({
      where: { id: { in: allIds } },
    });

    await hardDeleteCategoryTree(companyId, allIds, category.parentId);
    await recordCategoryDeletes(toDelete);

    res.status(200).json({
      success: true,
      message: descendantCount > 0
        ? `Category and ${descendantCount} sub-categories deleted successfully`
        : 'Category deleted successfully',
      data: {
        categoryId: categoryId,
        descendantsDeleted: descendantCount
      }
    });
  } catch (error) {
    console.error('Delete category error:', error);
    if (error.code === 'P2003') {
      return res.status(409).json({
        success: false,
        message: 'Cannot delete category — linked records still exist. Reassign products first.',
      });
    }
    res.status(500).json({
      success: false,
      message: error.message || 'Server error',
      error: error.message
    });
  }
};

// ─── GET CATEGORY TREE (Hierarchical) ──────────────────────
const getCategoryTree = async (req, res) => {
  try {
    const companyId = req.user.companyId;

    const categories = await prisma.category.findMany({
      where: {
        companyId: companyId,
        isActive: true
      },
      include: {
        _count: {
          select: {
            products: {
              where: { isActive: true }
            }
          }
        }
      },
      orderBy: { level: 'asc' }
    });

    const transformed = categories.map(c => ({
      ...c,
      productCount: c._count.products
    }));

    const tree = buildCategoryTree(transformed);
    res.status(200).json({
      success: true,
      data: tree
    });
  } catch (error) {
    console.error('Get category tree error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message
    });
  }
};

// ─── GET SUB-CATEGORIES OF A CATEGORY ──────────────────────
const getSubCategories = async (req, res) => {
  try {
    const companyId = req.user.companyId;
    const { parentId } = req.params;

    // Verify parent belongs to company
    const parent = await prisma.category.findFirst({
      where: {
        id: parentId,
        companyId: companyId,
        isActive: true
      }
    });

    if (!parent) {
      return res.status(404).json({
        success: false,
        message: 'Parent category not found'
      });
    }

    const subCategories = await prisma.category.findMany({
      where: {
        parentId: parentId,
        companyId: companyId,
        isActive: true
      },
      include: {
        _count: {
          select: {
            products: {
              where: { isActive: true }
            },
            children: {
              where: { isActive: true }
            }
          }
        }
      },
      orderBy: { name: 'asc' }
    });

    const transformed = subCategories.map(c => ({
      ...c,
      productCount: c._count.products,
      subCategoryCount: c._count.children
    }));

    res.status(200).json({
      success: true,
      data: {
        parent: parent,
        subCategories: transformed,
        total: transformed.length
      }
    });
  } catch (error) {
    console.error('Get sub-categories error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message
    });
  }
};

// ─── GET CATEGORY BREADCRUMB ──────────────────────────────
const getCategoryBreadcrumb = async (req, res) => {
  try {
    const companyId = req.user.companyId;
    const { id } = req.params;

    const category = await prisma.category.findFirst({
      where: {
        id: id,
        companyId: companyId
      }
    });

    if (!category) {
      return res.status(404).json({
        success: false,
        message: 'Category not found'
      });
    }

    const breadcrumb = [];
    let current = category;

    while (current) {
      breadcrumb.unshift({
        id: current.id,
        name: current.name,
        level: current.level
      });

      if (current.parentId) {
        const parent = await prisma.category.findFirst({
          where: {
            id: current.parentId,
            companyId: companyId
          }
        });
        current = parent;
      } else {
        current = null;
      }
    }

    res.status(200).json({
      success: true,
      data: breadcrumb
    });
  } catch (error) {
    console.error('Get breadcrumb error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message
    });
  }
};

// ─── GET CATEGORY STATS ────────────────────────────────────
const getCategoryStats = async (req, res) => {
  try {
    const companyId = req.user.companyId;

    const stats = await prisma.$transaction([
      prisma.category.count({
        where: { companyId: companyId, isActive: true }
      }),
      prisma.category.count({
        where: { 
          companyId: companyId, 
          isActive: true,
          parentId: null
        }
      }),
      prisma.category.count({
        where: { 
          companyId: companyId, 
          isActive: true,
          parentId: { not: null }
        }
      }),
      prisma.product.count({
        where: { 
          companyId: companyId, 
          isActive: true,
          categoryId: { not: null }
        }
      }),
      prisma.category.count({
        where: {
          companyId: companyId,
          isActive: true,
          children: {
            some: {}
          }
        }
      })
    ]);

    res.status(200).json({
      success: true,
      data: {
        totalCategories: stats[0],
        rootCategories: stats[1],
        subCategories: stats[2],
        categorizedProducts: stats[3],
        categoriesWithSubs: stats[4],
        uncategorizedProducts: await prisma.product.count({
          where: {
            companyId: companyId,
            isActive: true,
            categoryId: null
          }
        })
      }
    });
  } catch (error) {
    console.error('Get category stats error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message
    });
  }
};

module.exports = {
  getCategories,
  getCategoryById,
  createCategory,
  updateCategory,
  deleteCategory,
  getCategoryTree,
  getSubCategories,
  getCategoryBreadcrumb,
  getCategoryStats
};