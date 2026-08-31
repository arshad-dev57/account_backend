-- Assign a POS terminal to a user (cashier sees only this terminal on desktop)
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "assigned_terminal_id" TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'users_assigned_terminal_id_fkey'
  ) THEN
    ALTER TABLE "users"
      ADD CONSTRAINT "users_assigned_terminal_id_fkey"
      FOREIGN KEY ("assigned_terminal_id") REFERENCES "pos_terminals"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "users_assigned_terminal_id_idx" ON "users"("assigned_terminal_id");
