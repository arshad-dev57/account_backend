    // warehouse/routes/customerRoutes.js
    const express = require('express');
    const router = express.Router();
    const customerController = require('../controller/customerController');
    const { protect } = require("../../middleware/authMiddleware");

    // ─── Apply auth to all routes ──────────────────u────────────
    router.use(protect);

    // ─── Routes ──────────────────────────────────────────────────
    router.get('/', customerController.getCustomers);
    router.get('/stats', customerController.getCustomerStats);
    router.get('/search', customerController.searchCustomers);
    router.get('/:id', customerController.getCustomerById);
    router.get('/number/:customerNumber', customerController.getCustomerByNumber);
    router.get('/:id/orders', customerController.getCustomerOrders);

    router.post('/', customerController.createCustomer);

    router.put('/:id', customerController.updateCustomer);
    router.patch('/:id/status', customerController.updateCustomerStatus);

    router.delete('/:id', customerController.deleteCustomer);

    module.exports = router;