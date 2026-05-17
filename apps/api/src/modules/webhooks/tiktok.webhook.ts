import { createHmac } from 'node:crypto'
import type { FastifyInstance } from 'fastify'
import { prisma } from '@ems/db'
import { syncOrdersQueue } from '../../lib/queues'
import { decryptUserTikTokCreds, getShopTikTokAppCreds } from '../../platform/tiktok/tiktok-app-creds'
import { TikTokAdapter } from '../../platform/tiktok/tiktok.adapter'
import { upsertReturnFromPlatform } from '../returns/returns.service'

/**
 * Verify TikTok webhook signature.
 * sign = HMAC-SHA256(app_secret, path + timestamp + data)
 *
 * The app_secret comes from whichever app the merchant configured for this
 * shop's owner; falls back to env if the merchant hasn't set one.
 */
function verifySignature(path: string, timestamp: string, data: string, signature: string, appSecret: string): boolean {
  const base = `${path}${timestamp}${data}`
  const expected = createHmac('sha256', appSecret).update(base).digest('hex')
  return expected === signature
}

// TikTok webhook event types
const EVENT_ORDER_STATUS_CHANGE = 1
const EVENT_ORDER_SHIPMENT = 4
const EVENT_PRODUCT_STATUS_CHANGE = 5
const EVENT_RETURN_STATUS_CHANGE = 10

const TIKTOK_STATUSES = new Set([
  'UNPAID', 'ON_HOLD', 'AWAITING_SHIPMENT', 'AWAITING_COLLECTION',
  'PARTIALLY_SHIPPING', 'IN_TRANSIT', 'DELIVERED', 'COMPLETED', 'CANCELLED',
])

function mapOrderStatus(tiktokStatus: string): string {
  return TIKTOK_STATUSES.has(tiktokStatus) ? tiktokStatus : 'PENDING'
}

export async function tiktokWebhookRoutes(app: FastifyInstance) {
  // TikTok sends POST requests to this endpoint
  app.post('/tiktok', async (request, reply) => {
    const body = request.body as {
      type: number
      shop_id: string
      timestamp: number
      data: string
    }

    console.log(`[webhook/tiktok] Received event type=${body.type} shop_id=${body.shop_id}`)

    // Look up the shop first so we can verify the signature with that
    // merchant's app_secret. If unknown shop, fall back to env secret —
    // unknown shop will be rejected later anyway.
    const shop = await prisma.shop.findFirst({
      where: {
        platform: 'TIKTOK',
        status: 'ACTIVE',
        externalShopId: body.shop_id,
      },
      include: { owner: { select: { settings: true } } },
    })

    const appSecret = (shop && decryptUserTikTokCreds(shop.owner.settings)?.appSecret)
      ?? process.env.TIKTOK_APP_SECRET ?? ''

    const signature = (request.headers['authorization'] as string) ?? ''
    const isValid = verifySignature(
      '/api/v1/webhooks/tiktok',
      String(body.timestamp),
      body.data,
      signature,
      appSecret,
    )

    if (!isValid) {
      console.warn('[webhook/tiktok] Invalid signature, ignoring')
      // Still return 200 to avoid TikTok retrying
      return reply.status(200).send({ code: 0, message: 'ok' })
    }

    let eventData: Record<string, unknown>
    try {
      eventData = JSON.parse(body.data)
    } catch {
      console.error('[webhook/tiktok] Failed to parse event data:', body.data)
      return reply.status(200).send({ code: 0, message: 'ok' })
    }

    console.log(`[webhook/tiktok] Event data:`, JSON.stringify(eventData))

    if (!shop) {
      console.warn(`[webhook/tiktok] No active shop found for shop_id=${body.shop_id}`)
      return reply.status(200).send({ code: 0, message: 'ok' })
    }

    // Handle event types
    switch (body.type) {
      case EVENT_ORDER_STATUS_CHANGE:
      case EVENT_ORDER_SHIPMENT: {
        const orderId = (eventData.order_id ?? eventData.order_sn) as string | undefined
        const orderStatus = eventData.order_status as string | undefined

        if (orderId && orderStatus) {
          // Directly update order status in DB
          const mapped = mapOrderStatus(orderStatus)
          const updated = await prisma.order.updateMany({
            where: { shopId: shop.id, platformOrderId: orderId },
            data: { status: mapped as any },
          })
          console.log(`[webhook/tiktok] Updated order ${orderId} → ${mapped} (matched=${updated.count})`)
        }

        // Also queue a full sync to get complete order details. Use a 5-second
        // bucket on the jobId so a burst of webhooks (TK can fire multiple
        // events per state change) collapses into a single sync — without this
        // the worker can race itself and produce duplicate order_items rows.
        await syncOrdersQueue.add(
          'sync-orders',
          { shopId: shop.id, tenantId: shop.tenantId },
          {
            jobId: `webhook-sync-${shop.id}-${Math.floor(Date.now() / 5000)}`,
            priority: 1, // high priority
          },
        )
        break
      }

      case EVENT_RETURN_STATUS_CHANGE: {
        // TK field naming for returns is inconsistent across messages; check
        // the common variants and log the raw payload when we miss.
        const returnId =
          (eventData.return_id
            ?? eventData.return_order_id
            ?? eventData.returnId
            ?? eventData.id) as string | undefined
        if (!returnId) {
          console.warn(`[webhook/tiktok] event 10 had no return_id; raw payload:`, JSON.stringify(eventData))
          break
        }
        try {
          const appCreds = await getShopTikTokAppCreds(shop.id)
          const adapter = new TikTokAdapter(appCreds)
          const detail = await adapter.getReturn(shop, returnId)
          await upsertReturnFromPlatform({ id: shop.id, tenantId: shop.tenantId }, detail)
        } catch (err) {
          console.warn(`[webhook/tiktok] failed to fetch/upsert return ${returnId}:`, (err as Error).message)
        }
        break
      }

      case EVENT_PRODUCT_STATUS_CHANGE: {
        console.log(`[webhook/tiktok] Product status change, queuing product sync`)
        const { syncProductsQueue } = await import('../../lib/queues')
        await syncProductsQueue.add(
          'sync-products',
          { shopId: shop.id, tenantId: shop.tenantId },
          { jobId: `webhook-product-sync-${shop.id}-${Date.now()}` },
        )
        break
      }

      default:
        console.log(`[webhook/tiktok] Unhandled event type: ${body.type}`)
    }

    // Always return 200 to acknowledge receipt
    return reply.status(200).send({ code: 0, message: 'ok' })
  })
}
