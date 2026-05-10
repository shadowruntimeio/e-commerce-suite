import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export type UserRole = 'ADMIN' | 'WAREHOUSE_STAFF' | 'MERCHANT'
export type Capability =
  | 'ORDER_VIEW'
  | 'ORDER_PROCESS'
  | 'ORDER_CANCEL'
  | 'INVENTORY_VIEW'
  | 'INVENTORY_ADJUST'
  | 'PO_APPROVE'
  | 'RETURN_INTAKE'

export const ALL_CAPABILITIES: Capability[] = [
  'ORDER_VIEW',
  'ORDER_PROCESS',
  'ORDER_CANCEL',
  'INVENTORY_VIEW',
  'INVENTORY_ADJUST',
  'PO_APPROVE',
  'RETURN_INTAKE',
]

interface User {
  id: string
  email: string
  name: string
  role: UserRole
  tenantId: string
  capabilities?: Capability[]
  warehouseScope?: string[]
  settings?: Record<string, unknown>
}

interface AuthState {
  user: User | null
  accessToken: string | null
  refreshToken: string | null
  setAuth: (user: User, accessToken: string, refreshToken: string) => void
  setTokens: (accessToken: string, refreshToken: string) => void
  logout: () => void
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      user: null,
      accessToken: null,
      refreshToken: null,
      setAuth: (user, accessToken, refreshToken) => set({ user, accessToken, refreshToken }),
      setTokens: (accessToken, refreshToken) => set({ accessToken, refreshToken }),
      logout: () => set({ user: null, accessToken: null, refreshToken: null }),
    }),
    { name: 'ems-auth' }
  )
)

export function hasCapability(user: User | null, cap: Capability): boolean {
  if (!user) return false
  if (user.role === 'ADMIN') return true
  if (user.role === 'WAREHOUSE_STAFF') return (user.capabilities ?? []).includes(cap)
  return false
}

export function isAdmin(user: User | null) { return user?.role === 'ADMIN' }
export function isMerchant(user: User | null) { return user?.role === 'MERCHANT' }
export function isWarehouseStaff(user: User | null) { return user?.role === 'WAREHOUSE_STAFF' }
