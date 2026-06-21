// controllers/productController.js

const Product = require('../models/Product');
const Category = require('../models/Category');
const cloudinary = require('../../config/cloudinary');
const mongoose = require('mongoose'); 

const getProducts = async (req, res) => {
  try {
    const {
      search,
      categoryId,
      stockStatus,
      sortBy = 'name',
      sortOrder = 'asc',
      page = 1,
      limit = 10  // ✅ Sirf yeh line add karo
    } = req.query;

    // Build filter
    const filter = {};
    
    if (search) {
      filter.$text = { $search: search };
    }
    
    if (categoryId) {
      filter.categoryId = categoryId;
    }

    // Stock status filter (yeh original logic hai)
    if (stockStatus) {
      const products = await Product.find(filter);
      const filteredIds = products
        .filter(p => p.stockStatus === stockStatus)
        .map(p => p._id);
      filter._id = { $in: filteredIds };
    }

    // Sort options
    const sort = {};
    sort[sortBy] = sortOrder === 'asc' ? 1 : -1;

    // ✅ Pagination - Sirf yeh 2 lines add karo
    const skip = (page - 1) * limit;

    // Execute query - sirf .skip() aur .limit() add karo
    const products = await Product.find(filter)
      .populate('categoryId', 'name')
      .sort(sort)
      .skip(skip)  // ✅ Yeh add karo
      .limit(parseInt(limit));  // ✅ Yeh add karo

    // ✅ Total count ke liye - Yeh bhi add karo
    const total = await Product.countDocuments(filter);

    res.status(200).json({
      success: true,
      data: products,
      // ✅ Pagination info - Yeh bhi add karo
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / limit)
      }
    });

  } catch (error) {
    console.error('Get products error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
};
const getProductById = async (req, res) => {
  try {
    const product = await Product.findById(req.params.id)
      .populate('categoryId', 'name')
      .populate('supplierId', 'name email phone');

    if (!product) {
      return res.status(404).json({
        success: false,
        message: 'Product not found'
      });
    }

    res.status(200).json({
      success: true,
      data: product
    });

  } catch (error) {
    console.error('Get product error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
};

const createProduct = async (req, res) => {
  console.log("===== CREATE PRODUCT API HIT =====");
  console.log("Body:", req.body);
  console.log("Files:", req.files);
  console.log("User:", req.user);

  try {
    console.log("STEP 1: Destructuring body data");

    const {
      name,
      sku,
      barcodeNumber,
      categoryId,
      sellingPrice,
      costPrice,
      currentStock,
      minimumStock,
      maximumStock,
      location,
      description,
      expiryDate
    } = req.body;

    console.log("STEP 2: Data received", {
      name,
      sku,
      barcodeNumber,
      categoryId,
      sellingPrice,
      costPrice,
      currentStock
    });

    // Validation
    console.log("STEP 3: Checking required fields");

    if (!name || !sku || !categoryId || !sellingPrice || !costPrice || !currentStock) {
      console.log("VALIDATION FAILED: Missing required fields");
      return res.status(400).json({
        success: false,
        message: 'Please provide all required fields'
      });
    }

    console.log("STEP 4: Checking categoryId format");

    if (!mongoose.Types.ObjectId.isValid(categoryId)) {
      console.log("INVALID CATEGORY ID FORMAT:", categoryId);
      return res.status(400).json({
        success: false,
        message: 'Invalid category ID format'
      });
    }

    // Check existing product
    console.log("STEP 5: Checking existing product with SKU:", sku);

    const existingProduct = await Product.findOne({ sku });

    console.log("Existing product result:", existingProduct);

    if (existingProduct) {
      console.log("DUPLICATE SKU FOUND");
      return res.status(400).json({
        success: false,
        message: 'Product with this SKU already exists'
      });
    }

    // 🔴 NEW: Check for existing BARCODE NUMBER
    if (barcodeNumber) {
      console.log("STEP 5.1: Checking existing product with Barcode number:", barcodeNumber);
      
      const existingProductByBarcode = await Product.findOne({ 
        'barcode.number': barcodeNumber 
      });
      
      if (existingProductByBarcode) {
        console.log("DUPLICATE BARCODE NUMBER FOUND for product:", existingProductByBarcode.name);
         return res.status(400).json({
        success: false,
        message: 'Product with this barcode already exists'
      });
        // Clean up uploaded images if any      
        if (req.files) {
          if (req.files['images']) {
            for (const file of req.files['images']) {
              await cloudinary.uploader.destroy(file.filename);
            }
          }
          if (req.files['barcodeImage']) {
            await cloudinary.uploader.destroy(req.files['barcodeImage'][0].filename);
          }
        }
        
        // 🔴 SIMPLE MESSAGE - No extra data
        return res.status(400).json({
          success: false,
          message: 'Product with this barcode already exists'  // Sirf yeh message
        });
      }
      
      console.log("✅ Barcode number is unique");
    }

    // Get category
    console.log("STEP 6: Fetching category");

    const category = await Category.findById(categoryId);

    console.log("Category result:", category);

    if (!category) {
      console.log("CATEGORY NOT FOUND");
      return res.status(400).json({
        success: false,
        message: 'Category not found'
      });
    }

    // Product images
    console.log("STEP 7: Handling product images");

    let imageUrls = [];

    if (req.files && req.files['images'] && req.files['images'].length > 0) {
      console.log("PRODUCT IMAGES RECEIVED:", req.files['images'].length);
      imageUrls = req.files['images'].map(file => {
        console.log("Uploaded product image:", file.path);
        return file.path;
      });
    } else {
      console.log("NO PRODUCT IMAGES RECEIVED");
    }

    // Barcode image
    console.log("STEP 8: Handling barcode data");

    let barcodeData = {};

    if (req.files && req.files['barcodeImage'] && req.files['barcodeImage'].length > 0) {
      const barcodeImageFile = req.files['barcodeImage'][0];
      console.log("✅ BARCODE IMAGE RECEIVED:", barcodeImageFile.path);
      barcodeData.image = barcodeImageFile.path;
    } else {
      console.log("❌ NO BARCODE IMAGE RECEIVED IN FILES");
      console.log("req.files keys:", Object.keys(req.files || {}));
    }

    if (barcodeNumber) {
      console.log("✅ Barcode number received:", barcodeNumber);
      barcodeData.number = barcodeNumber;
    }

    console.log("✅ Final barcode object:", barcodeData);
    console.log("STEP 9: Creating product in database");

    const product = await Product.create({
      name,
      sku,
      barcode: barcodeData,
      categoryId,
      categoryName: category.name,
      sellingPrice: parseFloat(sellingPrice),
      costPrice: parseFloat(costPrice),
      currentStock: parseInt(currentStock),
      minimumStock: parseInt(minimumStock || 5),
      maximumStock: parseInt(maximumStock || 100),
      location: location || 'A-1-B1',
      imageUrls,
      description,
      expiryDate: expiryDate || null,
      createdBy: req.user?.id
    });

    console.log("STEP 10: PRODUCT CREATED SUCCESSFULLY");
    console.log("Product ID:", product._id);
    console.log("Saved barcode data:", product.barcode);

    res.status(201).json({
      success: true,
      message: 'Product created successfully',
      data: product
    });

  } catch (error) {
    console.error("===== CREATE PRODUCT ERROR =====");
    console.error("Error message:", error.message);
    console.error("Full error:", error);

    // Clean up uploaded images
    if (req.files) {
      console.log("STEP ERROR: Cleaning uploaded images");
      
      if (req.files['images']) {
        for (const file of req.files['images']) {
          try {
            console.log("Deleting product image:", file.filename);
            await cloudinary.uploader.destroy(file.filename);
          } catch (cloudError) {
            console.error("Cloudinary cleanup error:", cloudError);
          }
        }
      }
      
      if (req.files['barcodeImage']) {
        try {
          console.log("Deleting barcode image:", req.files['barcodeImage'][0].filename);
          await cloudinary.uploader.destroy(req.files['barcodeImage'][0].filename);
        } catch (cloudError) {
          console.error("Cloudinary cleanup error:", cloudError);
        }
      }
    }

    if (error.code === 11000) {
      console.log("DUPLICATE KEY ERROR:", error.keyValue);
      return res.status(400).json({
        success: false,
        message: 'Duplicate SKU or barcode number'
      });
    }

    if (error.name === 'ValidationError') {
      console.log("VALIDATION ERROR");
      const messages = Object.values(error.errors).map(err => err.message);
      return res.status(400).json({
        success: false,
        message: messages.join(', ')
      });
    }

    if (error.name === 'CastError') {
      console.log("CAST ERROR");
      return res.status(400).json({
        success: false,
        message: 'Invalid ID format'
      });
    }

    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
}

;const updateProduct = async (req, res) => {
  try {
    let product = await Product.findById(req.params.id);

    if (!product) {
      return res.status(404).json({
        success: false,
        message: 'Product not found'
      });
    }

    if (req.body.sku && req.body.sku !== product.sku) {
      const existingProduct = await Product.findOne({ sku: req.body.sku });
      if (existingProduct) {
        return res.status(400).json({
          success: false,
          message: 'Product with this SKU already exists'
        });
      }
    } 
    if (req.body.categoryId && req.body.categoryId !== product.categoryId.toString()) {
      const category = await Category.findById(req.body.categoryId);
      if (category) {
        req.body.categoryName = category.name;
      }
    }

    // Handle new images
    let imageUrls = [...product.imageUrls];
    
    // Add new images if uploaded
    if (req.files && req.files.length > 0) {
      const newImageUrls = req.files.map(file => file.path);
      imageUrls = [...imageUrls, ...newImageUrls];
    }
    
    // Remove specific images if requested
    if (req.body.removeImages) {
      const imagesToRemove = JSON.parse(req.body.removeImages);
      
      // Delete from Cloudinary
      for (const imageUrl of imagesToRemove) {
        const publicId = imageUrl.split('/').pop().split('.')[0];
        await cloudinary.uploader.destroy(`warehouse/products/${publicId}`);
      }
      
      // Remove from array
      imageUrls = imageUrls.filter(url => !imagesToRemove.includes(url));
    }

    req.body.imageUrls = imageUrls;

    product = await Product.findByIdAndUpdate(
      req.params.id,
      req.body,
      { new: true, runValidators: true }
    );

    res.status(200).json({
      success: true,
      message: 'Product updated successfully',
      data: product
    });

  } catch (error) {
    console.error('Update product error:', error);
    
    if (error.name === 'ValidationError') {
      const messages = Object.values(error.errors).map(err => err.message);
      return res.status(400).json({
        success: false,
        message: messages.join(', ')
      });
    }

    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
};
 
const deleteProduct = async (req, res) => {
  try {
    const product = await Product.findById(req.params.id);

    if (!product) {
      return res.status(404).json({
        success: false,
        message: 'Product not found'
      });
    }

    if (product.imageUrls && product.imageUrls.length > 0) {
      for (const imageUrl of product.imageUrls) {
        const publicId = imageUrl.split('/').pop().split('.')[0];
        await cloudinary.uploader.destroy(`warehouse/products/${publicId}`);
      }
    }

    await product.deleteOne();
    res.status(200).json({
      success: true,
      message: 'Product deleted successfully'
    });

  } catch (error) {
    console.error('Delete product error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
};
const getLowStockProducts = async (req, res) => {
  try {
    const products = await Product.find({
      $expr: { $lte: ['$currentStock', '$minimumStock'] }
    }).populate('categoryId', 'name');

    res.status(200).json({
      success: true,
      count: products.length,
      data: products
    });

  } catch (error) {
    console.error('Get low stock error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
};

const searchProducts = async (req, res) => {
  try {
    const { q, page = 1, limit = 20 } = req.query;

    console.log("===== PRODUCT SEARCH API =====");
    console.log("Query:", q);
    console.log("Page:", page);
    console.log("Limit:", limit);

    if (!q) {
      return res.status(400).json({
        success: false,
        message: 'Search query is required'
      });
    }
    const filter = {
      $or: [
        { name: { $regex: q, $options: 'i' } },
        { sku: { $regex: q, $options: 'i' } },
        { barcode: { $regex: q, $options: 'i' } }
      ]
    };
    const skip = (page - 1) * limit;
    const products = await Product.find(filter)
      .populate('categoryId', 'name')
      .sort({ name: 1 })
      .skip(skip)
      .limit(parseInt(limit));

    const total = await Product.countDocuments(filter);

    res.status(200).json({
      success: true,
      count: products.length,
      data: products,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / limit)
      }
    });

  } catch (error) {
    console.error('Product search error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
};
// @desc    Get product by barcode
// @route   GET /api/products/barcode/:barcode
// @access  Private
const getProductByBarcode = async (req, res) => {
  try {
    const { barcode } = req.params;
    
    console.log("🔍 Searching product by barcode:", barcode);
    
    // Find product where barcode.number matches
    const product = await Product.findOne({ 
      'barcode.number': barcode 
    }).populate('categoryId', 'name');
    
    if (!product) {
      console.log("❌ Product not found for barcode:", barcode);
      return res.status(404).json({
        success: false,
        message: 'Product not found with this barcode'
      });
    }
    
    console.log("✅ Product found:", product.name);
    
    res.status(200).json({
      success: true,
      data: product
    });
    
  } catch (error) {
    console.error('Get product by barcode error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
};

// @desc    Check if barcode exists
// @route   GET /api/products/check-barcode/:barcode
// @access  Private
const checkBarcodeExists = async (req, res) => {
  try {
    const { barcode } = req.params;
    
    const product = await Product.findOne({ 
      'barcode.number': barcode 
    });
    
    res.status(200).json({
      success: true,
      exists: !!product
    });
    
  } catch (error) {
    console.error('Check barcode error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
};

module.exports = {
  checkBarcodeExists,
  getProductByBarcode,
  searchProducts,
  getProducts,
  getProductById,
  createProduct,
  updateProduct,
  deleteProduct,
  getLowStockProducts
};
