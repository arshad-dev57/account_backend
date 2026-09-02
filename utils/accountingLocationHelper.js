/**
 * Shared location filters for accounting dashboards & ledger-derived reports.
 * Admin omit / "all" = company-wide. Staff without a location = assigned locations only.
 */

const { constraintIds } = require('./locationAccessHelper');

function normalizeLocationId(locationId) {
  if (locationId == null) return null;
  const s = String(locationId).trim();
  if (!s || s === 'all' || s === '__all__') return null;
  return s;
}

function none() {
  return { id: { in: [] } };
}

function withLocation(locationId) {
  const ids = constraintIds(locationId);
  if (ids == null) return {};
  if (!ids.length) return { locationId: { in: [] } };
  if (ids.length === 1) return { locationId: ids[0] };
  return { locationId: { in: ids } };
}

function salesInvoiceLocationWhere(locationId) {
  const ids = constraintIds(locationId);
  if (ids == null) return {};
  if (!ids.length) return none();
  return {
    OR: [
      { locationId: { in: ids } },
      { locationId: null, order: { locationId: { in: ids } } },
    ],
  };
}

function warehouseInvoiceLocationWhere(locationId) {
  const ids = constraintIds(locationId);
  if (ids == null) return {};
  if (!ids.length) return none();
  return { order: { locationId: { in: ids } } };
}

function purchaseInvoiceLocationWhere(locationId) {
  const ids = constraintIds(locationId);
  if (ids == null) return {};
  if (!ids.length) return none();
  return {
    OR: [
      { locationId: { in: ids } },
      { locationId: null, purchaseOrder: { locationId: { in: ids } } },
      { locationId: null, goodsReceiving: { locationId: { in: ids } } },
    ],
  };
}

function posSaleLocationWhere(locationId) {
  const ids = constraintIds(locationId);
  if (ids == null) return {};
  if (!ids.length) return none();
  return { terminal: { locationId: { in: ids } } };
}

function creditNoteLocationWhere(locationId) {
  const ids = constraintIds(locationId);
  if (ids == null) return {};
  if (!ids.length) return none();
  return {
    OR: [
      { salesInvoice: { locationId: { in: ids } } },
      { salesInvoice: { locationId: null, order: { locationId: { in: ids } } } },
      { originalInvoice: { order: { locationId: { in: ids } } } },
    ],
  };
}

function journalEntryLocationWhere(locationId) {
  const ids = constraintIds(locationId);
  if (ids == null) return {};
  if (!ids.length) return none();

  return {
    OR: [
      { locationId: { in: ids } },
      {
        salesInvoice: {
          OR: [
            { locationId: { in: ids } },
            { locationId: null, order: { locationId: { in: ids } } },
          ],
        },
      },
      {
        PurchaseInvoice: {
          OR: [
            { locationId: { in: ids } },
            { locationId: null, purchaseOrder: { locationId: { in: ids } } },
            { locationId: null, goodsReceiving: { locationId: { in: ids } } },
          ],
        },
      },
      { posSale: { terminal: { locationId: { in: ids } } } },
      { posReturn: { originalSale: { terminal: { locationId: { in: ids } } } } },
      {
        salesPayment: {
          invoicePayments: {
            some: {
              invoice: {
                OR: [
                  { locationId: { in: ids } },
                  { locationId: null, order: { locationId: { in: ids } } },
                ],
              },
            },
          },
        },
      },
      {
        purchasePayment: {
          invoicePayments: {
            some: {
              invoice: {
                OR: [
                  { locationId: { in: ids } },
                  { locationId: null, purchaseOrder: { locationId: { in: ids } } },
                  { locationId: null, goodsReceiving: { locationId: { in: ids } } },
                ],
              },
            },
          },
        },
      },
      {
        purchaseReturn: {
          purchaseInvoice: {
            OR: [
              { locationId: { in: ids } },
              { locationId: null, purchaseOrder: { locationId: { in: ids } } },
              { locationId: null, goodsReceiving: { locationId: { in: ids } } },
            ],
          },
        },
      },
    ],
  };
}

module.exports = {
  normalizeLocationId,
  withLocation,
  salesInvoiceLocationWhere,
  warehouseInvoiceLocationWhere,
  purchaseInvoiceLocationWhere,
  posSaleLocationWhere,
  creditNoteLocationWhere,
  journalEntryLocationWhere,
};
