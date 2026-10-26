'use strict';

/** Resume the completed-but-unclosed E2E run after a test assertion bug. */

const assert = require('node:assert/strict');
require('dotenv').config({ quiet: true });
const prisma = require('../prisma/client');

const BASE = 'http://localhost:5000/api';
const COMPANY_ID = 'b276083a-ee59-4fca-b9bb-4ac7c720576d';
const OTHER_COMPANY_ID = '73bf6455-9670-48e3-b1d6-2c05f0a5d9e4';
const log = (...a) => console.log('[E2E-RESUME]', ...a);
const num = (v) => (v && typeof v.toString === 'function' && typeof v !== 'number' ? Number(v.toString()) : Number(v));

let token = '';
async function api(method, route, body, opts = {}) {
  const headers = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`,
    'X-Company-Id': opts.companyId === null ? undefined : opts.companyId || COMPANY_ID,
  };
  Object.keys(headers).forEach((k) => headers[k] === undefined && delete headers[k]);
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
  if (!opts.allowFail && (!res.ok || json?.success === false)) {
    throw new Error(`${method} ${route} ${res.status}: ${json?.message || JSON.stringify(json)}`);
  }
  return { status: res.status, json };
}

(async () => {
  const login = await api(
    'POST',
    '/users/verify-login-otp',
    { email: 'demo@bisonstechs.com', otp: '123456' },
    { companyId: null }
  );
  token = login.json.token;
  const userRows = await prisma.exportSalesOrder.findMany({
    where: { companyId: COMPANY_ID, customerName: { startsWith: 'E2E Export Buyer' } },
    orderBy: { createdAt: 'desc' },
    include: { items: true },
  });
  const order = userRows[0];
  assert.ok(order, 'no E2E order found');
  const orderId = order.id;
  log('resuming order', order.orderNumber, 'status', order.status);

  const shipments = await prisma.exportShipment.findMany({ where: { companyId: COMPANY_ID, orderId } });
  const customs = await prisma.exportCustomsDeclaration.findMany({ where: { companyId: COMPANY_ID, orderId } });
  assert.equal(shipments.length, 1);
  assert.equal(customs.length, 1);
  const shipmentId = shipments[0].id;
  const customsId = customs[0].id;

  if (shipments[0].shipmentStatus !== 'Customs Cleared Buyer') {
    for (const status of [
      'Container Gate-In',
      'Loaded on Vessel',
      'In Transit',
      'Arrived at Destination',
      'Customs Cleared Buyer',
    ]) {
      const current = (await api('GET', `/export/shipments/${shipmentId}`)).json.data.shipmentStatus;
      if (current === 'Customs Cleared Buyer') break;
      await api('PATCH', `/export/shipments/${shipmentId}/status`, { status });
      log('shipment →', status);
    }
  }
  if (!['Sailed & Completed'].includes(customs[0].status)) {
    await api('PATCH', `/export/customs/${customsId}/status`, { status: 'Sailed & Completed' });
    log('customs → Sailed & Completed');
  }

  if (order.status !== 'Completed') {
    const delivered = await api('GET', `/export/orders/${orderId}`);
    assert.equal(delivered.json.data.status, 'Delivered');
    const completed = await api('PATCH', `/export/orders/${orderId}/status`, { status: 'Completed' });
    assert.equal(completed.json.data.status, 'Completed');
    log('order completed');
  } else {
    log('order already completed');
  }

  const terminal = await api(
    'PATCH',
    `/export/orders/${orderId}/status`,
    { status: 'Dispatched' },
    { allowFail: true }
  );
  assert.equal(terminal.status, 409);
  assert.equal(terminal.json.code, 'INVALID_TRANSITION');
  log('terminal transition blocked');

  const full = await api('GET', `/export/orders/${orderId}/full`);
  const invoice = full.json.data.invoices[0];
  assert.ok(invoice);
  const invoices = await prisma.salesInvoice.findMany({ where: { companyId: COMPANY_ID, id: invoice.id } });
  const ar = await prisma.accountsReceivable.findFirst({ where: { invoiceId: invoice.id } });
  assert.equal(num(invoices[0].grandTotal), 278500);
  assert.equal(num(invoices[0].paidAmount), 278500);
  assert.equal(num(invoices[0].outstanding), 0);
  assert.equal(invoices[0].paymentStatus, 'Paid');
  assert.equal(num(ar.outstanding), 0);

  const stock = await prisma.productStock.findFirst({
    where: {
      companyId: COMPANY_ID,
      product: { sku: { startsWith: 'E2E-SKU-' } },
    },
  });
  assert.equal(stock.currentStock, 90);

  const receipts = await prisma.exportReceipt.findMany({ where: { companyId: COMPANY_ID, orderId } });
  assert.equal(receipts.length, 2);
  assert.ok(receipts.every((r) => r.journalEntryId));

  const expenses = await prisma.exportExpense.findMany({ where: { companyId: COMPANY_ID, orderId } });
  assert.equal(expenses.length, 1);
  assert.equal(expenses[0].status, 'Reversed');

  const reversal = await prisma.journalEntry.findFirst({
    where: { companyId: COMPANY_ID, reference: `${expenses[0].expenseNumber}-REV` },
    include: { lines: true },
  });
  assert.ok(reversal, 'reversal JE missing');

  const lc = await prisma.exportFinanceLc.findFirst({ where: { companyId: COMPANY_ID, orderId } });
  assert.equal(lc.status, 'Settlement Received');

  const jeIds = new Set(
    [
      ...receipts.map((r) => r.journalEntryId),
      expenses[0].journalEntryId,
      reversal.id,
      lc.journalEntryId,
    ].filter(Boolean)
  );
  for (const id of jeIds) {
    const je = await prisma.journalEntry.findUnique({ where: { id }, include: { lines: true } });
    assert.ok(je, `JE ${id} missing`);
    const debit = je.lines.reduce((s, l) => s + Number(l.debit || 0), 0);
    const credit = je.lines.reduce((s, l) => s + Number(l.credit || 0), 0);
    assert.ok(Math.abs(debit - credit) < 0.01, `JE ${je.reference} unbalanced`);
  }

  const orderRow = await prisma.exportSalesOrder.findUnique({ where: { id: orderId } });
  assert.equal(orderRow.status, 'Completed');
  assert.equal(num(orderRow.advanceReceivedBase), 300 * 278.5);
  assert.equal(num(orderRow.advanceAppliedBase), 300 * 278.5);
  assert.equal(num(orderRow.invoicedBase), 278500);
  assert.equal(num(orderRow.paidBase), 278500);
  assert.equal(num(orderRow.outstandingBase), 0);

  const otherRead = await api('GET', '/export/orders', undefined, {
    companyId: OTHER_COMPANY_ID,
    allowFail: true,
  });
  assert.equal(otherRead.status, 403);
  const crossRecord = await api('GET', `/export/orders/${orderId}`, undefined, {
    companyId: OTHER_COMPANY_ID,
    allowFail: true,
  });
  assert.equal(crossRecord.status, 403);
  const allCompanies = await api('GET', '/export/dashboard', undefined, { companyId: '__all__' });
  assert.equal(allCompanies.json.success, true);
  log('cross-company access blocked; All Companies aggregation works');

  console.log('\n=== EXPORT E2E RESULT ===');
  console.log(
    JSON.stringify(
      {
        order: orderRow.orderNumber,
        status: orderRow.status,
        invoice: {
          number: invoices[0].invoiceNumber,
          grandTotal: num(invoices[0].grandTotal),
          paid: num(invoices[0].paidAmount),
          outstanding: num(invoices[0].outstanding),
          status: invoices[0].invoiceStatus,
        },
        arOutstanding: num(ar.outstanding),
        stockAfter: stock.currentStock,
        receipts: receipts.map((r) => `${r.receiptNumber}:${r.receiptType}:${r.status}`),
        lc: `${lc.lcAdviceNumber}:${lc.status}`,
        expense: `${expenses[0].expenseNumber}:${expenses[0].status}`,
        balancedJournalEntries: jeIds.size,
        orderBalances: {
          invoicedBase: num(orderRow.invoicedBase),
          paidBase: num(orderRow.paidBase),
          advanceReceivedBase: num(orderRow.advanceReceivedBase),
          advanceAppliedBase: num(orderRow.advanceAppliedBase),
          outstandingBase: num(orderRow.outstandingBase),
        },
      },
      null,
      2
    )
  );
  console.log('=== EXPORT E2E PASSED ===');
  await prisma.$disconnect();
})().catch(async (e) => {
  console.error('=== EXPORT E2E RESUME FAILED ===');
  console.error(e.stack || e.message);
  await prisma.$disconnect();
  process.exit(1);
});
