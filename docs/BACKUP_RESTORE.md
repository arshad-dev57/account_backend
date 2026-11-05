# Backup & Restore System

## Overview

Two separate backup systems:

1. **Super Admin full database backup** — complete Neon/PostgreSQL dump (pg_dump custom format when available).
2. **Customer company-wise backup** — ZIP of selected companies’ ERP data (IDs preserved, passwords excluded).

Application backups **complement** Neon PITR/branching; they do not replace provider disaster recovery.

## Environment variables

See `.env.example` section **Backup & Restore**.

| Variable | Purpose |
|----------|---------|
| `BACKUP_STORAGE_PROVIDER` | `local` \| `r2` \| `s3` |
| `R2_*` / `S3_*` | Private object storage credentials (never expose to frontend) |
| `BACKUP_CRON_SECRET` | Header `X-Cron-Secret` for Railway Cron |
| `BACKUP_COMPANY_RETENTION_DAYS` | Default 90 |
| `BACKUP_FULL_RETENTION_DAYS` | Default 30 |
| `BACKUP_ALLOW_FULL_RESTORE` | Must be `1` to even attempt automated full restore (staging only) |
| `PLATFORM_OWNER_EMAILS` | Who can manage full DB backups |
| `PG_DUMP_PATH` | Optional path to `pg_dump` |
| `DIRECT_URL` | Preferred for `pg_dump` (non-pooler) |

## API endpoints

### Customer (`protect` + company admin/owner)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/backups/companies` | Companies the user may back up |
| POST | `/api/backups` | Queue company ZIP backup `{ companyIds, name? }` |
| GET | `/api/backups` | History + summary |
| GET | `/api/backups/:id` | Job detail |
| GET | `/api/backups/:id/download` | Stream ZIP (`Content-Disposition: attachment`) |
| POST | `/api/backups/:id/validate` | Checksum + format validation |
| POST | `/api/backups/:id/restore` | Restore (`confirm: true`); creates pre-restore snapshot first |
| DELETE | `/api/backups/:id` | Delete backup + storage object |

### Super Admin (`protectOnly` + platform owner)

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/admin/backups/full` | Queue full DB backup |
| GET | `/api/admin/backups` | List + dashboard summary |
| GET | `/api/admin/backups/:id` | Detail + audit |
| GET | `/api/admin/backups/:id/download` | Download archive |
| POST | `/api/admin/backups/:id/restore` | Gated full restore (defaults to instructions only) |
| DELETE | `/api/admin/backups/:id` | Delete |
| GET/PUT | `/api/admin/backups/schedule` | Daily/weekly schedule config |
| POST | `/api/admin/backups/run-scheduled` | Cron entry (`X-Cron-Secret` or platform owner) |

## Railway deployment

### API service (existing)

- `preDeployCommand`: `npx prisma migrate deploy` (already in `railway.toml`)
- Ensure migration `20261103120000_backup_restore_system` is deployed

### Backup worker (recommended second service)

- Start command: `npm run start:backup-worker`
- Same env as API (`DATABASE_URL`, `DIRECT_URL`, R2/S3 vars)
- Polls `backup_jobs` with status `QUEUED`

The API also kicks jobs via `setImmediate` so backups work without a worker; the worker improves reliability under load.

### Scheduled full backups (Railway Cron)

Create a Cron Job that runs daily/weekly:

```http
POST https://<your-api>.up.railway.app/api/admin/backups/run-scheduled
X-Cron-Secret: <BACKUP_CRON_SECRET>
```

Do **not** use an in-memory `setInterval` inside Express for schedules.

### pg_dump on Railway

Railpack images may not include `pg_dump`. Options:

1. Install PostgreSQL client tools in the image / use a Dockerfile with `postgresql-client`
2. Rely on the built-in **logical JSONL fallback** (slower, still produces a valid ZIP)

## Cloudflare R2 setup

1. Create a **private** bucket (e.g. `bisonstechs-backups`) — no public access
2. Create an R2 API token with Object Read/Write on that bucket only
3. Set:

```
BACKUP_STORAGE_PROVIDER=r2
R2_ACCOUNT_ID=...
R2_ACCESS_KEY_ID=...
R2_SECRET_ACCESS_KEY=...
R2_BACKUP_BUCKET=bisonstechs-backups
```

4. Keep ERP Cloudinary uploads separate from this bucket

## How to use

### Full database backup (Super Admin)

1. Open **bisonstechs-admin** → **Backups**
2. Click **Create Full Database Backup**
3. Wait for status **COMPLETED**
4. **Download** to local disk / external drive

### Company backup (customer ERP)

1. ERP → **Users** → **Backup & Restore**
2. Select companies (auto-selected if only one)
3. **Create Backup**
4. When **Completed**, click **Download** (browser save / File System Access API when available)

### Safe restore (customer)

1. Choose a completed backup → **Restore**
2. Confirm warning
3. System creates a **pre-restore snapshot**, then restores only authorized companies

### Full DB restore (Super Admin)

Automated `pg_restore` against production is **disabled by default**. Download the archive and restore on staging, or use **Neon PITR**. Set `BACKUP_ALLOW_FULL_RESTORE=1` only on isolated environments.

## Smoke test

```bash
BACKUP_STORAGE_PROVIDER=local npm run test:backup
```

## ZIP format (company)

```
manifest.json
backup-metadata.json
companies/<companyId>/company.json
database/<table>.jsonl
```

Format version: `1.0.0` (`bisonstechs-company-backup`).
