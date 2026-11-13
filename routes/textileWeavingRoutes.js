'use strict';

const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/authMiddleware');
const { requireTextileWeaving } = require('../middleware/requireTextileWeaving');
const ctrl = require('../controllers/textileWeavingController');

router.use(protect);
router.use(requireTextileWeaving);

// Dashboard
router.get('/summary', ctrl.getSummary);

// Godown — Register pages 1–3
router.get('/godown/stocks', ctrl.listGodownStocks);
router.get('/godown/ledger', ctrl.listGodownLedger);
router.post('/godown/ledger', ctrl.postGodownLedger);

// Unit 1 — Twisting / Coning
router.get('/twisting/batches', ctrl.listTwistingBatches);
router.post('/twisting/batches', ctrl.createTwistingBatch);
router.post('/twisting/batches/:id/receipts', ctrl.addTwistingReceipt);
router.patch('/twisting/batches/:id/complete', ctrl.completeTwistingBatch);

// Direct Weft Issue (Unit 1 → Unit 3)
router.get('/weft-issues', ctrl.listWeftIssues);
router.post('/weft-issues', ctrl.createWeftIssue);

// Unit 2 — Warping & Beams
router.get('/beams', ctrl.listBeams);
router.post('/beams', ctrl.createBeam);
router.get('/warping/sets', ctrl.listWarpingSets);
router.post('/warping/sets', ctrl.createWarpingSet);

// Unit 3 — Looms, gaiting, daily production, wages
router.get('/looms', ctrl.listLooms);
router.post('/looms', ctrl.createLoom);
router.post('/looms/:id/allocate-beam', ctrl.allocateBeam);
router.get('/weaving/daily-production', ctrl.listDailyProduction);
router.post('/weaving/daily-production', ctrl.postDailyProduction);
router.get('/weaving/wages-report', ctrl.wagesReport);

module.exports = router;
