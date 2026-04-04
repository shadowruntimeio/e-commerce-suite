import { Outlet } from 'react-router-dom'

// Auth pages are full-page two-column layouts — no wrapper needed.
export function AuthLayout() {
  return <Outlet />
}
