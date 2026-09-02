// pos/routes/posRoutes.js — All POS API Routes
const express = require('express');
const router  = express.Router();

const { protect } = require('../../middleware/authMiddleware');
const emailService = require('../../services/emailService');

const terminalCtrl = require('../controllers/posTerminalController');
const shiftCtrl    = require('../controllers/posShiftController');
const saleCtrl     = require('../controllers/posSaleController');
const receiptCtrl  = require('../controllers/posReceiptSettingsController');
const restaurantCtrl = require('../controllers/restaurantOrderController');
const settingsCtrl = require('../controllers/posSettingsController');

// ─── Company POS settings (type chosen from web POS hub) ─────────────────────
router.get  ('/settings', protect, settingsCtrl.getSettings);
router.patch('/settings', protect, settingsCtrl.updateSettings);

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
router.get  ('/sales/lookup',     protect, saleCtrl.lookupSale);
router.post ('/sales',            protect, saleCtrl.completeSale);
router.get  ('/sales/held',       protect, saleCtrl.getHeldSales);
router.post ('/sales/hold',       protect, saleCtrl.holdSale);
router.post ('/sales/sync',       protect, saleCtrl.syncSales);
router.get  ('/sales/:id',        protect, saleCtrl.getSale);
router.delete('/sales/held/:id',  protect, saleCtrl.deleteHeldSale);
router.post ('/sales/:id/convert-to-invoice', protect, saleCtrl.convertToInvoice);
router.post ('/sales/:id/void',   protect, saleCtrl.voidSale);

// ─── Returns ──────────────────────────────────────────────────────────────────
router.post('/returns', protect, saleCtrl.processReturn);

// ─── Restaurant orders (Flow #2 — pick app / kitchen / counter via API) ────────
router.post  ('/restaurant/orders',              protect, restaurantCtrl.createOrder);
router.get   ('/restaurant/orders',              protect, restaurantCtrl.listOrders);
router.get   ('/restaurant/orders/kitchen',      protect, restaurantCtrl.getKitchenQueue);
router.get   ('/restaurant/orders/ready',       protect, restaurantCtrl.getReadyQueue);
router.get   ('/restaurant/orders/mine',        protect, restaurantCtrl.listMyOrders);
router.get   ('/restaurant/orders/:id',         protect, restaurantCtrl.getOrder);
router.post  ('/restaurant/orders/:id/preparing', protect, restaurantCtrl.markPreparing);
router.post  ('/restaurant/orders/:id/ready',   protect, restaurantCtrl.markReady);
router.post  ('/restaurant/orders/:id/served',  protect, restaurantCtrl.markServed);
router.post  ('/restaurant/orders/:id/paid',     protect, restaurantCtrl.markPaid);
router.post  ('/restaurant/orders/:id/cancel',  protect, restaurantCtrl.cancelOrder);
router.post  ('/restaurant/orders/:id/lines/:lineId/ready', protect, restaurantCtrl.markLineReady);
router.get   ('/restaurant/kitchen-stations',  protect, restaurantCtrl.listKitchenStations);
router.post  ('/restaurant/kitchen-stations',  protect, restaurantCtrl.createKitchenStation);

// ─── Products (POS-optimized search with barcode) ─────────────────────────────
router.get('/products/search', protect, saleCtrl.searchProducts);
router.get('/products/barcode/:code', protect, saleCtrl.getProductByBarcode);

// ─── Auth / Manager override ─────────────────────────────────────────────────
router.post('/auth/verify-manager', protect, saleCtrl.verifyManager);

// ─── Reports ──────────────────────────────────────────────────────────────────
router.get('/reports/daily', protect, saleCtrl.getDailyReport);
router.get('/reports/shift/:shiftId', protect, saleCtrl.getShiftReport);

// ─── Audit Log ────────────────────────────────────────────────────────────────
router.get('/audit-logs', protect, saleCtrl.getAuditLogs);

// ─── Receipt template (company-wide, edited from POS admin) ───────────────────
router.get('/receipt-settings', protect, receiptCtrl.getReceiptSettings);
router.put('/receipt-settings', protect, receiptCtrl.updateReceiptSettings);

