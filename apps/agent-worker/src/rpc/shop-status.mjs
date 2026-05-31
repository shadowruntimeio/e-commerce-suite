// Usage: node shop-status.mjs [shopId]
// Without arg: lists every shop belonging to the current tenant + its sync /
// auth health. With arg: returns just that shop's details (and verifies it
// belongs to the tenant). Diagnoses "店铺为什么不同步 / token 过期 / 订单没拉到" complaints.
import { prisma, requireTenantId, emit, closePrismaAnd } from './_lib.mjs'

const tenantId = requireTenantId()
const shopId = process.argv[2]?.trim()

try {
  if (shopId) {
    const shop = await prisma.shop.findFirst({
      where: { id: shopId, tenantId },
      select: {
        id: true, name: true, platform: true, status: true,
        lastSyncAt: true, tokenExpiresAt: true,
        externalShopId: true, createdAt: true,
      },
    })
    if (!shop) {
      emit({ ok: true, exists: false, query: shopId })
    } else {
      const tokenExpiredMs = shop.tokenExpiresAt ? shop.tokenExpiresAt.getTime() - Date.now() : null
      emit({
        ok: true,
        exists: true,
        ...shop,
        tokenExpiresInSec: tokenExpiredMs !== null ? Math.round(tokenExpiredMs / 1000) : null,
        lastSyncAgoSec: shop.lastSyncAt ? Math.round((Date.now() - shop.lastSyncAt.getTime()) / 1000) : null,
      })
    }
  } else {
    const shops = await prisma.shop.findMany({
      where: { tenantId },
      select: {
        id: true, name: true, platform: true, status: true,
        lastSyncAt: true, tokenExpiresAt: true, externalShopId: true,
      },
      orderBy: [{ status: 'asc' }, { name: 'asc' }],
    })
    const now = Date.now()
    emit({
      ok: true,
      shops: shops.map((s) => ({
        ...s,
        tokenExpiresInSec: s.tokenExpiresAt ? Math.round((s.tokenExpiresAt.getTime() - now) / 1000) : null,
        lastSyncAgoSec: s.lastSyncAt ? Math.round((now - s.lastSyncAt.getTime()) / 1000) : null,
      })),
    })
  }
  await closePrismaAnd(0)
} catch (err) {
  emit({ ok: false, error: String(err.message ?? err) })
  await closePrismaAnd(1)
}
