export type InventoryEventType = 'INBOUND' | 'OUTBOUND' | 'TRANSFER_IN' | 'TRANSFER_OUT' | 'ADJUSTMENT' | 'RESERVED' | 'UNRESERVED' | 'RETURN'

export type AdjustmentReason =
  | 'STOCKTAKE_CORRECTION'
  | 'DAMAGE'
  | 'LOSS'
  | 'EXPIRY'
  | 'FOUND'
  | 'SYSTEM_ERROR'
  | 'OTHER'

export const ADJUSTMENT_REASONS: AdjustmentReason[] = [
  'STOCKTAKE_CORRECTION',
  'DAMAGE',
  'LOSS',
  'EXPIRY',
  'FOUND',
  'SYSTEM_ERROR',
  'OTHER',
]

export interface StockLevel {
  warehouseSkuId: string
  warehouseId: string
  quantityOnHand: number
  quantityReserved: number
  quantityAvailable: number
}

export interface StockRow {
  warehouseSkuId: string
  warehouseId: string
  warehouseName: string
  ownerUserId?: string
  ownerName?: string | null
  systemSkuId: string
  skuCode: string
  productName: string
  categoryId: string | null
  categoryName: string | null
  quantityOnHand: number
  quantityReserved: number
  quantityAvailable: number
  reorderPoint: number
  lastEventAt: string | null
}
