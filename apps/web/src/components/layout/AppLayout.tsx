import { Outlet, useNavigate, useLocation } from 'react-router-dom'
import { Layout, Menu, Avatar, Dropdown, Typography } from 'antd'
import {
  DashboardOutlined, ShoppingCartOutlined, AppstoreOutlined,
  InboxOutlined, ShoppingOutlined, BankOutlined, ShopOutlined, UserOutlined, LogoutOutlined,
  FilterOutlined, AlertOutlined, BarChartOutlined, LineChartOutlined, MessageOutlined, TruckOutlined,
} from '@ant-design/icons'
import { useAuthStore } from '../../store/auth.store'

const { Sider, Content, Header } = Layout

const menuItems = [
  { key: '/dashboard', icon: <DashboardOutlined />, label: 'Dashboard' },
  {
    key: 'orders-group',
    icon: <ShoppingCartOutlined />,
    label: 'Orders',
    children: [
      { key: '/orders', label: 'All Orders' },
      { key: '/orders/rules', icon: <FilterOutlined />, label: 'Rules' },
    ],
  },
  { key: '/products', icon: <AppstoreOutlined />, label: 'Products' },
  { key: '/inventory', icon: <InboxOutlined />, label: 'Inventory' },
  {
    key: 'purchase-group',
    icon: <ShoppingOutlined />,
    label: 'Purchase',
    children: [
      { key: '/purchase', label: 'Purchase Orders' },
      { key: '/purchase/restocking', icon: <AlertOutlined />, label: 'Restocking' },
    ],
  },
  { key: '/warehouses', icon: <BankOutlined />, label: 'Warehouses' },
  { key: '/shops', icon: <ShopOutlined />, label: 'Shops' },
  {
    key: 'reports-group',
    icon: <BarChartOutlined />,
    label: 'Reports',
    children: [
      { key: '/reports/sales', label: 'Sales Report' },
      { key: '/reports/profit', label: 'Profit Report' },
    ],
  },
  { key: '/ads', icon: <LineChartOutlined />, label: 'Ads' },
  { key: '/cs', icon: <MessageOutlined />, label: 'Inbox' },
  { key: '/logistics', icon: <TruckOutlined />, label: 'Logistics' },
]

export function AppLayout() {
  const navigate = useNavigate()
  const location = useLocation()
  const { user, logout } = useAuthStore()

  return (
    <Layout style={{ minHeight: '100vh' }}>
      <Sider theme="dark" width={220} style={{ position: 'fixed', height: '100vh', left: 0, top: 0, bottom: 0 }}>
        <div style={{ padding: '20px 24px', borderBottom: '1px solid rgba(255,255,255,0.1)' }}>
          <Typography.Text strong style={{ color: '#fff', fontSize: 18 }}>EMS</Typography.Text>
        </div>
        <Menu
          theme="dark"
          mode="inline"
          selectedKeys={[location.pathname]}
          defaultOpenKeys={['orders-group', 'purchase-group', 'reports-group']}
          items={menuItems}
          onClick={({ key }) => { if (!key.endsWith('-group')) navigate(key) }}
          style={{ borderRight: 0, marginTop: 8 }}
        />
      </Sider>
      <Layout style={{ marginLeft: 220 }}>
        <Header style={{ background: '#fff', padding: '0 24px', display: 'flex', alignItems: 'center', justifyContent: 'flex-end', borderBottom: '1px solid #f0f0f0' }}>
          <Dropdown menu={{ items: [
            { key: 'logout', icon: <LogoutOutlined />, label: 'Logout', onClick: () => { logout(); navigate('/auth/login') } }
          ]}}>
            <span style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8 }}>
              <Avatar icon={<UserOutlined />} size="small" />
              <Typography.Text>{user?.name}</Typography.Text>
            </span>
          </Dropdown>
        </Header>
        <Content style={{ margin: 24, minHeight: 'calc(100vh - 112px)' }}>
          <Outlet />
        </Content>
      </Layout>
    </Layout>
  )
}
