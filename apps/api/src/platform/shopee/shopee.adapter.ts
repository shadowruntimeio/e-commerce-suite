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

const PARTNER_ID = parseInt(process.env.SHOPEE_PARTNER_ID ?? '0', 10)
const PARTNER_KEY = process.env.SHOPEE_PARTNER_KEY ?? ''
const REDIRECT_URI = process.env.SHOPEE_REDIRECT_URI ?? ''
const IS_TEST = (process.env.SHOPEE_ENV ?? 'test') === 'test'
const BASE_URL = IS_TEST
  ? 'https://partner.test-stable.shopeemobile.com'
  : 'https://partner.shopeemobile.com'

// ─── Helpers ──────────────────────────────────────────────────────────────────

function now(): number {
  return Math.floor(Date.now() / 1000)
}

function signAuth(apiPath: string, timestamp: number): string {
  const base = `${PARTNER_ID}${apiPath}${timestamp}`
  return createHmac('sha256', PARTNER_KEY).update(base).digest('hex')
}

function signShop(apiPath: string, timestamp: number, accessToken: string, shopId: string | number): string {
  const base = `${PARTNER_ID}${apiPath}${timestamp}${accessToken}${shopId}`
  return createHmac('sha256', PARTNER_KEY).update(base).digest('hex')
}

function authQueryString(apiPath: string, timestamp: number): string {
  const sign = signAuth(apiPath, timestamp)
  return `partner_id=${PARTNER_ID}&timestamp=${timestamp}&sign=${sign}`
}

function shopQueryString(apiPath: string, timestamp: number, accessToken: string, shopId: string | number): string {
  const sign = signShop(apiPath, timestamp, accessToken, shopId)
  return `partner_id=${PARTNER_ID}&timestamp=${timestamp}&access_token=${accessToken}&shop_id=${shopId}&sign=${sign}`
}

async function shopeeGet<T>(
  apiPath: string,
  queryParams: string,
  extraQuery: string = ''
): Promise<T> {
  const qs = extraQuery ? `${queryParams}&${extraQuery}` : queryParams
  const url = `${BASE_URL}${apiPath}?${qs}`
  const res = await fetch(url)
  const body = await res.json() as Record<string, unknown>
  if (res.status === 429) {
    const err = new Error(`Shopee rate limit hit: ${apiPath}`) as Error & { retryable: boolean }
    err.retryable = true
    throw err
  }
  if (!res.ok || (body.error && body.error !== '' && body.error !== 'error_none')) {
    console.error(`[shopee] GET ${apiPath} error:`, JSON.stringify(body))
    throw new Error(`Shopee API error on ${apiPath}: ${body.error} — ${body.message}`)
  }
  return body as T
}

async function shopeePost<T>(
  apiPath: string,
  queryParams: string,
  payload: Record<string, unknown>
): Promise<T> {
  const url = `${BASE_URL}${apiPath}?${queryParams}`
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  const body = await res.json() as Record<string, unknown>
  if (res.status === 429) {
    const err = new Error(`Shopee rate limit hit: ${apiPath}`) as Error & { retryable: boolean }
    err.retryable = true
    throw err
  }
  if (!res.ok || (body.error && body.error !== '' && body.error !== 'error_none')) {
    console.error(`[shopee] POST ${apiPath} error:`, JSON.stringify(body))
    throw new Error(`Shopee API error on ${apiPath}: ${body.error} — ${body.message}`)
  }
  return body as T
}

// ─── Token helpers ─────────────────────────────────────────────────────────────

export interface ShopeeCredentials {
  accessToken: string   // encrypted
  refreshToken: string  // encrypted
}

export function encryptCredentials(tokens: { accessToken: string; refreshToken: string }): ShopeeCredentials {
  return {
    accessToken: encrypt(tokens.accessToken),
    refreshToken: encrypt(tokens.refreshToken),
  }
}

export function decryptCredentials(creds: ShopeeCredentials): { accessToken: string; refreshToken: string } {
  return {
    accessToken: decrypt(creds.accessToken),
    refreshToken: decrypt(creds.refreshToken),
  }
}

