import type { FastifyInstance } from 'fastify'
import { prisma } from '@ems/db'
import { authenticate } from '../../middleware/authenticate'
import { ShopeeAdapter } from '../../platform/shopee/shopee.adapter'
import { encryptCredentials } from '../../platform/shopee/shopee.adapter'
import { TikTokAdapter } from '../../platform/tiktok/tiktok.adapter'
import { encryptCredentials as encryptTikTokCredentials } from '../../platform/tiktok/tiktok.adapter'
import { syncOrdersQueue } from '../../lib/queues'

const SHOPEE_REDIRECT_URI =
  process.env.SHOPEE_REDIRECT_URI ?? 'http://localhost:3001/api/v1/shops/shopee/callback'
const TIKTOK_REDIRECT_URI =
  process.env.TIKTOK_REDIRECT_URI ?? 'http://localhost:3001/api/v1/shops/tiktok/callback'
const FRONTEND_URL = process.env.CORS_ORIGIN ?? 'http://localhost:5173'

export async function shopRoutes(app: FastifyInstance) {
  // ─── Public: Shopee OAuth callback (no auth — Shopee redirects here) ─────────
  app.get('/shopee/callback', async (request, reply) => {
    const { code, shop_id, state } = request.query as Record<string, string>

    if (!code || !shop_id) {
      return reply.status(400).send({ success: false, error: 'Missing code or shop_id' })
    }

    const adapter = new ShopeeAdapter()

    try {
      const tokens = await adapter.exchangeCode(code, shop_id)
      const credentials = encryptCredentials({
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
      })

      // Determine tenantId from state (base64 encoded tenantId passed at connect time)
      let tenantId: string | undefined
      if (state) {
        try {
          tenantId = Buffer.from(state, 'base64').toString('utf8')
        } catch {
          // ignore malformed state
        }
      }

      if (!tenantId) {
        // Fallback: find an existing shop record by externalShopId to get tenantId
        const existing = await prisma.shop.findFirst({
          where: { externalShopId: tokens.shopId, platform: 'SHOPEE' },
          select: { tenantId: true },
        })
        tenantId = existing?.tenantId
      }

      if (!tenantId) {
        return reply.status(400).send({ success: false, error: 'Could not determine tenant from OAuth state' })
      }

      await prisma.shop.upsert({
        where: {
          tenantId_platform_externalShopId: {
            tenantId,
            platform: 'SHOPEE',
            externalShopId: tokens.shopId,
          },
        },
        update: {
          name: tokens.shopName,
          status: 'ACTIVE',
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          credentialsEncrypted: credentials as any,
          tokenExpiresAt: tokens.expiresAt,
        },
        create: {
          tenantId,
          platform: 'SHOPEE',
          externalShopId: tokens.shopId,
          name: tokens.shopName,
          status: 'ACTIVE',
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          credentialsEncrypted: credentials as any,
          tokenExpiresAt: tokens.expiresAt,
        },
      })

      return reply.redirect(`${FRONTEND_URL}/shops?connected=true`)
    } catch (err) {
      console.error('[shopee/callback] Error:', err)
      return reply.redirect(`${FRONTEND_URL}/shops?error=oauth_failed`)
    }
  })

  // ─── Public: TikTok OAuth callback ───────────────────────────────────────────
  app.get('/tiktok/callback', async (request, reply) => {
    const { code, state } = request.query as Record<string, string>

    if (!code) {
      return reply.status(400).send({ success: false, error: 'Missing code' })
    }

    const adapter = new TikTokAdapter()

    try {
      const tokens = await adapter.exchangeCode(code)
      const credentials = encryptTikTokCredentials({
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
      })

      // Determine tenantId from state (base64 encoded tenantId)
      let tenantId: string | undefined
      if (state) {
        try {
          tenantId = Buffer.from(state, 'base64').toString('utf8')
        } catch {
          // ignore malformed state
        }
      }

      if (!tenantId) {
        const existing = await prisma.shop.findFirst({
          where: { externalShopId: tokens.shopId, platform: 'TIKTOK' },
          select: { tenantId: true },
        })
        tenantId = existing?.tenantId
      }

      if (!tenantId) {
        return reply.status(400).send({ success: false, error: 'Could not determine tenant from OAuth state' })
      }

      await prisma.shop.upsert({
        where: {
          tenantId_platform_externalShopId: {
            tenantId,
            platform: 'TIKTOK',
            externalShopId: tokens.shopId,
          },
        },
        update: {
          name: tokens.shopName,
          status: 'ACTIVE',
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          credentialsEncrypted: credentials as any,
          tokenExpiresAt: tokens.expiresAt,
        },
        create: {
          tenantId,
          platform: 'TIKTOK',
          externalShopId: tokens.shopId,
          name: tokens.shopName,
          status: 'ACTIVE',
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          credentialsEncrypted: credentials as any,
          tokenExpiresAt: tokens.expiresAt,
        },
      })

      return reply.redirect(`${FRONTEND_URL}/shops?connected=true`)
    } catch (err) {
      console.error('[tiktok/callback] Error:', err)
      return reply.redirect(`${FRONTEND_URL}/shops?error=oauth_failed`)
    }
  })

  // ─── All routes below require authentication ───────────────────────────────
  app.addHook('preHandler', authenticate)

  app.get('/', async (request) => {
    const shops = await prisma.shop.findMany({
      where: { tenantId: request.user.tenantId },
      orderBy: { createdAt: 'asc' },
    })
    return { success: true, data: shops }
  })

  // GET /tiktok/connect — returns TikTok OAuth URL
  app.get('/tiktok/connect', async (request, reply) => {
    const adapter = new TikTokAdapter()
    const state = Buffer.from(request.user.tenantId).toString('base64')
    const url = adapter.getAuthUrl(TIKTOK_REDIRECT_URI, state)
    return reply.send({ success: true, data: { url } })
  })

  // GET /shopee/connect — returns the Shopee OAuth URL
  app.get('/shopee/connect', async (request, reply) => {
    const adapter = new ShopeeAdapter()
    // Encode tenantId in state so the callback can identify the tenant
    const state = Buffer.from(request.user.tenantId).toString('base64')
    const url = adapter.getAuthUrl(SHOPEE_REDIRECT_URI, state)
    return reply.send({ success: true, data: { url } })
  })

  // POST /:id/sync — manually trigger order sync for a shop
  app.post('/:id/sync', async (request, reply) => {
    const { id } = request.params as { id: string }
    const shop = await prisma.shop.findFirst({
      where: { id, tenantId: request.user.tenantId },
    })
    if (!shop) {
      return reply.status(404).send({ success: false, error: 'Shop not found' })
    }

    await syncOrdersQueue.add(
      'sync-orders',
      { shopId: shop.id, tenantId: shop.tenantId },
      { jobId: `manual-sync-${shop.id}-${Date.now()}` }
    )

    return reply.send({ success: true, data: { message: 'Sync job queued' } })
  })

  // DELETE /:id — soft-delete a shop
  app.delete('/:id', async (request, reply) => {
    const { id } = request.params as { id: string }
    const shop = await prisma.shop.findFirst({
      where: { id, tenantId: request.user.tenantId },
    })
    if (!shop) {
      return reply.status(404).send({ success: false, error: 'Shop not found' })
    }

    await prisma.shop.update({
      where: { id },
      data: { status: 'INACTIVE' },
    })

    return reply.send({ success: true, data: { message: 'Shop deactivated' } })
  })
}
