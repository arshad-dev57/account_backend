// controllers/warehouse/expiryReportController.js
const prisma = require('../../prisma/client');
const emailService = require('../../services/emailService');
const { sendToUser } = require('../../services/notificationService');

const getExpiryReport = async (req, res) => {
  try {
    const userId = req.user.id;
    const companyId = req.user.companyId;
    const now = new Date();
    
    // Calculate date ranges
    const thirtyDaysFromNow = new Date(now);
    thirtyDaysFromNow.setDate(thirtyDaysFromNow.getDate() + 30);

    // Get all products with expiry dates for the user
    const allProducts = await prisma.product.findMany({
      where: {
        companyId: companyId,
        isActive: true,
        expiryDate: { not: null }
      },
      select: {
        id: true,
        name: true,
        sku: true,
        barcodeNumber: true,
        currentStock: true,
        minimumStock: true,
        sellingPrice: true,
        expiryDate: true,
        category: {
          select: { id: true, name: true }
        },
        supplier: {
          select: { id: true, name: true }
        }
      }
    });

    const expired = allProducts.filter(p => new Date(p.expiryDate) < now);
    const expiringSoon = allProducts.filter(p => {
      const expiryDate = new Date(p.expiryDate);
      return expiryDate >= now && expiryDate <= thirtyDaysFromNow;
    });
    const productsWithExpiry = allProducts;

    const totalProducts = await prisma.product.count({
      where: { companyId: companyId, isActive: true }
    });
    const noExpiryCount = totalProducts - productsWithExpiry.length;

    await sendExpiryNotifications(userId, expired, expiringSoon);

    res.status(200).json({
      success: true,
      data: {
        summary: {
          totalProducts,
          expiredCount: expired.length,
          expiringSoonCount: expiringSoon.length,
          noExpiryCount
        },
        expired: expired.map(p => ({
          ...p,
          expiryDate: p.expiryDate.toISOString(),
          status: 'expired',
          daysLeft: Math.floor((new Date(p.expiryDate) - now) / (1000 * 60 * 60 * 24))
        })),
        expiringSoon: expiringSoon.map(p => ({
          ...p,
          expiryDate: p.expiryDate.toISOString(),
          status: 'expiring_soon',
          daysLeft: Math.floor((new Date(p.expiryDate) - now) / (1000 * 60 * 60 * 24))
        })),
        productsWithExpiry: productsWithExpiry.map(p => {
          const expiryDate = new Date(p.expiryDate);
          const daysLeft = Math.floor((expiryDate - now) / (1000 * 60 * 60 * 24));
          let status = 'good';
          if (expiryDate < now) status = 'expired';
          else if (daysLeft <= 30) status = 'expiring_soon';
          
          return {
            ...p,
            expiryDate: p.expiryDate.toISOString(),
            status,
            daysLeft
          };
        })
      }
    });
  } catch (error) {
    console.error('Get expiry report error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message
    });
  }
};

const sendExpiryNotifications = async (userId, expiredProducts, expiringSoonProducts) => {
  try {
    // Get user details for email
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        email: true,
        firstName: true,
        lastName: true,
        organizationName: true
      }
    });

    if (!user) {
      console.error('❌ User not found for notifications:', userId);
      return;
    }

    const hasExpired = expiredProducts.length > 0;
    const hasExpiring = expiringSoonProducts.length > 0;

    if (hasExpired || hasExpiring) {
      try {
        await sendExpiryEmail(user, expiredProducts, expiringSoonProducts);
        console.log('✅ Expiry email sent to:', user.email);
      } catch (emailError) {
        console.error('❌ Failed to send expiry email:', emailError.message);
      }
    }

    if (hasExpired || hasExpiring) {
      try {
        await sendExpiryPushNotification(userId, expiredProducts, expiringSoonProducts);
        console.log('✅ Expiry push notification sent to user:', userId);
      } catch (pushError) {
        console.error('❌ Failed to send expiry push notification:', pushError.message);
      }
    }

  } catch (error) {
    console.error('❌ sendExpiryNotifications error:', error);
    // Don't throw, just log the error
  }
};

