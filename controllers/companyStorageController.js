/**
 * companyStorageController.js
 *
 * Handles the GET /api/admin/company-storage-usage request.
 * Only reachable by platform owners (enforced at the route layer via
 * platformOwnerMiddleware).
 */

'use strict';

const {
  getCompanyStorageReport,
  invalidateCache,
} = require('../services/companyStorageUsageService');

/**
 * GET /api/admin/company-storage-usage
 *
 * Query params:
 *   breakdown     {string}  "false" to omit per-table breakdown (default: true)
 *   forceRefresh  {string}  "true"  to bypass the 30-min cache (default: false)
 */
exports.getCompanyStorageUsage = async (req, res) => {
  try {
    const includeBreakdown = req.query.breakdown !== 'false';
    const forceRefresh     = req.query.forceRefresh === 'true';

    console.log(
      `[companyStorageController] getCompanyStorageUsage ` +
      `— user: ${req.user?.email} | breakdown: ${includeBreakdown} | forceRefresh: ${forceRefresh}`
    );

    const report = await getCompanyStorageReport({ forceRefresh, includeBreakdown });

    return res.status(200).json(report);
  } catch (err) {
    console.error('[companyStorageController] getCompanyStorageUsage error:', err);
    return res.status(500).json({
      success: false,
      message: 'Failed to calculate company storage usage.',
      error: process.env.NODE_ENV === 'development' ? err.message : undefined,
    });
  }
};

/**
 * POST /api/admin/company-storage-usage/invalidate-cache
 *
 * Manually clears the in-process storage cache so the next GET recalculates.
 * Useful after a large bulk data import.
 */
exports.invalidateStorageCache = async (req, res) => {
  try {
    console.log(
      `[companyStorageController] invalidateStorageCache — user: ${req.user?.email}`
    );
    invalidateCache();
    return res.status(200).json({
      success: true,
      message: 'Storage usage cache cleared. The next request will recalculate.',
    });
  } catch (err) {
    console.error('[companyStorageController] invalidateStorageCache error:', err);
    return res.status(500).json({
      success: false,
      message: 'Failed to invalidate storage cache.',
      error: process.env.NODE_ENV === 'development' ? err.message : undefined,
    });
  }
};
