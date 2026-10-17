-- Add HS code to Import PO line items
ALTER TABLE "import_purchase_order_items"
  ADD COLUMN IF NOT EXISTS "hs_code" TEXT;
