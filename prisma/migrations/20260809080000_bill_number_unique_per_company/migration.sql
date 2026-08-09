-- Bill numbers are unique per company, not globally across tenants.
-- The composite unique (bill_number, company_id) already exists.

DROP INDEX IF EXISTS "bills_bill_number_key";
