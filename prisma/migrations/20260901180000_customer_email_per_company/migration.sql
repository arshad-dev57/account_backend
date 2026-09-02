-- Customer email should be unique per company (like suppliers), not globally.

DROP INDEX IF EXISTS "customers_email_key";

CREATE UNIQUE INDEX "customers_email_company_id_key" ON "customers"("email", "company_id");
