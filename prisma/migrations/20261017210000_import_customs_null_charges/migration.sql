-- Optional customs charge lines: empty = NULL (display "—"), explicit 0 stored as 0.
ALTER TABLE "import_customs_clearances"
  ALTER COLUMN "port_handling_charges_usd" DROP DEFAULT,
  ALTER COLUMN "port_handling_charges_usd" DROP NOT NULL;

-- Treat historical zero-default optional charges as empty (not entered).
UPDATE "import_customs_clearances"
SET "port_handling_charges_usd" = NULL
WHERE "port_handling_charges_usd" = 0;

UPDATE "import_customs_clearances"
SET "additional_duty_usd" = NULL
WHERE "additional_duty_usd" = 0
  AND ("additional_duty_rate_pct" IS NULL OR "additional_duty_rate_pct" = 0);

UPDATE "import_customs_clearances"
SET "regulatory_duty_usd" = NULL
WHERE "regulatory_duty_usd" = 0
  AND ("regulatory_duty_rate_pct" IS NULL OR "regulatory_duty_rate_pct" = 0);

UPDATE "import_customs_clearances"
SET "advance_income_tax_usd" = NULL
WHERE "advance_income_tax_usd" = 0
  AND ("advance_income_tax_rate_pct" IS NULL OR "advance_income_tax_rate_pct" = 0);

UPDATE "import_customs_clearances"
SET "clearing_broker_fee_usd" = NULL
WHERE "clearing_broker_fee_usd" = 0;

UPDATE "import_customs_clearances"
SET "demurrage_charges_usd" = NULL
WHERE "demurrage_charges_usd" = 0;