const sendExpiryEmail = async (user, expiredProducts, expiringSoonProducts) => {
  const { email, firstName, organizationName } = user;
  const now = new Date();

  // Generate product lists for email
  const generateProductRows = (products, status) => {
    if (products.length === 0) return '';
    
    const statusColor = status === 'expired' ? '#ef4444' : '#f59e0b';
    const statusText = status === 'expired' ? 'Expired' : 'Expiring Soon';
    const icon = status === 'expired' ? '❌' : '⚠️';

    let rows = '';
    products.forEach((p, index) => {
      const expiryDate = new Date(p.expiryDate);
      const daysLeft = Math.floor((expiryDate - now) / (1000 * 60 * 60 * 24));
      const bgColor = index % 2 === 0 ? '#f9fafb' : '#ffffff';
      
      rows += `
        <tr style="background:${bgColor};">
          <td style="padding:10px 12px;border-bottom:1px solid #f3f4f6;font-size:13px;color:#111827;">${p.name}</td>
          <td style="padding:10px 12px;border-bottom:1px solid #f3f4f6;font-size:13px;color:#6b7280;">${p.sku || 'N/A'}</td>
          <td style="padding:10px 12px;border-bottom:1px solid #f3f4f6;font-size:13px;text-align:center;">${p.currentStock || 0}</td>
          <td style="padding:10px 12px;border-bottom:1px solid #f3f4f6;font-size:13px;color:#6b7280;text-align:center;">${expiryDate.toLocaleDateString()}</td>
          <td style="padding:10px 12px;border-bottom:1px solid #f3f4f6;font-size:13px;text-align:center;">
            <span style="display:inline-block;background:${statusColor};color:white;padding:2px 10px;border-radius:12px;font-size:11px;font-weight:600;">${statusText}</span>
          </td>
          <td style="padding:10px 12px;border-bottom:1px solid #f3f4f6;font-size:13px;text-align:center;color:${daysLeft < 0 ? '#ef4444' : '#6b7280'};font-weight:${daysLeft < 0 ? '600' : '400'};">${daysLeft < 0 ? 'Expired' : daysLeft + ' days'}</td>
        </tr>
      `;
    });
    return rows;
  };

  const expiredRows = generateProductRows(expiredProducts, 'expired');
  const expiringRows = generateProductRows(expiringSoonProducts, 'expiring_soon');

  let tableSections = '';
  
  if (expiredProducts.length > 0) {
    tableSections += `
      <h3 style="color:#ef4444;margin:24px 0 12px 0;font-size:16px;">❌ Expired Products (${expiredProducts.length})</h3>
      <table style="width:100%;border-collapse:collapse;font-family:Arial,sans-serif;font-size:13px;border:1px solid #e5e7eb;border-radius:8px;overflow:hidden;">
        <thead>
          <tr style="background:#f3f4f6;">
            <th style="padding:10px 12px;text-align:left;font-weight:600;color:#374151;border-bottom:2px solid #e5e7eb;">Product</th>
            <th style="padding:10px 12px;text-align:left;font-weight:600;color:#374151;border-bottom:2px solid #e5e7eb;">SKU</th>
            <th style="padding:10px 12px;text-align:center;font-weight:600;color:#374151;border-bottom:2px solid #e5e7eb;">Stock</th>
            <th style="padding:10px 12px;text-align:center;font-weight:600;color:#374151;border-bottom:2px solid #e5e7eb;">Expiry Date</th>
            <th style="padding:10px 12px;text-align:center;font-weight:600;color:#374151;border-bottom:2px solid #e5e7eb;">Status</th>
            <th style="padding:10px 12px;text-align:center;font-weight:600;color:#374151;border-bottom:2px solid #e5e7eb;">Days Left</th>
          </tr>
        </thead>
        <tbody>
          ${expiredRows}
        </tbody>
      </table>
    `;
  }

  if (expiringSoonProducts.length > 0) {
    tableSections += `
      <h3 style="color:#f59e0b;margin:24px 0 12px 0;font-size:16px;">⚠️ Expiring Soon Products (${expiringSoonProducts.length})</h3>
      <table style="width:100%;border-collapse:collapse;font-family:Arial,sans-serif;font-size:13px;border:1px solid #e5e7eb;border-radius:8px;overflow:hidden;">
        <thead>
          <tr style="background:#f3f4f6;">
            <th style="padding:10px 12px;text-align:left;font-weight:600;color:#374151;border-bottom:2px solid #e5e7eb;">Product</th>
            <th style="padding:10px 12px;text-align:left;font-weight:600;color:#374151;border-bottom:2px solid #e5e7eb;">SKU</th>
            <th style="padding:10px 12px;text-align:center;font-weight:600;color:#374151;border-bottom:2px solid #e5e7eb;">Stock</th>
            <th style="padding:10px 12px;text-align:center;font-weight:600;color:#374151;border-bottom:2px solid #e5e7eb;">Expiry Date</th>
            <th style="padding:10px 12px;text-align:center;font-weight:600;color:#374151;border-bottom:2px solid #e5e7eb;">Status</th>
            <th style="padding:10px 12px;text-align:center;font-weight:600;color:#374151;border-bottom:2px solid #e5e7eb;">Days Left</th>
          </tr>
        </thead>
        <tbody>
          ${expiringRows}
        </tbody>
      </table>
    `;
  }

  const totalAffected = expiredProducts.length + expiringSoonProducts.length;
  const orgName = organizationName || 'Your Organization';

  const mailOptions = {
    from: `"BisonsTechs" <${process.env.EMAIL_USER}>`,
    to: email,
    subject: `⚠️ ${totalAffected} Products ${expiredProducts.length > 0 ? 'Expired' : 'Expiring Soon'} — ${orgName}`,
    html: `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1.0"/>
  <style>
    body { margin:0;padding:0;background-color:#f1f5f9;font-family:'Segoe UI',Tahoma,Geneva,Verdana,sans-serif; }
    .container { max-width:600px;width:100%;background:#ffffff;border-radius:24px;overflow:hidden;box-shadow:0 20px 60px rgba(0,0,0,0.12);margin:0 auto; }
    .header { background:linear-gradient(135deg,#0f172a 0%,#1e293b 55%,#0f2744 100%);padding:40px 40px 32px;text-align:center; }
    .header-title { font-size:24px;font-weight:800;color:#ffffff;letter-spacing:-0.5px; }
    .header-title span { color:#1AB4F5; }
    .content { padding:32px 40px 28px; }
    .alert-box { background:#fef2f2;border:1px solid #fecaca;border-left:4px solid #ef4444;border-radius:10px;padding:16px 20px;margin-bottom:24px; }
    .alert-box.warning { background:#fffbeb;border:1px solid #fde68a;border-left:4px solid #f59e0b; }
    .alert-box .icon { font-size:20px;padding-right:12px;vertical-align:top; }
    .alert-box .text { font-size:14px;color:#374151;line-height:1.7; }
    .footer { background:#f9fafb;border-top:1px solid #f3f4f6;padding:22px 40px;text-align:center;font-size:12px;color:#9ca3af;line-height:1.7; }
    .button { display:inline-block;background:linear-gradient(135deg,#1AB4F5,#6366f1);color:#ffffff;text-decoration:none;padding:12px 36px;border-radius:50px;font-weight:600;font-size:15px;margin:16px 0 8px; }
    @media only screen and (max-width:480px) {
      .content { padding:20px; }
      .header { padding:24px 20px; }
      .header-title { font-size:20px; }
    }
  </style>
</head>
<body style="margin:0;padding:0;background-color:#f1f5f9;font-family:'Segoe UI',Tahoma,Geneva,Verdana,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#f1f5f9;padding:40px 16px;">
    <tr><td align="center">
      <table class="container" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;width:100%;background:#ffffff;border-radius:24px;overflow:hidden;box-shadow:0 20px 60px rgba(0,0,0,0.12);">
        <!-- Header -->
        <tr>
          <td class="header" style="background:linear-gradient(135deg,#0f172a 0%,#1e293b 55%,#0f2744 100%);padding:40px 40px 32px;text-align:center;">
            <div style="font-size:28px;margin-bottom:8px;">⚠️</div>
            <div class="header-title" style="font-size:24px;font-weight:800;color:#ffffff;letter-spacing:-0.5px;">
              Product Expiry <span style="color:#1AB4F5;">Alert</span>
            </div>
            <div style="margin-top:6px;font-size:14px;color:rgba(255,255,255,0.6);">
              ${orgName} — ${new Date().toLocaleDateString()}
            </div>
          </td>
        </tr>
        <!-- Content -->
        <tr>
          <td class="content" style="padding:32px 40px 28px;">
            <p style="font-size:15px;color:#374151;line-height:1.8;margin:0 0 20px 0;">
              Hello <strong>${firstName || 'there'}</strong>,<br/>
              This is a notification regarding <strong>${totalAffected}</strong> product${totalAffected > 1 ? 's' : ''} in your inventory that ${expiredProducts.length > 0 ? 'have expired' : 'are expiring soon'}.
            </p>

            ${expiredProducts.length > 0 ? `
              <div class="alert-box" style="background:#fef2f2;border:1px solid #fecaca;border-left:4px solid #ef4444;border-radius:10px;padding:16px 20px;margin-bottom:20px;">
                <table cellpadding="0" cellspacing="0"><tr>
                  <td style="font-size:20px;padding-right:12px;vertical-align:top;">❌</td>
                  <td style="font-size:14px;color:#374151;line-height:1.7;">
                    <strong style="color:#dc2626;">${expiredProducts.length}</strong> product${expiredProducts.length > 1 ? 's have' : ' has'} expired. Immediate action required!
                  </td>
                </tr></table>
              </div>
            ` : ''}

            ${expiringSoonProducts.length > 0 ? `
              <div class="alert-box warning" style="background:#fffbeb;border:1px solid #fde68a;border-left:4px solid #f59e0b;border-radius:10px;padding:16px 20px;margin-bottom:20px;">
                <table cellpadding="0" cellspacing="0"><tr>
                  <td style="font-size:20px;padding-right:12px;vertical-align:top;">⚠️</td>
                  <td style="font-size:14px;color:#374151;line-height:1.7;">
                    <strong style="color:#d97706;">${expiringSoonProducts.length}</strong> product${expiringSoonProducts.length > 1 ? 's are' : ' is'} expiring within 30 days.
                  </td>
                </tr></table>
              </div>
            ` : ''}

            ${tableSections}

            <div style="text-align:center;margin:28px 0 12px;">
              <a href="${process.env.FRONTEND_URL || 'https://app.BisonsTechs.com'}/warehouse/expiry" 
                 class="button" 
                 style="display:inline-block;background:linear-gradient(135deg,#1AB4F5,#6366f1);color:#ffffff;text-decoration:none;padding:12px 36px;border-radius:50px;font-weight:600;font-size:15px;">
                View Full Report →
              </a>
            </div>

            <div style="border-top:1px solid #e5e7eb;margin:20px 0 4px;"></div>
            <p style="font-size:12px;color:#9ca3af;text-align:center;line-height:1.8;margin:16px 0 0 0;">
              This is an automated notification from BisonsTechs.<br/>
              Please review your inventory and take necessary action.
            </p>
          </td>
        </tr>
        <!-- Footer -->
        <tr>
          <td class="footer" style="background:#f9fafb;border-top:1px solid #f3f4f6;padding:22px 40px;text-align:center;font-size:12px;color:#9ca3af;line-height:1.7;">
            © 2025 BisonsTechs. All rights reserved.<br/>
            Secure Financial & Inventory Management Platform
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`
  };

  await emailService.transporter.sendMail(mailOptions);
};

