/**
 * In-memory SSE hub — pushes live notifications to connected app clients.
 * No third-party push service required.
 */

/** @type {Map<string, Set<import('http').ServerResponse>>} */
const clientsByUser = new Map();

function subscribe(userId, res) {
  const key = String(userId || '').trim();
  if (!key) return;
  if (!clientsByUser.has(key)) clientsByUser.set(key, new Set());
  clientsByUser.get(key).add(res);
}

function unsubscribe(userId, res) {
  const key = String(userId || '').trim();
  const set = clientsByUser.get(key);
  if (!set) return;
  set.delete(res);
  if (set.size === 0) clientsByUser.delete(key);
}

function publish(userId, payload) {
  const key = String(userId || '').trim();
  const set = clientsByUser.get(key);
  if (!set || set.size === 0) return 0;

  const data = `data: ${JSON.stringify(payload)}\n\n`;
  let delivered = 0;

  for (const res of set) {
    try {
      res.write(data);
      delivered += 1;
    } catch {
      set.delete(res);
    }
  }

  if (set.size === 0) clientsByUser.delete(key);
  return delivered;
}

function connectedCount(userId) {
  const set = clientsByUser.get(String(userId || '').trim());
  return set ? set.size : 0;
}

module.exports = {
  subscribe,
  unsubscribe,
  publish,
  connectedCount,
};
