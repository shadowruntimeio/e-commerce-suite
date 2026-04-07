import { createHmac } from 'node:crypto'
import { encrypt, decrypt } from '../../lib/encryption'
import type {
  PlatformAdapter,
  ShopRecord,
  OAuthTokens,
  SyncOrdersParams,
  PlatformOrder,
  PlatformOrderItem,
  PlatformProduct,
  StockUpdate,
} from '../adapter.interface'

function getAppKey() { return process.env.TIKTOK_APP_KEY ?? '' }
function getAppSecret() { return process.env.TIKTOK_APP_SECRET ?? '' }
function getRedirectUri() { return process.env.TIKTOK_REDIRECT_URI ?? '' }

const AUTH_BASE = 'https://auth.tiktok-shops.com'
const API_BASE = 'https://open-api.tiktokglobalshop.com'

// ─── Helpers ──────────────────────────────────────────────────────────────────

function now(): number {
  return Math.floor(Date.now() / 1000)
}

/**
 * Build the TikTok request signature.
 * base_string = app_secret + path + sorted_params_as_key_value_string + timestamp
 */
function buildSign(
  path: string,
  params: Record<string, string | number>,
  timestamp: number
): string {
  // Exclude sign, app_key, access_token
  const excluded = new Set(['sign', 'app_key', 'access_token'])
  const sorted = Object.entries(params)
    .filter(([k]) => !excluded.has(k))
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}${v}`)
    .join('')

  const base = `${getAppSecret()}${path}${sorted}${timestamp}`
  return createHmac('sha256', getAppSecret()).update(base).digest('hex')
}

async function tiktokGet<T>(
  path: string,
  accessToken: string,
  queryParams: Record<string, string | number> = {}
): Promise<T> {
  const timestamp = now()
  const allParams = { ...queryParams }
  const sign = buildSign(path, allParams, timestamp)

  const qs = new URLSearchParams({
    app_key: getAppKey(),
    access_token: accessToken,
    timestamp: String(timestamp),
    sign,
    ...Object.fromEntries(Object.entries(queryParams).map(([k, v]) => [k, String(v)])),
  })

  const url = `${API_BASE}${path}?${qs.toString()}`
  const res = await fetch(url)
  const body = await res.json() as Record<string, unknown>

  if (!res.ok || (body.code !== 0)) {
    console.error(`[tiktok] GET ${path} error:`, JSON.stringify(body))
    throw new Error(`TikTok API error on ${path}: code=${body.code} msg=${body.message}`)
  }
  return body as T
}

async function tiktokPost<T>(
  path: string,
  accessToken: string,
  payload: Record<string, unknown>,
  queryParams: Record<string, string | number> = {}
): Promise<T> {
  const timestamp = now()
  const allParams = { ...queryParams }
  const sign = buildSign(path, allParams, timestamp)

  const qs = new URLSearchParams({
    app_key: getAppKey(),
    access_token: accessToken,
    timestamp: String(timestamp),
    sign,
    ...Object.fromEntries(Object.entries(queryParams).map(([k, v]) => [k, String(v)])),
  })

  const url = `${API_BASE}${path}?${qs.toString()}`
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  const body = await res.json() as Record<string, unknown>

  if (!res.ok || (body.code !== 0)) {
    console.error(`[tiktok] POST ${path} error:`, JSON.stringify(body))
    throw new Error(`TikTok API error on ${path}: code=${body.code} msg=${body.message}`)
  }
  return body as T
}

// ─── Credentials ──────────────────────────────────────────────────────────────

export interface TikTokCredentials {
  accessToken: string   // encrypted
  refreshToken: string  // encrypted
}

export function encryptCredentials(tokens: { accessToken: string; refreshToken: string }): TikTokCredentials {
  return {
    accessToken: encrypt(tokens.accessToken),
    refreshToken: encrypt(tokens.refreshToken),
  }
}

export function decryptCredentials(creds: TikTokCredentials): { accessToken: string; refreshToken: string } {
  return {
    accessToken: decrypt(creds.accessToken),
    refreshToken: decrypt(creds.refreshToken),
  }
}

function getCredentials(shop: ShopRecord): { accessToken: string; refreshToken: string } {
  const raw = shop.credentialsEncrypted as unknown as TikTokCredentials
  if (!raw?.accessToken || !raw?.refreshToken) {
    throw new Error(`Shop ${shop.id} has no valid TikTok credentials`)
  }
  return decryptCredentials(raw)
}

// ─── Status mapping ────────────────────────────────────────────────────────────

function mapOrderStatus(tiktokStatus: string): string {
  switch (tiktokStatus) {
    case 'UNPAID':
      return 'UNPAID'
    case 'ON_HOLD':
    case 'AWAITING_SHIPMENT':
    case 'PARTIALLY_SHIPPING':
      return 'TO_SHIP'
    case 'SHIPPED':
    case 'AWAITING_COLLECTION':
      return 'SHIPPED'
    case 'COMPLETED':
    case 'DELIVERED':
      return 'COMPLETED'
    case 'CANCELLED':
      return 'CANCELLED'
    default:
      return 'PENDING'
  }
}

// ─── TikTok API response types ─────────────────────────────────────────────────

interface TikTokTokenData {
  access_token: string
  refresh_token: string
  access_token_expire_in: number
  refresh_token_expire_in: number
  open_id: string
  seller_name: string
}

interface TikTokTokenResponse {
  data: TikTokTokenData
  code: number
  message?: string
}

interface TikTokOrderLineItem {
  sku_id: string
  product_name: string
  sku_name?: string
  quantity: number
  sale_price: number
  original_price?: number
}

interface TikTokOrder {
  order_id: string
  status: string
  buyer_name?: string
  recipient_address?: Record<string, unknown>
  currency: string
  line_items?: TikTokOrderLineItem[]
  payment_info?: {
    sub_total?: number
    platform_discount?: number
    seller_discount?: number
    shipping_fee?: number
    platform_commission?: number
    total_amount?: number
  }
  create_time?: number
}

interface TikTokOrderListResponse {
  data: {
    orders: TikTokOrder[]
    total_count: number
    next_page_token?: string
  }
  code: number
  message?: string
}

// ─── Adapter ──────────────────────────────────────────────────────────────────

export class TikTokAdapter implements PlatformAdapter {
  readonly platform = 'TIKTOK' as const

  getAuthUrl(_redirectUri: string, state: string): string {
    const qs = new URLSearchParams({
      app_key: getAppKey(),
      state,
      redirect_uri: getRedirectUri(),
    })
    return `${AUTH_BASE}/oauth/authorize?${qs.toString()}`
  }

  async exchangeCode(code: string, _shopId?: string): Promise<OAuthTokens> {
    const res = await fetch(`${AUTH_BASE}/api/v2/token/get`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ app_key: getAppKey(), auth_code: code, app_secret: getAppSecret() }),
    })
    const body = await res.json() as TikTokTokenResponse

    if (body.code !== 0 || !body.data) {
      throw new Error(`TikTok token exchange failed: code=${body.code} msg=${body.message}`)
    }

    const { data } = body
    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresAt: new Date(Date.now() + data.access_token_expire_in * 1000),
      shopId: data.open_id,
      shopName: data.seller_name,
    }
  }

  async refreshAccessToken(shop: ShopRecord): Promise<OAuthTokens> {
    const { refreshToken } = getCredentials(shop)

    const res = await fetch(`${AUTH_BASE}/api/v2/token/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ app_key: getAppKey(), refresh_token: refreshToken, app_secret: getAppSecret() }),
    })
    const body = await res.json() as TikTokTokenResponse

    if (body.code !== 0 || !body.data) {
      throw new Error(`TikTok token refresh failed: code=${body.code} msg=${body.message}`)
    }

    const { data } = body
    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresAt: new Date(Date.now() + data.access_token_expire_in * 1000),
      shopId: shop.externalShopId,
      shopName: shop.name,
    }
  }

  async syncOrders(shop: ShopRecord, params: SyncOrdersParams): Promise<PlatformOrder[]> {
    const { accessToken } = getCredentials(shop)
    const orders: PlatformOrder[] = []

    let nextPageToken: string | undefined
    let hasMore = true

    while (hasMore) {
      const payload: Record<string, unknown> = {
        page_size: params.pageSize ?? 50,
        sort_field: 'CREATE_TIME',
        sort_type: 'DESC',
        create_time_ge: params.timeFrom,
        create_time_lt: params.timeTo,
      }
      if (nextPageToken) {
        payload.page_token = nextPageToken
      }

      const data = await tiktokPost<TikTokOrderListResponse>(
        '/api/orders/search',
        accessToken,
        payload
      )

      const orderList = data.data?.orders ?? []
      for (const o of orderList) {
        const items: PlatformOrderItem[] = (o.line_items ?? []).map((item) => ({
          platformSkuId: item.sku_id,
          productName: item.product_name,
          skuName: item.sku_name,
          quantity: item.quantity,
          unitPrice: item.original_price ?? item.sale_price,
          discount: (item.original_price ?? item.sale_price) - item.sale_price,
        }))

        const payInfo = o.payment_info ?? {}
        const subtotal = payInfo.sub_total ?? items.reduce((s, i) => s + i.unitPrice * i.quantity, 0)
        const platformDiscount = payInfo.platform_discount ?? 0
        const sellerDiscount = payInfo.seller_discount ?? 0
        const shippingFeeBuyer = payInfo.shipping_fee ?? 0
        const platformCommission = payInfo.platform_commission ?? 0
        const totalRevenue = (payInfo.total_amount ?? 0) - platformCommission

        orders.push({
          platformOrderId: o.order_id,
          status: mapOrderStatus(o.status),
          buyerName: o.buyer_name,
          shippingAddress: o.recipient_address,
          currency: o.currency ?? 'USD',
          subtotal,
          platformDiscount,
          sellerDiscount,
          shippingFeeBuyer,
          shippingFeeSeller: 0,
          platformCommission,
          totalRevenue,
          platformMetadata: o as unknown as Record<string, unknown>,
          items,
          platformCreatedAt: new Date((o.create_time ?? 0) * 1000),
        })
      }

      nextPageToken = data.data?.next_page_token
      hasMore = !!(nextPageToken && orderList.length > 0)
    }

    return orders
  }

  async syncProducts(shop: ShopRecord): Promise<PlatformProduct[]> {
    console.log(`[tiktok] syncProducts not yet implemented for shop ${shop.id}`)
    return []
  }

  async updateStock(shop: ShopRecord, updates: StockUpdate[]): Promise<void> {
    console.log(`[tiktok] updateStock not yet implemented for shop ${shop.id}, ${updates.length} updates queued`)
  }
}
