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

// ─── V202309 Signing ─────────────────────────────────────────────────────────

function now(): number {
  return Math.floor(Date.now() / 1000)
}

/**
 * TikTok Shop V202309 signature.
 * base_string = app_secret + path + sorted_query_params_string + body_string + app_secret
 * V202309: only `sign` and `access_token` are excluded from signature.
 * `app_key` IS included in the signature.
 */
function buildSignV2(
  path: string,
  queryParams: Record<string, string>,
  body?: string,
): string {
  const excluded = new Set(['sign', 'access_token'])
  const sorted = Object.entries(queryParams)
    .filter(([k]) => !excluded.has(k))
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}${v}`)
    .join('')

  const secret = getAppSecret()
  const base = `${secret}${path}${sorted}${body ?? ''}${secret}`
  return createHmac('sha256', secret).update(base).digest('hex')
}

// ─── HTTP helpers (V202309) ──────────────────────────────────────────────────

async function tiktokRequest<T>(
  method: 'GET' | 'POST',
  path: string,
  accessToken: string,
  shopCipher?: string,
  queryParams: Record<string, string> = {},
  body?: Record<string, unknown>,
): Promise<T> {
  const timestamp = String(now())
  const appKey = getAppKey()
  const allQuery: Record<string, string> = {
    ...queryParams,
    app_key: appKey,
    timestamp,
  }
  if (shopCipher) {
    allQuery.shop_cipher = shopCipher
  }

  const bodyStr = method === 'POST' ? (body ? JSON.stringify(body) : '{}') : undefined
  const sign = buildSignV2(path, allQuery, bodyStr)

  const qs = new URLSearchParams({
    ...allQuery,
    sign,
  })

  const url = `${API_BASE}${path}?${qs.toString()}`
  const headers: Record<string, string> = {
    'x-tts-access-token': accessToken,
  }
  if (method === 'POST') {
    headers['Content-Type'] = 'application/json'
  }
  const options: RequestInit = { method, headers }
  if (method === 'POST') {
    options.body = bodyStr
  }

  console.log(`[tiktok] ${method} ${path} → ${url.split('?')[0]}?... (shop_cipher=${shopCipher ? 'yes' : 'no'})`)
  const res = await fetch(url, options)
  const text = await res.text()
  console.log(`[tiktok] ${method} ${path} response (status=${res.status}):`, text.slice(0, 500))

  let parsed: Record<string, unknown>
  try {
    parsed = JSON.parse(text)
  } catch {
    console.error(`[tiktok] ${method} ${path} non-JSON response:`, text.slice(0, 300))
    throw new Error(`TikTok API returned non-JSON on ${path}`)
  }

  if (!res.ok || parsed.code !== 0) {
    throw new Error(`TikTok API error on ${path}: code=${parsed.code} msg=${parsed.message}`)
  }

  return parsed as T
}

// ─── Credentials ──────────────────────────────────────────────────────────────

export interface TikTokCredentials {
  accessToken: string   // encrypted
  refreshToken: string  // encrypted
  shopCipher?: string   // encrypted — needed for V202309 data APIs
}

export function encryptCredentials(tokens: {
  accessToken: string
  refreshToken: string
  shopCipher?: string
}): TikTokCredentials {
  return {
    accessToken: encrypt(tokens.accessToken),
    refreshToken: encrypt(tokens.refreshToken),
    shopCipher: tokens.shopCipher ? encrypt(tokens.shopCipher) : undefined,
  }
}

export function decryptCredentials(creds: TikTokCredentials): {
  accessToken: string
  refreshToken: string
  shopCipher?: string
} {
  return {
    accessToken: decrypt(creds.accessToken),
    refreshToken: decrypt(creds.refreshToken),
    shopCipher: creds.shopCipher ? decrypt(creds.shopCipher) : undefined,
  }
}

function getCredentials(shop: ShopRecord): {
  accessToken: string
  refreshToken: string
  shopCipher?: string
} {
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
    case 'IN_TRANSIT':
    case 'DELIVERED':
      return 'SHIPPED'
    case 'COMPLETED':
      return 'COMPLETED'
    case 'CANCELLED':
      return 'CANCELLED'
    default:
      return 'PENDING'
  }
}

// ─── TikTok V202309 API response types ────────────────────────────────────────

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

interface TikTokShopInfo {
  cipher: string
  code: string
  id: string
  name: string
  region: string
  seller_type: string
}

interface TikTokShopsResponse {
  code: number
  message?: string
  data: { shops: TikTokShopInfo[] }
}

interface TikTokOrderLineItem {
  id: string
  sku_id: string
  product_name: string
  sku_name?: string
  quantity: number
  sale_price: string       // V202309 returns prices as string with minor units
  original_price?: string
  sku_image?: string
}

interface TikTokOrder {
  id: string
  status: string
  buyer_message?: string
  payment_info?: {
    currency: string
    sub_total?: string
    platform_discount?: string
    seller_discount?: string
    shipping_fee?: string
    total_amount?: string
  }
  recipient_address?: {
    full_address?: string
    name?: string
    phone_number?: string
    region_code?: string
  }
  line_items?: TikTokOrderLineItem[]
  create_time?: number
  update_time?: number
}

interface TikTokOrderSearchResponse {
  code: number
  message?: string
  data: {
    orders: TikTokOrder[]
    total_count: number
    next_page_token?: string
  }
}

interface TikTokProductItem {
  id: string
  title: string
  status: string
  create_time?: number
  update_time?: number
  skus?: Array<{
    id: string
    seller_sku?: string
    price: { sale_price?: string; tax_exclusive_price?: string; currency?: string }
    sales_attributes?: Array<{
      id: string
      name: string
      value_id: string
      value_name: string
    }>
    inventory?: Array<{ quantity: number; warehouse_id?: string }>
  }>
}

interface TikTokProductSearchResponse {
  code: number
  message?: string
  data: {
    products: TikTokProductItem[]
    total_count: number
    next_page_token?: string
  }
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

  /**
   * Exchange auth code for tokens, then fetch authorized shops to get shop_cipher.
   * Returns the first authorized shop's cipher and name.
   */
  async exchangeCode(code: string, _shopId?: string): Promise<OAuthTokens & { shopCipher?: string }> {
    // Step 1: Exchange code for access token
    const qs = new URLSearchParams({
      app_key: getAppKey(),
      app_secret: getAppSecret(),
      auth_code: code,
      grant_type: 'authorized_code',
    })
    const url = `${AUTH_BASE}/api/v2/token/get?${qs.toString()}`
    const res = await fetch(url)

    const text = await res.text()
    console.log('[tiktok] token exchange full response:', text)

    let tokenBody: TikTokTokenResponse
    try {
      tokenBody = JSON.parse(text) as TikTokTokenResponse
    } catch {
      throw new Error(`TikTok token endpoint returned non-JSON: ${text.slice(0, 200)}`)
    }

    if (tokenBody.code !== 0 || !tokenBody.data) {
      throw new Error(`TikTok token exchange failed: code=${tokenBody.code} msg=${tokenBody.message}`)
    }

    const { data: tokenData } = tokenBody

    // Step 2: Try to fetch authorized shops to get shop_cipher
    let shopCipher: string | undefined
    let shopId = tokenData.open_id
    let shopName = tokenData.seller_name

    try {
      const shopsData = await this.getAuthorizedShops(tokenData.access_token)
      const shop = shopsData[0]
      if (shop) {
        shopCipher = shop.cipher
        shopId = shop.id || shopId
        shopName = shop.name || shopName
        console.log(`[tiktok] Authorized shop: ${shopName} (cipher=${shopCipher}, region=${shop.region})`)
      }
    } catch (err) {
      console.warn(`[tiktok] Could not fetch authorized shops (may need scope approval): ${(err as Error).message}`)
      console.warn('[tiktok] Shop saved without shop_cipher — data sync will require scope approval in TikTok Partner Center')
    }

    return {
      accessToken: tokenData.access_token,
      refreshToken: tokenData.refresh_token,
      expiresAt: new Date(Date.now() + tokenData.access_token_expire_in * 1000),
      shopId,
      shopName,
      shopCipher,
    }
  }

  /**
   * Call /authorization/202309/shops to get list of shops with their cipher.
   */
  private async getAuthorizedShops(accessToken: string): Promise<TikTokShopInfo[]> {
    const path = '/authorization/202309/shops'
    const timestamp = String(now())
    const appKey = getAppKey()
    const queryParams: Record<string, string> = { app_key: appKey, timestamp }
    const sign = buildSignV2(path, queryParams)

    const qs = new URLSearchParams({
      ...queryParams,
      sign,
    })

    const url = `${API_BASE}${path}?${qs.toString()}`
    console.log('[tiktok] getAuthorizedShops URL:', url)
    console.log('[tiktok] getAuthorizedShops access_token (first 20 chars):', accessToken.slice(0, 20))
    const res = await fetch(url, {
      headers: { 'x-tts-access-token': accessToken },
    })
    const text = await res.text()
    console.log('[tiktok] authorized shops response (status=%d):', res.status, text)

    let body: TikTokShopsResponse
    try {
      body = JSON.parse(text) as TikTokShopsResponse
    } catch {
      throw new Error(`TikTok shops endpoint returned non-JSON: ${text.slice(0, 200)}`)
    }

    if (body.code !== 0 || !body.data?.shops) {
      throw new Error(`TikTok get shops failed: code=${body.code} msg=${body.message}`)
    }

    return body.data.shops
  }

  async refreshAccessToken(shop: ShopRecord): Promise<OAuthTokens> {
    const creds = shop.credentialsEncrypted as unknown as TikTokCredentials
    const { refreshToken } = decryptCredentials(creds)

    const qs = new URLSearchParams({
      app_key: getAppKey(),
      app_secret: getAppSecret(),
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    })
    const url = `${AUTH_BASE}/api/v2/token/refresh?${qs.toString()}`
    const res = await fetch(url)
    const text = await res.text()

    let body: TikTokTokenResponse
    try {
      body = JSON.parse(text) as TikTokTokenResponse
    } catch {
      throw new Error(`TikTok refresh endpoint returned non-JSON: ${text.slice(0, 200)}`)
    }

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

  // ─── Order sync (V202309) ──────────────────────────────────────────────────

  async syncOrders(shop: ShopRecord, params: SyncOrdersParams): Promise<PlatformOrder[]> {
    const { accessToken, shopCipher } = getCredentials(shop)
    console.log(`[tiktok] syncOrders for shop ${shop.id}, shopCipher=${shopCipher ? 'present' : 'MISSING'}`)
    const orders: PlatformOrder[] = []
    const path = '/order/202309/orders/search'

    let nextPageToken: string | undefined
    let hasMore = true

    while (hasMore) {
      const queryParams: Record<string, string> = {
        page_size: String(params.pageSize ?? 20),
      }
      if (nextPageToken) {
        queryParams.page_token = nextPageToken
      }

      // Time filters go in the body
      const body: Record<string, unknown> = {}
      if (params.timeRangeField === 'update_time') {
        body.update_time_ge = params.timeFrom
        body.update_time_lt = params.timeTo
      } else {
        body.create_time_ge = params.timeFrom
        body.create_time_lt = params.timeTo
      }

      const resp = await tiktokRequest<TikTokOrderSearchResponse>(
        'POST',
        path,
        accessToken,
        shopCipher,
        queryParams,
        body,
      )

      const orderList = resp.data?.orders ?? []
      console.log(`[tiktok] Fetched ${orderList.length} orders (total: ${resp.data?.total_count})`)

      for (const o of orderList) {
        if (orderList.length <= 5) {
          console.log(`[tiktok] Raw order:`, JSON.stringify(o).slice(0, 1000))
        }
        orders.push(this.mapOrder(o))
      }

      nextPageToken = resp.data?.next_page_token
      hasMore = !!(nextPageToken && orderList.length > 0)
    }

    return orders
  }

  private mapOrder(o: TikTokOrder): PlatformOrder {
    const items: PlatformOrderItem[] = (o.line_items ?? []).map((item) => {
      const salePrice = parsePrice(item.sale_price)
      const originalPrice = item.original_price ? parsePrice(item.original_price) : salePrice
      return {
        platformSkuId: item.sku_id ?? item.id,
        productName: item.product_name,
        skuName: item.sku_name,
        quantity: item.quantity ?? 1,
        unitPrice: originalPrice,
        discount: originalPrice - salePrice,
      }
    })

    const pay = o.payment_info ?? {} as Partial<NonNullable<TikTokOrder['payment_info']>>
    const currency = pay.currency ?? 'USD'
    const subtotal = parsePrice(pay.sub_total)
    const platformDiscount = parsePrice(pay.platform_discount)
    const sellerDiscount = parsePrice(pay.seller_discount)
    const shippingFeeBuyer = parsePrice(pay.shipping_fee)
    const totalAmount = parsePrice(pay.total_amount)

    return {
      platformOrderId: o.id,
      status: mapOrderStatus(o.status),
      buyerName: o.recipient_address?.name,
      buyerPhone: o.recipient_address?.phone_number,
      shippingAddress: o.recipient_address as Record<string, unknown> | undefined,
      currency,
      subtotal,
      platformDiscount,
      sellerDiscount,
      shippingFeeBuyer,
      shippingFeeSeller: 0,
      platformCommission: 0, // commission info not in search response; can be enriched from order detail
      totalRevenue: totalAmount,
      platformMetadata: o as unknown as Record<string, unknown>,
      items,
      platformCreatedAt: new Date((o.create_time ?? 0) * 1000),
    }
  }

  // ─── Product sync (V202309) ────────────────────────────────────────────────

  async syncProducts(shop: ShopRecord): Promise<PlatformProduct[]> {
    const { accessToken, shopCipher } = getCredentials(shop)
    console.log(`[tiktok] syncProducts for shop ${shop.id}, shopCipher=${shopCipher ? 'present' : 'MISSING'}`)
    const products: PlatformProduct[] = []
    const path = '/product/202309/products/search'

    let nextPageToken: string | undefined
    let hasMore = true

    while (hasMore) {
      const queryParams: Record<string, string> = {
        page_size: '20',
      }
      if (nextPageToken) {
        queryParams.page_token = nextPageToken
      }

      const resp = await tiktokRequest<TikTokProductSearchResponse>(
        'POST',
        path,
        accessToken,
        shopCipher,
        queryParams,
      )

      const productList = resp.data?.products ?? []
      console.log(`[tiktok] Fetched ${productList.length} products (total: ${resp.data?.total_count})`)

      // Fetch detail for each product to get images
      for (const p of productList) {
        let imageUrl: string | undefined
        try {
          const detail = await tiktokRequest<{ code: number; data: Record<string, unknown> }>(
            'GET',
            `/product/202309/products/${p.id}`,
            accessToken,
            shopCipher,
          )
          const images = (detail.data as any)?.main_images as Array<{ urls?: string[] }> | undefined
          imageUrl = images?.[0]?.urls?.[0]
        } catch {
          // product detail may fail for some items, continue without image
        }

        products.push({
          platformItemId: p.id,
          title: p.title,
          status: p.status,
          platformData: { ...p as unknown as Record<string, unknown>, imageUrl },
          skus: (p.skus ?? []).map((sku) => ({
            platformSkuId: sku.id,
            price: parsePrice(sku.price?.sale_price ?? sku.price?.tax_exclusive_price),
            attributes: Object.fromEntries(
              (sku.sales_attributes ?? []).map((a) => [a.name, a.value_name])
            ),
          })),
        })
      }

      nextPageToken = resp.data?.next_page_token
      hasMore = !!(nextPageToken && productList.length > 0)
    }

    return products
  }

  // ─── Shipping label (V202309) ───────────────────────────────────────────────

  async getShippingLabel(
    shop: ShopRecord,
    orderId: string,
    documentType: 'SHIPPING_LABEL' | 'PICK_LIST' | 'PACKING_LIST' = 'SHIPPING_LABEL',
    documentSize: 'A5' | 'A6' = 'A6',
  ): Promise<{ docUrl: string }> {
    const { accessToken, shopCipher } = getCredentials(shop)
    // First get package IDs for this order
    const pkgPath = '/fulfillment/202309/packages/search'
    const pkgResp = await tiktokRequest<{
      code: number
      data: { packages?: Array<{ id: string }> }
    }>(
      'POST', pkgPath, accessToken, shopCipher,
      { page_size: '20' },
      { order_id: orderId },
    )

    const packageId = pkgResp.data?.packages?.[0]?.id
    if (!packageId) {
      throw new Error('No package found for this order — order may not be ready for shipping yet')
    }

    const path = `/fulfillment/202309/packages/${packageId}/shipping_documents`
    const resp = await tiktokRequest<{
      code: number
      data: { doc_url?: string; document_url?: string }
    }>(
      'POST',
      path,
      accessToken,
      shopCipher,
      {},
      { document_type: documentType, document_size: documentSize },
    )

    const docUrl = resp.data?.doc_url ?? resp.data?.document_url
    if (!docUrl) {
      throw new Error('No shipping document URL returned from TikTok')
    }

    return { docUrl }
  }

  async updateStock(shop: ShopRecord, updates: StockUpdate[]): Promise<void> {
    console.log(`[tiktok] updateStock not yet implemented for shop ${shop.id}, ${updates.length} updates queued`)
  }
}

// ─── Utility ──────────────────────────────────────────────────────────────────

/** Parse TikTok price strings (minor units as string, e.g. "1999" = 19.99) to number. */
function parsePrice(value?: string | number): number {
  if (value === undefined || value === null) return 0
  const num = typeof value === 'string' ? Number(value) : value
  if (isNaN(num)) return 0
  // TikTok V202309 returns prices in minor units (cents), convert to major units
  return num / 100
}