// ─── Send Receipt Email ────────────────────────────────────────────────────────
router.post('/send-receipt', protect, async (req, res) => {
  try {
    const { email, sale, companyProfile, receiptMeta = {} } = req.body;
    
    if (!email) {
      return res.status(400).json({ success: false, message: 'Email is required' });
    }

    const companyName =
      companyProfile?.organizationName ||
      companyProfile?.company?.name ||
      'Bisonstechs';
    const companyLogo =
      companyProfile?.businessDetails?.logo ||
      companyProfile?.company?.logo ||
      companyProfile?.logo ||
      '';
    const companyAddress = [companyProfile?.address, companyProfile?.country].filter(Boolean).join(', ');
    const companyPhone = companyProfile?.phone || companyProfile?.contactNo || '';
    const companyEmail = companyProfile?.email || '';
    const taxId = companyProfile?.businessDetails?.taxRegistrationNumber || '';
    const website = (companyProfile?.websiteLink || '').replace(/^https?:\/\//, '');
    const money = (n) => {
      const symbol = receiptMeta.currencySymbol || '$';
      return `${symbol} ${Number(n || 0).toFixed(2)}`;
    };
    const header = receiptMeta.header || 'TAX INVOICE / SALES RECEIPT';
    const footer = receiptMeta.footer || 'Thank you for shopping with us! Please visit again.';
    const returnPolicy = receiptMeta.returnPolicy || '';
    const extraNotes = receiptMeta.notes || '';
    const cashierName = receiptMeta.cashierName || '';
    const terminalName = receiptMeta.terminalName || '';
    const itemRows = (sale.items || []).map((item) => `
      <tr>
        <td style="padding:10px 0;border-bottom:1px dashed #e5e7eb;font-size:13px;color:#111827;">
          <div style="font-weight:700;">${item.productName || 'Item'}</div>
          <div style="font-size:11px;color:#6b7280;margin-top:2px;">
            ${item.sku ? `SKU ${item.sku}` : ''}
            ${item.quantity || 0} × ${money(item.unitPrice)}
            ${item.discount ? ` · Disc ${item.discount}%` : ''}
            ${item.taxRate ? ` · Tax ${item.taxRate}%` : ''}
          </div>
        </td>
        <td style="padding:10px 0;border-bottom:1px dashed #e5e7eb;font-size:13px;font-weight:700;color:#111827;text-align:right;vertical-align:top;">
          ${money(item.lineTotal)}
        </td>
      </tr>
    `).join('');
    const paymentRows = (sale.payments || []).map((pmt) => `
      <tr>
        <td style="padding:4px 0;font-size:13px;color:#4b5563;">${pmt.paymentMethod || 'Payment'}${pmt.reference ? ` (${pmt.reference})` : ''}</td>
        <td style="padding:4px 0;font-size:13px;color:#111827;text-align:right;">${money(pmt.amount)}</td>
      </tr>
    `).join('');

    const receiptHtml = `
<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width,initial-scale=1.0"/></head>
<body style="margin:0;padding:0;background-color:#eef2f7;font-family:'Segoe UI',Tahoma,Geneva,Verdana,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#eef2f7;padding:32px 16px;">
    <tr><td align="center">
      <table width="560" cellpadding="0" cellspacing="0" border="0"
        style="max-width:560px;width:100%;background:#ffffff;border-radius:18px;overflow:hidden;box-shadow:0 16px 40px rgba(1,69,130,0.12);">
        <tr>
          <td style="background:#014582;padding:32px 36px 24px;text-align:center;">
            ${companyLogo ? `<img src="${companyLogo}" alt="${companyName}" style="height:56px;object-fit:contain;margin-bottom:12px;" />` : ''}
            <div style="font-size:22px;font-weight:800;color:#ffffff;letter-spacing:0.4px;">${companyName}</div>
            <div style="margin-top:8px;font-size:12px;color:rgba(255,255,255,0.85);line-height:1.6;">
              ${companyAddress ? `${companyAddress}<br/>` : ''}
              ${companyPhone ? `Tel: ${companyPhone}<br/>` : ''}
              ${companyEmail || ''}
              ${website ? `<br/>${website}` : ''}
              ${taxId ? `<br/><strong>NTN / Tax ID: ${taxId}</strong>` : ''}
            </div>
            <div style="margin-top:16px;display:inline-block;background:rgba(255,255,255,0.12);color:#fff;font-size:11px;font-weight:700;letter-spacing:1.4px;padding:6px 12px;border-radius:999px;">
              ${header}
            </div>
          </td>
        </tr>
        <tr>
          <td style="background:#ffffff;padding:28px 36px;">
            <p style="font-size:14px;color:#374151;line-height:1.7;margin:0 0 20px 0;">
              Dear <strong style="color:#111827;">${sale.customerName || 'Customer'}</strong>,<br/>
              Thank you for your purchase at <strong>${companyName}</strong>. This email is your official sales receipt.
            </p>
            <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:18px;font-size:13px;color:#374151;">
              <tr><td style="padding:4px 0;">Receipt #</td><td style="padding:4px 0;text-align:right;font-weight:700;color:#111827;">${sale.invoiceNumber}</td></tr>
              <tr><td style="padding:4px 0;">Date</td><td style="padding:4px 0;text-align:right;">${new Date(sale.createdAt || Date.now()).toLocaleString()}</td></tr>
              ${terminalName ? `<tr><td style="padding:4px 0;">Terminal</td><td style="padding:4px 0;text-align:right;">${terminalName}</td></tr>` : ''}
              ${cashierName ? `<tr><td style="padding:4px 0;">Cashier</td><td style="padding:4px 0;text-align:right;">${cashierName}</td></tr>` : ''}
              ${sale.customerPhone ? `<tr><td style="padding:4px 0;">Phone</td><td style="padding:4px 0;text-align:right;">${sale.customerPhone}</td></tr>` : ''}
            </table>
            <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:16px;">
              <tr>
                <td style="font-size:11px;font-weight:700;color:#6b7280;letter-spacing:0.8px;padding-bottom:8px;border-bottom:1px solid #e5e7eb;">ITEM</td>
                <td style="font-size:11px;font-weight:700;color:#6b7280;letter-spacing:0.8px;padding-bottom:8px;border-bottom:1px solid #e5e7eb;text-align:right;">AMOUNT</td>
              </tr>
              ${itemRows}
            </table>
            <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:16px;font-size:13px;">
              <tr><td style="padding:4px 0;color:#4b5563;">Subtotal</td><td style="padding:4px 0;text-align:right;">${money(sale.subtotal)}</td></tr>
              ${Number(sale.discountTotal) > 0 ? `<tr><td style="padding:4px 0;color:#4b5563;">Discount</td><td style="padding:4px 0;text-align:right;">-${money(sale.discountTotal)}</td></tr>` : ''}
              ${Number(sale.taxTotal) > 0 ? `<tr><td style="padding:4px 0;color:#4b5563;">Tax</td><td style="padding:4px 0;text-align:right;">${money(sale.taxTotal)}</td></tr>` : ''}
              <tr><td style="padding:10px 0 4px;font-size:16px;font-weight:800;color:#014582;">TOTAL</td><td style="padding:10px 0 4px;font-size:16px;font-weight:800;color:#014582;text-align:right;">${money(sale.grandTotal)}</td></tr>
            </table>
            ${paymentRows ? `
              <div style="font-size:11px;font-weight:700;color:#6b7280;letter-spacing:0.8px;margin-bottom:6px;">PAYMENT</div>
              <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:16px;">${paymentRows}</table>
            ` : ''}
            <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:18px;font-size:13px;">
              <tr><td style="padding:4px 0;color:#4b5563;">Amount paid</td><td style="padding:4px 0;text-align:right;font-weight:700;">${money(sale.paidAmount)}</td></tr>
              ${Number(sale.changeAmount) > 0 ? `<tr><td style="padding:4px 0;color:#4b5563;">Change</td><td style="padding:4px 0;text-align:right;">${money(sale.changeAmount)}</td></tr>` : ''}
            </table>
            ${receiptMeta.barcodeDataUrl || receiptMeta.qrDataUrl ? `
              <div style="text-align:center;margin:8px 0 18px;">
                ${receiptMeta.barcodeDataUrl ? `<img src="${receiptMeta.barcodeDataUrl}" alt="${sale.invoiceNumber}" style="max-width:320px;height:auto;" />` : ''}
                ${receiptMeta.qrDataUrl ? `<div style="margin-top:12px;"><img src="${receiptMeta.qrDataUrl}" alt="Receipt QR" style="width:160px;height:160px;" /></div>` : ''}
                <div style="font-size:11px;color:#6b7280;margin-top:6px;">Scan barcode / QR for full receipt data (${sale.invoiceNumber || ''})</div>
              </div>
            ` : ''}
            ${returnPolicy ? `<p style="font-size:11px;color:#6b7280;line-height:1.6;text-align:center;margin:0 0 10px 0;">${returnPolicy}</p>` : ''}
            ${extraNotes ? `<p style="font-size:11px;color:#9ca3af;line-height:1.6;text-align:center;margin:0 0 10px 0;">${extraNotes}</p>` : ''}
            <p style="font-size:13px;color:#111827;text-align:center;font-weight:700;margin:12px 0 0 0;">${footer}</p>
            ${companyEmail ? `<p style="font-size:12px;color:#9ca3af;text-align:center;margin:12px 0 0 0;">Questions? ${companyEmail}</p>` : ''}
          </td>
        </tr>
        <tr>
          <td style="background:#f8fafc;border-top:1px solid #eef2f7;padding:18px 36px;">
            <p style="font-size:11px;color:#9ca3af;line-height:1.7;margin:0;text-align:center;">
              © ${new Date().getFullYear()} ${companyName}. All rights reserved.<br/>This is a computer-generated receipt from BisonTechs POS.
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
      html: receiptHtml
    };

    await emailService.transporter.sendMail(mailOptions);
    
    res.status(200).json({ success: true, message: 'Receipt sent successfully' });
  } catch (error) {
    console.error('Error sending receipt email:', error);
    res.status(500).json({ success: false, message: 'Failed to send receipt', error: error.message });
  }
});

module.exports = router;
