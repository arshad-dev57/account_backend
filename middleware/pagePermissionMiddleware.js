// middleware/pagePermissionMiddleware.js
// Soft page-permission gate for non-admin users.

const prisma = require('../prisma/client');

/**
 * Require canView on any of the given page keys (or admin/manager/owner).
 * @param {...string} pages
 */
const requirePageView = (...pages) => {
  const allowed = pages.flat().filter(Boolean);

  return async (req, res, next) => {
    try {
      const user = req.user;
      if (!user) {
        return res.status(401).json({
          success: false,
          message: 'Not authorized',
        });
      }

      const role = String(user.role || '').toLowerCase();
      if (['admin', 'owner', 'superadmin', 'manager'].includes(role)) {
        return next();
      }

      if (allowed.length === 0) return next();

      const userPerms = await prisma.userPermission.findMany({
        where: {
          userId: user.id,
          canView: true,
        },
        select: { page: true },
      });

      const pages = userPerms.map((p) => String(p.page || '').toLowerCase());
      const allowedLower = allowed.map((p) => String(p).toLowerCase());

      const hasAccess = pages.some((page) => {
        if (allowedLower.includes(page)) return true;
        // Module-level grants (e.g. "sales", "accounting")
        if (page === 'sales' || page === 'accounting') {
          return allowedLower.some(
            (a) => a === page || a.startsWith(`${page}-`)
          );
        }
        return false;
      });

      if (!hasAccess) {
        return res.status(403).json({
          success: false,
          message: 'You do not have permission to access this resource',
          requiredPages: allowed,
        });
      }

      return next();
    } catch (error) {
      console.error('Page permission check error:', error);
      return res.status(500).json({
        success: false,
        message: 'Permission check failed',
      });
    }
  };
};

module.exports = { requirePageView };
