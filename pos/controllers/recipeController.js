const prisma = require('../../prisma/client');
const {
  normalizeItemType,
  computeRecipeCost,
  getRecipeWithIngredients,
} = require('../services/recipeStockService');

/** GET /api/pos/recipes/:menuProductId */
exports.getRecipe = async (req, res) => {
  try {
    const companyId = req.user.companyId;
    const menuProductId = req.params.menuProductId;
    const recipe = await getRecipeWithIngredients(prisma, { companyId, menuProductId });
    if (!recipe) {
      return res.json({ success: true, data: null });
    }
    res.json({
      success: true,
      data: {
        ...recipe,
        recipeCost: computeRecipeCost(recipe),
      },
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * PUT /api/pos/recipes/:menuProductId
 * Body: { notes?, items: [{ ingredientProductId, quantity, uom?, notes? }] }
 */
exports.upsertRecipe = async (req, res) => {
  try {
    const companyId = req.user.companyId;
    const userId = req.user.id;
    const menuProductId = req.params.menuProductId;
    const { notes, items = [] } = req.body || {};

    const product = await prisma.product.findFirst({
      where: { id: menuProductId, companyId },
    });
    if (!product) {
      return res.status(404).json({ success: false, message: 'Menu product not found' });
    }
    if (normalizeItemType(product.itemType) !== 'MENU_ITEM') {
      return res.status(400).json({
        success: false,
        message: 'Recipes can only be saved on MENU_ITEM products',
      });
    }

    const cleaned = [];
    for (const raw of Array.isArray(items) ? items : []) {
      const ingredientProductId = String(raw.ingredientProductId || '').trim();
      const quantity = Number(raw.quantity);
      if (!ingredientProductId || !(quantity > 0)) continue;
      if (ingredientProductId === menuProductId) {
        return res.status(400).json({
          success: false,
          message: 'A menu item cannot be an ingredient of itself',
        });
      }
      const ing = await prisma.product.findFirst({
        where: { id: ingredientProductId, companyId },
        select: { id: true, name: true, itemType: true },
      });
      if (!ing) {
        return res.status(400).json({
          success: false,
          message: `Ingredient not found: ${ingredientProductId}`,
        });
      }
      cleaned.push({
        ingredientProductId,
        quantity,
        uom: String(raw.uom || 'Pcs').trim() || 'Pcs',
        notes: raw.notes ? String(raw.notes) : null,
      });
    }

    const recipe = await prisma.$transaction(async (tx) => {
      const existing = await tx.recipe.findFirst({
        where: { companyId, menuProductId },
      });
      let recipeId;
      if (existing) {
        await tx.recipe.update({
          where: { id: existing.id },
          data: {
            notes: notes != null ? String(notes) : existing.notes,
            updatedBy: userId,
            isActive: true,
          },
        });
        recipeId = existing.id;
        await tx.recipeItem.deleteMany({ where: { recipeId } });
      } else {
        const created = await tx.recipe.create({
          data: {
            companyId,
            menuProductId,
            name: product.name,
            notes: notes != null ? String(notes) : null,
            createdBy: userId,
            updatedBy: userId,
          },
        });
        recipeId = created.id;
      }

      if (cleaned.length) {
        await tx.recipeItem.createMany({
          data: cleaned.map((row, idx) => ({
            recipeId,
            ingredientProductId: row.ingredientProductId,
            quantity: row.quantity,
            uom: row.uom,
            notes: row.notes,
            sortOrder: idx,
          })),
        });
      }

      return getRecipeWithIngredients(tx, { companyId, menuProductId });
    });

    res.json({
      success: true,
      data: {
        ...recipe,
        recipeCost: computeRecipeCost(recipe),
      },
    });
  } catch (error) {
    console.error('upsertRecipe error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

/** DELETE /api/pos/recipes/:menuProductId */
exports.deleteRecipe = async (req, res) => {
  try {
    const companyId = req.user.companyId;
    const menuProductId = req.params.menuProductId;
    await prisma.recipe.deleteMany({ where: { companyId, menuProductId } });
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};
