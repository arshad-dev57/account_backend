const prisma = require('../../prisma/client');
const { resolveLocationId } = require('../services/locationService');

function generateRequisitionNumber() {
  const date = new Date();
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const random = Math.floor(Math.random() * 10000).toString().padStart(4, '0');
  return `PR-${year}${month}${day}-${random}`;
}

const EDITABLE_STATUSES = new Set(['Draft', 'Rejected']);
const APPROVABLE_STATUSES = new Set(['Submitted']);
const CONVERTIBLE_STATUSES = new Set(['Approved', 'Partially Converted']);

class PurchaseRequisitionModel {
  static async create(data) {
    const requisitionNumber = generateRequisitionNumber();

    return prisma.$transaction(async (tx) => {
      let suggestedSupplier = null;
      if (data.suggestedSupplierId) {
        suggestedSupplier = await tx.supplier.findFirst({
          where: { id: data.suggestedSupplierId, companyId: data.companyId },
        });
        if (!suggestedSupplier) {
          throw new Error('Suggested supplier not found for your company');
        }
      }

      for (const item of data.items) {
        const product = await tx.product.findFirst({
          where: { id: item.productId, companyId: data.companyId, isActive: true },
        });
        if (!product) {
          throw new Error(`Product ${item.productName || item.productId} not found`);
        }
      }

      const locationId = await resolveLocationId(
        tx,
        data.companyId,
        data.locationId,
        data.createdBy
      );

      const items = data.items.map((item) => ({
        productId: item.productId,
        productName: item.productName,
        sku: item.sku,
        quantity: Number(item.quantity),
        estimatedUnitPrice: Number(item.estimatedUnitPrice || 0),
        notes: item.notes || null,
        purpose: item.purpose || null,
      }));

      const requisition = await tx.purchaseRequisition.create({
        data: {
          requisitionNumber,
          title: data.title || null,
          department: data.department || null,
          priority: data.priority || 'Normal',
          requiredDate: data.requiredDate ? new Date(data.requiredDate) : null,
          status: data.status || 'Draft',
          suggestedSupplierId: suggestedSupplier?.id || null,
          suggestedSupplierName: suggestedSupplier?.name || null,
          notes: data.notes || null,
          createdBy: data.createdBy,
          companyId: data.companyId,
          locationId,
          submittedAt: data.status === 'Submitted' ? new Date() : null,
          items: { create: items },
        },
        include: {
          items: { include: { product: true } },
          suggestedSupplier: true,
          creator: {
            select: { id: true, firstName: true, lastName: true, email: true },
          },
        },
      });

      return {
        ...requisition,
        totalItems: requisition.items.reduce((sum, item) => sum + item.quantity, 0),
        estimatedTotal: requisition.items.reduce(
          (sum, item) => sum + item.quantity * item.estimatedUnitPrice,
          0
        ),
        canEdit: EDITABLE_STATUSES.has(requisition.status),
        canSubmit: requisition.status === 'Draft',
        canApprove: APPROVABLE_STATUSES.has(requisition.status),
        canConvert: CONVERTIBLE_STATUSES.has(requisition.status),
      };
    });
  }

  static enrich(requisition) {
    if (!requisition) return null;
    const totalItems = (requisition.items || []).reduce((sum, item) => sum + item.quantity, 0);
    const estimatedTotal = (requisition.items || []).reduce(
      (sum, item) => sum + item.quantity * (item.estimatedUnitPrice || 0),
      0
    );
    return {
      ...requisition,
      totalItems,
      estimatedTotal,
      canEdit: EDITABLE_STATUSES.has(requisition.status),
      canSubmit: requisition.status === 'Draft',
      canApprove: APPROVABLE_STATUSES.has(requisition.status),
      canReject: APPROVABLE_STATUSES.has(requisition.status),
      canConvert: CONVERTIBLE_STATUSES.has(requisition.status),
      canCancel: ['Draft', 'Submitted', 'Approved', 'Rejected', 'Partially Converted'].includes(
        requisition.status
      ),
    };
  }

  static async findById(id, companyId) {
    const requisition = await prisma.purchaseRequisition.findFirst({
      where: {
        id,
        ...(companyId ? { companyId } : {}),
        isActive: true,
        isDeleted: false,
      },
      include: {
        items: { include: { product: true } },
        suggestedSupplier: true,
        purchaseOrders: {
          where: { isActive: true, isDeleted: false },
          select: {
            id: true,
            orderNumber: true,
            status: true,
            grandTotal: true,
            supplierName: true,
            createdAt: true,
          },
        },
        creator: {
          select: { id: true, firstName: true, lastName: true, email: true },
        },
        approver: {
          select: { id: true, firstName: true, lastName: true, email: true },
        },
        location: true,
      },
    });
    return this.enrich(requisition);
  }

