const express = require("express");
const router = express.Router();
const distributorController = require("../controllers/distributorController");
const { protect } = require("../middleware/authMiddleware");

router.use(protect);

// 1. Dashboard
router.get("/dashboard", distributorController.getDistributorDashboard);

// 2. Salespersons
router.get("/salespersons", distributorController.getSalespersons);
router.post("/salespersons", distributorController.createSalesperson);
router.get("/salespersons/:id", distributorController.getSalespersonById);
router.put("/salespersons/:id", distributorController.updateSalesperson);
router.post("/salespersons/:id/assign-customers", distributorController.assignCustomersToSalesperson);

// 3. Customer 360, Credit & Collections, Ledger, Statement
router.get("/customers/:id/360", distributorController.getCustomer360);
router.get("/customers/:id/account", distributorController.getCustomerAccount);
router.get("/customers/:id/ledger", distributorController.getCustomerLedger);
router.get("/customers/:id/statement", distributorController.getCustomerStatement);
router.post("/customers/check-credit-limit", distributorController.checkCreditLimit);
router.get("/collections", distributorController.getCollectionsWorkspace);

// 4. Aging & Reports
router.get("/reports/customer-aging", distributorController.getCustomerAgingReport);
router.get("/reports/salesperson-recovery", distributorController.getSalespersonRecoveryReport);

// 5. Product & Warehouse 360
router.get("/products/:id/analytics", distributorController.getProductDistributorAnalytics);
router.get("/warehouses/:locationId/360", distributorController.getWarehouse360);

module.exports = router;
