/**
 * Restaurant recipe (BOM) stock helpers.
 * MENU_ITEM → deduct ingredients; READY_ITEM → deduct own stock.
 * Retail READY_ITEM / trackInventory flows stay unchanged outside this module.
 */
const { adjustLocationStock, resolveLocationId } = require('../../warehouse/services/locationService');

const ITEM_TYPES = {
  MENU_ITEM: 'MENU_ITEM',
  READY_ITEM: 'READY_ITEM',
  INGREDIENT: 'INGREDIENT',
  MODIFIER: 'MODIFIER',
};

function normalizeItemType(raw) {
  const t = String(raw || ITEM_TYPES.READY_ITEM).toUpperCase().trim();
  return ITEM_TYPES[t] || ITEM_TYPES.READY_ITEM;
}

function defaultsForItemType(itemType) {
  const t = normalizeItemType(itemType);
  if (t === ITEM_TYPES.MENU_ITEM) {
    return { trackInventory: false, showInPos: true };
  }
  if (t === ITEM_TYPES.INGREDIENT) {
    return { trackInventory: true, showInPos: false };
  }
  if (t === ITEM_TYPES.MODIFIER) {
    return { trackInventory: false, showInPos: true };
  }
  // READY_ITEM
  return { trackInventory: true, showInPos: true };
}

function round4(n) {
  return Math.round((Number(n) || 0) * 10000) / 10000;
}

/**
 * Load recipe + ingredient stock for a menu product.
 */
async function getRecipeWithIngredients(tx, { companyId, menuProductId }) {
  const recipe = await tx.recipe.findFirst({
    where: { companyId, menuProductId, isActive: true },
    include: {
      items: {
        include: {
          ingredientProduct: {
            select: {
              id: true,
              name: true,
              costPrice: true,
              averageCost: true,
              currentStock: true,
              availableStock: true,
              trackInventory: true,
              stockUnitName: true,
              itemType: true,
            },
          },
        },
        orderBy: { sortOrder: 'asc' },
      },
    },
  });
  return recipe;
}

function computeRecipeCost(recipe) {
  if (!recipe?.items?.length) return 0;
  return round4(
    recipe.items.reduce((sum, row) => {
      const unitCost = Number(
        row.ingredientProduct?.averageCost ??
          row.ingredientProduct?.costPrice ??
          0
      );
      return sum + unitCost * (Number(row.quantity) || 0);
    }, 0)
  );
}

/**
 * How many menu portions can be made from current ingredient stock.
 * Returns Infinity if no recipe / no tracked ingredients.
 */
function maxPortionsFromRecipe(recipe, stockByProductId = null) {
  if (!recipe?.items?.length) return Infinity;
  let max = Infinity;
  for (const row of recipe.items) {
    const ing = row.ingredientProduct;
    if (!ing || ing.trackInventory === false) continue;
    const need = Number(row.quantity) || 0;
    if (need <= 0) continue;
    const avail = stockByProductId
      ? Number(stockByProductId[ing.id] ?? 0)
      : Number(ing.availableStock ?? ing.currentStock ?? 0);
    max = Math.min(max, Math.floor(avail / need + 1e-9));
  }
  return max === Infinity ? Infinity : Math.max(0, max);
}

/**
 * Build shortage list for a menu item qty against recipe.
 */
function recipeShortages(recipe, sellQty) {
  const shortages = [];
  if (!recipe?.items?.length) return shortages;
  const qty = Number(sellQty) || 0;
  for (const row of recipe.items) {
    const ing = row.ingredientProduct;
    if (!ing || ing.trackInventory === false) continue;
    const needEach = Number(row.quantity) || 0;
    const required = round4(needEach * qty);
    const avail = Number(ing.availableStock ?? ing.currentStock ?? 0);
    if (required > avail + 1e-9) {
      shortages.push({
        ingredientId: ing.id,
        ingredientName: ing.name,
        required,
        available: avail,
        uom: row.uom || ing.stockUnitName || 'Pcs',
      });
    }
  }
  return shortages;
}

/**
 * Deduct stock for one sold line (menu via recipe, ready via own stock).
 * Idempotent when caller passes a unique reference + checks order.stockDeductedAt.
 */
