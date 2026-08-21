/**
 * Shared location filters for accounting dashboards & ledger-derived reports.
 * Omit / "all" = company-wide. Specific id = warehouse/shop scoped.
 */

function normalizeLocationId(locationId) {
  if (locationId == null) return null;
  const s = String(locationId).trim();
  if (!s || s === 'all' || s === '__all__') return null;
  return s;
}

function withLocation(locationId) {
  const loc = normalizeLocationId(locationId);
  return loc ? { locationId: loc } : {};
}

/** Sales invoices: own locationId, or legacy rows via order.locationId */
function salesInvoiceLocationWhere(locationId) {
  const loc = normalizeLocationId(locationId);
  if (!loc) return {};
  return {
    OR: [
      { locationId: loc },
      { locationId: null, order: { locationId: loc } },
    ],
  };
}

/** Warehouse invoices have no locationId — filter via linked order */
function warehouseInvoiceLocationWhere(locationId) {
  const loc = normalizeLocationId(locationId);
  if (!loc) return {};
  return { order: { locationId: loc } };
}

/** Purchase invoices: own location, or via PO / GRN */
function purchaseInvoiceLocationWhere(locationId) {
  const loc = normalizeLocationId(locationId);
  if (!loc) return {};
  return {
    OR: [
      { locationId: loc },
      { locationId: null, purchaseOrder: { locationId: loc } },
      { locationId: null, goodsReceiving: { locationId: loc } },
    ],
  };
}

function posSaleLocationWhere(locationId) {
  const loc = normalizeLocationId(locationId);
  if (!loc) return {};
  return { terminal: { locationId: loc } };
}

function creditNoteLocationWhere(locationId) {
  const loc = normalizeLocationId(locationId);
  if (!loc) return {};
  return {
    OR: [
      { salesInvoice: { locationId: loc } },
      { salesInvoice: { locationId: null, order: { locationId: loc } } },
      { originalInvoice: { order: { locationId: loc } } },
    ],
  };
}

/**
 * Journal entries linked to location-tagged source documents.
 * Manual / unlinked JEs are excluded when a location is selected.
 */
function journalEntryLocationWhere(locationId) {
  const loc = normalizeLocationId(locationId);
  if (!loc) return {};
  return {
    OR: [
      {
        salesInvoice: {
          OR: [
            { locationId: loc },
            { locationId: null, order: { locationId: loc } },
          ],
        },
      },
      {
        PurchaseInvoice: {
          OR: [
            { locationId: loc },
            { locationId: null, purchaseOrder: { locationId: loc } },
            { locationId: null, goodsReceiving: { locationId: loc } },
          ],
        },
      },
      { posSale: { terminal: { locationId: loc } } },
      { posReturn: { originalSale: { terminal: { locationId: loc } } } },
      {
        salesPayment: {
          invoicePayments: {
            some: {
              invoice: {
                OR: [
                  { locationId: loc },
                  { locationId: null, order: { locationId: loc } },
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
                  { locationId: loc },
                  { locationId: null, purchaseOrder: { locationId: loc } },
                  { locationId: null, goodsReceiving: { locationId: loc } },
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
              { locationId: loc },
              { locationId: null, purchaseOrder: { locationId: loc } },
              { locationId: null, goodsReceiving: { locationId: loc } },
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
