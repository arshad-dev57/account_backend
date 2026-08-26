/**
 * POS master-data change log.
 * Isolated from ERP CRUD — callers record after a successful write.
 */
const prisma = require('../../prisma/client');

const ENTITY = {
  CATEGORY: 'CATEGORY',
  SUBCATEGORY: 'SUBCATEGORY',
  PRODUCT: 'PRODUCT',
};

function categoryEntityType(category) {
  return category?.parentId ? ENTITY.SUBCATEGORY : ENTITY.CATEGORY;
}

function categoryPayload(category, isDeleted = false) {
  const deleted = Boolean(isDeleted || category.isDeleted || category.isActive === false);
  const base = {
    id: category.id,
    name: category.name,
    updatedAt: (category.updatedAt || new Date()).toISOString(),
    isDeleted: deleted,
    isActive: category.isActive !== false && !deleted,
  };
  if (category.parentId) {
    return { ...base, categoryId: category.parentId };
  }
  return { ...base, parentId: null };
}

function productPayload(product, categoryRow, isDeleted = false) {
  const deleted = Boolean(isDeleted || product.isActive === false);
  let categoryId = product.categoryId || null;
  let subcategoryId = null;
  if (categoryRow?.parentId) {
    subcategoryId = categoryRow.id;
    categoryId = categoryRow.parentId;
  }
  return {
    id: product.id,
    categoryId,
    subcategoryId,
    name: product.name,
    sku: product.sku || product.sku || '',
    barcode: product.barcodeNumber || product.barcodeNumber || product.barcode || '',
    price: Number(product.sellingPrice ?? product.sellingPrice ?? 0),
    taxRate: Number(product.taxRate ?? product.taxRate ?? 0),
    taxType: product.taxType || product.taxType || 'Exclusive',
    currentStock: Number(product.currentStock ?? product.availableStock ?? product.currentStock ?? 0),
    mainImage: product.mainImage || (Array.isArray(product.images) && product.images[0]) || '',
    isActive: !deleted,
    isDeleted: deleted,
    updatedAt: (product.updatedAt || new Date()).toISOString(),
  };
}

async function recordChange({ companyId, entityType, entityId, isDeleted, payload }) {
  if (!companyId || !entityId || !entityType) return null;
  try {
    return await prisma.posMasterSyncChange.create({
      data: {
        companyId,
        entityType,
        entityId,
        isDeleted: Boolean(isDeleted),
        payload,
      },
    });
  } catch (err) {
    console.error('[pos-master-sync] changelog write failed:', err.message);
    return null;
  }
}

async function recordCategoryChange(category, { isDeleted = false } = {}) {
  if (!category?.id || !category.companyId) return null;
  return recordChange({
    companyId: category.companyId,
    entityType: categoryEntityType(category),
    entityId: category.id,
    isDeleted,
    payload: categoryPayload(category, isDeleted),
  });
}

async function recordProductChange(product, { isDeleted = false } = {}) {
  if (!product?.id || !product.companyId) return null;
  let categoryRow = null;
  if (product.categoryId) {
    try {
      categoryRow = await prisma.category.findUnique({
        where: { id: product.categoryId },
        select: { id: true, parentId: true },
      });
    } catch {
      categoryRow = null;
    }
  }
  return recordChange({
    companyId: product.companyId,
    entityType: ENTITY.PRODUCT,
    entityId: product.id,
    isDeleted,
    payload: productPayload(product, categoryRow, isDeleted),
  });
}

async function recordCategoryDeletes(categories) {
  for (const category of categories || []) {
    await recordCategoryChange(category, { isDeleted: true });
  }
}

module.exports = {
  ENTITY,
  categoryPayload,
  productPayload,
  recordChange,
  recordCategoryChange,
  recordProductChange,
  recordCategoryDeletes,
};
