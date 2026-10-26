'use strict';

/**
 * Live Export Management E2E smoke test against the running local backend.
 * Seeds one customer/product/location/stock/bank account in the demo company,
 * then drives the complete workflow through the HTTP API.
 *
 * Run: node scratch/export-e2e-smoke.js
 */

const assert = require('node:assert/strict');
require('dotenv').config({ quiet: true });
const prisma = require('../prisma/client');

const BASE = 'http://localhost:5000/api';
const COMPANY_ID = 'b276083a-ee59-4fca-b9bb-4ac7c720576d'; // App Store Demo Company
const OTHER_COMPANY_ID = '73bf6455-9670-48e3-b1d6-2c05f0a5d9e4';
const RATE = 278.5;
const STAMP = Date.now();
const log = (...args) => console.log('[E2E]', ...args);
const num = (v) => (v && typeof v.toString === 'function' && typeof v !== 'number' ? Number(v.toString()) : Number(v));

let token = '';
let userId = '';

async function api(method, route, body, { companyId = COMPANY_ID, allowFail = false } = {}) {
  const headers = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`,
  };
  if (companyId) headers['X-Company-Id'] = companyId;
  const res = await fetch(`${BASE}${route}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let json = null;
  try {
    json = await res.json();
  } catch {
    json = { raw: await res.text() };
  }
  if (!allowFail && (!res.ok || json?.success === false)) {
    throw new Error(
      `${method} ${route} failed ${res.status}: ${json?.message || JSON.stringify(json)}`
    );
  }
  return { status: res.status, json };
}

async function expectFailure(method, route, body, expectedStatus, expectedCode, opts = {}) {
  const { status, json } = await api(method, route, body, { ...opts, allowFail: true });
  assert.equal(
    status,
    expectedStatus,
    `expected ${expectedStatus} from ${method} ${route}, got ${status}: ${JSON.stringify(json)}`
  );
  if (expectedCode) {
    assert.equal(
      json?.code,
      expectedCode,
      `expected code ${expectedCode}, got ${json?.code}: ${JSON.stringify(json)}`
    );
  }
  log(`✓ rejected as expected: ${method} ${route} → ${status} ${json?.code || ''}`);
}

