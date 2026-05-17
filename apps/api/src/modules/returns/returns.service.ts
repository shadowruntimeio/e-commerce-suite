import { prisma } from '@ems/db'
import type { TikTokReturn } from '../../platform/tiktok/tiktok.adapter'
import { recordAudit, AuditAction } from '../../lib/audit'

// Resolve the WarehouseSku the warehouse should restock into for a return,
// given TK's return_line_items + the order's owner. Single-SKU returns and
// single-warehouse merchants (the common case) get a unambiguous match;
// anything ambiguous returns null and the warehouse user picks manually.
async function resolveDefaultWarehouseSku(
  ret: TikTokReturn,
  shopOwnerUserId: string,
  tenantId: string,
): Promise<string | null> {
  const uniqueSkus = Array.from(new Set((ret.return_line_items ?? []).map((i) => i.seller_sku).filter((s): s is string => !!s)))
  if (uniqueSkus.length !== 1) return null

  const systemSku = await prisma.systemSku.findFirst({
    where: { skuCode: uniqueSkus[0], systemProduct: { tenantId } },
    select: { id: true },
  })
  if (!systemSku) return null

  const candidates = await prisma.warehouseSku.findMany({
    where: { systemSkuId: systemSku.id, ownerUserId: shopOwnerUserId },
    select: { id: true },
  })
  return candidates.length === 1 ? candidates[0].id : null
}

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
    select: { id: true, shop: { select: { ownerUserId: true } } },
  })
  if (!order) {
    console.warn(`[returns] no Order found for shop=${shop.id} platformOrderId=${ret.order_id} — skipping return ${ret.return_id}`)
    return null
  }

  // Some return_line_items have an explicit quantity; the live payload we
  // tested only had per-unit lines (no quantity field) so fall back to
  // counting entries. Either way produces the correct expected qty.
  const lineItems = ret.return_line_items ?? []
  const expectedQty = lineItems.reduce((sum, it) => sum + (it.quantity ?? 1), 0)
  const payload = ret as unknown as Record<string, unknown>
  const nextSellerActions = extractNextSellerActions(payload)

  const existing = await prisma.afterSalesTicket.findUnique({
    where: { platformReturnId: ret.return_id },
    select: { id: true, platformReturnStatus: true, warehouseSkuId: true },
  })

  let created = false
  let ticketId: string

  if (existing) {
    // Backfill warehouseSkuId for older tickets that pre-date the resolver
    // (or were ambiguous at first but became resolvable later). Never
    // overwrite a value the warehouse already chose.
    const backfilledWarehouseSkuId = existing.warehouseSkuId
      ?? (order.shop?.ownerUserId ? await resolveDefaultWarehouseSku(ret, order.shop.ownerUserId, shop.tenantId) : null)
    const updated = await prisma.afterSalesTicket.update({
      where: { id: existing.id },
      data: {
        platformReturnStatus: ret.return_status,
        platformPayload: payload as any,
        nextSellerActions,
        expectedQty: expectedQty > 0 ? expectedQty : undefined,
        ...(backfilledWarehouseSkuId !== existing.warehouseSkuId ? { warehouseSkuId: backfilledWarehouseSkuId } : {}),
      },
    })
    ticketId = updated.id
  } else {
    const defaultWarehouseSkuId = order.shop?.ownerUserId
      ? await resolveDefaultWarehouseSku(ret, order.shop.ownerUserId, shop.tenantId)
      : null
    const inserted = await prisma.afterSalesTicket.create({
      data: {
        orderId: order.id,
        type: 'RETURN',
        platformReturnId: ret.return_id,
        platformReturnStatus: ret.return_status,
        platformPayload: payload as any,
        nextSellerActions,
        warehouseSkuId: defaultWarehouseSkuId,
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

// TK tells us exactly what the seller needs to do next via
// seller_next_action_response. Extract the action strings so we can filter
// on them with Postgres array operators instead of digging through JSON.
function extractNextSellerActions(payload: Record<string, unknown>): string[] {
  const raw = payload['seller_next_action_response']
  if (!Array.isArray(raw)) return []
  return raw
    .map((a) => (a && typeof a === 'object' && 'action' in a ? String((a as { action: unknown }).action) : null))
    .filter((s): s is string => !!s)
}
