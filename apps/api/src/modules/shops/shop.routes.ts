import type { FastifyInstance } from 'fastify'
import { prisma } from '@ems/db'
import { authenticate } from '../../middleware/authenticate'
import { ShopeeAdapter } from '../../platform/shopee/shopee.adapter'
import { encryptCredentials } from '../../platform/shopee/shopee.adapter'
import { TikTokAdapter } from '../../platform/tiktok/tiktok.adapter'
import { encryptCredentials as encryptTikTokCredentials } from '../../platform/tiktok/tiktok.adapter'
import {
  getMerchantTikTokAppCreds,
  buildUserTikTokSettings,
} from '../../platform/tiktok/tiktok-app-creds'
import { z } from 'zod'
import { syncOrdersQueue, syncProductsQueue } from '../../lib/queues'
import { recordAudit, AuditAction } from '../../lib/audit'

const SHOPEE_REDIRECT_URI =
  process.env.SHOPEE_REDIRECT_URI ?? 'http://localhost:3001/api/v1/shops/shopee/callback'
const TIKTOK_REDIRECT_URI =
  process.env.TIKTOK_REDIRECT_URI ?? 'http://localhost:3001/api/v1/shops/tiktok/callback'
const FRONTEND_URL = process.env.CORS_ORIGIN ?? 'http://localhost:5173'

