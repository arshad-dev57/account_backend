-- Track whether admin chose POS type from the POS hub (not at registration)
ALTER TABLE "companies" ADD COLUMN IF NOT EXISTS "pos_mode_configured" BOOLEAN NOT NULL DEFAULT false;

-- Existing companies already using POS keep their current mode without re-setup
UPDATE "companies" SET "pos_mode_configured" = true WHERE "pos_mode_configured" = false;
