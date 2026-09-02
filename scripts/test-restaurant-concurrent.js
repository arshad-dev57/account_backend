/**
 * Concurrent restaurant order smoke test.
 *
 * Usage:
 *   TOKEN=<jwt> API_URL=http://localhost:5000 node scripts/test-restaurant-concurrent.js
 *
 * Requires a company with posMode=restaurant and at least one product in catalog.
 */
const API = process.env.API_URL || 'http://localhost:5000';
const TOKEN = process.env.TOKEN;

if (!TOKEN) {
  console.error('Set TOKEN env var to a restaurant-mode user JWT.');
  process.exit(1);
}

async function api(method, path, body) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, ...data };
}

async function createOrder(i) {
  const clientRequestId = `test-${Date.now()}-${i}`;
  return api('POST', '/api/pos/restaurant/orders', {
    tableLabel: String(4 + (i % 8)),
    orderType: i % 3 === 0 ? 'takeaway' : 'dine_in',
    clientRequestId,
    lines: [
      {
        productName: `Test item ${i}`,
        sku: `T-${i}`,
        quantity: 1,
        unitPrice: 10 + i,
      },
    ],
  });
}

async function main() {
  console.log('Creating 5 orders concurrently…');
  const creates = await Promise.all([0, 1, 2, 3, 4].map(createOrder));
  const ok = creates.filter((r) => r.success);
  const tickets = ok.map((r) => r.data?.ticketNumber).filter(Boolean);
  const uniqueTickets = new Set(tickets);
  console.log(`Created ${ok.length}/5 orders, ticket numbers:`, tickets.join(', '));
  if (uniqueTickets.size !== tickets.length) {
    throw new Error('Duplicate ticket numbers detected');
  }

  const dupKey = creates[0]?.data?.clientRequestId || `test-dup-${Date.now()}`;
  const first = await api('POST', '/api/pos/restaurant/orders', {
    tableLabel: '99',
    clientRequestId: dupKey,
    lines: [{ productName: 'Dup test', quantity: 1, unitPrice: 5 }],
  });
  const second = await api('POST', '/api/pos/restaurant/orders', {
    tableLabel: '99',
    clientRequestId: dupKey,
    lines: [{ productName: 'Dup test', quantity: 1, unitPrice: 5 }],
  });
  if (!second.idempotent || second.data?.id !== first.data?.id) {
    throw new Error('Idempotent create failed');
  }
  console.log('Idempotent create OK — same order returned on retry');

  const queue = await api('GET', '/api/pos/restaurant/orders/kitchen');
  if (!queue.success) throw new Error(queue.message || 'Kitchen queue failed');
  const grouped = queue.data;
  const total =
    (grouped?.newOrders?.length || 0) +
    (grouped?.preparing?.length || 0) +
    (grouped?.ready?.length || 0);
  console.log(
    `Kitchen queue: ${grouped?.newOrders?.length || 0} new, ${grouped?.preparing?.length || 0} preparing, ${grouped?.ready?.length || 0} ready (${total} total)`
  );

  console.log('All concurrent smoke checks passed.');
}

main().catch((err) => {
  console.error('FAILED:', err.message);
  process.exit(1);
});
