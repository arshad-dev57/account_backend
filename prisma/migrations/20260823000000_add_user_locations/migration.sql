-- CreateTable
CREATE TABLE "user_locations" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "location_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_locations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "user_locations_user_id_location_id_key" ON "user_locations"("user_id", "location_id");

-- CreateIndex
CREATE INDEX "user_locations_user_id_idx" ON "user_locations"("user_id");

-- CreateIndex
CREATE INDEX "user_locations_location_id_idx" ON "user_locations"("location_id");

-- AddForeignKey
ALTER TABLE "user_locations" ADD CONSTRAINT "user_locations_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_locations" ADD CONSTRAINT "user_locations_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "locations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Existing users keep access to every location in their company
INSERT INTO "user_locations" ("id", "user_id", "location_id", "created_at")
SELECT ('ul_' || u.id || '_' || l.id), u.id, l.id, CURRENT_TIMESTAMP
FROM "users" u
INNER JOIN "locations" l ON l.company_id = u.company_id AND l.is_deleted = false
WHERE u.company_id IS NOT NULL
ON CONFLICT ("user_id", "location_id") DO NOTHING;
