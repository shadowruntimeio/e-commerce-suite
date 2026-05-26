-- Sync-orders worker had a SELECT-then-INSERT idempotency check that lost
-- the race when the same shop's sync fired concurrently (BullMQ retry,
-- manual Sync Now, webhook-triggered re-sync). Result: 145 (warehouseSku,
-- order) pairs had duplicate OUTBOUND rows.
--
-- This migration removes the existing duplicates (keeping the earliest row
-- per pair) and installs a partial unique index so future concurrent
-- inserts fast-fail with P2002 instead of silently double-deducting.

-- 1. Delete duplicate OUTBOUND rows.
WITH dups AS (
  SELECT id FROM (
    SELECT id, ROW_NUMBER() OVER (
      PARTITION BY "warehouseSkuId", "referenceId"
      ORDER BY "createdAt"
    ) AS rn
    FROM inventory_events
    WHERE "eventType" = 'OUTBOUND' AND "referenceType" = 'order'
  ) sub
  WHERE rn > 1
)
DELETE FROM inventory_events WHERE id IN (SELECT id FROM dups);

-- 2. Partial unique index — only enforces uniqueness on the OUTBOUND/order
-- combo. RESERVED, UNRESERVED, ADJUSTMENT, INBOUND etc. can still legitimately
-- repeat for the same referenceId (e.g. partial cancel → re-reserve cycles).
CREATE UNIQUE INDEX "inventory_events_outbound_order_dedupe"
  ON inventory_events ("warehouseSkuId", "referenceId")
  WHERE "eventType" = 'OUTBOUND' AND "referenceType" = 'order';
