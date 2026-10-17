-- Shipment cargo metrics: allow null instead of misleading zeros; add delivered_at

ALTER TABLE "import_shipments" ADD COLUMN IF NOT EXISTS "delivered_at" TIMESTAMP(3);

ALTER TABLE "import_shipments" ALTER COLUMN "package_count" DROP DEFAULT;
ALTER TABLE "import_shipments" ALTER COLUMN "net_weight_kg" DROP DEFAULT;
ALTER TABLE "import_shipments" ALTER COLUMN "gross_weight_kg" DROP DEFAULT;
ALTER TABLE "import_shipments" ALTER COLUMN "cbm" DROP DEFAULT;

ALTER TABLE "import_shipments" ALTER COLUMN "package_count" DROP NOT NULL;
ALTER TABLE "import_shipments" ALTER COLUMN "net_weight_kg" DROP NOT NULL;
ALTER TABLE "import_shipments" ALTER COLUMN "gross_weight_kg" DROP NOT NULL;
ALTER TABLE "import_shipments" ALTER COLUMN "cbm" DROP NOT NULL;

-- Cleanup: convert placeholder zeros to null
UPDATE "import_shipments" SET "package_count" = NULL WHERE "package_count" IS NOT NULL AND "package_count" = 0;
UPDATE "import_shipments" SET "net_weight_kg" = NULL WHERE "net_weight_kg" IS NOT NULL AND "net_weight_kg" = 0;
UPDATE "import_shipments" SET "gross_weight_kg" = NULL WHERE "gross_weight_kg" IS NOT NULL AND "gross_weight_kg" = 0;
UPDATE "import_shipments" SET "cbm" = NULL WHERE "cbm" IS NOT NULL AND "cbm" = 0;

-- Backfill port of loading from linked PO when empty
UPDATE "import_shipments" s
SET "origin_port" = po."port_of_loading"
FROM "import_purchase_orders" po
WHERE s."import_po_id" = po."id"
  AND (s."origin_port" IS NULL OR trim(s."origin_port") = '')
  AND po."port_of_loading" IS NOT NULL
  AND trim(po."port_of_loading") <> '';

-- Backfill PI link from same PO
UPDATE "import_shipments" s
SET
  "proforma_id" = pi."id",
  "pi_ref" = pi."pi_number"
FROM (
  SELECT DISTINCT ON ("import_po_id")
    "id", "import_po_id", "pi_number"
  FROM "import_proforma_invoices"
  WHERE "import_po_id" IS NOT NULL
    AND "status" NOT IN ('Cancelled', 'Rejected', 'Expired')
  ORDER BY "import_po_id", "created_at" DESC
) pi
WHERE s."import_po_id" = pi."import_po_id"
  AND s."proforma_id" IS NULL;

-- Backfill LC link from same PO
UPDATE "import_shipments" s
SET
  "finance_lc_id" = lc."id",
  "lc_ref" = lc."lc_number"
FROM (
  SELECT DISTINCT ON ("import_po_id")
    "id", "import_po_id", "lc_number"
  FROM "import_finance_lcs"
  WHERE "import_po_id" IS NOT NULL
    AND "status" NOT IN ('Cancelled', 'Expired')
  ORDER BY "import_po_id", "created_at" DESC
) lc
WHERE s."import_po_id" = lc."import_po_id"
  AND s."finance_lc_id" IS NULL;

-- Infer FCL when container type looks like a container but load_type is empty
UPDATE "import_shipments"
SET "load_type" = 'FCL'
WHERE ("load_type" IS NULL OR trim("load_type") = '')
  AND "container_type" IS NOT NULL
  AND (
    upper("container_type") LIKE '%20%'
    OR upper("container_type") LIKE '%40%'
    OR upper("container_type") LIKE '%GP%'
    OR upper("container_type") LIKE '%HC%'
    OR upper("container_type") LIKE '%FT%'
  );
