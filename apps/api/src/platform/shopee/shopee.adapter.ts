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

// ─── Cancellation / shipping label types ───────────────────────────────────────

// Shopee accepts a fixed enum for seller-initiated cancels. Anything else is rejected.
export type ShopeeCancelReason =
  | 'OUT_OF_STOCK'
  | 'CUSTOMER_REQUEST'
  | 'UNDELIVERABLE_AREA'
  | 'COD_NOT_SUPPORTED'

interface ShopeeShippingParameterInfo {
  info_needed?: {
    dropoff?: string[]   // e.g. ["branch_id"] when dropoff is required
    pickup?: string[]    // e.g. ["address_id", "pickup_time_id"] when pickup is required
    non_integrated?: string[]
  }
  dropoff?: {
    branch_list?: Array<{ branch_id: number; region: string; address: string; city: string }>
  }
  pickup?: {
    address_list?: Array<{
      address_id: number
      address: string
      time_slot_list?: Array<{ date: number; time_text: string; pickup_time_id: string }>
    }>
  }
}

interface ShopeeShippingParameterResponse {
  response?: ShopeeShippingParameterInfo
  error?: string
  message?: string
}

interface ShopeeShippingDocumentCreateResponse {
  response?: { result_list?: Array<{ order_sn: string; fail_error?: string; fail_message?: string }> }
  error?: string
  message?: string
}

interface ShopeeShippingDocumentResultResponse {
  response?: { result_list?: Array<{ order_sn: string; status: string; fail_error?: string; fail_message?: string }> }
  error?: string
  message?: string
}

// ─── Product types ────────────────────────────────────────────────────────────

interface ShopeeItemListResponse {
  response?: {
    item: Array<{ item_id: number; item_status: string; update_time: number }>
    total_count: number
    has_next_page: boolean
    next_offset: number
  }
  error?: string
  message?: string
}

interface ShopeeItemBaseInfo {
  item_id: number
  item_name: string
  item_status: string
  has_model: boolean
  price_info?: Array<{ original_price?: number; current_price?: number }>
  stock_info_v2?: { summary_info?: { total_available_stock: number } }
  image?: { image_url_list?: string[] }
  attribute_list?: Array<{ attribute_id: number; attribute_name: string; attribute_value_list?: Array<{ value_id: number; original_value_name: string }> }>
}

interface ShopeeItemBaseInfoResponse {
  response?: { item_list?: ShopeeItemBaseInfo[] }
  error?: string
  message?: string
}

interface ShopeeModelInfo {
  model_id: number
  model_sku?: string
  tier_index?: number[]
  price_info?: Array<{ original_price?: number; current_price?: number }>
  stock_info_v2?: { summary_info?: { total_available_stock: number } }
}

