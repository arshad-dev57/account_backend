const prisma = require('../../prisma/client');
const {
  ensureDefaultLocation,
  backfillCompanyLocationStock,
  adjustLocationStock,
  resolveLocationId,
} = require('../services/locationService');

function locationToJson(loc) {
  if (!loc) return null;
  return {
    id: loc.id,
    companyId: loc.companyId,
    name: loc.name,
    code: loc.code,
    type: loc.type,
    address: loc.address,
    phone: loc.phone,
    isDefault: loc.isDefault,
    isActive: loc.isActive,
    notes: loc.notes,
    createdAt: loc.createdAt,
    updatedAt: loc.updatedAt,
  };
}

// GET /api/warehouse/locations
const listLocations = async (req, res) => {
  try {
    const companyId = req.user.companyId;
    await ensureDefaultLocation(prisma, companyId, req.user.id);
    // Ensure legacy company stock is on the default warehouse so filters work
    await backfillCompanyLocationStock(companyId, req.user.id);

    const locations = await prisma.location.findMany({
      where: { companyId, isDeleted: false },
      orderBy: [{ isDefault: 'desc' }, { name: 'asc' }],
    });

    res.json({
      success: true,
      count: locations.length,
      data: locations.map(locationToJson),
    });
  } catch (error) {
    console.error('listLocations error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// POST /api/warehouse/locations
const createLocation = async (req, res) => {
  try {
    const companyId = req.user.companyId;
    const userId = req.user.id;
    const {
      name,
      code,
      type = 'Shop',
      address,
      phone,
      notes,
      isDefault = false,
    } = req.body;

    if (!name?.trim() || !code?.trim()) {
      return res.status(400).json({
        success: false,
        message: 'Name and code are required',
      });
    }

    const normalizedCode = code.trim().toUpperCase();
    const exists = await prisma.location.findFirst({
      where: { companyId, code: normalizedCode, isDeleted: false },
    });
    if (exists) {
      return res.status(400).json({
        success: false,
        message: 'Location code already exists',
      });
    }

    const location = await prisma.$transaction(async (tx) => {
      if (isDefault) {
        await tx.location.updateMany({
          where: { companyId, isDefault: true },
          data: { isDefault: false },
        });
      }

      const count = await tx.location.count({
        where: { companyId, isDeleted: false },
      });

      return tx.location.create({
        data: {
          companyId,
          name: name.trim(),
          code: normalizedCode,
          type: ['Warehouse', 'Shop', 'POS_Store'].includes(type)
            ? type
            : 'Shop',
          address: address || null,
          phone: phone || null,
          notes: notes || null,
          isDefault: isDefault || count === 0,
          createdBy: userId,
        },
      });
    });

    res.status(201).json({
      success: true,
      data: locationToJson(location),
      message: 'Location created',
    });
  } catch (error) {
    console.error('createLocation error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// PUT /api/warehouse/locations/:id
const updateLocation = async (req, res) => {
  try {
    const companyId = req.user.companyId;
    const { id } = req.params;
    const { name, code, type, address, phone, notes, isDefault, isActive } =
      req.body;

    const existing = await prisma.location.findFirst({
      where: { id, companyId, isDeleted: false },
    });
    if (!existing) {
      return res.status(404).json({ success: false, message: 'Location not found' });
    }

    if (code && code.trim().toUpperCase() !== existing.code) {
      const clash = await prisma.location.findFirst({
        where: {
          companyId,
          code: code.trim().toUpperCase(),
          isDeleted: false,
          NOT: { id },
        },
      });
      if (clash) {
        return res.status(400).json({
          success: false,
          message: 'Location code already exists',
        });
      }
    }

    const location = await prisma.$transaction(async (tx) => {
      if (isDefault === true) {
        await tx.location.updateMany({
          where: { companyId, isDefault: true, NOT: { id } },
          data: { isDefault: false },
        });
      }

      return tx.location.update({
        where: { id },
        data: {
          ...(name != null ? { name: name.trim() } : {}),
          ...(code != null ? { code: code.trim().toUpperCase() } : {}),
          ...(type != null ? { type } : {}),
          ...(address !== undefined ? { address } : {}),
          ...(phone !== undefined ? { phone } : {}),
          ...(notes !== undefined ? { notes } : {}),
          ...(isDefault !== undefined ? { isDefault: !!isDefault } : {}),
          ...(isActive !== undefined ? { isActive: !!isActive } : {}),
          updatedBy: req.user.id,
        },
      });
    });

    res.json({
      success: true,
      data: locationToJson(location),
      message: 'Location updated',
    });
  } catch (error) {
    console.error('updateLocation error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// DELETE /api/warehouse/locations/:id (soft)
const deleteLocation = async (req, res) => {
  try {
    const companyId = req.user.companyId;
    const { id } = req.params;

    const existing = await prisma.location.findFirst({
      where: { id, companyId, isDeleted: false },
    });
    if (!existing) {
      return res.status(404).json({ success: false, message: 'Location not found' });
    }
    if (existing.isDefault) {
      return res.status(400).json({
        success: false,
        message: 'Cannot delete the default location. Set another default first.',
      });
    }

    const stockRows = await prisma.productStock.aggregate({
      where: { locationId: id },
      _sum: { currentStock: true },
    });
    if ((stockRows._sum.currentStock || 0) > 0) {
      return res.status(400).json({
        success: false,
        message: 'Location still has stock. Transfer stock out before deleting.',
      });
    }

    await prisma.location.update({
      where: { id },
      data: { isDeleted: true, isActive: false, updatedBy: req.user.id },
    });

    res.json({ success: true, message: 'Location deleted' });
  } catch (error) {
    console.error('deleteLocation error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// GET /api/warehouse/locations/:id/stock
const getLocationStock = async (req, res) => {
  try {
    const companyId = req.user.companyId;
    const { id } = req.params;

    const location = await prisma.location.findFirst({
      where: { id, companyId, isDeleted: false },
    });
    if (!location) {
      return res.status(404).json({ success: false, message: 'Location not found' });
    }

    const stocks = await prisma.productStock.findMany({
      where: { companyId, locationId: id },
      include: {
        product: {
          select: {
            id: true,
            name: true,
            sku: true,
            costPrice: true,
            sellingPrice: true,
            barcodeNumber: true,
          },
        },
      },
      orderBy: { updatedAt: 'desc' },
    });

    res.json({
      success: true,
      data: {
        location: locationToJson(location),
        stocks: stocks.map((s) => ({
          id: s.id,
          productId: s.productId,
          productName: s.product?.name,
          sku: s.product?.sku,
          barcodeNumber: s.product?.barcodeNumber,
          costPrice: s.product?.costPrice,
          sellingPrice: s.product?.sellingPrice,
          currentStock: s.currentStock,
          reservedStock: s.reservedStock,
          availableStock: s.availableStock,
          stockValue: s.currentStock * (s.product?.costPrice || 0),
        })),
      },
    });
  } catch (error) {
    console.error('getLocationStock error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// GET /api/warehouse/locations/product/:productId/stocks
const getProductLocationStocks = async (req, res) => {
  try {
    const companyId = req.user.companyId;
    const { productId } = req.params;

    const product = await prisma.product.findFirst({
      where: { id: productId, companyId },
      select: {
        id: true,
        name: true,
        sku: true,
        currentStock: true,
        costPrice: true,
      },
    });
    if (!product) {
      return res.status(404).json({ success: false, message: 'Product not found' });
    }

    const stocks = await prisma.productStock.findMany({
      where: { companyId, productId },
      include: { location: true },
      orderBy: { location: { name: 'asc' } },
    });

    res.json({
      success: true,
      data: {
        product,
        totalStock: product.currentStock,
        locations: stocks.map((s) => ({
          locationId: s.locationId,
          locationName: s.location?.name,
          locationCode: s.location?.code,
          locationType: s.location?.type,
          currentStock: s.currentStock,
          reservedStock: s.reservedStock,
          availableStock: s.availableStock,
        })),
      },
    });
  } catch (error) {
    console.error('getProductLocationStocks error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// POST /api/warehouse/locations/transfer
const transferStock = async (req, res) => {
  try {
    const companyId = req.user.companyId;
    const userId = req.user.id;
    const { productId, fromLocationId, toLocationId, quantity, notes } =
      req.body;

    if (!productId || !fromLocationId || !toLocationId || !quantity) {
      return res.status(400).json({
        success: false,
        message: 'productId, fromLocationId, toLocationId and quantity are required',
      });
    }
    if (fromLocationId === toLocationId) {
      return res.status(400).json({
        success: false,
        message: 'From and To locations must be different',
      });
    }

    const qty = parseInt(quantity, 10);
    if (!qty || qty <= 0) {
      return res.status(400).json({
        success: false,
        message: 'Quantity must be greater than 0',
      });
    }

    const result = await prisma.$transaction(async (tx) => {
      const product = await tx.product.findFirst({
        where: { id: productId, companyId },
      });
      if (!product) throw Object.assign(new Error('Product not found'), { statusCode: 404 });

      await resolveLocationId(tx, companyId, fromLocationId, userId);
      await resolveLocationId(tx, companyId, toLocationId, userId);

      const out = await adjustLocationStock(tx, {
        companyId,
        productId,
        locationId: fromLocationId,
        delta: -qty,
      });

      const inn = await adjustLocationStock(tx, {
        companyId,
        productId,
        locationId: toLocationId,
        delta: qty,
      });

      const movement = await tx.stockMovement.create({
        data: {
          productId,
          productName: product.name,
          type: 'Transfer',
          quantity: qty,
          previousStock: out.previousLocationStock,
          newStock: out.newLocationStock,
          stockType: 'bulk',
          stockDetails: {
            transfer: true,
            fromLocationId,
            toLocationId,
            qtyInAtDestination: inn.newLocationStock,
          },
          reason: 'Location Transfer',
          reference: `TRF-${Date.now()}`,
          status: 'Completed',
          notes: notes || '',
          createdBy: userId,
          companyId,
          locationId: fromLocationId,
          fromLocationId,
          toLocationId,
        },
      });

      return { movement, out, inn, product };
    });

    res.json({
      success: true,
      message: 'Stock transferred successfully',
      data: result,
    });
  } catch (error) {
    console.error('transferStock error:', error);
    res.status(error.statusCode || 500).json({
      success: false,
      message: error.message,
    });
  }
};

// POST /api/warehouse/locations/migrate
const migrateLegacyStock = async (req, res) => {
  try {
    const companyId = req.user.companyId;
    const location = await backfillCompanyLocationStock(
      companyId,
      req.user.id
    );
    res.json({
      success: true,
      message: 'Legacy stock migrated to default location',
      data: locationToJson(location),
    });
  } catch (error) {
    console.error('migrateLegacyStock error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

module.exports = {
  listLocations,
  createLocation,
  updateLocation,
  deleteLocation,
  getLocationStock,
  getProductLocationStocks,
  transferStock,
  migrateLegacyStock,
};
