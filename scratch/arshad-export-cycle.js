'use strict';

/**
 * Seeds a complete export cycle for Arshads company via exportService.
 * Run: node scratch/arshad-export-cycle.js
 */

require('dotenv').config({ quiet: true });
const prisma = require('../prisma/client');
const exportSvc = require('../services/exportService');

const COMPANY_ID = 'd192a79c-4480-45d3-bad0-41312f6fe4bd';
const USER_ID = '7e60368c-2409-448b-a0ac-f556eb3d61a5';
const CUSTOMER_ID = 'a1392d36-37a3-4e3a-b443-2116433de893';
const PRODUCT_ID = '3a2d3fee-a686-47bb-9cd3-ace2f681ca4d';
const LOCATION_ID = 'e3bcce73-f909-4c1a-8211-1945f7c4b6c1';
const BANK_ID = 'ebc6c59f-5f17-4eba-90ae-635f81fe6085';
const RATE = 278.5;
const QTY = 1200; // meters finished fabric
const UNIT = 2.85; // USD/m
const log = (...a) => console.log('[EXPORT-CYCLE]', ...a);

function makeReq(body = {}, params = {}) {
  return {
    method: 'POST',
    body,
    params,
    query: {},
    companyMode: 'single',
    accessibleCompanyIds: [COMPANY_ID],
    user: {
      id: USER_ID,
      companyId: COMPANY_ID,
      email: 'arshadnasir212@gmail.com',
    },
  };
}

