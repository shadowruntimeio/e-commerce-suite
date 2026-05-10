import { createBrowserRouter, Navigate } from 'react-router-dom'
import { Suspense } from 'react'
import { AppLayout } from './components/layout/AppLayout'
import { AuthLayout } from './components/layout/AuthLayout'
import { AuthGuard } from './components/auth/AuthGuard'
import { RouteErrorBoundary } from './components/RouteErrorBoundary'
import { lazyWithRetry } from './lib/lazy-with-retry'
import { Spin } from 'antd'

const LoginPage = lazyWithRetry(() => import('./modules/auth/LoginPage'))
const RegisterPage = lazyWithRetry(() => import('./modules/auth/RegisterPage'))
const DashboardPage = lazyWithRetry(() => import('./modules/dashboard/DashboardPage'))
const OrdersPage = lazyWithRetry(() => import('./modules/orders/OrdersPage'))
const RulesPage = lazyWithRetry(() => import('./modules/orders/RulesPage'))
const ProductsPage = lazyWithRetry(() => import('./modules/products/ProductsPage'))
const InventoryPage = lazyWithRetry(() => import('./modules/inventory/InventoryPage'))
const InventoryHistoryPage = lazyWithRetry(() => import('./modules/inventory/HistoryPage'))
const InboundShipmentsPage = lazyWithRetry(() => import('./modules/inventory/InboundShipmentsPage'))
const PurchasePage = lazyWithRetry(() => import('./modules/purchase/PurchasePage'))
const RestockingPage = lazyWithRetry(() => import('./modules/purchase/RestockingPage'))
const WarehousesPage = lazyWithRetry(() => import('./modules/warehouses/WarehousesPage'))
const ShopsPage = lazyWithRetry(() => import('./modules/shops/ShopsPage'))
const SalesReportPage = lazyWithRetry(() => import('./modules/reports/SalesReportPage'))
const ProfitReportPage = lazyWithRetry(() => import('./modules/reports/ProfitReportPage'))
const AdsPage = lazyWithRetry(() => import('./modules/ads/AdsPage'))
const InboxPage = lazyWithRetry(() => import('./modules/cs/InboxPage'))
const LogisticsPage = lazyWithRetry(() => import('./modules/logistics/LogisticsPage'))
const AdminUsersPage = lazyWithRetry(() => import('./modules/admin/UsersPage'))
const AdminAuditPage = lazyWithRetry(() => import('./modules/admin/AuditPage'))
const ReturnsPage = lazyWithRetry(() => import('./modules/returns/ReturnsPage'))

const Loading = () => (
  <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh' }}>
    <Spin size="large" />
  </div>
)

export const router = createBrowserRouter([
  {
    path: '/auth',
    element: <AuthLayout />,
    errorElement: <RouteErrorBoundary />,
    children: [
      { path: 'login', element: <Suspense fallback={<Loading />}><LoginPage /></Suspense> },
      { path: 'register', element: <Suspense fallback={<Loading />}><RegisterPage /></Suspense> },
    ],
  },
  {
    path: '/',
    element: <AuthGuard><AppLayout /></AuthGuard>,
    errorElement: <RouteErrorBoundary />,
    children: [
      { index: true, element: <Navigate to="/dashboard" replace /> },
      { path: 'dashboard', element: <Suspense fallback={<Loading />}><DashboardPage /></Suspense> },
      { path: 'orders', element: <Suspense fallback={<Loading />}><OrdersPage /></Suspense> },
      { path: 'orders/rules', element: <Suspense fallback={<Loading />}><RulesPage /></Suspense> },
      { path: 'products', element: <Suspense fallback={<Loading />}><ProductsPage /></Suspense> },
      { path: 'inventory', element: <Suspense fallback={<Loading />}><InventoryPage /></Suspense> },
      { path: 'inventory/history', element: <Suspense fallback={<Loading />}><InventoryHistoryPage /></Suspense> },
      { path: 'inventory/inbound-shipments', element: <Suspense fallback={<Loading />}><InboundShipmentsPage /></Suspense> },
      { path: 'purchase', element: <Suspense fallback={<Loading />}><PurchasePage /></Suspense> },
      { path: 'purchase/restocking', element: <Suspense fallback={<Loading />}><RestockingPage /></Suspense> },
      { path: 'warehouses', element: <Suspense fallback={<Loading />}><WarehousesPage /></Suspense> },
      { path: 'shops', element: <Suspense fallback={<Loading />}><ShopsPage /></Suspense> },
      { path: 'reports/sales', element: <Suspense fallback={<Loading />}><SalesReportPage /></Suspense> },
      { path: 'reports/profit', element: <Suspense fallback={<Loading />}><ProfitReportPage /></Suspense> },
      { path: 'ads', element: <Suspense fallback={<Loading />}><AdsPage /></Suspense> },
      { path: 'cs', element: <Suspense fallback={<Loading />}><InboxPage /></Suspense> },
      { path: 'logistics', element: <Suspense fallback={<Loading />}><LogisticsPage /></Suspense> },
      { path: 'admin/users', element: <Suspense fallback={<Loading />}><AdminUsersPage /></Suspense> },
      { path: 'admin/audit', element: <Suspense fallback={<Loading />}><AdminAuditPage /></Suspense> },
      { path: 'returns', element: <Suspense fallback={<Loading />}><ReturnsPage /></Suspense> },
    ],
  },
  { path: '*', element: <Navigate to="/" replace /> },
])
