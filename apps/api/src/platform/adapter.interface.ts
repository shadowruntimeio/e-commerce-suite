import type { Platform } from '@ems/shared'

// Minimal shop shape required by platform adapters — avoids dependency on generated Prisma types
export interface ShopRecord {
  id: string
  externalShopId: string
  name: string
  credentialsEncrypted: unknown
  tokenExpiresAt: Date | null
}

export interface PlatformAdapter {
  platform: Platform
  // Auth
  getAuthUrl(redirectUri: string, state: string): string
  exchangeCode(code: string, shopId?: string): Promise<OAuthTokens>
  refreshAccessToken(shop: ShopRecord): Promise<OAuthTokens>
  // Data sync
  syncOrders(shop: ShopRecord, params: SyncOrdersParams): Promise<PlatformOrder[]>
  syncProducts(shop: ShopRecord): Promise<PlatformProduct[]>
  updateStock(shop: ShopRecord, updates: StockUpdate[]): Promise<void>
}

export interface OAuthTokens {
  accessToken: string
  refreshToken: string
  expiresAt: Date
  shopId: string
  shopName: string
}

export interface SyncOrdersParams {
  timeRangeField: 'create_time' | 'update_time'
  timeFrom: number  // unix timestamp
  timeTo: number    // unix timestamp
  pageSize?: number
  cursor?: string
}

export interface PlatformOrder {
  platformOrderId: string
  status: string
  buyerName?: string
  buyerPhone?: string
  shippingAddress?: Record<string, unknown>
  currency: string
  subtotal: number
  platformDiscount: number
  sellerDiscount: number
  shippingFeeBuyer: number
  shippingFeeSeller: number
  platformCommission: number
  totalRevenue: number
  platformMetadata: Record<string, unknown>
  items: PlatformOrderItem[]
  platformCreatedAt: Date
}

export interface PlatformOrderItem {
  platformSkuId: string
  sellerSku?: string  // seller-defined SKU code (e.g. "D-1-2"); used for picking
  productName: string
  skuName?: string
  quantity: number
  unitPrice: number
  discount: number
}

export interface PlatformProduct {
  platformItemId: string
  title: string
  status: string
  platformData: Record<string, unknown>
  skus: Array<{
    platformSkuId: string
    price: number
    attributes: Record<string, string>
  }>
}

export interface StockUpdate {
  platformSkuId: string
  stock: number
}
