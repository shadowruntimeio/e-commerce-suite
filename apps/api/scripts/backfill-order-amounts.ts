/**
 * One-time backfill: recompute order financial fields from the raw TikTok
 * payload already stored on each order (`platformMetadata.payment`).
 *
 * Why: historical orders were synced while mapOrder read the wrong key
 * (`payment_info` instead of `payment`) and divided amounts by 100, so their
 * subtotal/totalRevenue/discounts are 0. The raw payload is intact, so we can
 * fix existing rows WITHOUT calling the TikTok API.
 *
 * Safe to run repeatedly (idempotent) and safe on production — it only reads
 * already-stored data and overwrites numeric amount columns; it never fabricates
 * data or touches COGS / settlement.
 *
 *   pnpm --filter @ems/api exec tsx scripts/backfill-order-amounts.ts
 *   # or against prod:  railway run --service @ems/api npx tsx apps/api/scripts/backfill-order-amounts.ts
 */
import { prisma } from '@ems/db'

function amt(v: unknown): number {
  if (v === undefined || v === null) return 0
  const n = typeof v === 'string' ? Number(v) : (v as number)
  return isNaN(n) ? 0 : n
}

async function main() {
  const BATCH = 500
  let cursor: string | undefined
  let scanned = 0
  let updated = 0

  for (;;) {
    const orders = await prisma.order.findMany({
      where: { isManual: false },
      select: { id: true, platformMetadata: true, subtotal: true, totalRevenue: true },
      orderBy: { id: 'asc' },
      take: BATCH,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
    })
    if (orders.length === 0) break
    cursor = orders[orders.length - 1].id

    for (const o of orders) {
      scanned++
      const meta = (o.platformMetadata ?? {}) as Record<string, unknown>
      const pay = (meta.payment ?? meta.payment_info ?? {}) as Record<string, unknown>
      if (!pay || Object.keys(pay).length === 0) continue

      const subtotal = amt(pay.sub_total)
      const totalRevenue = amt(pay.total_amount)
      // Skip if there's genuinely nothing to set and it's already 0 (no-op).
      const data = {
        subtotal,
        platformDiscount: amt(pay.platform_discount),
        sellerDiscount: amt(pay.seller_discount),
        shippingFeeBuyer: amt(pay.shipping_fee),
        totalRevenue,
      }
      // Only write when something actually changes, to keep the run cheap.
      if (Number(o.subtotal) === subtotal && Number(o.totalRevenue) === totalRevenue) continue
      await prisma.order.update({ where: { id: o.id }, data })
      updated++
    }
    console.log(`[backfill] scanned=${scanned} updated=${updated}`)
  }

  console.log(`[backfill] done. scanned=${scanned}, updated=${updated}`)
  await prisma.$disconnect()
}

main().catch((e) => { console.error(e); process.exit(1) })