  static async findAll(filters = {}) {
    const {
      companyId,
      locationId,
      status,
      search,
      page = 1,
      limit = 20,
    } = filters;

    const where = {
      companyId,
      isActive: true,
      isDeleted: false,
      ...(locationId ? { locationId } : {}),
      ...(status ? { status } : {}),
      ...(search
        ? {
            OR: [
              { requisitionNumber: { contains: search, mode: 'insensitive' } },
              { title: { contains: search, mode: 'insensitive' } },
              { department: { contains: search, mode: 'insensitive' } },
              { suggestedSupplierName: { contains: search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };

    const [rows, total] = await Promise.all([
      prisma.purchaseRequisition.findMany({
        where,
        include: {
          items: true,
          suggestedSupplier: true,
          creator: {
            select: { id: true, firstName: true, lastName: true, email: true },
          },
          purchaseOrders: {
            where: { isActive: true, isDeleted: false },
            select: { id: true, orderNumber: true, status: true },
          },
        },
        orderBy: { createdAt: 'desc' },
        skip: (Number(page) - 1) * Number(limit),
        take: Number(limit),
      }),
      prisma.purchaseRequisition.count({ where }),
    ]);

    return {
      data: rows.map((row) => this.enrich(row)),
      pagination: {
        page: Number(page),
        limit: Number(limit),
        total,
        pages: Math.ceil(total / Number(limit)),
      },
    };
  }

  static async update(id, data, companyId) {
    return prisma.$transaction(async (tx) => {
      const existing = await tx.purchaseRequisition.findFirst({
        where: { id, companyId, isActive: true, isDeleted: false },
        include: { items: true },
      });
      if (!existing) throw new Error('Purchase requisition not found');
      if (!EDITABLE_STATUSES.has(existing.status)) {
        throw new Error(`Cannot edit requisition in status ${existing.status}`);
      }

      let suggestedSupplier = null;
      if (data.suggestedSupplierId) {
        suggestedSupplier = await tx.supplier.findFirst({
          where: { id: data.suggestedSupplierId, companyId },
        });
        if (!suggestedSupplier) throw new Error('Suggested supplier not found');
      }

      if (data.items?.length) {
        for (const item of data.items) {
          const product = await tx.product.findFirst({
            where: { id: item.productId, companyId, isActive: true },
          });
          if (!product) {
            throw new Error(`Product ${item.productName || item.productId} not found`);
          }
        }
        await tx.purchaseRequisitionItem.deleteMany({
          where: { purchaseRequisitionId: id },
        });
      }

      const updated = await tx.purchaseRequisition.update({
        where: { id },
        data: {
          title: data.title !== undefined ? data.title : existing.title,
          department: data.department !== undefined ? data.department : existing.department,
          priority: data.priority || existing.priority,
          requiredDate:
            data.requiredDate !== undefined
              ? data.requiredDate
                ? new Date(data.requiredDate)
                : null
              : existing.requiredDate,
          suggestedSupplierId:
            data.suggestedSupplierId !== undefined
              ? suggestedSupplier?.id || null
              : existing.suggestedSupplierId,
          suggestedSupplierName:
            data.suggestedSupplierId !== undefined
              ? suggestedSupplier?.name || null
              : existing.suggestedSupplierName,
          notes: data.notes !== undefined ? data.notes : existing.notes,
          updatedBy: data.updatedBy,
          ...(data.items?.length
            ? {
                items: {
                  create: data.items.map((item) => ({
                    productId: item.productId,
                    productName: item.productName,
                    sku: item.sku,
                    quantity: Number(item.quantity),
                    estimatedUnitPrice: Number(item.estimatedUnitPrice || 0),
                    notes: item.notes || null,
                    purpose: item.purpose || null,
                  })),
                },
              }
            : {}),
        },
        include: {
          items: { include: { product: true } },
          suggestedSupplier: true,
          creator: {
            select: { id: true, firstName: true, lastName: true, email: true },
          },
        },
      });

      return this.enrich(updated);
    });
  }

  static async submit(id, companyId, userId) {
    const existing = await prisma.purchaseRequisition.findFirst({
      where: { id, companyId, isActive: true, isDeleted: false },
      include: { items: true },
    });
    if (!existing) throw new Error('Purchase requisition not found');
    if (existing.status !== 'Draft' && existing.status !== 'Rejected') {
      throw new Error('Only draft or rejected requisitions can be submitted');
    }
    if (!existing.items.length) throw new Error('Requisition must have at least one item');

    const updated = await prisma.purchaseRequisition.update({
      where: { id },
      data: {
        status: 'Submitted',
        submittedAt: new Date(),
        rejectionReason: null,
        rejectedAt: null,
        updatedBy: userId,
      },
      include: {
        items: true,
        suggestedSupplier: true,
        creator: {
          select: { id: true, firstName: true, lastName: true, email: true },
        },
      },
    });
    return this.enrich(updated);
  }

  static async approve(id, companyId, userId) {
    const existing = await prisma.purchaseRequisition.findFirst({
      where: { id, companyId, isActive: true, isDeleted: false },
    });
    if (!existing) throw new Error('Purchase requisition not found');
    if (!APPROVABLE_STATUSES.has(existing.status)) {
      throw new Error('Only submitted requisitions can be approved');
    }

    const updated = await prisma.purchaseRequisition.update({
      where: { id },
      data: {
        status: 'Approved',
        approvedAt: new Date(),
        approvedBy: userId,
        updatedBy: userId,
      },
      include: {
        items: true,
        suggestedSupplier: true,
        creator: {
          select: { id: true, firstName: true, lastName: true, email: true },
        },
        approver: {
          select: { id: true, firstName: true, lastName: true, email: true },
        },
      },
    });
    return this.enrich(updated);
  }

  static async reject(id, companyId, userId, reason) {
    const existing = await prisma.purchaseRequisition.findFirst({
      where: { id, companyId, isActive: true, isDeleted: false },
    });
    if (!existing) throw new Error('Purchase requisition not found');
    if (!APPROVABLE_STATUSES.has(existing.status)) {
      throw new Error('Only submitted requisitions can be rejected');
    }

    const updated = await prisma.purchaseRequisition.update({
      where: { id },
      data: {
        status: 'Rejected',
        rejectedAt: new Date(),
        rejectionReason: reason || 'Rejected',
        updatedBy: userId,
      },
      include: {
        items: true,
        suggestedSupplier: true,
        creator: {
          select: { id: true, firstName: true, lastName: true, email: true },
        },
      },
    });
    return this.enrich(updated);
  }

  static async cancel(id, companyId, userId) {
    const existing = await prisma.purchaseRequisition.findFirst({
      where: { id, companyId, isActive: true, isDeleted: false },
    });
    if (!existing) throw new Error('Purchase requisition not found');
    if (existing.status === 'Converted') {
      throw new Error('Converted requisitions cannot be cancelled');
    }

    const updated = await prisma.purchaseRequisition.update({
      where: { id },
      data: {
        status: 'Cancelled',
        cancelledAt: new Date(),
        updatedBy: userId,
      },
      include: { items: true },
    });
    return this.enrich(updated);
  }

  static async softDelete(id, companyId, userId) {
    const existing = await prisma.purchaseRequisition.findFirst({
      where: { id, companyId, isActive: true, isDeleted: false },
    });
    if (!existing) throw new Error('Purchase requisition not found');
    if (!['Draft', 'Cancelled', 'Rejected'].includes(existing.status)) {
      throw new Error('Only draft, cancelled, or rejected requisitions can be deleted');
    }

    await prisma.purchaseRequisition.update({
      where: { id },
      data: { isDeleted: true, isActive: false, updatedBy: userId },
    });
    return true;
  }

  static async getStats(companyId, locationId) {
    const where = {
      companyId,
      isActive: true,
      isDeleted: false,
      ...(locationId ? { locationId } : {}),
    };

    const [total, draft, submitted, approved, converted] = await Promise.all([
      prisma.purchaseRequisition.count({ where }),
      prisma.purchaseRequisition.count({ where: { ...where, status: 'Draft' } }),
      prisma.purchaseRequisition.count({ where: { ...where, status: 'Submitted' } }),
      prisma.purchaseRequisition.count({ where: { ...where, status: 'Approved' } }),
      prisma.purchaseRequisition.count({
        where: { ...where, status: { in: ['Converted', 'Partially Converted'] } },
      }),
    ]);

    return { total, draft, submitted, approved, converted };
  }

  static async markConverted(id, companyId, userId, tx = prisma) {
    const existing = await tx.purchaseRequisition.findFirst({
      where: { id, companyId, isActive: true, isDeleted: false },
      include: { items: true, purchaseOrders: { where: { isActive: true, isDeleted: false }, include: { items: true } } },
    });
    if (!existing) return null;

    const requestedByProduct = {};
    for (const item of existing.items) {
      requestedByProduct[item.productId] = (requestedByProduct[item.productId] || 0) + item.quantity;
    }

    const orderedByProduct = {};
    for (const po of existing.purchaseOrders || []) {
      for (const item of po.items || []) {
        orderedByProduct[item.productId] = (orderedByProduct[item.productId] || 0) + item.quantity;
      }
    }

    const fullyConverted = Object.keys(requestedByProduct).every(
      (productId) => (orderedByProduct[productId] || 0) >= requestedByProduct[productId]
    );

    return tx.purchaseRequisition.update({
      where: { id },
      data: {
        status: fullyConverted ? 'Converted' : 'Partially Converted',
        convertedAt: fullyConverted ? new Date() : existing.convertedAt || new Date(),
        updatedBy: userId,
      },
    });
  }
}

module.exports = PurchaseRequisitionModel;