async function deductLineStock(tx, {
  companyId,
  locationId,
  product,
  quantity,
  reference,
  movementType = 'RESTAURANT_KOT',
  reason = 'Restaurant KOT stock out',
  userId = null,
}) {
  const itemType = normalizeItemType(product.itemType);
  const qty = Number(quantity) || 0;
  if (qty <= 0) return { movements: [], skipped: true };

  const movements = [];

  if (itemType === ITEM_TYPES.MENU_ITEM) {
    const recipe = await getRecipeWithIngredients(tx, {
      companyId,
      menuProductId: product.id,
    });
    // No recipe → sellable, no stock movement on the menu SKU
    if (!recipe?.items?.length) {
      return { movements: [], skipped: true, noRecipe: true };
    }

    const shortages = recipeShortages(recipe, qty);
    if (shortages.length) {
      const msg = shortages
        .map((s) => `${s.ingredientName} (need ${s.required} ${s.uom}, have ${s.available})`)
        .join('; ');
      const err = new Error(`Insufficient ingredients for ${product.name}: ${msg}`);
      err.statusCode = 400;
      err.shortages = shortages;
      throw err;
    }

    for (const row of recipe.items) {
      const ing = row.ingredientProduct;
      if (!ing) continue;
      if (ing.trackInventory === false) continue;
      const baseQty = round4((Number(row.quantity) || 0) * qty);
      if (baseQty <= 0) continue;

      const adj = await adjustLocationStock(tx, {
        companyId,
        productId: ing.id,
        locationId,
        delta: -baseQty,
        checkAvailable: true,
        productName: ing.name,
      });

      const movement = await tx.stockMovement.create({
        data: {
          productId: ing.id,
          productName: ing.name,
          type: 'stock_out',
          movementType,
          quantity: baseQty,
          enteredQuantity: baseQty,
          baseQuantity: baseQty,
          conversionFactor: 1,
          uom: row.uom || ing.stockUnitName || 'Pcs',
          previousStock: adj.previousLocationStock,
          newStock: adj.newLocationStock,
          unitCost: Number(ing.averageCost ?? ing.costPrice ?? 0),
          totalValue: round4(Number(ing.averageCost ?? ing.costPrice ?? 0) * baseQty),
          reason,
          reference: reference || null,
          notes: `Recipe ingredient for ${product.name} × ${qty}`,
          locationId: locationId || null,
          companyId,
          createdBy: userId,
        },
      });
      movements.push(movement);
    }
    return { movements, itemType, recipeCost: computeRecipeCost(recipe) * qty };
  }

  // READY_ITEM / MODIFIER with tracking / default
  if (product.trackInventory === false) {
    return { movements: [], skipped: true };
  }

  const adj = await adjustLocationStock(tx, {
    companyId,
    productId: product.id,
    locationId,
    delta: -qty,
    checkAvailable: true,
    productName: product.name,
  });

  const movement = await tx.stockMovement.create({
    data: {
      productId: product.id,
      productName: product.name,
      type: 'stock_out',
      movementType,
      quantity: qty,
      enteredQuantity: qty,
      baseQuantity: qty,
      conversionFactor: 1,
      uom: product.stockUnitName || 'Pcs',
      previousStock: adj.previousLocationStock,
      newStock: adj.newLocationStock,
      unitCost: Number(product.averageCost ?? product.costPrice ?? 0),
      totalValue: round4(Number(product.averageCost ?? product.costPrice ?? 0) * qty),
      reason,
      reference: reference || null,
      notes: reason,
      locationId: locationId || null,
      companyId,
      createdBy: userId,
    },
  });
  movements.push(movement);
  return { movements, itemType };
}

/**
 * Deduct all lines for a restaurant order (KOT). Idempotent via stockDeductedAt.
 */
async function deductByRecipeForOrder(tx, {
  companyId,
  order,
  userId = null,
}) {
  if (!order) return { alreadyDeducted: true, movements: [] };
  if (order.stockDeductedAt) {
    return { alreadyDeducted: true, movements: [] };
  }

  const locationId =
    order.locationId ||
    (await resolveLocationId(tx, { companyId, required: false }));

  const deductionKey = `kot:${order.id}`;
  const allMovements = [];

  for (const line of order.lines || []) {
    if (!line.productId) continue;
    const product = await tx.product.findFirst({
      where: { id: line.productId, companyId },
    });
    if (!product) {
      const err = new Error(`Product not found: ${line.productName || line.productId}`);
      err.statusCode = 400;
      throw err;
    }

    const result = await deductLineStock(tx, {
      companyId,
      locationId,
      product,
      quantity: line.quantity,
      reference: deductionKey,
      movementType: 'RESTAURANT_KOT',
      reason: `KOT #${order.ticketNumber || order.id}`,
      userId,
    });
    allMovements.push(...(result.movements || []));
  }

  await tx.restaurantOrder.update({
    where: { id: order.id },
    data: {
      stockDeductedAt: new Date(),
      stockDeductionKey: deductionKey,
    },
  });

  return { alreadyDeducted: false, movements: allMovements, deductionKey };
}

/**
 * After cancel/void of a KOT that already deducted stock: post wastage audit
 * (do NOT restore stock). Idempotent via wastagePostedAt.
 */
