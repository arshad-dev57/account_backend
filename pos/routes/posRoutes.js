// pos/routes/posRoutes.js — All POS API Routes
const express = require('express');
const router  = express.Router();

const { protect } = require('../../middleware/authMiddleware');
const emailService = require('../../services/emailService');

const terminalCtrl = require('../controllers/posTerminalController');
const shiftCtrl    = require('../controllers/posShiftController');
const saleCtrl     = require('../controllers/posSaleController');

// ─── Terminal Routes ─────────────────────────────────────────────────────────
router.get   ('/terminals',     protect, terminalCtrl.listTerminals);
router.post  ('/terminals',     protect, terminalCtrl.createTerminal);
router.put   ('/terminals/:id', protect, terminalCtrl.updateTerminal);
router.delete('/terminals/:id', protect, terminalCtrl.deleteTerminal);

// ─── Shift Routes ─────────────────────────────────────────────────────────────
router.get  ('/shifts/current',       protect, shiftCtrl.getCurrentShift);
router.get  ('/shifts',               protect, shiftCtrl.getShiftHistory);
router.post ('/shifts/open',          protect, shiftCtrl.openShift);
router.post ('/shifts/:shiftId/close',   protect, shiftCtrl.closeShift);
router.post ('/shifts/:shiftId/suspend', protect, shiftCtrl.suspendShift);
router.post ('/shifts/:shiftId/resume',  protect, shiftCtrl.resumeShift);
router.post ('/shifts/:shiftId/reopen',  protect, shiftCtrl.reopenShift);
router.post ('/cash-flow',            protect, shiftCtrl.recordCashFlow);

// ─── Sale Routes ──────────────────────────────────────────────────────────────
router.get  ('/sales',            protect, saleCtrl.listSales);
router.post ('/sales',            protect, saleCtrl.completeSale);
router.get  ('/sales/held',       protect, saleCtrl.getHeldSales);
router.post ('/sales/hold',       protect, saleCtrl.holdSale);
router.post ('/sales/sync',       protect, saleCtrl.syncSales);
router.get  ('/sales/:id',        protect, saleCtrl.getSale);
router.delete('/sales/held/:id',  protect, saleCtrl.deleteHeldSale);
router.post ('/sales/:id/convert-to-invoice', protect, saleCtrl.convertToInvoice);

// ─── Returns ──────────────────────────────────────────────────────────────────
router.post('/returns', protect, saleCtrl.processReturn);

// ─── Products (POS-optimized search with barcode) ─────────────────────────────
router.get('/products/search', protect, saleCtrl.searchProducts);

// ─── Reports ──────────────────────────────────────────────────────────────────
router.get('/reports/daily', protect, saleCtrl.getDailyReport);

// ─── Audit Log ────────────────────────────────────────────────────────────────
router.get('/audit-logs', protect, saleCtrl.getAuditLogs);

