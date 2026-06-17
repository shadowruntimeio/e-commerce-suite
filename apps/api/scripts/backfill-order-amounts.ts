/**
 * One-time backfill: recompute order financial fields from the raw TikTok
 * payload already stored on each order (`platformMetadata.payment`).
 *
 * Why: historical orders were synced while mapOrder read the wrong key
 * (`payment_info` instead of `payment`) and divided amounts by 100, so their
 * subtotal/totalRevenue/discounts are 0. The raw payload is intact, so we fix
 * existing rows WITHOUT calling the TikTok API.
 *
 * Implemented as a single server-side SQL UPDATE (no per-row round-trips), so
 * it runs in milliseconds even against a remote/prod database. Amounts are
 * decimal currency strings — read straight from JSONB, no /100. Idempotent and
 * safe on production (only rewrites amount columns; never touches COGS/settlement).
 *
 *   pnpm --filter @ems/api exec tsx scripts/backfill-order-amounts.ts
 *   # prod (via public proxy):  DATABASE_URL="<DATABASE_PUBLIC_URL>" npx tsx apps/api/scripts/backfill-order-amounts.ts
 */
import { prisma } from '@ems/db'

// COALESCE across `payment` (V202309) then legacy `payment_info`; NULLIF guards
// empty strings so they don't fail the ::numeric cast.
function pick(field: string): string {
  return `COALESCE(
    NULLIF("platformMetadata"->'payment'->>'${field}','')::numeric,
    NULLIF("platformMetadata"->'payment_info'->>'${field}','')::numeric,
    0)`
}

async function main() {
  const sql = `
    UPDATE "orders" SET
      "subtotal"          = ${pick('sub_total')},
      "totalRevenue"      = ${pick('total_amount')},
      "platformDiscount"  = ${pick('platform_discount')},
      "sellerDiscount"    = ${pick('seller_discount')},
      "shippingFeeBuyer"  = ${pick('shipping_fee')}
    WHERE "isManual" = false
      AND ("platformMetadata" ? 'payment' OR "platformMetadata" ? 'payment_info')
  `
  const updated = await prisma.$executeRawUnsafe(sql)
  console.log(`[backfill] order amounts updated: ${updated} rows`)
  await prisma.$disconnect()
}

main().catch((e) => { console.error(e); process.exit(1) })
