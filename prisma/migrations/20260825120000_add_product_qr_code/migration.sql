ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "qr_code" TEXT;
CREATE INDEX IF NOT EXISTS "products_qr_code_idx" ON "products"("qr_code");
