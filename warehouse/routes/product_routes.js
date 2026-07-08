const express = require('express');
const router = express.Router();
const { protect } = require('../../middleware/authMiddleware');
const { upload } = require('../../config/cloudinary');

const {
  getProducts,
  getProductById,
  createProduct,
  updateProduct,
  deleteProduct,
  searchProducts,
  getLowStockProducts,
  getProductByBarcode,
  checkBarcodeExists
} = require('../controller/product_controller');

// All routes protected (authentication + subscription)
router.use(protect);

// ─── GET Routes ──────────────────────────────────────────────
// Search products
router.get('/search', searchProducts);

// Low stock products
router.get('/low-stock', getLowStockProducts);

// Barcode check
router.get('/check-barcode/:barcode', checkBarcodeExists);

// Get product by barcode
router.get('/barcode/:barcode', getProductByBarcode);

// Get all products with pagination, filters, sorting
router.get('/', getProducts);

// Get single product
router.get('/:id', getProductById);

// ─── POST Routes ──────────────────────────────────────────────
// Create product (with image upload)
router.post(
  '/',
  upload.fields([
    { name: 'images', maxCount: 5 },
    { name: 'barcodeImage', maxCount: 1 }
  ]),
  createProduct
);

// ─── PUT Routes ──────────────────────────────────────────────
// Update product (with image upload)
router.put(
  '/:id',
  upload.array('images', 5),
  updateProduct
);

// ─── DELETE Routes ──────────────────────────────────────────────
// Delete product
router.delete('/:id', deleteProduct);

module.exports = router;