const sendExpiryPushNotification = async (userId, expiredProducts, expiringSoonProducts) => {
  const expiredCount = expiredProducts.length;
  const expiringCount = expiringSoonProducts.length;
  
  let title = '';
  let message = '';
  let priority = 'normal';

  if (expiredCount > 0 && expiringCount > 0) {
    title = `⚠️ ${expiredCount} Expired & ${expiringCount} Expiring Soon`;
    message = `${expiredCount} product${expiredCount > 1 ? 's have' : ' has'} expired and ${expiringCount} product${expiringCount > 1 ? 's are' : ' is'} expiring soon. Take action now!`;
    priority = 'high';
  } else if (expiredCount > 0) {
    title = `❌ ${expiredCount} Product${expiredCount > 1 ? 's Have' : ' Has'} Expired`;
    message = `${expiredCount} product${expiredCount > 1 ? 's' : ''} in your inventory ${expiredCount > 1 ? 'have' : 'has'} expired. Please review immediately!`;
    priority = 'high';
  } else if (expiringCount > 0) {
    title = `⚠️ ${expiringCount} Product${expiringCount > 1 ? 's Are' : ' Is'} Expiring Soon`;
    message = `${expiringCount} product${expiringCount > 1 ? 's' : ''} will expire within 30 days. Review your inventory now.`;
    priority = 'normal';
  } else {
    return;
  }

  const topProducts = [...expiredProducts, ...expiringSoonProducts]
    .slice(0, 3)
    .map(p => ({
      id: p.id,
      name: p.name,
      sku: p.sku,
      expiryDate: p.expiryDate,
      daysLeft: Math.floor((new Date(p.expiryDate) - new Date()) / (1000 * 60 * 60 * 24))
    }));

  await sendToUser({
    mongoUserId: userId.toString(),
    title: title,
    message: message,
    priority: priority,
    data: {
      type: 'expiry_alert',
      screen: 'warehouse/expiry',
      expiredCount: expiredCount,
      expiringCount: expiringCount,
      products: topProducts
    }
  });
};