async function postWastageForCancelledOrder(tx, {
  companyId,
  order,
  userId = null,
}) {
  if (!order?.stockDeductedAt) {
    return { skipped: true, reason: 'no_prior_deduction' };
  }
  if (order.wastagePostedAt) {
    return { skipped: true, reason: 'already_posted' };
  }

  const reference = order.stockDeductionKey || `kot:${order.id}`;
  const prior = await tx.stockMovement.findMany({
    where: {
      companyId,
      reference,
      type: 'stock_out',
      movementType: 'RESTAURANT_KOT',
    },
  });

  const wastageRows = [];
  for (const m of prior) {
    const row = await tx.stockMovement.create({
      data: {
        productId: m.productId,
        productName: m.productName,
        type: 'wastage',
        movementType: 'RESTAURANT_CANCEL_WASTAGE',
        quantity: m.quantity,
        enteredQuantity: m.enteredQuantity ?? m.quantity,
        baseQuantity: m.baseQuantity ?? m.quantity,
        conversionFactor: m.conversionFactor || 1,
        uom: m.uom || 'Pcs',
        previousStock: m.newStock,
        newStock: m.newStock,
        unitCost: m.unitCost,
        totalValue: m.totalValue,
        reason: `Wastage after cancel — KOT #${order.ticketNumber || order.id}`,
        reference: `wastage:${order.id}`,
        notes: 'Cancel after kitchen send — stock not restored',
        locationId: m.locationId || order.locationId || null,
        companyId,
        createdBy: userId,
      },
    });
    wastageRows.push(row);
  }

  await tx.restaurantOrder.update({
    where: { id: order.id },
    data: { wastagePostedAt: new Date() },
  });

  return { skipped: false, wastageRows };
}

/**
 * POS grid availability for a product (restaurant).
 */
async function getPosAvailability(tx, { companyId, product, locationId = null }) {
  const itemType = normalizeItemType(product.itemType);
  if (product.showInPos === false || itemType === ITEM_TYPES.INGREDIENT) {
    return {
      showInPos: false,
      available: false,
      reason: 'hidden',
      displayStock: null,
      maxQty: 0,
    };
  }

  if (itemType === ITEM_TYPES.MENU_ITEM) {
    const recipe = await getRecipeWithIngredients(tx, {
      companyId,
      menuProductId: product.id,
    });
    if (!recipe?.items?.length) {
      return {
        showInPos: true,
        available: true,
        reason: 'no_recipe',
        displayStock: null,
        maxQty: Infinity,
        recipeCost: 0,
      };
    }
    // Prefer location stock when provided
    let stockMap = null;
    if (locationId) {
      const ids = recipe.items.map((i) => i.ingredientProductId);
      const rows = await tx.productStock.findMany({
        where: { productId: { in: ids }, locationId },
      });
      stockMap = Object.fromEntries(
        rows.map((r) => [r.productId, Number(r.availableStock ?? r.currentStock ?? 0)])
      );
      for (const item of recipe.items) {
        const ing = item.ingredientProduct;
        if (!ing || ing.trackInventory === false) continue;
        if (stockMap[ing.id] == null) {
          stockMap[ing.id] = Number(ing.availableStock ?? ing.currentStock ?? 0);
        }
      }
    }
    const maxQty = maxPortionsFromRecipe(recipe, stockMap);
    return {
      showInPos: true,
      available: maxQty > 0,
      reason: maxQty > 0 ? 'ok' : 'insufficient_ingredients',
      displayStock: null,
      maxQty: maxQty === Infinity ? 999999 : maxQty,
      recipeCost: computeRecipeCost(recipe),
      shortages: maxQty > 0 ? [] : recipeShortages(recipe, 1),
    };
  }

  // READY_ITEM / MODIFIER
  if (product.trackInventory === false) {
    return {
      showInPos: true,
      available: true,
      reason: 'untracked',
      displayStock: null,
      maxQty: Infinity,
    };
  }

  let stock = Number(product.availableStock ?? product.currentStock ?? 0);
  if (locationId) {
    const row = await tx.productStock.findFirst({
      where: { productId: product.id, locationId },
    });
    if (row) stock = Number(row.availableStock ?? row.currentStock ?? 0);
  }
  return {
    showInPos: true,
    available: stock > 0,
    reason: stock > 0 ? 'ok' : 'out_of_stock',
    displayStock: stock,
    maxQty: Math.max(0, stock),
  };
}

module.exports = {
  ITEM_TYPES,
  normalizeItemType,
  defaultsForItemType,
  getRecipeWithIngredients,
  computeRecipeCost,
  maxPortionsFromRecipe,
  recipeShortages,
  deductLineStock,
  deductByRecipeForOrder,
  postWastageForCancelledOrder,
  getPosAvailability,
};
