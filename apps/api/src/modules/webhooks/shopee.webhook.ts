import { createHmac } from 'node:crypto'
import type { FastifyInstance } from 'fastify'
import { prisma } from '@ems/db'
import { syncOrdersQueue, syncProductsQueue } from '../../lib/queues'

// Shopee push (webhook) signing: HMAC-SHA256(partner_key, url + '|' + raw_body),
// hex digest, delivered as the value of the `Authorization` header. The url is
// the full public callback URL Shopee was configured with — we reconstruct
// it from the request rather than hardcoding so dev (localhost), staging, and
// prod all verify without code changes.
function verifySignature(url: string, rawBody: Buffer, authorization: string, partnerKey: string): boolean {
  const expected = createHmac('sha256', partnerKey).update(`${url}|${rawBody.toString('utf8')}`).digest('hex')
  return expected === authorization
}

// Shopee push event codes (subset we actually act on; full list in their docs).
const EVENT_SHOP_AUTHORIZATION = 1
const EVENT_SHOP_DEAUTHORIZATION = 2
const EVENT_ORDER_STATUS = 3
const EVENT_TRACKING_NUMBER = 4
const EVENT_ITEM_PROMOTION = 7
const EVENT_LOGISTICS_STATUS = 10
const EVENT_RETURN_STATUS = 11

// Map Shopee status strings → our internal OrderStatus enum. Mirrors the
// adapter's mapOrderStatus so a webhook-driven write and a sync-driven write
// resolve to the same value.
function mapOrderStatus(s: string): string {
  switch (s) {
    case 'UNPAID': return 'UNPAID'
    case 'READY_TO_SHIP':
    case 'PROCESSED':
    case 'RETRY_SHIP':
      return 'TO_SHIP'
    case 'SHIPPED':
    case 'TO_CONFIRM_RECEIVE':
      return 'SHIPPED'
    case 'COMPLETED': return 'COMPLETED'
    case 'CANCELLED':
    case 'IN_CANCEL':
      return 'CANCELLED'
    default: return 'PENDING'
  }
}

export async function shopeeWebhookRoutes(app: FastifyInstance) {
  // Capture the raw body bytes — Shopee signs them verbatim, so we can't
  // rely on re-serialized JSON. Encapsulated in this plugin so other routes
  // keep the default JSON parser. eslint-disable: rawBody is a runtime attach.
  app.addContentTypeParser('application/json', { parseAs: 'buffer' }, function (req, body, done) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(req as any).rawBody = body
      done(null, JSON.parse((body as Buffer).toString('utf8')))
    } catch (err) {
      done(err as Error)
    }
  })

  app.post('/shopee', async (request, reply) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rawBody = (request as any).rawBody as Buffer | undefined
    if (!rawBody) {
      console.warn('[webhook/shopee] missing raw body — content parser misconfigured?')
      // ACK anyway so Shopee doesn't retry indefinitely
      return reply.status(200).send({})
    }

    const partnerKey = process.env.SHOPEE_PARTNER_KEY ?? ''
    const authorization = (request.headers['authorization'] as string) ?? ''
    // Reconstruct the URL Shopee actually called us on. They sign against the
    // full URL including protocol + host + path (no query string for push).
    const proto = (request.headers['x-forwarded-proto'] as string) ?? request.protocol
    const host = (request.headers['x-forwarded-host'] as string) ?? request.headers['host']
    const fullUrl = `${proto}://${host}${request.url.split('?')[0]}`

    if (!verifySignature(fullUrl, rawBody, authorization, partnerKey)) {
      console.warn(`[webhook/shopee] Invalid signature for ${fullUrl}; ignoring`)
      // Per Shopee's docs: ACK with 2xx + empty body so we're not retried.
      return reply.status(200).send({})
    }

    const body = request.body as {
      shop_id?: number
      code?: number
      timestamp?: number
      data?: Record<string, unknown>
    }
    console.log(`[webhook/shopee] Received event code=${body.code} shop_id=${body.shop_id}`)

    // Authorization push (code 1) fires *before* we may have a shop row yet
    // (it's the initial OAuth grant notification). Skip the shop lookup for
    // that case; for others, require an ACTIVE shop in our tenant.
    if (body.code === EVENT_SHOP_AUTHORIZATION) {
      console.log(`[webhook/shopee] Shop authorization push for shop_id=${body.shop_id}; OAuth callback should follow`)
      return reply.status(200).send({})
    }

    const shop = body.shop_id
      ? await prisma.shop.findFirst({
          where: { platform: 'SHOPEE', externalShopId: String(body.shop_id), status: 'ACTIVE' },
        })
      : null
    if (!shop) {
      console.warn(`[webhook/shopee] No active shop for shop_id=${body.shop_id}; ACKing`)
      return reply.status(200).send({})
    }

    switch (body.code) {
      case EVENT_SHOP_DEAUTHORIZATION: {
        // Merchant revoked our access — mark shop inactive so workers stop
        // hitting it (and the UI shows an auth-expired state).
        await prisma.shop.update({ where: { id: shop.id }, data: { status: 'AUTH_EXPIRED' } })
        console.log(`[webhook/shopee] Shop ${shop.id} deauthorized`)
        break
      }

      case EVENT_ORDER_STATUS:
      case EVENT_TRACKING_NUMBER:
      case EVENT_LOGISTICS_STATUS: {
        const orderSn = (body.data?.ordersn ?? body.data?.order_sn) as string | undefined
        const status = (body.data?.status ?? body.data?.order_status) as string | undefined
        if (orderSn && status) {
          const mapped = mapOrderStatus(status)
          const updated = await prisma.order.updateMany({
            where: { shopId: shop.id, platformOrderId: orderSn },
            data: { status: mapped as never },
          })
          console.log(`[webhook/shopee] order ${orderSn} -> ${mapped} (matched=${updated.count})`)
        }
        // Bucket-deduped follow-up sync to pull full order detail (tracking#,
        // shipping info, etc.) — Shopee push only carries identifiers, not
        // the full record. Mirrors the TikTok webhook pattern.
        await syncOrdersQueue.add(
          'sync-orders',
          { shopId: shop.id, tenantId: shop.tenantId },
          { jobId: `webhook-sync-${shop.id}-${Math.floor(Date.now() / 5000)}`, priority: 1 },
        )
        break
      }

      case EVENT_RETURN_STATUS: {
        // Returns ingestion for Shopee isn't wired yet — log so we can build
        // out parity with TikTok later. ACK to prevent Shopee retries.
        console.log(`[webhook/shopee] return status push:`, JSON.stringify(body.data))
        break
      }

      case EVENT_ITEM_PROMOTION: {
        await syncProductsQueue.add(
          'sync-products',
          { shopId: shop.id, tenantId: shop.tenantId },
          { jobId: `webhook-product-sync-${shop.id}-${Math.floor(Date.now() / 5000)}` },
        )
        break
      }

      default:
        console.log(`[webhook/shopee] Unhandled event code: ${body.code}`)
    }

    // Shopee requires 2xx + empty body to consider the push delivered.
    return reply.status(200).send({})
  })
}