interface ShopeeModelListResponse {
  response?: {
    tier_variation?: Array<{ name: string; option_list: Array<{ option: string }> }>
    model?: ShopeeModelInfo[]
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

  // ─── Product sync ───────────────────────────────────────────────────────────
  // Two-phase: page through get_item_list to collect item_ids, then resolve
  // each item via get_item_base_info (batches of 50) and — for items that
  // have variants — get_model_list per item. Returns one PlatformProduct per
  // listing, with one entry in skus[] for each model (or a synthetic single
  // SKU for items with no variants).
  async syncProducts(shop: ShopRecord): Promise<PlatformProduct[]> {
    const { accessToken } = getCredentials(shop)
    const shopId = shop.externalShopId

    // Collect item_ids
    const itemIds: number[] = []
    let offset = 0
    const PAGE_SIZE = 100
    while (true) {
      const apiPath = '/api/v2/product/get_item_list'
      const timestamp = now()
      const qs = shopQueryString(apiPath, timestamp, accessToken, shopId)
      const extra = new URLSearchParams({
        offset: String(offset),
        page_size: String(PAGE_SIZE),
        item_status: 'NORMAL',
      }).toString()
      const data = await shopeeGet<ShopeeItemListResponse>(apiPath, qs, extra)
      const list = data.response?.item ?? []
      for (const it of list) itemIds.push(it.item_id)
      if (!data.response?.has_next_page) break
      offset = data.response.next_offset
    }
    if (itemIds.length === 0) return []

    // Resolve details — base info in batches of 50, model list per-item only
    // for items where has_model is true.
    const products: PlatformProduct[] = []
    const BATCH_SIZE = 50
    for (let i = 0; i < itemIds.length; i += BATCH_SIZE) {
      const batch = itemIds.slice(i, i + BATCH_SIZE)
      const apiPath = '/api/v2/product/get_item_base_info'
      const timestamp = now()
      const qs = shopQueryString(apiPath, timestamp, accessToken, shopId)
      const extra = new URLSearchParams({ item_id_list: batch.join(',') }).toString()
      const data = await shopeeGet<ShopeeItemBaseInfoResponse>(apiPath, qs, extra)
      for (const item of data.response?.item_list ?? []) {
        const skus: PlatformProduct['skus'] = []
        if (item.has_model) {
          const modelPath = '/api/v2/product/get_model_list'
          const ts2 = now()
          const qs2 = shopQueryString(modelPath, ts2, accessToken, shopId)
          const ex2 = new URLSearchParams({ item_id: String(item.item_id) }).toString()
          const modelData = await shopeeGet<ShopeeModelListResponse>(modelPath, qs2, ex2)
          const tiers = modelData.response?.tier_variation ?? []
          for (const model of modelData.response?.model ?? []) {
            const attrs: Record<string, string> = {}
            ;(model.tier_index ?? []).forEach((optIdx, tierIdx) => {
              const tier = tiers[tierIdx]
              const opt = tier?.option_list?.[optIdx]?.option
              if (tier?.name && opt) attrs[tier.name] = opt
            })
            skus.push({
              platformSkuId: String(model.model_id),
              price: model.price_info?.[0]?.current_price ?? model.price_info?.[0]?.original_price ?? 0,
              attributes: attrs,
            })
          }
        } else {
          // Single-variant item — synthesize one SKU with model_id=0, which is
          // also Shopee's convention for "stock_list with no variants" on
          // update_stock.
          skus.push({
            platformSkuId: '0',
            price: item.price_info?.[0]?.current_price ?? item.price_info?.[0]?.original_price ?? 0,
            attributes: {},
          })
        }
        products.push({
          platformItemId: String(item.item_id),
          title: item.item_name,
          status: item.item_status,
          platformData: item as unknown as Record<string, unknown>,
          skus,
        })
      }
    }
    return products
  }

  // ─── Stock push ─────────────────────────────────────────────────────────────
  // POST /api/v2/product/update_stock — operates on (item_id, model_id) pairs.
  // Callers MUST populate update.platformItemId (we throw otherwise — better
  // than silently no-op'ing). model_id=0 indicates a single-variant item.
  async updateStock(shop: ShopRecord, updates: StockUpdate[]): Promise<void> {
    if (updates.length === 0) return
    const { accessToken } = getCredentials(shop)
    // Group by item_id so one API call updates all models on the same item.
    const byItem = new Map<string, Array<{ model_id: number; normal_stock: number }>>()
    for (const u of updates) {
      if (!u.platformItemId) {
        throw new Error(`Shopee updateStock requires platformItemId (sku=${u.platformSkuId})`)
      }
      const modelId = parseInt(u.platformSkuId, 10) || 0
      const arr = byItem.get(u.platformItemId) ?? []
      arr.push({ model_id: modelId, normal_stock: u.stock })
      byItem.set(u.platformItemId, arr)
    }
    for (const [itemId, stockList] of byItem) {
      const apiPath = '/api/v2/product/update_stock'
      const timestamp = now()
      const qs = shopQueryString(apiPath, timestamp, accessToken, shop.externalShopId)
      await shopeePost<Record<string, unknown>>(apiPath, qs, {
        item_id: parseInt(itemId, 10),
        stock_list: stockList,
      })
    }
  }

  // ─── Cancellation ───────────────────────────────────────────────────────────
  // POST /api/v2/order/cancel_order — seller-initiated cancel. Only allowed
  // before pickup (UNPAID / READY_TO_SHIP). Shopee fixes the reason enum;
  // anything outside the four canonical values is rejected with `error_param`.
  async cancelOrder(
    shop: ShopRecord,
    orderSn: string,
    reason: ShopeeCancelReason = 'OUT_OF_STOCK',
  ): Promise<void> {
    const { accessToken } = getCredentials(shop)
    const apiPath = '/api/v2/order/cancel_order'
    const timestamp = now()
    const qs = shopQueryString(apiPath, timestamp, accessToken, shop.externalShopId)
    await shopeePost<Record<string, unknown>>(apiPath, qs, {
      order_sn: orderSn,
      cancel_reason: reason,
    })
  }

  // ─── Shipping label ─────────────────────────────────────────────────────────
  // Shopee's label flow is 5 steps. We try to be tolerant of orders that are
  // already shipped (skip ship_order if it errors with "logistics_status_*").
  //   1. get_shipping_parameter — discover whether dropoff or pickup is needed
  //      and which fields (branch_id / address_id / pickup_time_id) to send.
  //   2. ship_order               — declare ready-to-ship. Required exactly once
  //      per order. Idempotent in practice (subsequent calls error and we ignore).
  //   3. create_shipping_document — async; queues the PDF generation.
  //   4. get_shipping_document_result — poll READY/PROCESSING/FAILED.
  //   5. download_shipping_document — fetch the actual PDF bytes.
  // Returns a data: URI so the rest of the system (label-proxy, pdf-lib merger)
  // can treat Shopee labels and TikTok labels uniformly.
  async getShippingLabel(
    shop: ShopRecord,
    orderSn: string,
    documentType: 'NORMAL_AIR_WAYBILL' | 'THERMAL_AIR_WAYBILL' = 'THERMAL_AIR_WAYBILL',
  ): Promise<{ docUrl: string }> {
    const { accessToken } = getCredentials(shop)
    const shopId = shop.externalShopId

    // Step 1: shipping parameters
    const paramsPath = '/api/v2/logistics/get_shipping_parameter'
    {
      const timestamp = now()
      const qs = shopQueryString(paramsPath, timestamp, accessToken, shopId)
      const extra = new URLSearchParams({ order_sn: orderSn }).toString()
      const paramsResp = await shopeeGet<ShopeeShippingParameterResponse>(paramsPath, qs, extra)
      const info = paramsResp.response?.info_needed ?? {}

      // Step 2: ship_order — choose dropoff if available (no slot needed),
      // otherwise pick the first pickup slot. We swallow logistics_status_*
      // errors so a re-print of an already-shipped order still works.
      const shipPath = '/api/v2/logistics/ship_order'
      const shipTs = now()
      const shipQs = shopQueryString(shipPath, shipTs, accessToken, shopId)
      const shipPayload: Record<string, unknown> = { order_sn: orderSn }

      if ((info.dropoff ?? []).length > 0) {
        const branch = paramsResp.response?.dropoff?.branch_list?.[0]
        shipPayload.dropoff = branch ? { branch_id: branch.branch_id } : {}
      } else if ((info.pickup ?? []).length > 0) {
        const address = paramsResp.response?.pickup?.address_list?.[0]
        const slot = address?.time_slot_list?.[0]
        shipPayload.pickup = {
          address_id: address?.address_id,
          ...(slot?.pickup_time_id ? { pickup_time_id: slot.pickup_time_id } : {}),
        }
      } else {
        // Non-integrated channels need a tracking number from the seller. We
        // can't auto-fill that, so surface a clearer error.
        shipPayload.non_integrated = {}
      }

      try {
        await shopeePost<Record<string, unknown>>(shipPath, shipQs, shipPayload)
      } catch (err) {
        const m = (err as Error).message
        // Idempotency: ignore "already shipped / wrong status" errors so a
        // re-print works. Surface anything else (auth, bad params, etc.).
        if (!/logistics_status|already.*ship|ship_order_already_shipped/i.test(m)) {
          throw err
        }
        console.log(`[shopee] ship_order skipped for ${orderSn} (already shipped or processed): ${m.slice(0, 200)}`)
      }
    }

    // Step 3: create_shipping_document
    const createPath = '/api/v2/logistics/create_shipping_document'
    {
      const timestamp = now()
      const qs = shopQueryString(createPath, timestamp, accessToken, shopId)
      const createResp = await shopeePost<ShopeeShippingDocumentCreateResponse>(createPath, qs, {
        order_list: [{ order_sn: orderSn, shipping_document_type: documentType }],
      })
      const result = createResp.response?.result_list?.find((r) => r.order_sn === orderSn)
      if (result?.fail_error) {
        throw new Error(`Shopee shipping document create failed: ${result.fail_error} — ${result.fail_message ?? ''}`)
      }
    }

    // Step 4: poll for readiness (Shopee generates async; usually <5s)
    const resultPath = '/api/v2/logistics/get_shipping_document_result'
    const POLL_DELAYS_MS = [1000, 2000, 4000, 6000, 8000]
    let ready = false
    for (const delay of POLL_DELAYS_MS) {
      await new Promise((r) => setTimeout(r, delay))
      const timestamp = now()
      const qs = shopQueryString(resultPath, timestamp, accessToken, shopId)
      const pollResp = await shopeePost<ShopeeShippingDocumentResultResponse>(resultPath, qs, {
        order_list: [{ order_sn: orderSn, shipping_document_type: documentType }],
      })
      const status = pollResp.response?.result_list?.find((r) => r.order_sn === orderSn)?.status
      if (status === 'READY') { ready = true; break }
      if (status === 'FAILED') {
        const r = pollResp.response?.result_list?.find((x) => x.order_sn === orderSn)
        throw new Error(`Shopee shipping document generation failed: ${r?.fail_error ?? 'unknown'} — ${r?.fail_message ?? ''}`)
      }
    }
    if (!ready) throw new Error(`Shopee shipping document not ready after ${POLL_DELAYS_MS.reduce((a, b) => a + b, 0)}ms`)

    // Step 5: download — returns PDF bytes. Encode as data: URI so the
    // existing label-proxy / pdf-lib merging code can consume it the same
    // way it consumes TikTok's signed CDN URL.
    const downloadPath = '/api/v2/logistics/download_shipping_document'
    const timestamp = now()
    const qs = shopQueryString(downloadPath, timestamp, accessToken, shopId)
    const url = `${BASE_URL}${downloadPath}?${qs}`
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        order_list: [{ order_sn: orderSn, shipping_document_type: documentType }],
      }),
    })
    if (!res.ok) {
      throw new Error(`Shopee download_shipping_document returned ${res.status}`)
    }
    const buf = Buffer.from(await res.arrayBuffer())
    // PDF magic header is `%PDF-`. If the response isn't a PDF, surface the
    // JSON error so callers see why.
    if (buf.subarray(0, 5).toString('utf8') !== '%PDF-') {
      throw new Error(`Shopee download_shipping_document non-PDF body: ${buf.subarray(0, 256).toString('utf8')}`)
    }
    return { docUrl: `data:application/pdf;base64,${buf.toString('base64')}` }
  }
}