function getCredentials(shop: ShopRecord): { accessToken: string; refreshToken: string } {
  const raw = shop.credentialsEncrypted as unknown as ShopeeCredentials
  if (!raw?.accessToken || !raw?.refreshToken) {
    throw new Error(`Shop ${shop.id} has no valid credentials`)
  }
  return decryptCredentials(raw)
}

// ─── Status mapping ────────────────────────────────────────────────────────────

function mapOrderStatus(shopeeStatus: string): string {
  switch (shopeeStatus) {
    case 'UNPAID':
      return 'UNPAID'
    case 'READY_TO_SHIP':
    case 'PROCESSED':
    case 'RETRY_SHIP':
      return 'TO_SHIP'
    case 'SHIPPED':
    case 'TO_CONFIRM_RECEIVE':
      return 'SHIPPED'
    case 'COMPLETED':
      return 'COMPLETED'
    case 'CANCELLED':
    case 'IN_CANCEL':
      return 'CANCELLED'
    default:
      return 'PENDING'
  }
}

// ─── Shopee API response types ─────────────────────────────────────────────────

interface ShopeeTokenResponse {
  access_token: string
  refresh_token: string
  expire_in: number
  shop_id: number
  shop_name?: string
  error?: string
  message?: string
}

interface ShopeeOrderListResponse {
  response?: {
    order_list: Array<{ order_sn: string }>
    more: boolean
    next_cursor: string
  }
  error?: string
  message?: string
}

interface ShopeeOrderDetailItem {
  item_id: number
  item_name: string
  model_sku?: string
  model_id: number
  model_quantity_purchased: number
  model_discounted_price: number
  model_original_price: number
  model_name?: string
}

interface ShopeeOrderDetail {
  order_sn: string
  order_status: string
  buyer_username?: string
  recipient_address?: Record<string, unknown>
  currency: string
  item_list: ShopeeOrderDetailItem[]
  total_amount?: number
  actual_shipping_fee?: number
  buyer_service_fee?: number
  commission_fee?: number
  service_fee?: number
  create_time: number
  voucher_from_seller?: number
  voucher_from_shopee?: number
  shipping_carrier?: string
  payment_method?: string
}

interface ShopeeOrderDetailResponse {
  response?: {
    order_list: ShopeeOrderDetail[]
  }
  error?: string
  message?: string
}

// ─── Adapter ──────────────────────────────────────────────────────────────────

export class ShopeeAdapter implements PlatformAdapter {
  readonly platform = 'SHOPEE' as const

  getAuthUrl(redirectUri: string, state: string): string {
    const apiPath = '/api/v2/shop/auth_partner'
    const timestamp = now()
    const sign = signAuth(apiPath, timestamp)
    const qs = new URLSearchParams({
      partner_id: String(PARTNER_ID),
      timestamp: String(timestamp),
      sign,
      redirect: redirectUri,
      state,
    })
    return `${BASE_URL}${apiPath}?${qs.toString()}`
  }

