-- ============================================================================
-- Pre-deploy migration for the sub-account-system PR.
--
-- Background: the deploy flow runs `prisma db push --accept-data-loss`, which
-- cannot add a NOT NULL column without a default to a populated table, and
-- cannot safely change enum types. This script does those steps explicitly,
-- with backfills, BEFORE the PR is merged. After running, the schema matches
-- the new schema.prisma so `db push` becomes a no-op on deploy.
--
-- Run once against prod with the runner: pnpm --filter @ems/api migrate:sub-account
-- Each statement is auto-committed independently by the runner — required so
-- ALTER TABLE doesn't pile up locks against the live sync worker. Every
-- statement uses IF NOT EXISTS / EXCEPTION-handlers so partial completion
-- can be re-run safely.
--
-- Pre-flight assumptions (verified against prod 2026-05-10):
--   - 1 tenant, 1 user (role=ADMIN), 1 shop, 27 SKUs, 1466 orders, 0 returns
--   - No duplicates in after_sales_tickets per orderId
-- ============================================================================

-- ─── 1. New enums (additive) ────────────────────────────────────────────────

DO $$ BEGIN
  CREATE TYPE "Capability" AS ENUM (
    'ORDER_VIEW', 'ORDER_PROCESS', 'ORDER_CANCEL',
    'INVENTORY_VIEW', 'INVENTORY_ADJUST', 'PO_APPROVE', 'RETURN_INTAKE'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "MerchantConfirmStatus" AS ENUM (
    'PENDING_CONFIRM', 'CONFIRMED', 'AUTO_CONFIRMED', 'CANCELLED_BY_MERCHANT'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "ReturnCondition" AS ENUM (
    'PENDING_INSPECTION', 'SELLABLE', 'DAMAGED', 'DISPOSED'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "ReturnReviewStatus" AS ENUM (
    'PENDING_REVIEW', 'CONFIRMED', 'REJECTED'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ─── 2. UserRole enum: replace MANAGER/OPERATOR/VIEWER with WAREHOUSE_STAFF/MERCHANT
-- Postgres can't drop enum values in place; rename the type, create the new
-- one, ALTER COLUMN with a USING cast, then drop the old type.

DO $$
DECLARE
  needs_migration BOOLEAN;
BEGIN
  SELECT EXISTS(
    SELECT 1 FROM pg_enum
    WHERE enumtypid = 'public."UserRole"'::regtype
      AND enumlabel IN ('MANAGER', 'OPERATOR', 'VIEWER')
  ) INTO needs_migration;

  IF needs_migration THEN
    ALTER TYPE "UserRole" RENAME TO "UserRole_old";
    CREATE TYPE "UserRole" AS ENUM ('ADMIN', 'WAREHOUSE_STAFF', 'MERCHANT');

    ALTER TABLE users
      ALTER COLUMN role DROP DEFAULT,
      ALTER COLUMN role TYPE "UserRole" USING (
        CASE role::text
          WHEN 'ADMIN'    THEN 'ADMIN'::"UserRole"
          WHEN 'MANAGER'  THEN 'ADMIN'::"UserRole"
          WHEN 'OPERATOR' THEN 'WAREHOUSE_STAFF'::"UserRole"
          WHEN 'VIEWER'   THEN 'WAREHOUSE_STAFF'::"UserRole"
        END
      ),
      ALTER COLUMN role SET DEFAULT 'WAREHOUSE_STAFF'::"UserRole";

    DROP TYPE "UserRole_old";
  END IF;
END $$;

-- ─── 3. User: new columns (all have defaults — safe to add directly) ───────

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS "capabilities"    "Capability"[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS "warehouseScope"  TEXT[]         NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS "createdByUserId" TEXT,
  ADD COLUMN IF NOT EXISTS "settings"        JSONB          NOT NULL DEFAULT '{}';

DO $$ BEGIN
  ALTER TABLE users
    ADD CONSTRAINT users_createdByUserId_fkey
    FOREIGN KEY ("createdByUserId") REFERENCES users(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ─── 4. Owner backfill strategy ─────────────────────────────────────────────
-- The first ADMIN user per tenant is reused as the placeholder owner so
-- existing rows have a valid ownerUserId. The backfill is inlined as a
-- correlated subquery in each UPDATE — no temp table, so each step can run
-- in its own auto-commit transaction (avoiding deadlocks vs. live writers).
-- Pre-flight runner check confirms every tenant with data has an ADMIN.

-- ─── 5. Shop.ownerUserId ────────────────────────────────────────────────────

ALTER TABLE shops ADD COLUMN IF NOT EXISTS "ownerUserId" TEXT;

UPDATE shops s SET "ownerUserId" = (
  SELECT u.id FROM users u
  WHERE u."tenantId" = s."tenantId" AND u.role = 'ADMIN'
  ORDER BY u."createdAt" LIMIT 1
)
WHERE s."ownerUserId" IS NULL;

ALTER TABLE shops ALTER COLUMN "ownerUserId" SET NOT NULL;

DO $$ BEGIN
  ALTER TABLE shops
    ADD CONSTRAINT shops_ownerUserId_fkey
    FOREIGN KEY ("ownerUserId") REFERENCES users(id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS shops_ownerUserId_idx ON shops("ownerUserId");

-- ─── 6. SystemProduct.ownerUserId + unique-key swap ────────────────────────

ALTER TABLE system_products ADD COLUMN IF NOT EXISTS "ownerUserId" TEXT;

UPDATE system_products sp SET "ownerUserId" = (
  SELECT u.id FROM users u
  WHERE u."tenantId" = sp."tenantId" AND u.role = 'ADMIN'
  ORDER BY u."createdAt" LIMIT 1
)
WHERE sp."ownerUserId" IS NULL;

ALTER TABLE system_products ALTER COLUMN "ownerUserId" SET NOT NULL;

DO $$ BEGIN
  ALTER TABLE system_products
    ADD CONSTRAINT system_products_ownerUserId_fkey
    FOREIGN KEY ("ownerUserId") REFERENCES users(id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE system_products DROP CONSTRAINT IF EXISTS "system_products_tenantId_spuCode_key";
DO $$ BEGIN
  ALTER TABLE system_products
    ADD CONSTRAINT "system_products_ownerUserId_spuCode_key"
    UNIQUE ("ownerUserId", "spuCode");
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS system_products_tenantId_idx ON system_products("tenantId");

-- ─── 7. SystemSku unique-key swap ──────────────────────────────────────────

ALTER TABLE system_skus DROP CONSTRAINT IF EXISTS "system_skus_skuCode_key";
DO $$ BEGIN
  ALTER TABLE system_skus
    ADD CONSTRAINT "system_skus_systemProductId_skuCode_key"
    UNIQUE ("systemProductId", "skuCode");
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ─── 8. WarehouseSku: ownerUserId + new quantity columns ───────────────────

ALTER TABLE warehouse_skus
  ADD COLUMN IF NOT EXISTS "ownerUserId"      TEXT,
  ADD COLUMN IF NOT EXISTS "quantityOnHand"   INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "quantityReserved" INT NOT NULL DEFAULT 0;

UPDATE warehouse_skus ws SET "ownerUserId" = (
  SELECT u.id FROM users u
  JOIN warehouses w ON w."tenantId" = u."tenantId"
  WHERE w.id = ws."warehouseId" AND u.role = 'ADMIN'
  ORDER BY u."createdAt" LIMIT 1
)
WHERE ws."ownerUserId" IS NULL;

ALTER TABLE warehouse_skus ALTER COLUMN "ownerUserId" SET NOT NULL;

DO $$ BEGIN
  ALTER TABLE warehouse_skus
    ADD CONSTRAINT warehouse_skus_ownerUserId_fkey
    FOREIGN KEY ("ownerUserId") REFERENCES users(id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS warehouse_skus_ownerUserId_warehouseId_idx
  ON warehouse_skus("ownerUserId", "warehouseId");

-- ─── 9. Order: merchant-confirm gate ──────────────────────────────────────
-- Existing orders shouldn't be hidden from warehouse, so backfill them as
-- AUTO_CONFIRMED. New orders will land as PENDING_CONFIRM (schema default).

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS "merchantConfirmStatus"
    "MerchantConfirmStatus" NOT NULL DEFAULT 'PENDING_CONFIRM',
  ADD COLUMN IF NOT EXISTS "merchantConfirmedAt"      TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "merchantConfirmExpiresAt" TIMESTAMP(3);

UPDATE orders
   SET "merchantConfirmStatus" = 'AUTO_CONFIRMED',
       "merchantConfirmedAt" = COALESCE("merchantConfirmedAt", "createdAt")
 WHERE "merchantConfirmStatus" = 'PENDING_CONFIRM';

CREATE INDEX IF NOT EXISTS orders_merchantConfirmStatus_merchantConfirmExpiresAt_idx
  ON orders("merchantConfirmStatus", "merchantConfirmExpiresAt");

-- ─── 10. AfterSalesTicket new columns + unique ─────────────────────────────

ALTER TABLE after_sales_tickets
  ADD COLUMN IF NOT EXISTS "reviewStatus"      "ReturnReviewStatus" NOT NULL DEFAULT 'PENDING_REVIEW',
  ADD COLUMN IF NOT EXISTS "reviewedAt"        TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "reviewedByUserId"  TEXT,
  ADD COLUMN IF NOT EXISTS "rejectReason"      TEXT,
  ADD COLUMN IF NOT EXISTS "expectedQty"       INT,
  ADD COLUMN IF NOT EXISTS "returnedQty"       INT,
  ADD COLUMN IF NOT EXISTS "condition"         "ReturnCondition" NOT NULL DEFAULT 'PENDING_INSPECTION',
  ADD COLUMN IF NOT EXISTS "arrivedAt"         TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "inspectedAt"       TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "inspectedByUserId" TEXT;

DO $$ BEGIN
  ALTER TABLE after_sales_tickets
    ADD CONSTRAINT "after_sales_tickets_orderId_key" UNIQUE ("orderId");
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS after_sales_tickets_reviewStatus_idx
  ON after_sales_tickets("reviewStatus");

-- ─── 11. audit_logs ─────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS audit_logs (
  id            TEXT PRIMARY KEY,
  "tenantId"    TEXT NOT NULL,
  "actorUserId" TEXT,
  action        TEXT NOT NULL,
  "targetType"  TEXT,
  "targetId"    TEXT,
  payload       JSONB NOT NULL DEFAULT '{}',
  ip            TEXT,
  "userAgent"   TEXT,
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT audit_logs_tenantId_fkey FOREIGN KEY ("tenantId") REFERENCES tenants(id),
  CONSTRAINT audit_logs_actorUserId_fkey FOREIGN KEY ("actorUserId") REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS audit_logs_tenantId_createdAt_idx ON audit_logs("tenantId", "createdAt");
CREATE INDEX IF NOT EXISTS audit_logs_targetType_targetId_idx ON audit_logs("targetType", "targetId");
CREATE INDEX IF NOT EXISTS audit_logs_actorUserId_createdAt_idx ON audit_logs("actorUserId", "createdAt");

-- ─── Final sanity checks ───────────────────────────────────────────────────

DO $$
DECLARE
  null_owners INT;
  pending_orders INT;
BEGIN
  SELECT
    (SELECT COUNT(*) FROM shops WHERE "ownerUserId" IS NULL) +
    (SELECT COUNT(*) FROM system_products WHERE "ownerUserId" IS NULL) +
    (SELECT COUNT(*) FROM warehouse_skus WHERE "ownerUserId" IS NULL)
  INTO null_owners;

  SELECT COUNT(*) INTO pending_orders FROM orders WHERE "merchantConfirmStatus" = 'PENDING_CONFIRM';

  RAISE NOTICE 'sanity: null_owners=%, orders_still_pending_confirm=%', null_owners, pending_orders;

  IF null_owners > 0 THEN
    RAISE EXCEPTION 'backfill incomplete — % rows still have NULL ownerUserId', null_owners;
  END IF;
END $$;
