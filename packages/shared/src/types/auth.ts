export interface LoginPayload {
  email: string
  password: string
}

export interface RegisterPayload {
  email: string
  password: string
  name: string
  tenantName: string
}

export interface AuthTokens {
  accessToken: string
  refreshToken: string
}

export type UserRole = 'ADMIN' | 'WAREHOUSE_STAFF' | 'MERCHANT'

export type Capability =
  | 'ORDER_VIEW'
  | 'ORDER_PROCESS'
  | 'ORDER_CANCEL'
  | 'INVENTORY_VIEW'
  | 'INVENTORY_ADJUST'
  | 'PO_APPROVE'
  | 'RETURN_INTAKE'

export interface JwtPayload {
  userId: string
  tenantId: string
  role: UserRole
  capabilities: Capability[]
  warehouseScope: string[]
}