export async function shopRoutes(app: FastifyInstance) {
  // ─── Public OAuth callbacks (no auth — platforms redirect here) ──────────────
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

        let stateObj: { tenantId?: string; userId?: string } = {}
        if (state) {
          try {
            stateObj = JSON.parse(Buffer.from(state, 'base64').toString('utf8'))
          } catch {
            // ignore malformed state
          }
        }
        let tenantId = stateObj.tenantId
        let ownerUserId = stateObj.userId

        if (!tenantId || !ownerUserId) {
          const existing = await prisma.shop.findFirst({
            where: { externalShopId: tokens.shopId, platform: 'SHOPEE' },
            select: { tenantId: true, ownerUserId: true },
          })
          tenantId ??= existing?.tenantId
          ownerUserId ??= existing?.ownerUserId
        }

        if (!tenantId || !ownerUserId) {
          return reply.status(400).send({ success: false, error: 'Could not determine merchant from OAuth state' })
        }

        const preExisting = await prisma.shop.findUnique({
          where: {
            tenantId_platform_externalShopId: {
              tenantId,
              platform: 'SHOPEE',
              externalShopId: tokens.shopId,
            },
          },
          select: { id: true },
        })

        const shop = await prisma.shop.upsert({
          where: {
            tenantId_platform_externalShopId: {
              tenantId,
              platform: 'SHOPEE',
              externalShopId: tokens.shopId,
            },
          },
          update: {
            // The merchant authorizing the shop becomes its owner.
            ownerUserId,
            name: tokens.shopName,
            status: 'ACTIVE',
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            credentialsEncrypted: credentials as any,
            tokenExpiresAt: tokens.expiresAt,
          },
          create: {
            tenantId,
            ownerUserId,
            platform: 'SHOPEE',
            externalShopId: tokens.shopId,
            name: tokens.shopName,
            status: 'ACTIVE',
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            credentialsEncrypted: credentials as any,
            tokenExpiresAt: tokens.expiresAt,
          },
        })

        await recordAudit({
          tenantId,
          actorUserId: ownerUserId,
          action: preExisting ? AuditAction.SHOP_UPDATE : AuditAction.SHOP_CREATE,
          targetType: 'shop',
          targetId: shop.id,
          payload: { platform: 'SHOPEE', externalShopId: tokens.shopId, name: tokens.shopName },
          ip: request.ip,
          userAgent: request.headers['user-agent'] ?? undefined,
        })

        const ts = Date.now()
        await syncOrdersQueue.add(
          'sync-orders',
          { shopId: shop.id, tenantId: shop.tenantId },
          { jobId: `initial-sync-${shop.id}-${ts}` }
        )
        await syncProductsQueue.add(
          'sync-products',
          { shopId: shop.id, tenantId: shop.tenantId },
          { jobId: `initial-product-sync-${shop.id}-${ts}` }
        )

        return reply.redirect(`${FRONTEND_URL}/shops?connected=true`)
      } catch (err) {
        console.error('[shopee/callback] Error:', err)
        return reply.redirect(`${FRONTEND_URL}/shops?error=oauth_failed`)
      }
    })

  app.get('/tiktok/callback', async (request, reply) => {
      console.log('[tiktok/callback] incoming query:', request.query)
      const { code, state } = request.query as Record<string, string>

      if (!code) {
        console.error('[tiktok/callback] missing code in query')
        return reply.status(400).send({ success: false, error: 'Missing code' })
      }

      try {
        // Resolve which merchant initiated this OAuth so we can use their
        // app credentials for the code exchange. State carries userId.
        let stateObj: { tenantId?: string; userId?: string } = {}
        if (state) {
          try { stateObj = JSON.parse(Buffer.from(state, 'base64').toString('utf8')) }
          catch (e) { console.warn('[tiktok/callback] malformed state:', (e as Error).message) }
        }

        const appCreds = stateObj.userId
          ? await getMerchantTikTokAppCreds(stateObj.userId)
          : { appKey: process.env.TIKTOK_APP_KEY ?? '', appSecret: process.env.TIKTOK_APP_SECRET ?? '' }
        const adapter = new TikTokAdapter(appCreds)

        console.log('[tiktok/callback] step 1: exchanging code for tokens (app=%s)', appCreds.appKey.slice(0, 6))
        const tokens = await adapter.exchangeCode(code)
        console.log('[tiktok/callback] step 1 ok. tokens:', {
          shopId: tokens.shopId,
          shopName: tokens.shopName,
          shopCipher: tokens.shopCipher ? 'present' : 'MISSING',
          expiresAt: tokens.expiresAt,
          accessTokenPreview: tokens.accessToken?.slice(0, 10),
        })

        console.log('[tiktok/callback] step 2: encrypting credentials')
        const credentials = encryptTikTokCredentials({
          accessToken: tokens.accessToken,
          refreshToken: tokens.refreshToken,
          shopCipher: tokens.shopCipher,
        })
        console.log('[tiktok/callback] step 2 ok')

        console.log('[tiktok/callback] step 3: resolving merchant. state present:', !!state)
        let tenantId = stateObj.tenantId
        let ownerUserId = stateObj.userId

        if (!tenantId || !ownerUserId) {
          console.log('[tiktok/callback] falling back to existing shop lookup by externalShopId:', tokens.shopId)
          const existing = await prisma.shop.findFirst({
            where: { externalShopId: tokens.shopId, platform: 'TIKTOK' },
            select: { tenantId: true, ownerUserId: true },
          })
          tenantId ??= existing?.tenantId
          ownerUserId ??= existing?.ownerUserId
        }

        if (!tenantId || !ownerUserId) {
          console.error('[tiktok/callback] no merchant resolved')
          return reply.status(400).send({ success: false, error: 'Could not determine merchant from OAuth state' })
        }

        console.log('[tiktok/callback] step 4: upserting shop. tenantId:', tenantId, 'ownerUserId:', ownerUserId, 'externalShopId:', tokens.shopId)
        const preExisting = await prisma.shop.findUnique({
          where: {
            tenantId_platform_externalShopId: {
              tenantId,
              platform: 'TIKTOK',
              externalShopId: tokens.shopId,
            },
          },
          select: { id: true },
        })
        const shop = await prisma.shop.upsert({
          where: {
            tenantId_platform_externalShopId: {
              tenantId,
              platform: 'TIKTOK',
              externalShopId: tokens.shopId,
            },
          },
          update: {
            // The merchant authorizing the shop becomes its owner. If they're
            // reconnecting their own shop, this is a no-op; if they're claiming
            // a shop previously assigned to another user (e.g. via backfill),
            // ownership transfers to them.
            ownerUserId,
            name: tokens.shopName,
            status: 'ACTIVE',
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            credentialsEncrypted: credentials as any,
            tokenExpiresAt: tokens.expiresAt,
          },
          create: {
            tenantId,
            ownerUserId,
            platform: 'TIKTOK',
            externalShopId: tokens.shopId,
            name: tokens.shopName,
            status: 'ACTIVE',
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            credentialsEncrypted: credentials as any,
            tokenExpiresAt: tokens.expiresAt,
          },
        })
        console.log('[tiktok/callback] step 4 ok. queueing initial sync jobs')

        await recordAudit({
          tenantId,
          actorUserId: ownerUserId,
          action: preExisting ? AuditAction.SHOP_UPDATE : AuditAction.SHOP_CREATE,
          targetType: 'shop',
          targetId: shop.id,
          payload: { platform: 'TIKTOK', externalShopId: tokens.shopId, name: tokens.shopName },
          ip: request.ip,
          userAgent: request.headers['user-agent'] ?? undefined,
        })

        const ts = Date.now()
        await syncOrdersQueue.add(
          'sync-orders',
          { shopId: shop.id, tenantId: shop.tenantId },
          { jobId: `initial-sync-${shop.id}-${ts}` }
        )
        await syncProductsQueue.add(
          'sync-products',
          { shopId: shop.id, tenantId: shop.tenantId },
          { jobId: `initial-product-sync-${shop.id}-${ts}` }
        )
        console.log('[tiktok/callback] initial sync jobs queued. redirecting to frontend success.')

        return reply.redirect(`${FRONTEND_URL}/shops?connected=true`)
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err)
        const stack = err instanceof Error ? err.stack : undefined
        console.error('[tiktok/callback] Error:', errMsg)
        if (stack) console.error('[tiktok/callback] Stack:', stack)
        return reply.redirect(`${FRONTEND_URL}/shops?error=oauth_failed&detail=${encodeURIComponent(errMsg)}`)
      }
  })

  // ─── Protected routes (require authentication) ──────────────────────────────
  app.register(async function protectedRoutes(auth) {
    auth.addHook('preHandler', authenticate)

    auth.get('/', async (request) => {
      const where: Record<string, unknown> = {
        tenantId: request.user.tenantId,
        status: { not: 'INACTIVE' },
      }
      // MERCHANT only sees own shops
      if (request.user.role === 'MERCHANT') {
        where.ownerUserId = request.user.userId
      }
      const shops = await prisma.shop.findMany({
        where,
        orderBy: { createdAt: 'asc' },
        include: { owner: { select: { id: true, name: true, email: true } } },
      })
      return { success: true, data: shops }
    })

    // GET /tiktok/connect — returns TikTok OAuth URL (merchant only).
    // Uses the merchant's own app_key configured under settings.tiktok; if
    // they haven't set one, falls back to the env app (legacy mode).
    auth.get('/tiktok/connect', async (request, reply) => {
      if (request.user.role !== 'MERCHANT') {
        return reply.status(403).send({ success: false, error: 'Only merchants can connect shops' })
      }
      const appCreds = await getMerchantTikTokAppCreds(request.user.userId)
      if (!appCreds.appKey || !appCreds.appSecret) {
        return reply.status(400).send({
          success: false,
          error: 'TIKTOK_APP_NOT_CONFIGURED',
        })
      }
      const adapter = new TikTokAdapter(appCreds)
      const state = Buffer.from(JSON.stringify({
        tenantId: request.user.tenantId,
        userId: request.user.userId,
      })).toString('base64')
      const url = adapter.getAuthUrl(TIKTOK_REDIRECT_URI, state)
      return reply.send({ success: true, data: { url } })
    })

    // ─── Per-merchant TikTok app credentials ─────────────────────────────────
    // The secret is stored encrypted in user.settings.tiktok.appSecretEncrypted
    // and never returned in plaintext. GET returns only the key + a boolean.

    auth.get('/tiktok/app', async (request, reply) => {
      if (request.user.role !== 'MERCHANT') {
        return reply.status(403).send({ success: false, error: 'Only merchants can manage app credentials' })
      }
      const user = await prisma.user.findUnique({
        where: { id: request.user.userId },
        select: { settings: true },
      })
      const tt = (user?.settings as { tiktok?: { appKey?: string; appSecretEncrypted?: string } } | null)?.tiktok
      return {
        success: true,
        data: {
          appKey: tt?.appKey ?? '',
          hasAppSecret: !!tt?.appSecretEncrypted,
        },
      }
    })

    auth.put('/tiktok/app', async (request, reply) => {
      if (request.user.role !== 'MERCHANT') {
        return reply.status(403).send({ success: false, error: 'Only merchants can manage app credentials' })
      }
      const schema = z.object({
        appKey: z.string().trim().min(1, 'appKey required'),
        // Allow blank to mean "keep existing secret" so the merchant can edit
        // the key without re-entering the secret.
        appSecret: z.string().optional(),
      })
      const parsed = schema.safeParse(request.body)
      if (!parsed.success) {
        return reply.status(400).send({ success: false, error: parsed.error.message })
      }
      const { appKey, appSecret } = parsed.data

      const user = await prisma.user.findUnique({
        where: { id: request.user.userId },
        select: { settings: true },
      })
      const existing = (user?.settings as { tiktok?: { appSecretEncrypted?: string } } | null)?.tiktok ?? {}
      const newTiktok = appSecret
        ? buildUserTikTokSettings(appKey, appSecret)
        : { appKey, appSecretEncrypted: existing.appSecretEncrypted }

      if (!newTiktok.appSecretEncrypted) {
        return reply.status(400).send({ success: false, error: 'appSecret required (no existing secret to keep)' })
      }

      const merged = { ...((user?.settings as Record<string, unknown>) ?? {}), tiktok: newTiktok }
      await prisma.user.update({
        where: { id: request.user.userId },
        data: { settings: merged as object },
      })

      await recordAudit({
        tenantId: request.user.tenantId,
        actorUserId: request.user.userId,
        action: AuditAction.TIKTOK_APP_SAVE,
        targetType: 'user',
        targetId: request.user.userId,
        payload: { appKey: newTiktok.appKey, secretUpdated: !!appSecret },
        ip: request.ip,
        userAgent: request.headers['user-agent'] ?? undefined,
      })

      return {
        success: true,
        data: { appKey: newTiktok.appKey, hasAppSecret: true },
      }
    })

    // GET /shopee/connect — returns the Shopee OAuth URL (merchant only)
    auth.get('/shopee/connect', async (request, reply) => {
      if (request.user.role !== 'MERCHANT') {
        return reply.status(403).send({ success: false, error: 'Only merchants can connect shops' })
      }
      const adapter = new ShopeeAdapter()
      const state = Buffer.from(JSON.stringify({
        tenantId: request.user.tenantId,
        userId: request.user.userId,
      })).toString('base64')
      const url = adapter.getAuthUrl(SHOPEE_REDIRECT_URI, state)
      return reply.send({ success: true, data: { url } })
    })

    // POST /:id/sync — manually trigger order + product sync for a shop.
    // JobId has 5-second granularity: rapid button mashing collapses, but
    // intentional triggers spaced >5s apart stay distinct (e.g. post-print
    // retries or page mount after a fresh action).
    auth.post('/:id/sync', async (request, reply) => {
      const { id } = request.params as { id: string }
      const where: Record<string, unknown> = { id, tenantId: request.user.tenantId }
      if (request.user.role === 'MERCHANT') where.ownerUserId = request.user.userId
      const shop = await prisma.shop.findFirst({ where })
      if (!shop) {
        return reply.status(404).send({ success: false, error: 'Shop not found' })
      }

      const bucket = Math.floor(Date.now() / 5000)
      await syncOrdersQueue.add(
        'sync-orders',
        { shopId: shop.id, tenantId: shop.tenantId },
        { jobId: `manual-sync-${shop.id}-${bucket}` }
      )
      await syncProductsQueue.add(
        'sync-products',
        { shopId: shop.id, tenantId: shop.tenantId },
        { jobId: `manual-product-sync-${shop.id}-${bucket}` }
      )

      return reply.send({ success: true, data: { message: 'Order and product sync jobs queued' } })
    })

    // POST /sync-all — enqueue order + product sync for every active shop in
    // this tenant. Used by the web app on page navigation and post-action refresh.
    auth.post('/sync-all', async (request) => {
      const where: Record<string, unknown> = { tenantId: request.user.tenantId, status: 'ACTIVE' }
      if (request.user.role === 'MERCHANT') where.ownerUserId = request.user.userId
      const shops = await prisma.shop.findMany({
        where,
        select: { id: true, tenantId: true },
      })
      const bucket = Math.floor(Date.now() / 5000)
      for (const shop of shops) {
        await syncOrdersQueue.add(
          'sync-orders',
          { shopId: shop.id, tenantId: shop.tenantId },
          { jobId: `manual-sync-${shop.id}-${bucket}` }
        )
        await syncProductsQueue.add(
          'sync-products',
          { shopId: shop.id, tenantId: shop.tenantId },
          { jobId: `manual-product-sync-${shop.id}-${bucket}` }
        )
      }
      return { success: true, data: { queued: shops.length } }
    })

    // DELETE /:id — soft-delete a shop
    auth.delete('/:id', async (request, reply) => {
      const { id } = request.params as { id: string }
      const where: Record<string, unknown> = { id, tenantId: request.user.tenantId }
      if (request.user.role === 'MERCHANT') where.ownerUserId = request.user.userId
      const shop = await prisma.shop.findFirst({ where })
      if (!shop) {
        return reply.status(404).send({ success: false, error: 'Shop not found' })
      }

      await prisma.shop.update({
        where: { id },
        data: { status: 'INACTIVE' },
      })

      await recordAudit({
        tenantId: request.user.tenantId,
        actorUserId: request.user.userId,
        action: AuditAction.SHOP_DISCONNECT,
        targetType: 'shop',
        targetId: id,
        payload: { platform: shop.platform, name: shop.name },
        ip: request.ip,
        userAgent: request.headers['user-agent'] ?? undefined,
      })

      return reply.send({ success: true, data: { message: 'Shop deactivated' } })
    })
  })
}