// ============================================================
// @desc    Send expiry notifications manually (for cron job)
// @route   POST /api/warehouse/reports/expiry/notify
// @access  Private/Admin
// ============================================================
const sendManualExpiryNotifications = async (req, res) => {
  try {
    const userId = req.user.id;
    const companyId = req.user.companyId;
    const now = new Date();
    const thirtyDaysFromNow = new Date(now);
    thirtyDaysFromNow.setDate(thirtyDaysFromNow.getDate() + 30);

    // Get all users with their products (for admin/batch processing)
    // For single user, use the one from request
    const users = await prisma.user.findMany({
      where: {
        id: userId, // For admin: remove this to send to all
        isActive: true
      },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        organizationName: true
      }
    });

    const results = [];

    for (const user of users) {
      const products = await prisma.product.findMany({
        where: {
          companyId: companyId,
          isActive: true,
          expiryDate: { not: null }
        },
        select: {
          id: true,
          name: true,
          sku: true,
          currentStock: true,
          expiryDate: true
        }
      });

      const expired = products.filter(p => new Date(p.expiryDate) < now);
      const expiringSoon = products.filter(p => {
        const expiryDate = new Date(p.expiryDate);
        return expiryDate >= now && expiryDate <= thirtyDaysFromNow;
      });

      if (expired.length > 0 || expiringSoon.length > 0) {
        try {
          await sendExpiryNotifications(user.id, expired, expiringSoon);
          results.push({
            userId: user.id,
            email: user.email,
            expired: expired.length,
            expiringSoon: expiringSoon.length,
            status: 'sent'
          });
        } catch (error) {
          results.push({
            userId: user.id,
            email: user.email,
            error: error.message,
            status: 'failed'
          });
        }
      } else {
        results.push({
          userId: user.id,
          email: user.email,
          expired: 0,
          expiringSoon: 0,
          status: 'no_expiry_products'
        });
      }
    }

    res.status(200).json({
      success: true,
      message: 'Expiry notifications processed',
      data: results
    });

  } catch (error) {
    console.error('sendManualExpiryNotifications error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message
    });
  }
};

module.exports = {
  getExpiryReport,
  sendManualExpiryNotifications,
  sendExpiryNotifications // Export for use in cron jobs
};