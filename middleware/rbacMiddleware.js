/**
 * RBAC & Granular Permission Middleware
 * Enforces server-side authorization, record scope, and tenant isolation.
 */

const { getEffectivePermissions, verifyDataScope } = require('../services/permissionService');

/**
 * Middleware requiring a specific permission (e.g. 'sales.orders.create' or 'accounting.journal_entries.post')
 * @param {string} permissionKey Canonical permission string
 * @param {object} [options]
 * @param {string} [options.scopeRecordField] If checking record scope against req.params / body
 */
function requirePermission(permissionKey, options = {}) {
  return async (req, res, next) => {
    try {
      const user = req.user;
      if (!user) {
        return res.status(401).json({
          success: false,
          code: 'UNAUTHORIZED',
          message: 'Authentication required'
        });
      }

      const companyId = req.user.companyId || req.authUserRow?.companyId;
      const effective = await getEffectivePermissions(user.id || user._id, companyId);

      // Super Admins, Company Admins & Owners bypass granular permission checks
      if (effective.isAdmin) {
        req.effectivePermissions = effective;
        req.permissionScope = 'ALL';
        return next();
      }

      const permInfo = effective.permissionMap[permissionKey];
      if (!permInfo || !permInfo.granted) {
        return res.status(403).json({
          success: false,
          code: 'PERMISSION_DENIED',
          message: `Access denied. You do not have permission for '${permissionKey}'.`,
          requiredPermission: permissionKey
        });
      }

      req.effectivePermissions = effective;
      req.permissionScope = permInfo.scope || 'ALL';
      return next();
    } catch (err) {
      console.error('❌ [requirePermission] Error:', err);
      return res.status(500).json({
        success: false,
        message: 'Internal authorization error',
        error: err.message
      });
    }
  };
}

/**
 * Middleware requiring ANY of the provided permissions
 * @param {string[]} permissionKeys Array of permission strings
 */
function requireAnyPermission(permissionKeys = []) {
  return async (req, res, next) => {
    try {
      const user = req.user;
      if (!user) {
        return res.status(401).json({
          success: false,
          code: 'UNAUTHORIZED',
          message: 'Authentication required'
        });
      }

      const companyId = req.user.companyId || req.authUserRow?.companyId;
      const effective = await getEffectivePermissions(user.id || user._id, companyId);

      if (effective.isAdmin) {
        req.effectivePermissions = effective;
        req.permissionScope = 'ALL';
        return next();
      }

      const matchedKey = permissionKeys.find(
        (key) => effective.permissionMap[key]?.granted === true
      );

      if (!matchedKey) {
        return res.status(403).json({
          success: false,
          code: 'PERMISSION_DENIED',
          message: 'Access denied. You do not have permission for this resource.',
          requiredPermissions: permissionKeys
        });
      }

      req.effectivePermissions = effective;
      req.permissionScope = effective.permissionMap[matchedKey]?.scope || 'ALL';
      req.matchedPermission = matchedKey;
      return next();
    } catch (err) {
      console.error('❌ [requireAnyPermission] Error:', err);
      return res.status(500).json({
        success: false,
        message: 'Internal authorization error',
        error: err.message
      });
    }
  };
}

/**
 * Controller helper to assert record scope before viewing/mutating an existing record.
 * @returns {boolean} true if permitted, false if response was sent with 403
 */
function assertRecordScope(req, res, record, permissionKey) {
  if (!record) return true;

  // Tenant / Company Isolation Guard
  const activeCompanyId = req.user?.companyId || req.authUserRow?.companyId;
  const recordCompanyId = record.companyId;

  if (activeCompanyId && recordCompanyId && String(activeCompanyId) !== String(recordCompanyId)) {
    res.status(403).json({
      success: false,
      code: 'COMPANY_ACCESS_DENIED',
      message: 'Access denied. This record belongs to another company.'
    });
    return false;
  }

  if (req.effectivePermissions?.isAdmin) return true;

  const scope = req.permissionScope || req.effectivePermissions?.scopes[permissionKey] || 'ALL';
  const allowed = verifyDataScope({
    user: req.user,
    scope,
    record
  });

  if (!allowed) {
    res.status(403).json({
      success: false,
      code: 'RECORD_SCOPE_DENIED',
      message: `Access denied. Your access is restricted to ${scope} records only.`
    });
    return false;
  }

  return true;
}

module.exports = {
  requirePermission,
  requireAnyPermission,
  assertRecordScope
};