(async () => {
  const login = await api(
    'POST',
    '/users/verify-login-otp',
    { email: 'demo@bisonstechs.com', otp: '123456' },
    { companyId: null }
  );
  token = login.json.token;
  userId = login.json.user?.id || login.json.user?._id;
  assert.ok(token, 'login did not return a token');
  assert.ok(userId, 'login did not return a user id');
  log('logged in as', login.json.user?.email, 'company', COMPANY_ID);

  const customer = await prisma.customer.create({
    data: {
      customerNumber: `E2E-C-${STAMP}`,
      name: `E2E Export Buyer ${STAMP}`,
      email: `e2e-${STAMP}@example.com`,
      customerType: 'Business',
      address: { country: 'United Arab Emirates', city: 'Dubai' },
      status: 'Active',
      creator: { connect: { id: userId } },
      company: { connect: { id: COMPANY_ID } },
      isActive: true,
      isDeleted: false,
    },
  });
  const product = await prisma.product.create({
    data: {
      name: `E2E Export Widget ${STAMP}`,
      sku: `E2E-SKU-${STAMP}`,
      costPrice: 50,
      sellingPrice: 80,
      currencyCode: 'USD',
      stockUnitName: 'PCS',
      currentStock: 100,
      availableStock: 100,
      isActive: true,
      company: { connect: { id: COMPANY_ID } },
      creator: { connect: { id: userId } },
    },
  });
  const location = await prisma.location.create({
    data: {
      company: { connect: { id: COMPANY_ID } },
      name: `E2E Export Warehouse ${STAMP}`,
      code: `E2E-WH-${STAMP}`,
      type: 'Warehouse',
      isActive: true,
      isDeleted: false,
    },
  });
  await prisma.productStock.create({
    data: {
      company: { connect: { id: COMPANY_ID } },
      product: { connect: { id: product.id } },
      location: { connect: { id: location.id } },
      currentStock: 100,
      availableStock: 100,
    },
  });
  const bankCoa = await prisma.chartOfAccount.findFirst({
    where: { companyId: COMPANY_ID, isActive: true, code: '1002' },
  });
  assert.ok(bankCoa, 'cash/bank COA account 1002 missing');
  const bank = await prisma.bankAccount.create({
    data: {
      accountName: `E2E Export Bank ${STAMP}`,
      accountNumber: `E2E-ACC-${STAMP}`,
      bankName: 'E2E Bank',
      currency: 'PKR',
      chartOfAccount: { connect: { id: bankCoa.id } },
      creator: { connect: { id: userId } },
      company: { connect: { id: COMPANY_ID } },
    },
  });
  log('seeded customer/product/location/stock/bank');

  const inquiry = await api('POST', '/export/inquiries', {
    customerId: customer.id,
    currency: 'USD',
    exchangeRate: RATE,
    incoterm: 'FOB',
    destinationPort: 'Jebel Ali',
    notes: `E2E smoke ${STAMP}`,
    items: [{ productId: product.id, quantity: 10, unitPriceForeign: 100 }],
  });
  const inquiryId = inquiry.json.data.id;
  assert.equal(inquiry.json.data.estimatedRevenueForeign, 1000);
  assert.equal(inquiry.json.data.estimatedRevenueBase, 278500);
  log('inquiry', inquiry.json.data.inquiryNumber, 'foreign 1000 base 278500');

  const quote = await api('POST', '/export/quotations', {
    inquiryId,
    customerId: customer.id,
    currency: 'USD',
    exchangeRate: RATE,
    items: [{ productId: product.id, quantity: 10, unitPriceForeign: 100 }],
  });
  const quoteId = quote.json.data.id;
  assert.equal(quote.json.data.totalForeign, 1000);
  const inquiryAfterQuote = await api('GET', `/export/inquiries/${inquiryId}`);
  assert.equal(inquiryAfterQuote.json.data.status, 'Converted');
  log('quotation', quote.json.data.quoteNumber, 'inquiry auto-converted');

  await api('POST', `/export/quotations/${quoteId}/approve`);
  const converted = await api('POST', `/export/quotations/${quoteId}/convert-to-order`, {
    locationId: location.id,
  });
  const orderId = converted.json.data.id;
  assert.equal(converted.json.data.status, 'Confirmed');
  assert.equal(converted.json.data.exchangeRate, RATE);
  log('order', converted.json.data.orderNumber, 'confirmed at rate', RATE);

  await expectFailure(
    'PATCH',
    `/export/orders/${orderId}/status`,
    { status: 'Completed' },
    409,
    'INVALID_TRANSITION'
  );

  const proforma = await api('POST', '/export/proformas', { orderId });
  assert.equal(proforma.json.data.status, 'Issued');
  log('proforma', proforma.json.data.piNumber);

  for (const status of ['In Production / Packing', 'Pre-Shipment Inspection', 'Customs Cleared']) {
    const r = await api('PATCH', `/export/orders/${orderId}/status`, { status });
    assert.equal(r.json.data.status, status);
  }

  const packing = await api('POST', '/export/packing', {
    orderId,
    inspectionAgency: 'E2E Inspection Co',
    inspectionCertificateNo: `E2E-CERT-${STAMP}`,
  });
  const packingId = packing.json.data.id;
  for (const status of ['Sample Tested', 'Passed & Certified']) {
    await api('PATCH', `/export/packing/${packingId}/status`, { status });
  }
  log('packing certified', packing.json.data.packingListNo);

  const customs = await api('POST', '/export/customs', {
    orderId,
    exportPort: 'Karachi',
    dutyDrawbackEligible: false,
  });
  const customsId = customs.json.data.id;
  for (const status of [
    'Submitted to Customs',
    'Goods Inspected at Port',
    'Let Export Order (LEO) Granted',
  ]) {
    await api('PATCH', `/export/customs/${customsId}/status`, { status });
  }
  log('customs LEO', customs.json.data.shippingBillNo);

  const shipment = await api('POST', '/export/shipments', {
    orderId,
    shippingLine: 'E2E Line',
    portOfLoading: 'Karachi',
    portOfDischarge: 'Jebel Ali',
    locationId: location.id,
  });
  const shipmentId = shipment.json.data.id;
  assert.equal(shipment.json.data.items.length, 1);
  assert.equal(shipment.json.data.items[0].quantity, 10);
  log('shipment', shipment.json.data.shipmentNumber);

  const advance = await api('POST', '/export/receipts', {
    orderId,
    proformaId: proforma.json.data.id,
    receiptType: 'Advance',
    receiptDate: new Date().toISOString(),
    foreignAmount: 300,
    currency: 'USD',
    exchangeRate: RATE,
    bankChargesForeign: 2,
    bankAccountId: bank.id,
    nostroAccountRef: `E2E-NOSTRO-${STAMP}`,
  });
  assert.equal(advance.json.data.status, 'Funds In Transit');
  assert.equal(advance.json.data.grossBase, 300 * RATE);
  const advanceId = advance.json.data.id;
  await api('POST', `/export/receipts/${advanceId}/post`, { bankAccountId: bank.id });
  const advanceAfter = await api('GET', `/export/receipts/${advanceId}`);
  assert.equal(advanceAfter.json.data.status, 'Realized & Credited');
  assert.ok(advanceAfter.json.data.journalEntryId, 'advance JE missing');
  log('advance posted', advance.json.data.receiptNumber, 'JE', advanceAfter.json.data.journalEntryId);

  await expectFailure(
    'POST',
    '/export/receipts',
    {
      orderId,
      receiptType: 'Advance',
      foreignAmount: 10,
      currency: 'EUR',
      exchangeRate: RATE,
    },
    400,
    'CURRENCY_MISMATCH'
  );

  const dispatch = await api('POST', '/export/dispatch', {
    orderId,
    shipmentId,
    locationId: location.id,
    transporterName: 'E2E Transport',
  });
  const dispatchId = dispatch.json.data.id;
  for (const status of ['En Route to Port', 'Container Gate-In Complete']) {
    await api('PATCH', `/export/dispatch/${dispatchId}/status`, { status });
  }
  const handover = await api('PATCH', `/export/dispatch/${dispatchId}/status`, {
    status: 'Handed Over to Shipping Line',
  });
  assert.equal(handover.json.data.status, 'Handed Over to Shipping Line');
  const orderAfterDispatch = await api('GET', `/export/orders/${orderId}`);
  assert.equal(orderAfterDispatch.json.data.status, 'Dispatched');
  log('dispatch handed over; order Dispatched');

  await expectFailure(
    'POST',
    '/export/dispatch',
    { orderId, shipmentId, locationId: location.id },
    409,
    'DISPATCH_EXISTS'
  );

  const full = await api('GET', `/export/orders/${orderId}/full`);
  const invoice = full.json.data.invoices[0];
  assert.ok(invoice, 'commercial invoice not created');
  assert.equal(invoice.invoiceNumber.startsWith('ECI-'), true);
  assert.equal(invoice.grandTotal, 278500);
  assert.equal(invoice.outstanding, 194950, 'advance should have reduced invoice outstanding');
  assert.equal(full.json.data.order.advanceAppliedBase, 300 * RATE);
  assert.equal(full.json.data.order.invoicedBase, 278500);
  log('invoice', invoice.invoiceNumber, 'grand', invoice.grandTotal, 'outstanding', invoice.outstanding);

  const stockRow = await prisma.productStock.findUnique({
    where: { productId_locationId: { productId: product.id, locationId: location.id } },
  });
  assert.equal(stockRow.currentStock, 90, 'stock should drop from 100 to 90');
  const productRow = await prisma.product.findUnique({ where: { id: product.id } });
  assert.equal(productRow.currentStock, 90, 'product stock should match location stock');
  log('inventory deducted 100 → 90 at location');

  const settlementForeign = invoice.outstanding / RATE;
  const settlement = await api('POST', '/export/receipts', {
    orderId,
    invoiceId: invoice.id,
    receiptType: 'Settlement',
    receiptDate: new Date().toISOString(),
    foreignAmount: settlementForeign,
    currency: 'USD',
    exchangeRate: RATE,
    bankAccountId: bank.id,
  });
  const settlementId = settlement.json.data.id;
  await api('POST', `/export/receipts/${settlementId}/post`, { bankAccountId: bank.id });
  await api('PATCH', `/export/receipts/${settlementId}/status`, { status: 'Forex Hedged' });
  const settlementAfter = await api('GET', `/export/receipts/${settlementId}`);
  assert.equal(settlementAfter.json.data.status, 'Forex Hedged');
  const invoiceAfter = await prisma.salesInvoice.findUnique({ where: { id: invoice.id } });
  assert.equal(invoiceAfter.outstanding, 0, 'invoice should be fully paid');
  assert.equal(invoiceAfter.paymentStatus, 'Paid');
  log('settlement posted; invoice fully paid');

  const lc = await api('POST', '/export/finance/lcs', {
    orderId,
    issuingBank: 'E2E Issuing Bank',
    advisingBank: 'E2E Advising Bank',
    lcValueForeign: 1000,
    currency: 'USD',
    exchangeRate: RATE,
    expiryDate: '2026-12-31',
    presentationDays: 21,
  });
  const lcId = lc.json.data.id;
  assert.equal(lc.json.data.lcValueBase, 278500);
  for (const status of ['Confirmed', 'Documents Negotiated', 'Settlement Received']) {
    await api('PATCH', `/export/finance/lcs/${lcId}/status`, { status });
  }
  const lcAfter = await api('GET', `/export/finance/lcs/${lcId}`);
  assert.equal(lcAfter.json.data.status, 'Settlement Received');
  log('LC settled', lc.json.data.lcAdviceNumber);

  const expenseAccount = await prisma.chartOfAccount.findFirst({
    where: { companyId: COMPANY_ID, code: '6600' },
  });
  const expense = await api('POST', '/export/expenses', {
    orderId,
    shipmentId,
    expenseType: 'Freight',
    date: new Date().toISOString(),
    currency: 'USD',
    exchangeRate: RATE,
    amountForeign: 50,
    description: `E2E freight ${STAMP}`,
    accountId: expenseAccount.id,
    bankAccountId: bank.id,
  });
  const expenseId = expense.json.data.id;
  assert.equal(expense.json.data.status, 'Draft');
  assert.equal(expense.json.data.amountBase, 50 * RATE);
  const postedExpense = await api('POST', `/export/expenses/${expenseId}/post`, {});
  assert.equal(postedExpense.json.data.status, 'Posted');
  assert.ok(postedExpense.json.data.journalEntryId, 'expense JE missing');
  const reversed = await api('POST', `/export/expenses/${expenseId}/reverse`, {
    reason: 'E2E smoke reversal',
  });
  assert.equal(reversed.json.data.status, 'Reversed');
  const reversalJe = await prisma.journalEntry.findFirst({
    where: { companyId: COMPANY_ID, reference: `${expense.json.data.expenseNumber}-REV` },
  });
  assert.ok(reversalJe, 'reversal JE missing');
  log('expense posted and reversed', expense.json.data.expenseNumber);

  for (const status of [
    'Container Gate-In',
    'Loaded on Vessel',
    'In Transit',
    'Arrived at Destination',
    'Customs Cleared Buyer',
  ]) {
    await api('PATCH', `/export/shipments/${shipmentId}/status`, { status });
  }
  await api('PATCH', `/export/customs/${customsId}/status`, { status: 'Sailed & Completed' });
  const delivered = await api('GET', `/export/orders/${orderId}`);
  assert.equal(delivered.json.data.status, 'Delivered');
  log('shipment cleared at destination; order Delivered');

  const completed = await api('PATCH', `/export/orders/${orderId}/status`, { status: 'Completed' });
  assert.equal(completed.json.data.status, 'Completed');
  log('order completed');

  await expectFailure(
    'PATCH',
    `/export/orders/${orderId}/status`,
    { status: 'Dispatched' },
    409,
    'INVALID_TRANSITION'
  );

  const finalInvoice = await prisma.salesInvoice.findFirst({
    where: { id: invoice.id, companyId: COMPANY_ID },
  });
  assert.equal(num(finalInvoice.grandTotal), 278500);
  assert.equal(num(finalInvoice.paidAmount), 278500);
  assert.equal(num(finalInvoice.outstanding), 0);

  const ar = await prisma.accountsReceivable.findFirst({ where: { invoiceId: invoice.id } });
  assert.ok(ar, 'AR row missing');
  assert.equal(num(ar.outstanding), 0);
  assert.equal(ar.status, 'Paid');

  const receipts = await prisma.exportReceipt.findMany({
    where: { orderId, companyId: COMPANY_ID },
    select: { receiptNumber: true, status: true, journalEntryId: true, receiptType: true },
  });
  assert.equal(receipts.length, 2);
  assert.ok(receipts.every((r) => r.journalEntryId));

  const expenseRow = await prisma.exportExpense.findUnique({ where: { id: expenseId } });
  assert.ok(expenseRow.journalEntryId);
  assert.equal(expenseRow.status, 'Reversed');

  const auditCount = await prisma.exportAuditLog.count({ where: { companyId: COMPANY_ID } });
  assert.ok(auditCount > 0, 'audit trail empty');

  const orderRow = await prisma.exportSalesOrder.findUnique({ where: { id: orderId } });
  assert.equal(orderRow.status, 'Completed');
  assert.equal(num(orderRow.advanceReceivedBase), 300 * RATE);
  assert.equal(num(orderRow.advanceAppliedBase), 300 * RATE);
  assert.equal(num(orderRow.invoicedBase), 278500);
  assert.equal(num(orderRow.paidBase), 278500);

  const jeIds = [
    ...receipts.map((r) => r.journalEntryId),
    expenseRow.journalEntryId,
    reversalJe.id,
  ].filter(Boolean);
  const invoiceJe = await prisma.journalEntry.findFirst({
    where: { companyId: COMPANY_ID, reference: { contains: invoice.invoiceNumber } },
    include: { lines: true },
  });
  if (invoiceJe) jeIds.push(invoiceJe.id);
  for (const id of new Set(jeIds)) {
    const je = await prisma.journalEntry.findUnique({
      where: { id },
      include: { lines: true },
    });
    assert.ok(je, `journal entry ${id} missing`);
    const debit = je.lines.reduce((s, l) => s + Number(l.debit || 0), 0);
    const credit = je.lines.reduce((s, l) => s + Number(l.credit || 0), 0);
    assert.ok(
      Math.abs(debit - credit) < 0.01,
      `JE ${je.reference || je.id} unbalanced: ${debit} vs ${credit}`
    );
  }
  log('balanced journal entries verified:', new Set(jeIds).size);

  await expectFailure(
    'GET',
    '/export/orders',
    undefined,
    403,
    undefined,
    { companyId: OTHER_COMPANY_ID }
  );
  await expectFailure(
    'GET',
    `/export/orders/${orderId}`,
    undefined,
    403,
    undefined,
    { companyId: OTHER_COMPANY_ID }
  );
  const allCompanies = await api('GET', '/export/dashboard', undefined, { companyId: '__all__' });
  assert.equal(allCompanies.json.success, true);
  log('cross-company reads blocked; All Companies dashboard OK');

  const finalFull = await api('GET', `/export/orders/${orderId}/full`);
  console.log('\n=== EXPORT E2E RESULT ===');
  console.log(
    JSON.stringify(
      {
        companyId: COMPANY_ID,
        inquiry: inquiry.json.data.inquiryNumber,
        quotation: quote.json.data.quoteNumber,
        order: converted.json.data.orderNumber,
        proforma: proforma.json.data.piNumber,
        packing: packing.json.data.packingListNo,
        shippingBill: customs.json.data.shippingBillNo,
        shipment: shipment.json.data.shipmentNumber,
        dispatch: dispatch.json.data.dispatchNumber,
        invoices: finalFull.json.data.invoices.map((i) => ({
          number: i.invoiceNumber,
          grandTotal: i.grandTotal,
          paid: i.paidAmount,
          outstanding: i.outstanding,
          status: i.invoiceStatus,
        })),
        receipts: finalFull.json.data.receipts.map((r) => ({
          number: r.receiptNumber,
          type: r.receiptType,
          status: r.status,
        })),
        lc: lc.json.data.lcAdviceNumber,
        expense: expense.json.data.expenseNumber,
        orderStatus: finalFull.json.data.order.status,
        stockAfter: stockRow.currentStock,
      },
      null,
      2
    )
  );
  console.log('=== EXPORT E2E PASSED ===');
  await prisma.$disconnect();
})().catch(async (err) => {
  console.error('\n=== EXPORT E2E FAILED ===');
  console.error(err.stack || err.message);
  try {
    await prisma.$disconnect();
  } catch {
    /* ignore */
  }
  process.exit(1);
});
