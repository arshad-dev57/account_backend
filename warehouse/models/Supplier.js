// warehouse/models/Supplier.js - Prisma Version (FIXED)
const prisma = require('../../prisma/client');  // ✅ CORRECT PATH

class SupplierModel {
  // ============================================================
  // GET ALL SUPPLIERS with pagination, search, filters
  // ============================================================
  static async findMany(filter = {}, options = {}) {
    const { skip, take, orderBy = { createdAt: 'desc' }, include } = options;
    
    return await prisma.supplier.findMany({
      where: filter,
      skip,
      take,
      orderBy,
      include: include || {
        creator: {
          select: { id: true, firstName: true, lastName: true, email: true }
        }
      }
    });
  }

  // ============================================================
  // COUNT SUPPLIERS
  // ============================================================
  static async count(filter = {}) {
    return await prisma.supplier.count({ where: filter });
  }

  // ============================================================
  // FIND SUPPLIER BY ID
  // ============================================================
  static async findById(id) {
    return await prisma.supplier.findUnique({
      where: { id },
      include: {
        creator: {
          select: { id: true, firstName: true, lastName: true, email: true }
        },
        products: {
          select: { id: true, name: true, sku: true, sellingPrice: true }
        }
      }
    });
  }

  // ============================================================
  // FIND SUPPLIER BY CODE
  // ============================================================
  static async findByCode(code) {
    return await prisma.supplier.findUnique({
      where: { code }
    });
  }

  // ============================================================
  // FIND SUPPLIER BY EMAIL
  // ============================================================
  static async findByEmail(email) {
    return await prisma.supplier.findUnique({
      where: { email }
    });
  }

  // ============================================================
  // SEARCH SUPPLIERS
  // ============================================================
  static async search(query, options = {}) {
    const { skip, take } = options;
    
    const filter = {
      OR: [
        { name: { contains: query, mode: 'insensitive' } },
        { companyName: { contains: query, mode: 'insensitive' } },
        { contactPerson: { contains: query, mode: 'insensitive' } },
        { email: { contains: query, mode: 'insensitive' } },
        { phone: { contains: query, mode: 'insensitive' } },
        { department: { contains: query, mode: 'insensitive' } },
        { city: { contains: query, mode: 'insensitive' } },
        { country: { contains: query, mode: 'insensitive' } },
        { industry: { contains: query, mode: 'insensitive' } },
        { gstNumber: { contains: query, mode: 'insensitive' } },
        { code: { contains: query, mode: 'insensitive' } }
      ]
    };

    const suppliers = await prisma.supplier.findMany({
      where: filter,
      skip,
      take,
      orderBy: { createdAt: 'desc' },
      include: {
        creator: {
          select: { id: true, firstName: true, lastName: true, email: true }
        }
      }
    });

    const total = await prisma.supplier.count({ where: filter });

    return { suppliers, total };
  }

  // ============================================================
  // CREATE SUPPLIER
  // ============================================================
  static async create(data) {
    // Auto-generate code if not provided
    let code = data.code;
    if (!code) {
      const prefix = data.name.substring(0, 3).toUpperCase();
      const count = await prisma.supplier.count();
      const serial = String(count + 1).padStart(3, '0');
      code = `SUP-${prefix}-${serial}`;
    }

    const supplierData = {
      name: data.name,
      companyName: data.companyName || '',
      code,
      contactPerson: data.contactPerson || '',
      department: data.department || '',
      phone: data.phone || '',
      email: data.email || '',
      address: data.address || '',
      city: data.city || '',
      country: data.country || 'Pakistan',
      industry: data.industry || '',
      businessType: data.businessType || '',
      paymentTerms: data.paymentTerms || 'Net 30',
      gstNumber: data.gstNumber || '',
      taxId: data.taxId || '',
      status: data.status || 'active',
      isPreferred: data.isPreferred || false,
      isVerified: data.isVerified || false,
      notes: data.notes || '',
      createdBy: data.createdBy
    };

    return await prisma.supplier.create({
      data: supplierData,
      include: {
        creator: {
          select: { id: true, firstName: true, lastName: true, email: true }
        }
      }
    });
  }

  // ============================================================
  // UPDATE SUPPLIER
  // ============================================================
  static async update(id, data) {
    return await prisma.supplier.update({
      where: { id },
      data,
      include: {
        creator: {
          select: { id: true, firstName: true, lastName: true, email: true }
        }
      }
    });
  }

  // ============================================================
  // DELETE SUPPLIER (Hard Delete)
  // ============================================================
  static async delete(id) {
    return await prisma.supplier.delete({
      where: { id }
    });
  }

  // ============================================================
  // SOFT DELETE (Deactivate)
  // ============================================================
  static async deactivate(id) {
    return await prisma.supplier.update({
      where: { id },
      data: { status: 'inactive' }
    });
  }

  // ============================================================
  // GET SUPPLIER WITH PRODUCT COUNT
  // ============================================================
  static async getWithProductCount(id) {
    const supplier = await prisma.supplier.findUnique({
      where: { id },
      include: {
        _count: {
          select: {
            products: true
          }
        }
      }
    });
    
    return {
      ...supplier,
      productCount: supplier._count.products
    };
  }

  // ============================================================
  // GET SUPPLIER STATS (KPI)
  // ============================================================
  static async getStats() {
    const [total, active, inactive] = await Promise.all([
      prisma.supplier.count(),
      prisma.supplier.count({ where: { status: 'active' } }),
      prisma.supplier.count({ where: { status: 'inactive' } })
    ]);

    return { total, active, inactive };
  }
}

module.exports = SupplierModel;