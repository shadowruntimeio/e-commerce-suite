import { Navigate } from 'react-router-dom'
import { useAuthStore } from '../../store/auth.store'
import type { ReactNode } from 'react'

export function AuthGuard({ children }: { children: ReactNode }) {
  const accessToken = useAuthStore((s) => s.accessToken)
  if (!accessToken) return <Navigate to="/auth/login" replace />
  return <>{children}</>
}