async function main() {
  // Ensure stock still available
  await prisma.productStock.upsert({
    where: { productId_locationId: { productId: PRODUCT_ID, locationId: LOCATION_ID } },
    create: {
      companyId: COMPANY_ID,
      productId: PRODUCT_ID,
      locationId: LOCATION_ID,
      currentStock: 5000,
      availableStock: 5000,
    },
    update: { currentStock: 5000, availableStock: 5000 },
  });
  await prisma.product.update({
    where: { id: PRODUCT_ID },
    data: { currentStock: 5000, availableStock: 5000, sellingPrice: UNIT, costPrice: 1800 },
  });

  // 1. Inquiry
  const inquiry = await exportSvc.createInquiry(
    makeReq({
      customerId: CUSTOMER_ID,
      customerCountry: 'United Arab Emirates',
      currency: 'USD',
      exchangeRate: RATE,
      incoterm: 'CIF',
      destinationPort: 'Jebel Ali',
      destinationPortCode: 'AEJEA',
      notes: 'Buyer RFQ for finished fabric — Dubai garment factories Q1 shipment',
      status: 'Open',
      leadStage: 'New Inquiry',
      targetDispatchDate: '2026-12-15',
      items: [{ productId: PRODUCT_ID, quantity: QTY, unitPriceForeign: UNIT }],
    })
  );
  log('1 Inquiry', inquiry.inquiryNumber);

  // 2. Quotation (from inquiry)
  const quote = await exportSvc.createQuotation(
    makeReq({
      inquiryId: inquiry.id,
      customerId: CUSTOMER_ID,
      currency: 'USD',
      exchangeRate: RATE,
      incoterm: 'CIF',
      destinationPort: 'Jebel Ali',
      validityDate: '2026-12-01',
      notes: 'CIF Jebel Ali — includes ocean freight & marine insurance',
      items: [{ productId: PRODUCT_ID, quantity: QTY, unitPriceForeign: UNIT }],
    })
  );
  log('2 Quotation', quote.quoteNumber);

  await exportSvc.approveQuotation(makeReq({}, { id: quote.id }));
  log('2 Quotation approved');

  // 3. Convert to Export Sales Order
  const order = await exportSvc.convertQuotationToOrder(
    makeReq({ locationId: LOCATION_ID }, { id: quote.id })
  );
  log('3 Order', order.orderNumber, order.status);

  // 4. Proforma
  const proforma = await exportSvc.createProforma(makeReq({ orderId: order.id }));
  log('4 Proforma', proforma.piNumber);

  // Move order through production statuses
  for (const status of ['In Production / Packing', 'Pre-Shipment Inspection', 'Customs Cleared']) {
    await exportSvc.updateOrderStatus(makeReq({ status }, { id: order.id }));
  }
  log('3 Order status → Customs Cleared');

  // 5. Packing & Inspection
  const packing = await exportSvc.createPacking(
    makeReq({
      orderId: order.id,
      inspectionAgency: 'SGS Pakistan',
      inspectionCertificateNo: `SGS-PK-${Date.now()}`,
      notes: '40ft HC — fabric rolls poly-wrapped on pallets',
    })
  );
  for (const status of ['Sample Tested', 'Passed & Certified']) {
    await exportSvc.updatePackingStatus(makeReq({ status }, { id: packing.id }));
  }
  log('5 Packing', packing.packingListNo, 'certified');

  // 6. Customs
  const customs = await exportSvc.createCustoms(
    makeReq({
      orderId: order.id,
      exportPort: 'Karachi',
      dutyDrawbackEligible: true,
      notes: 'Shipping bill filed for fabric HS chapter 52',
    })
  );
  for (const status of [
    'Submitted to Customs',
    'Goods Inspected at Port',
    'Let Export Order (LEO) Granted',
  ]) {
    await exportSvc.updateCustomsStatus(makeReq({ status }, { id: customs.id }));
  }
  log('6 Customs', customs.shippingBillNo, 'LEO granted');

  // 7. Shipment
  const shipment = await exportSvc.createShipment(
    makeReq({
      orderId: order.id,
      shippingLine: 'Maersk Line',
      vesselName: 'MAERSK KARACHI',
      voyageNo: 'MK-452E',
      containerNo: 'MSKU7654321',
      blNumber: `MAEU${Date.now().toString().slice(-9)}`,
      portOfLoading: 'Karachi',
      portOfDischarge: 'Jebel Ali',
      locationId: LOCATION_ID,
      etd: '2026-12-10',
      eta: '2026-12-18',
    })
  );
  log('7 Shipment', shipment.shipmentNumber);

  // 8. Documents
  for (const docType of [
    'Commercial Invoice',
    'Packing List',
    'Bill of Lading',
    'Certificate of Origin',
    'Insurance Certificate',
  ]) {
    const doc = await exportSvc.createDocument(
      makeReq({
        orderId: order.id,
        shipmentId: shipment.id,
        docType,
        notes: `${docType} for ${order.orderNumber}`,
      })
    );
    await exportSvc.updateDocumentStatus(makeReq({ status: 'Finalized' }, { id: doc.id }));
    await exportSvc.updateDocumentStatus(
      makeReq({ status: 'Dispatched via DHL to Bank' }, { id: doc.id })
    );
    log('8 Document', doc.docNumber, docType);
  }

  // 9. Advance receipt (30%) — post to bank
  const advanceForeign = Math.round(QTY * UNIT * 0.3 * 100) / 100;
  const advance = await exportSvc.createReceipt(
    makeReq({
      orderId: order.id,
      proformaId: proforma.id,
      receiptType: 'Advance',
      receiptDate: new Date().toISOString(),
      foreignAmount: advanceForeign,
      currency: 'USD',
      exchangeRate: RATE,
      bankChargesForeign: 15,
      bankAccountId: BANK_ID,
      nostroAccountRef: `NOSTRO-HBL-${Date.now()}`,
      notes: '30% advance against PI via TT',
    })
  );
  await exportSvc.updateReceiptStatus(
    makeReq({ status: 'Realized & Credited', bankAccountId: BANK_ID }, { id: advance.id })
  );
  log('9 Advance receipt', advance.receiptNumber, `$${advanceForeign} posted`);

  // 10. Dispatch
  const dispatch = await exportSvc.createDispatch(
    makeReq({
      orderId: order.id,
      shipmentId: shipment.id,
      locationId: LOCATION_ID,
      transporterName: 'Al-Hamd Logistics',
      vehicleNo: 'KHI-4587',
      notes: 'Gate pass to Karachi Port QICT',
    })
  );
  for (const status of ['En Route to Port', 'Container Gate-In Complete', 'Handed Over to Shipping Line']) {
    await exportSvc.updateDispatchStatus(makeReq({ status }, { id: dispatch.id }));
  }
  log('10 Dispatch', dispatch.dispatchNumber, 'handed over');

  // Fetch invoice created on dispatch handover
  const full = await exportSvc.getOrderFull(makeReq({}, { id: order.id }));
  const invoice = full.invoices?.[0];
  if (!invoice) throw new Error('Commercial invoice missing after dispatch');
  log('11 Commercial invoice', invoice.invoiceNumber, 'outstanding', invoice.outstanding);

  // 12. LC
  const lc = await exportSvc.createFinanceLc(
    makeReq({
      orderId: order.id,
      issuingBank: 'Emirates NBD',
      advisingBank: 'Habib Bank Limited',
      lcValueForeign: QTY * UNIT,
      currency: 'USD',
      exchangeRate: RATE,
      expiryDate: '2027-01-31',
      presentationDays: 21,
      notes: 'Irrevocable LC at sight',
    })
  );
  for (const status of ['Confirmed', 'Documents Negotiated', 'Settlement Received']) {
    await exportSvc.updateFinanceLcStatus(makeReq({ status }, { id: lc.id }));
  }
  log('12 LC', lc.lcAdviceNumber);

  // 13. Settlement receipt for remaining
  const settlementForeign = Math.round((invoice.outstanding / RATE) * 100) / 100;
  const settlement = await exportSvc.createReceipt(
    makeReq({
      orderId: order.id,
      invoiceId: invoice.id,
      receiptType: 'Settlement',
      receiptDate: new Date().toISOString(),
      foreignAmount: settlementForeign,
      currency: 'USD',
      exchangeRate: RATE,
      bankAccountId: BANK_ID,
      notes: 'Balance settlement after BL presentation',
    })
  );
  await exportSvc.updateReceiptStatus(
    makeReq({ status: 'Realized & Credited', bankAccountId: BANK_ID }, { id: settlement.id })
  );
  await exportSvc.updateReceiptStatus(
    makeReq({ status: 'Forex Hedged' }, { id: settlement.id })
  );
  log('13 Settlement', settlement.receiptNumber, `$${settlementForeign} posted`);

  // 14. Expense — freight
  const expenseAccount = await prisma.chartOfAccount.findFirst({
    where: { companyId: COMPANY_ID, code: '6600' },
  });
  const expense = await exportSvc.createExpense(
    makeReq({
      orderId: order.id,
      shipmentId: shipment.id,
      expenseType: 'Freight',
      date: new Date().toISOString(),
      currency: 'USD',
      exchangeRate: RATE,
      amountForeign: 1850,
      description: 'Ocean freight Karachi → Jebel Ali (CIF portion)',
      accountId: expenseAccount.id,
      bankAccountId: BANK_ID,
    })
  );
  await exportSvc.postExpense(makeReq({}, { id: expense.id }));
  log('14 Expense', expense.expenseNumber, 'Posted');

  // 15. Shipment milestones → order Delivered → Completed
  for (const status of [
    'Container Gate-In',
    'Loaded on Vessel',
    'In Transit',
    'Arrived at Destination',
    'Customs Cleared Buyer',
  ]) {
    await exportSvc.updateShipmentStatus(makeReq({ status }, { id: shipment.id }));
  }
  await exportSvc.updateCustomsStatus(makeReq({ status: 'Sailed & Completed' }, { id: customs.id }));
  await exportSvc.updateOrderStatus(makeReq({ status: 'Completed' }, { id: order.id }));
  log('15 Order completed');

  const finalFull = await exportSvc.getOrderFull(makeReq({}, { id: order.id }));
  console.log(
    '\n=== ARSHAD EXPORT CYCLE READY ===\n',
    JSON.stringify(
      {
        inquiry: inquiry.inquiryNumber,
        quotation: quote.quoteNumber,
        order: order.orderNumber,
        orderStatus: finalFull.order.status,
        proforma: proforma.piNumber,
        packing: packing.packingListNo,
        customs: customs.shippingBillNo,
        shipment: shipment.shipmentNumber,
        dispatch: dispatch.dispatchNumber,
        invoices: (finalFull.invoices || []).map((i) => ({
          number: i.invoiceNumber,
          grand: i.grandTotal,
          paid: i.paidAmount,
          outstanding: i.outstanding,
        })),
        receipts: (finalFull.receipts || []).map((r) => ({
          number: r.receiptNumber,
          type: r.receiptType,
          status: r.status,
        })),
        lc: lc.lcAdviceNumber,
        expense: expense.expenseNumber,
      },
      null,
      2
    )
  );
}

main()
  .catch((err) => {
    console.error('\nFAILED:', err.stack || err.message || err);
    process.exitCode = 1;
  })
  .finally(async () => {
    try {
      await prisma.$disconnect();
    } catch {
      /* ignore */
    }
  });
