export type InventoryEventType = 'INBOUND' | 'OUTBOUND' | 'TRANSFER_IN' | 'TRANSFER_OUT' | 'ADJUSTMENT' | 'RESERVED' | 'UNRESERVED' | 'RETURN'

export interface StockLevel {
  warehouseSkuId: string
  warehouseId: string
  quantityOnHand: number
  quantityReserved: number
  quantityAvailable: number
}
