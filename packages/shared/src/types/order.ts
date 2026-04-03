export type OrderStatus = 'UNPAID' | 'PENDING' | 'TO_SHIP' | 'SHIPPED' | 'COMPLETED' | 'CANCELLED' | 'AFTER_SALES' | 'EXCEPTION'
export type Platform = 'SHOPEE' | 'TIKTOK' | 'LAZADA' | 'AMAZON' | 'MANUAL'

export interface OrderFilters {
  status?: OrderStatus
  shopId?: string
  search?: string
  dateFrom?: string
  dateTo?: string
}
