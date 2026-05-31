// Usage: node order-lookup.mjs <platform_order_id>
// Returns the full state of an order if it belongs to the current tenant.
// Use this when the user asks about a specific order: "为什么订单 X 没发货 / 取消了 / 状态不对".
import { prisma, requireTenantId, getArg, emit, closePrismaAnd } from './_lib.mjs'

const tenantId = requireTenantId()
const id = getArg('platformOrderId', 2)

try {
  const order = await prisma.order.findFirst({
    where: { tenantId, platformOrderId: id },
    select: {
      id: true,
      platformOrderId: true,
      status: true,
      merchantConfirmStatus: true,
      merchantConfirmExpiresAt: true,
      buyerName: true,
      currency: true,
      totalRevenue: true,
      platformCreatedAt: true,
      createdAt: true,
      updatedAt: true,
      isManual: true,
      trackingNumber: true,
      shop: { select: { id: true, name: true, platform: true, status: true } },
      items: {
        select: {
          id: true,
          platformSkuId: true,
          sellerSku: true,
          productName: true,
          skuName: true,
          quantity: true,
          systemSkuId: true,
        },
      },
    },
  })
  if (!order) {
    emit({ ok: true, exists: false, query: id })
  } else {
    emit({ ok: true, exists: true, order })
  }
  await closePrismaAnd(0)
} catch (err) {
  emit({ ok: false, error: String(err.message ?? err) })
  await closePrismaAnd(1)
}
