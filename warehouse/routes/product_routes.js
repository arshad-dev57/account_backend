// warehouse/routes/product_routes.js

const express = require('express');
const router = express.Router();
const { protect } = require('../../middleware/authMiddleware');  // ✅ Subscription wala
const { upload } = require('../../config/cloudinary');

const {
  checkBarcodeExists,
  getProductByBarcode,
  searchProducts,
  getProducts,
  getProductById,
  createProduct,
  updateProduct,
  deleteProduct,
  getLowStockProducts
} = require('../controller/product_controller');

// ✅ Sab routes ke liye authentication + subscription check
router.use(protect);

// Routes
router.get('/barcode/:barcode', getProductByBarcode);
router.get('/check-barcode/:barcode', checkBarcodeExists);
router.get('/search', searchProducts); 
router.get('/', getProducts);
router.get('/low-stock', getLowStockProducts);
router.get('/:id', getProductById);

router.post(
  '/',
  upload.fields([
    { name: 'images', maxCount: 5 },
    { name: 'barcodeImage', maxCount: 1 }
  ]),
  createProduct
);

router.put(
  '/:id',
  upload.array('images', 5),
  updateProduct
);

router.delete('/:id', deleteProduct);

module.exports = router;