  async exchangeCode(code: string, shopId?: string): Promise<OAuthTokens> {
    const apiPath = '/api/v2/auth/token/get'
    const timestamp = now()
    const qs = authQueryString(apiPath, timestamp)
    const payload: Record<string, unknown> = {
      code,
      partner_id: PARTNER_ID,
    }
    if (shopId) payload.shop_id = parseInt(shopId, 10)

    const data = await shopeePost<ShopeeTokenResponse>(apiPath, qs, payload)

    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresAt: new Date(Date.now() + data.expire_in * 1000),
      shopId: String(data.shop_id),
      shopName: data.shop_name ?? `Shop ${data.shop_id}`,
    }
  }

  async refreshAccessToken(shop: ShopRecord): Promise<OAuthTokens> {
    const { refreshToken } = getCredentials(shop)
    const apiPath = '/api/v2/auth/access_token/get'
    const timestamp = now()
    const qs = authQueryString(apiPath, timestamp)
    const payload = {
      refresh_token: refreshToken,
      shop_id: parseInt(shop.externalShopId, 10),
      partner_id: PARTNER_ID,
    }
    const data = await shopeePost<ShopeeTokenResponse>(apiPath, qs, payload)

    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresAt: new Date(Date.now() + data.expire_in * 1000),
      shopId: String(data.shop_id),
      shopName: shop.name,
    }
  }

  async syncOrders(shop: ShopRecord, params: SyncOrdersParams): Promise<PlatformOrder[]> {
    const { accessToken } = getCredentials(shop)
    const shopId = shop.externalShopId
    const orders: PlatformOrder[] = []

    // Step 1: paginate order list
    const orderSns: string[] = []
    let cursor = params.cursor ?? ''
    let hasMore = true

    while (hasMore) {
      const apiPath = '/api/v2/order/get_order_list'
      const timestamp = now()
      const qs = shopQueryString(apiPath, timestamp, accessToken, shopId)
      const extra = new URLSearchParams({
        time_range_field: params.timeRangeField,
        time_from: String(params.timeFrom),
        time_to: String(params.timeTo),
        page_size: String(params.pageSize ?? 50),
        ...(cursor ? { cursor } : {}),
      }).toString()

      const data = await shopeeGet<ShopeeOrderListResponse>(apiPath, qs, extra)
      const response = data.response
      if (!response) break

      for (const o of response.order_list) {
        orderSns.push(o.order_sn)
      }
      hasMore = response.more
      cursor = response.next_cursor ?? ''
    }

    if (orderSns.length === 0) return []

    // Step 2: fetch details in batches of 50
    const BATCH_SIZE = 50
    for (let i = 0; i < orderSns.length; i += BATCH_SIZE) {
      const batch = orderSns.slice(i, i + BATCH_SIZE)
      const apiPath = '/api/v2/order/get_order_detail'
      const timestamp = now()
      const qs = shopQueryString(apiPath, timestamp, accessToken, shopId)

      const data = await shopeePost<ShopeeOrderDetailResponse>(apiPath, qs, {
        order_sn_list: batch,
        response_optional_fields: [
          'buyer_username',
          'recipient_address',
          'item_list',
          'actual_shipping_fee',
          'buyer_service_fee',
          'commission_fee',
          'service_fee',
          'voucher_from_seller',
          'voucher_from_shopee',
        ],
      })

      const detailList = data.response?.order_list ?? []
      for (const o of detailList) {
        const items: PlatformOrderItem[] = (o.item_list ?? []).map((item) => ({
          platformSkuId: String(item.model_id),
          productName: item.item_name,
          skuName: item.model_name,
          quantity: item.model_quantity_purchased,
          unitPrice: item.model_original_price ?? 0,
          discount: (item.model_original_price ?? 0) - (item.model_discounted_price ?? 0),
        }))

        const subtotal = items.reduce(
          (sum, item) => sum + item.unitPrice * item.quantity,
          0
        )
        const platformDiscount = o.voucher_from_shopee ?? 0
        const sellerDiscount = o.voucher_from_seller ?? 0
        const shippingFeeBuyer = o.actual_shipping_fee ?? 0
        const platformCommission = o.commission_fee ?? 0
        const shippingFeeSeller = o.buyer_service_fee ?? 0
        const totalRevenue = (o.total_amount ?? 0) - platformCommission

        orders.push({
          platformOrderId: o.order_sn,
          status: mapOrderStatus(o.order_status),
          buyerName: o.buyer_username,
          shippingAddress: o.recipient_address,
          currency: o.currency ?? 'USD',
          subtotal,
          platformDiscount,
          sellerDiscount,
          shippingFeeBuyer,
          shippingFeeSeller,
          platformCommission,
          totalRevenue,
          platformMetadata: o as unknown as Record<string, unknown>,
          items,
          platformCreatedAt: new Date(o.create_time * 1000),
        })
      }
    }

    return orders
  }

  async syncProducts(shop: ShopRecord): Promise<PlatformProduct[]> {
    // Product sync is out of scope for Phase 1 — placeholder for adapter completeness
    console.log(`[shopee] syncProducts not yet implemented for shop ${shop.id}`)
    return []
  }

  async updateStock(shop: ShopRecord, updates: StockUpdate[]): Promise<void> {
    // Stock push is out of scope for Phase 1 — placeholder for adapter completeness
    console.log(`[shopee] updateStock not yet implemented for shop ${shop.id}, ${updates.length} updates queued`)
  }
}
