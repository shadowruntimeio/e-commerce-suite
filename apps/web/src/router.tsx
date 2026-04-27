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
const RulesPage = lazy(() => import('./modules/orders/RulesPage'))
const ProductsPage = lazy(() => import('./modules/products/ProductsPage'))
const InventoryPage = lazy(() => import('./modules/inventory/InventoryPage'))
const InventoryHistoryPage = lazy(() => import('./modules/inventory/HistoryPage'))
const PurchasePage = lazy(() => import('./modules/purchase/PurchasePage'))
const RestockingPage = lazy(() => import('./modules/purchase/RestockingPage'))
const WarehousesPage = lazy(() => import('./modules/warehouses/WarehousesPage'))
const ShopsPage = lazy(() => import('./modules/shops/ShopsPage'))
const SalesReportPage = lazy(() => import('./modules/reports/SalesReportPage'))
const ProfitReportPage = lazy(() => import('./modules/reports/ProfitReportPage'))
const AdsPage = lazy(() => import('./modules/ads/AdsPage'))
const InboxPage = lazy(() => import('./modules/cs/InboxPage'))
const LogisticsPage = lazy(() => import('./modules/logistics/LogisticsPage'))
const AdminUsersPage = lazy(() => import('./modules/admin/UsersPage'))
const AdminAuditPage = lazy(() => import('./modules/admin/AuditPage'))
const ReturnsPage = lazy(() => import('./modules/returns/ReturnsPage'))

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
      { path: 'orders/rules', element: <Suspense fallback={<Loading />}><RulesPage /></Suspense> },
      { path: 'products', element: <Suspense fallback={<Loading />}><ProductsPage /></Suspense> },
      { path: 'inventory', element: <Suspense fallback={<Loading />}><InventoryPage /></Suspense> },
      { path: 'inventory/history', element: <Suspense fallback={<Loading />}><InventoryHistoryPage /></Suspense> },
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
