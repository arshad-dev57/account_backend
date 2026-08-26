# POS master-data sync

Dedicated module for Electron POS catalog replication.

## Endpoint

```
GET /api/pos/sync/master-data?cursor=&limit=200
GET /api/sync/master-data?cursor=&limit=200
```

Auth: Bearer JWT (`protect`).

`limit` default 200, max 500.

## Modes

1. **Initial snapshot** — omit `cursor`. Server freezes `boundAt` + changelog head, then pages:
   categories (parentId null) → subcategories → products.
2. **Incremental** — send `nextCursor` from the last **successfully committed** page.

Save `nextCursor` locally only after the SQLite transaction commits.

## Errors

| code | HTTP | Client action |
|---|---|---|
| `VALIDATION` | 400 | Fix request |
| `CURSOR_INVALID` | 409 | Reset cursor and run a full snapshot |
| `401` | 401 | Re-login |
| `500` | 500 | Retry |

## Apply order (client)

1. Upsert categories
2. Upsert subcategories
3. Upsert products
4. Persist cursor

Never hard-delete a category that still has children; use `isDeleted`.
