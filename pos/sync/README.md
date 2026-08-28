# POS master-data sync

Dedicated module for Electron POS catalog replication with **bidirectional**
synchronization (Local ⇄ Cloud) for Categories, Subcategories and Products.

- **Cloud → Local (pull):** the server serves the cloud catalog.
- **Local → Cloud (push):** offline-created records are upserted into the cloud,
  keyed by a stable `syncId`, so no duplicates are created even though local and
  cloud primary keys differ.

## Endpoints

Auth: Bearer JWT (`protect`). `limit` default 200, max 500.

### 1. Pull (Cloud → Local) — unchanged

```
GET /api/pos/sync/master-data?cursor=&limit=200
GET /api/sync/master-data?cursor=&limit=200
```

Snapshot cursor / changelog cursor. Save `nextCursor` locally only after the
SQLite transaction commits.

### 2. Push (Local → Cloud)

```
POST /api/pos/sync/master-data/push
POST /api/sync/master-data/push
```

Body — the client sends its **pending** local records (created while offline).
Every record **must** carry a stable `syncId` (client-generated UUID). Category
hierarchy is expressed through `parentSyncId`; products use `categorySyncId`
and optional `subcategorySyncId`.

```json
{
  "records": {
    "categories": [{ "syncId": "uuid", "name": "Drinks", "description": "" }],
    "subcategories": [{ "syncId": "uuid", "name": "Soft", "parentSyncId": "<drinks-uuid>" }],
    "products": [{
      "syncId": "uuid",
      "name": "Cola",
      "sku": "COLA-1",
      "sellingPrice": 100,
      "costPrice": 70,
      "categorySyncId": "<drinks-uuid>",
      "subcategorySyncId": "<soft-uuid>"
    }]
  }
}
```

- Processed in dependency order: **categories → subcategories → products**.
- If a `syncId` already exists in the cloud it is **updated/merged**, not
  duplicated. If a product references a category/subcategory not yet available,
  it is left in a retryable `failed` state (returned in `pushed.failed`).
- Response returns a `mapping` (`syncId -> cloudId`) and per-record
  `pushed`/`failed` outcomes so the client can mark records as `SYNCED` and
  update `lastSyncedAt`. Unsuccessful records remain `PENDING`/`FAILED` for the
  next sync.

### 3. Combined bidirectional sync (Sync button)

```
POST /api/pos/sync/master-data/sync
POST /api/sync/master-data/sync
```

Body is the same as `/push` (`records`). This performs the full flow in one call:

1. **Local → Cloud:** pushes the supplied pending records (upsert by `syncId`).
2. **Cloud → Local:** returns the full latest merged cloud catalog
   (`categories`, `subcategories`, `products`) plus the push `mapping` and
   `summary`, so the client can merge everything locally after committing.

## Offline / connectivity

The client should check connectivity before starting sync (show an offline
message when no connection). The server also verifies the cloud database is
reachable and returns `503 / OFFLINE` if it is not, aborting the sync.

## Sync metadata

`Category` and `Product` now carry:

```
syncId        String?  @unique      // stable client-generated UUID
syncStatus    String   ("PENDING" | "SYNCED" | "FAILED")
lastSyncedAt  DateTime?
```

## Apply order (client)

1. Upsert categories
2. Upsert subcategories
3. Upsert products
4. Persist cursor / mapping

Never hard-delete a category that still has children; use `isDeleted`.

## Errors

| code | HTTP | Client action |
|---|---|---|
| `VALIDATION` | 400 | Fix request |
| `CURSOR_INVALID` | 409 | Reset cursor and run a full snapshot |
| `OFFLINE` | 503 | Show offline message, retry when online |
| `401` | 401 | Re-login |
| `500` | 500 | Retry |

Every `failed` item is retryable — the next sync attempt will re-attempt it.
