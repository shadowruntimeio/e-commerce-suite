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

function tkLog(line: string) {
  console.log(line)
}

function getEnvAppKey() { return process.env.TIKTOK_APP_KEY ?? '' }
function getEnvAppSecret() { return process.env.TIKTOK_APP_SECRET ?? '' }
function getRedirectUri() { return process.env.TIKTOK_REDIRECT_URI ?? '' }

export interface TikTokAppCreds {
  appKey: string
  appSecret: string
}

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
  body: string | undefined,
  appSecret: string,
): string {
  const excluded = new Set(['sign', 'access_token'])
  const sorted = Object.entries(queryParams)
    .filter(([k]) => !excluded.has(k))
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}${v}`)
    .join('')

  const base = `${appSecret}${path}${sorted}${body ?? ''}${appSecret}`
  return createHmac('sha256', appSecret).update(base).digest('hex')
}

// ─── HTTP helpers (V202309) ──────────────────────────────────────────────────

// TikTok transient error codes that are safe to retry.
const TIKTOK_RETRYABLE_CODES = new Set([36009007]) // 36009007 = Request timeout

async function tiktokRequestOnce<T>(
  method: 'GET' | 'POST',
  path: string,
  accessToken: string,
  shopCipher: string | undefined,
  queryParams: Record<string, string>,
  body: Record<string, unknown> | undefined,
  appCreds: TikTokAppCreds,
): Promise<T> {
  const timestamp = String(now())
  const allQuery: Record<string, string> = {
    ...queryParams,
    app_key: appCreds.appKey,
    timestamp,
  }
  if (shopCipher) {
    allQuery.shop_cipher = shopCipher
  }

  const bodyStr = method === 'POST' ? (body ? JSON.stringify(body) : '{}') : undefined
  const sign = buildSignV2(path, allQuery, bodyStr, appCreds.appSecret)

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

  tkLog(`[tiktok] ${method} ${path} → ${url.split('?')[0]}?... (shop_cipher=${shopCipher ? 'yes' : 'no'})`)
  const res = await fetch(url, options)
  const text = await res.text()
  tkLog(`[tiktok] ${method} ${path} response (status=${res.status}): ${text.slice(0, 500)}`)

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

async function tiktokRequest<T>(
  method: 'GET' | 'POST',
  path: string,
  accessToken: string,
  shopCipher: string | undefined,
  queryParams: Record<string, string>,
  body: Record<string, unknown> | undefined,
  appCreds: TikTokAppCreds,
): Promise<T> {
  const delays = [0, 800, 2000]
  let lastErr: unknown
  for (let attempt = 0; attempt < delays.length; attempt++) {
    if (delays[attempt] > 0) {
      await new Promise((r) => setTimeout(r, delays[attempt]))
      console.log(`[tiktok] retry ${attempt}/${delays.length - 1} on ${path}`)
    }
    try {
      return await tiktokRequestOnce<T>(method, path, accessToken, shopCipher, queryParams, body, appCreds)
    } catch (err) {
      lastErr = err
      const msg = err instanceof Error ? err.message : String(err)
      const codeMatch = msg.match(/code=(\d+)/)
      const code = codeMatch ? Number(codeMatch[1]) : null
      if (code == null || !TIKTOK_RETRYABLE_CODES.has(code)) throw err
    }
  }
  throw lastErr
}

export type TikTokDocumentType =
  | 'SHIPPING_LABEL'
  | 'PACKING_SLIP'
  | 'SHIPPING_LABEL_AND_PACKING_SLIP'
  | 'SHIPPING_LABEL_PICTURE'
  | 'HAZMAT_LABEL'
  | 'INVOICE_LABEL'

// TikTok error 21042104 means "documents can't be printed before shipped".
// Code in main flow catches this to auto-arrange shipping via TLA.
class NotShippedError extends Error {}
function isNotShippedError(err: unknown): boolean {
  if (err instanceof NotShippedError) return true
  const msg = err instanceof Error ? err.message : String(err)
  return msg.includes('21042104') || msg.includes("couldn't be printed before shipped")
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
    case 'AWAITING_COLLECTION':  // label printed, waiting for courier pickup — still "to ship" from our POV
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
  seller_sku?: string
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
  private readonly appCreds: TikTokAppCreds

  /**
   * Construct an adapter scoped to a merchant's TikTok app credentials.
   * If omitted, falls back to TIKTOK_APP_KEY / TIKTOK_APP_SECRET env vars
   * (kept for backwards compat with shops created before per-merchant
   * apps were configurable).
   */
  constructor(appCreds?: TikTokAppCreds) {
    this.appCreds = appCreds ?? { appKey: getEnvAppKey(), appSecret: getEnvAppSecret() }
  }

  getAuthUrl(_redirectUri: string, state: string): string {
    const qs = new URLSearchParams({
      app_key: this.appCreds.appKey,
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
      app_key: this.appCreds.appKey,
      app_secret: this.appCreds.appSecret,
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
      // TikTok returns access_token_expire_in as a Unix timestamp (seconds),
      // not a duration — convert directly to ms.
      expiresAt: new Date(tokenData.access_token_expire_in * 1000),
      shopId,
      shopName,
      shopCipher,
    }
  }

  /**
   * Re-fetch the shop_cipher for a shop whose stored credentials are missing it.
   * Returns the cipher for the shop matching `externalShopId`, or undefined if no match.
   */
  async fetchShopCipher(accessToken: string, externalShopId: string): Promise<string | undefined> {
    const shops = await this.getAuthorizedShops(accessToken)
    const match = shops.find((s) => s.id === externalShopId) ?? shops[0]
    return match?.cipher
  }

  /**
   * Call /authorization/202309/shops to get list of shops with their cipher.
   */
  private async getAuthorizedShops(accessToken: string): Promise<TikTokShopInfo[]> {
    const path = '/authorization/202309/shops'
    const timestamp = String(now())
    const queryParams: Record<string, string> = { app_key: this.appCreds.appKey, timestamp }
    const sign = buildSignV2(path, queryParams, undefined, this.appCreds.appSecret)

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
      app_key: this.appCreds.appKey,
      app_secret: this.appCreds.appSecret,
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
      // access_token_expire_in is a Unix timestamp (seconds), not a duration.
      expiresAt: new Date(data.access_token_expire_in * 1000),
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
        this.appCreds,
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
        sellerSku: item.seller_sku,
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
        undefined,
        this.appCreds,
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
            {},
            undefined,
            this.appCreds,
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

  // ─── Shipping label (V202309, TLA flow) ─────────────────────────────────────
  // If the package isn't in a shippable state yet, auto-run the TLA chain:
  // warehouses → shipping_services → buy_shipping_label → retry documents.

  async getShippingLabel(
    shop: ShopRecord,
    orderId: string,
    // TikTok V202309 valid values (verified via API error):
    //   SHIPPING_LABEL, PACKING_SLIP, SHIPPING_LABEL_AND_PACKING_SLIP,
    //   SHIPPING_LABEL_PICTURE, HAZMAT_LABEL, INVOICE_LABEL
    documentType: TikTokDocumentType = 'SHIPPING_LABEL_AND_PACKING_SLIP',
    documentSize: 'A5' | 'A6' = 'A6',
    packageIdHint?: string,
  ): Promise<{ docUrl: string }> {
    tkLog(`[tiktok] ===== getShippingLabel start: order=${orderId} type=${documentType} size=${documentSize} hint=${packageIdHint ?? 'none'} =====`)

    let packageId: string | null = packageIdHint ?? null

    try {
      if (!packageId) throw new NotShippedError('No package ID provided — will arrange shipping')
      return await this.fetchShippingDocument(shop, packageId, documentType, documentSize)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      if (!isNotShippedError(err)) {
        tkLog(`[tiktok] non-recoverable label error for order ${orderId}: ${msg}`)
        throw err
      }

      tkLog(`[tiktok] >>> TLA recovery START for order ${orderId} (trigger: ${msg.slice(0, 200)})`)
      const arranged = await this.arrangeShippingTLA(shop, orderId, packageId)
      if (arranged.packageId) packageId = arranged.packageId
      if (!packageId) throw new Error('TLA arranged but no package ID available — cannot fetch label')
      tkLog(`[tiktok] <<< TLA recovery DONE for order ${orderId}, waiting for state update then retrying`)

      // TikTok takes a moment to transition the package state after /ship.
      // Poll shipping_documents with backoff (1s, 3s, 6s) before giving up.
      const delays = [1000, 3000, 6000]
      let lastErr: unknown
      for (const d of delays) {
        await new Promise((r) => setTimeout(r, d))
        try {
          return await this.fetchShippingDocument(shop, packageId, documentType, documentSize)
        } catch (e) {
          lastErr = e
          const em = e instanceof Error ? e.message : String(e)
          tkLog(`[tiktok] post-arrange retry after ${d}ms still failing: ${em.slice(0, 160)}`)
          if (!isNotShippedError(e)) throw e
        }
      }
      throw lastErr
    }
  }

  private async fetchShippingDocument(
    shop: ShopRecord,
    packageId: string,
    documentType: string,
    documentSize: string,
  ): Promise<{ docUrl: string }> {
    const { accessToken, shopCipher } = getCredentials(shop)
    const resp = await tiktokRequest<{
      code: number
      data: { doc_url?: string; document_url?: string }
    }>(
      'GET',
      `/fulfillment/202309/packages/${packageId}/shipping_documents`,
      accessToken, shopCipher,
      { document_type: documentType, document_size: documentSize },
      undefined,
      this.appCreds,
    )
    const docUrl = resp.data?.doc_url ?? resp.data?.document_url
    if (!docUrl) throw new Error('No shipping document URL returned from TikTok')
    return { docUrl }
  }

  /**
   * Advance a package from TO_FULFILL to a shippable state via V202309
   * `POST /fulfillment/202309/packages/{id}/ship`. Tries DROP_OFF first
   * (simplest — no pickup slot needed); falls back to PICKUP with the first
   * available handover slot if the seller isn't set up for drop-off.
   */
  private async arrangeShippingTLA(
    shop: ShopRecord,
    orderId: string,
    knownPackageId?: string | null,
  ): Promise<{ packageId?: string }> {
    const { accessToken, shopCipher } = getCredentials(shop)
    if (!knownPackageId) {
      throw new Error(`Cannot arrange shipping: no package_id available for order ${orderId}. Re-sync the order to populate package metadata.`)
    }

    const shipPath = `/fulfillment/202309/packages/${knownPackageId}/ship`

    try {
      const dropResp = await tiktokRequest<{ code: number; data: unknown }>(
        'POST', shipPath, accessToken, shopCipher, {},
        { handover_method: 'DROP_OFF' },
        this.appCreds,
      )
      tkLog(`[tiktok] DROP_OFF ship ok for package ${knownPackageId}: ${JSON.stringify(dropResp).slice(0, 300)}`)
      return { packageId: knownPackageId }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      tkLog(`[tiktok] DROP_OFF ship failed, falling back to PICKUP: ${msg.slice(0, 200)}`)
    }

    const slotsResp = await tiktokRequest<{
      code: number
      data: { pickup_slots?: Array<{ start_time?: number; end_time?: number; slot_id?: string }> }
    }>(
      'GET', `/fulfillment/202309/packages/${knownPackageId}/handover_time_slots`,
      accessToken, shopCipher, {}, undefined, this.appCreds,
    )
    const slot = slotsResp.data?.pickup_slots?.[0]
    if (!slot) throw new Error('No pickup slot available and DROP_OFF was rejected — check shop pickup settings')
    tkLog(`[tiktok] Picked pickup slot: ${JSON.stringify(slot)}`)

    const pickupResp = await tiktokRequest<{ code: number; data: unknown }>(
      'POST', shipPath, accessToken, shopCipher, {},
      {
        handover_method: 'PICKUP',
        pickup_slot: {
          start_time: slot.start_time,
          end_time: slot.end_time,
          ...(slot.slot_id ? { slot_id: slot.slot_id } : {}),
        },
      },
      this.appCreds,
    )
    tkLog(`[tiktok] PICKUP ship ok for package ${knownPackageId}: ${JSON.stringify(pickupResp).slice(0, 300)}`)
    return { packageId: knownPackageId }
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
