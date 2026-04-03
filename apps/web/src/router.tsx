import { createBrowserRouter, Navigate } from 'react-router-dom'
import { lazy, Suspense } from 'react'
import { AppLayout } from './components/layout/AppLayout'
import { AuthLayout } from './components/layout/AuthLayout'
import { AuthGuard } from './components/auth/AuthGuard'
import { Spin } from 'antd'

const LoginPage = lazy(() => import('./modules/auth/LoginPage'))
const RegisterPage = lazy(() => import('./modules/auth/RegisterPage'))
const DashboardPage = lazy(() => import('./modules/dashboard/DashboardPage'))
const OrdersPage = lazy(() => import('./modules/orders/OrdersPage'))
const ProductsPage = lazy(() => import('./modules/products/ProductsPage'))
const InventoryPage = lazy(() => import('./modules/inventory/InventoryPage'))
const PurchasePage = lazy(() => import('./modules/purchase/PurchasePage'))
const WarehousesPage = lazy(() => import('./modules/warehouses/WarehousesPage'))
const ShopsPage = lazy(() => import('./modules/shops/ShopsPage'))

const Loading = () => (
  <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh' }}>
    <Spin size="large" />
  </div>
)

export const router = createBrowserRouter([
  {
    path: '/auth',
    element: <AuthLayout />,
    children: [
      { path: 'login', element: <Suspense fallback={<Loading />}><LoginPage /></Suspense> },
      { path: 'register', element: <Suspense fallback={<Loading />}><RegisterPage /></Suspense> },
    ],
  },
  {
    path: '/',
    element: <AuthGuard><AppLayout /></AuthGuard>,
    children: [
      { index: true, element: <Navigate to="/dashboard" replace /> },
      { path: 'dashboard', element: <Suspense fallback={<Loading />}><DashboardPage /></Suspense> },
      { path: 'orders', element: <Suspense fallback={<Loading />}><OrdersPage /></Suspense> },
      { path: 'products', element: <Suspense fallback={<Loading />}><ProductsPage /></Suspense> },
      { path: 'inventory', element: <Suspense fallback={<Loading />}><InventoryPage /></Suspense> },
      { path: 'purchase', element: <Suspense fallback={<Loading />}><PurchasePage /></Suspense> },
      { path: 'warehouses', element: <Suspense fallback={<Loading />}><WarehousesPage /></Suspense> },
      { path: 'shops', element: <Suspense fallback={<Loading />}><ShopsPage /></Suspense> },
    ],
  },
  { path: '*', element: <Navigate to="/" replace /> },
])
