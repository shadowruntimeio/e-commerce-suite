import { prisma } from '@ems/db'
import type { TikTokReturn } from '../../platform/tiktok/tiktok.adapter'
import { recordAudit, AuditAction } from '../../lib/audit'

/**
 * Upsert an AfterSalesTicket from a TikTok return payload. Shared by the
 * webhook handler and the sync-returns worker so the two paths stay in sync.
 *
 * Lookup order:
 *   1. Find the Order by (shopId, platformOrderId = return.order_id).
 *      If not found, log and skip — we can't anchor a return without an order.
 *   2. Upsert by AfterSalesTicket.platformReturnId (unique).
 *
 * Warehouse-set fields (condition, arrivedAt, returnedQty, warehouseSkuId,
 * inspectedAt/By, restockedAt, notes) are NEVER overwritten on update — the
 * platform doesn't know about the physical flow.
 */
export async function upsertReturnFromPlatform(
  shop: { id: string; tenantId: string },
  ret: TikTokReturn,
): Promise<{ created: boolean; ticketId: string } | null> {
  const order = await prisma.order.findFirst({
    where: { shopId: shop.id, platformOrderId: ret.order_id },
    select: { id: true },
  })
  if (!order) {
    console.warn(`[returns] no Order found for shop=${shop.id} platformOrderId=${ret.order_id} — skipping return ${ret.return_id}`)
    return null
  }

  const expectedQty = (ret.items ?? []).reduce((sum, it) => sum + (it.quantity ?? 0), 0)
  const payload = ret as unknown as Record<string, unknown>

  const existing = await prisma.afterSalesTicket.findUnique({
    where: { platformReturnId: ret.return_id },
    select: { id: true, platformReturnStatus: true },
  })

  let created = false
  let ticketId: string

  if (existing) {
    const updated = await prisma.afterSalesTicket.update({
      where: { id: existing.id },
      data: {
        platformReturnStatus: ret.return_status,
        platformPayload: payload as any,
        expectedQty: expectedQty > 0 ? expectedQty : undefined,
      },
    })
    ticketId = updated.id
  } else {
    const inserted = await prisma.afterSalesTicket.create({
      data: {
        orderId: order.id,
        type: 'RETURN',
        platformReturnId: ret.return_id,
        platformReturnStatus: ret.return_status,
        platformPayload: payload as any,
        expectedQty: expectedQty > 0 ? expectedQty : null,
      },
    })
    ticketId = inserted.id
    created = true
  }

  try {
    await recordAudit({
      tenantId: shop.tenantId,
      actorUserId: null,
      action: created ? AuditAction.RETURN_CREATE : AuditAction.RETURN_PLATFORM_STATUS_CHANGE,
      targetType: 'after_sales_ticket',
      targetId: ticketId,
      payload: {
        platformReturnId: ret.return_id,
        platformReturnStatus: ret.return_status,
        previousStatus: existing?.platformReturnStatus ?? null,
        orderId: order.id,
      },
    })
  } catch (err) {
    console.warn(`[returns] failed to record audit for ticket ${ticketId}:`, err)
  }

  return { created, ticketId }
}
