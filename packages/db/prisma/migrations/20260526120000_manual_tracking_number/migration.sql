-- AlterTable: carrier tracking number for manual orders, captured at
-- warehouse ship time. Nullable because orders sit in PENDING before ship.
ALTER TABLE "orders" ADD COLUMN "manualTrackingNumber" TEXT;
