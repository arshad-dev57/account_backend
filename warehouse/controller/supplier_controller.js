// controllers/supplierController.js

const Supplier = require('../models/Supplier');

// @desc    Get all suppliers with pagination, search, status filter
// @route   GET /api/warehouse/supplier
// @access  Private
const getSuppliers = async (req, res) => {
  try {
    const { search, status, page = 1, limit = 15 } = req.query;

    const filter = {};

    if (status && status !== 'all') {
      filter.status = status;
    }

    if (search) {
      filter.$or = [
        { name: { $regex: search, $options: 'i' } },
        { contactPerson: { $regex: search, $options: 'i' } },
        { email: { $regex: search, $options: 'i' } },
        { phone: { $regex: search, $options: 'i' } },
        { gstNumber: { $regex: search, $options: 'i' } },
      ];
    }

    const pageNum = parseInt(page);
    const limitNum = parseInt(limit);
    const skip = (pageNum - 1) * limitNum;

    const [suppliers, total] = await Promise.all([
      Supplier.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limitNum)
        .lean(),
      Supplier.countDocuments(filter),
    ]);

    // KPI counts (always on full collection, not filtered)
    const [totalCount, activeCount, inactiveCount] = await Promise.all([
      Supplier.countDocuments({}),
      Supplier.countDocuments({ status: 'active' }),
      Supplier.countDocuments({ status: 'inactive' }),
    ]);

    res.status(200).json({
      success: true,
      count: suppliers.length,
      data: suppliers,
      kpi: {
        total: totalCount,
        active: activeCount,
        inactive: inactiveCount,
      },
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        pages: Math.ceil(total / limitNum),
        hasNext: pageNum < Math.ceil(total / limitNum),
        hasPrev: pageNum > 1,
      },
    });
  } catch (error) {
    console.error('Get suppliers error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// @desc    Get single supplier
// @route   GET /api/warehouse/supplier/:id
// @access  Private
const getSupplierById = async (req, res) => {
  try {
    const supplier = await Supplier.findById(req.params.id);

    if (!supplier) {
      return res
        .status(404)
        .json({ success: false, message: 'Supplier not found' });
    }

    res.status(200).json({ success: true, data: supplier });
  } catch (error) {
    console.error('Get supplier error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

const createSupplier = async (req, res) => {
  try {
    console.log("===== CREATE SUPPLIER API HIT =====");

    console.log("req.body =>", req.body);
    console.log("req.user =>", req.user);

    const {
      name,
      contactPerson,
      email,
      phone,
      address,
      gstNumber,
      paymentTerms,
    } = req.body;

    console.log("name =>", name);
    console.log("contactPerson =>", contactPerson);
    console.log("email =>", email);
    console.log("phone =>", phone);
    console.log("address =>", address);
    console.log("gstNumber =>", gstNumber);
    console.log("paymentTerms =>", paymentTerms);

    if (!name) {
      console.log("Supplier name missing");

      return res.status(400).json({
        success: false,
        message: "Supplier name is required",
      });
    }

    const supplierData = {
      name,
      contactPerson,
      email,
      phone,
      address,
      gstNumber,
      paymentTerms,
      status: "active",
      createdBy: req.user?.id,
    };

    console.log("Supplier data to save =>", supplierData);

    const supplier = await Supplier.create(supplierData);

    console.log("Supplier created successfully =>", supplier);

    return res.status(201).json({
      success: true,
      message: "Supplier created successfully",
      data: supplier,
    });
  } catch (error) {
    console.error("===== CREATE SUPPLIER ERROR =====");
    console.error("Error Name =>", error.name);
    console.error("Error Message =>", error.message);
    console.error("Full Error =>", error);

    if (error.name === "ValidationError") {
      const messages = Object.values(error.errors).map(
        (e) => e.message
      );

      console.log("Validation Errors =>", messages);

      return res.status(400).json({
        success: false,
        message: messages.join(", "),
      });
    }

    return res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message, // debug ke liye temporary
    });
  }
};
// @desc    Update supplier
// @route   PUT /api/warehouse/supplier/:id
// @access  Private (Admin/Manager)
const updateSupplier = async (req, res) => {
  try {
    let supplier = await Supplier.findById(req.params.id);

    if (!supplier) {
      return res
        .status(404)
        .json({ success: false, message: 'Supplier not found' });
    }

    supplier = await Supplier.findByIdAndUpdate(req.params.id, req.body, {
      new: true,
      runValidators: true,
    });

    res.status(200).json({
      success: true,
      message: 'Supplier updated successfully',
      data: supplier,
    });
  } catch (error) {
    console.error('Update supplier error:', error);

    if (error.name === 'ValidationError') {
      const messages = Object.values(error.errors).map((e) => e.message);
      return res
        .status(400)
        .json({ success: false, message: messages.join(', ') });
    }

    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// @desc    Delete supplier
// @route   DELETE /api/warehouse/supplier/:id
// @access  Private (Admin only)
const deleteSupplier = async (req, res) => {
  try {
    const supplier = await Supplier.findById(req.params.id);

    if (!supplier) {
      return res
        .status(404)
        .json({ success: false, message: 'Supplier not found' });
    }

    const StockMovement = require('../models/StockMovement');
    const hasMovements = await StockMovement.findOne({
      supplierId: req.params.id,
    });

    if (hasMovements) {
      supplier.status = 'inactive';
      await supplier.save();
      return res.status(200).json({
        success: true,
        message: 'Supplier deactivated (has linked stock movements)',
      });
    }

    await supplier.deleteOne();

    res
      .status(200)
      .json({ success: true, message: 'Supplier deleted successfully' });
  } catch (error) {
    console.error('Delete supplier error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

module.exports = {
  getSuppliers,
  getSupplierById,
  createSupplier,
  updateSupplier,
  deleteSupplier,
};