import { createHmac } from 'node:crypto'
import type { FastifyInstance } from 'fastify'
import { prisma } from '@ems/db'
import { syncOrdersQueue } from '../../lib/queues'

function getAppSecret() { return process.env.TIKTOK_APP_SECRET ?? '' }

/**
 * Verify TikTok webhook signature.
 * sign = HMAC-SHA256(app_secret, path + timestamp + data)
 */
function verifySignature(path: string, timestamp: string, data: string, signature: string): boolean {
  const base = `${path}${timestamp}${data}`
  const expected = createHmac('sha256', getAppSecret()).update(base).digest('hex')
  return expected === signature
}

// TikTok webhook event types
const EVENT_ORDER_STATUS_CHANGE = 1
const EVENT_ORDER_SHIPMENT = 4
const EVENT_PRODUCT_STATUS_CHANGE = 5
const EVENT_RETURN_STATUS_CHANGE = 10

function mapOrderStatus(tiktokStatus: string): string {
  switch (tiktokStatus) {
    case 'UNPAID': return 'UNPAID'
    case 'ON_HOLD':
    case 'AWAITING_SHIPMENT':
    case 'PARTIALLY_SHIPPING': return 'TO_SHIP'
    case 'IN_TRANSIT':
    case 'DELIVERED': return 'SHIPPED'
    case 'COMPLETED': return 'COMPLETED'
    case 'CANCELLED': return 'CANCELLED'
    default: return 'PENDING'
  }
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

    // Verify signature
    const signature = (request.headers['authorization'] as string) ?? ''
    const isValid = verifySignature(
      '/api/v1/webhooks/tiktok',
      String(body.timestamp),
      body.data,
      signature,
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

    // Find the shop
    const shop = await prisma.shop.findFirst({
      where: {
        platform: 'TIKTOK',
        status: 'ACTIVE',
        externalShopId: body.shop_id,
      },
    })

    if (!shop) {
      console.warn(`[webhook/tiktok] No active shop found for shop_id=${body.shop_id}`)
      return reply.status(200).send({ code: 0, message: 'ok' })
    }

    // Handle event types
    switch (body.type) {
      case EVENT_ORDER_STATUS_CHANGE:
      case EVENT_ORDER_SHIPMENT:
      case EVENT_RETURN_STATUS_CHANGE: {
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

        // Also queue a full sync to get complete order details
        await syncOrdersQueue.add(
          'sync-orders',
          { shopId: shop.id, tenantId: shop.tenantId },
          {
            jobId: `webhook-sync-${shop.id}-${Date.now()}`,
            priority: 1, // high priority
          },
        )
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