// ─── Send Receipt Email ────────────────────────────────────────────────────────
router.post('/send-receipt', protect, async (req, res) => {
  try {
    const { email, sale, companyProfile } = req.body;
    
    if (!email) {
      return res.status(400).json({ success: false, message: 'Email is required' });
    }

    const companyName = companyProfile?.organizationName || companyProfile?.personName || 'BisonTechs';
    const companyLogo = companyProfile?.businessDetails?.logo || companyProfile?.logo || '';

    // Generate receipt HTML
    const receiptHtml = `
<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width,initial-scale=1.0"/></head>
<body style="margin:0;padding:0;background-color:#f1f5f9;font-family:'Segoe UI',Tahoma,Geneva,Verdana,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#f1f5f9;padding:40px 16px;">
    <tr><td align="center">
      <table width="560" cellpadding="0" cellspacing="0" border="0"
        style="max-width:560px;width:100%;background:#ffffff;border-radius:24px;overflow:hidden;box-shadow:0 20px 60px rgba(0,0,0,0.12);">
        <tr>
          <td style="background:linear-gradient(135deg,#0f172a 0%,#1e293b 55%,#0f2744 100%);padding:48px 40px 36px;text-align:center;">
            ${companyLogo ? `
              <img src="${companyLogo}" alt="${companyName}" style="width:80px;height:80px;border-radius:12px;object-fit:cover;margin-bottom:20px;" />
            ` : ''}
            <div style="font-size:36px;margin-bottom:8px;">🏪</div>
            <div style="font-size:26px;font-weight:800;color:#ffffff;letter-spacing:-0.5px;line-height:1.2;">RECEIPT</div>
            <div style="margin-top:8px;font-size:15px;color:rgba(255,255,255,0.7);font-weight:300;">
              ${companyName}
            </div>
            <table width="100%" cellpadding="0" cellspacing="0" style="margin-top:32px;margin-bottom:-2px;">
              <tr><td>
                <svg viewBox="0 0 560 36" xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="none" width="100%" height="36">
                  <path d="M0,36 C140,0 420,0 560,36 L560,36 L0,36 Z" fill="#ffffff"/>
                </svg>
              </td></tr>
            </table>
          </td>
        </tr>
        <tr>
          <td style="background:#ffffff;padding:36px 40px 28px;">
            <p style="font-size:15px;color:#374151;line-height:1.8;margin:0 0 28px 0;">
              Dear <strong style="color:#111827;">${sale.customerName || 'Customer'}</strong>,<br/>
              Thank you for your purchase at <strong style="color:#111827;">${companyName}</strong>.
              Below is your receipt for reference.
            </p>
            <table width="100%" cellpadding="0" cellspacing="0" style="background:#f0fdf4;border:1px solid #bbf7d0;border-left:4px solid #22c55e;border-radius:10px;margin-bottom:28px;">
              <tr><td style="padding:16px 20px;">
                <table cellpadding="0" cellspacing="0"><tr>
                  <td style="padding-right:12px;vertical-align:top;font-size:18px;">📋</td>
                  <td style="font-size:14px;color:#14532d;line-height:1.7;">
                    <strong>Receipt Details:</strong><br/>
                    Invoice: ${sale.invoiceNumber}<br/>
                    Date: ${new Date(sale.createdAt || Date.now()).toLocaleString()}<br/>
                    Total: $${sale.grandTotal?.toFixed(2)}
                  </td>
                </tr></table>
              </td></tr>
            </table>
            <div style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:10px;padding:20px;margin-bottom:28px;">
              <div style="font-size:12px;color:#6b7280;margin-bottom:12px;font-weight:600;">ITEMS</div>
              ${sale.items?.map((item, i) => `
                <div style="display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid #e5e7eb;">
                  <span style="color:#374151;font-size:13px;">${item.productName} x${item.quantity}</span>
                  <span style="color:#111827;font-weight:600;font-size:13px;">$${item.lineTotal?.toFixed(2)}</span>
                </div>
              `).join('') || ''}
              <div style="display:flex;justify-content:space-between;padding:12px 0 8px;margin-top:8px;border-top:2px solid #e5e7eb;">
                <span style="color:#374151;font-weight:600;font-size:14px;">TOTAL</span>
                <span style="color:#111827;font-weight:800;font-size:16px;">$${sale.grandTotal?.toFixed(2)}</span>
              </div>
            </div>
            <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:22px;">
              <tr><td style="height:1px;background:linear-gradient(90deg,transparent,#e5e7eb,transparent);"></td></tr>
            </table>
            <p style="font-size:12px;color:#9ca3af;text-align:center;line-height:1.8;margin:0;">
              Questions? <span style="color:#6366f1;">support@bisontechs.com</span>
            </p>
          </td>
        </tr>
        <tr>
          <td style="background:#f9fafb;border-top:1px solid #f3f4f6;padding:22px 40px;">
            <p style="font-size:12px;color:#9ca3af;line-height:1.7;margin:0 0 12px 0;">
              © ${new Date().getFullYear()} ${companyName}. All rights reserved.<br/>Point of Sale System
            </p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;

    const mailOptions = {
      from: `"${companyName}" <${process.env.EMAIL_USER}>`,
      to: email,
      subject: `Receipt - ${sale.invoiceNumber} - ${companyName}`,
      html: receiptHtml,
    };

    await emailService.transporter.sendMail(mailOptions);
    
    res.status(200).json({ success: true, message: 'Receipt sent successfully' });
  } catch (error) {
    console.error('Error sending receipt email:', error);
    res.status(500).json({ success: false, message: 'Failed to send receipt', error: error.message });
  }
});

module.exports = router;
