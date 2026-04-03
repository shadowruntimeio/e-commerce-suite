import { Outlet, useNavigate, useLocation } from 'react-router-dom'
import { Layout, Menu, Avatar, Dropdown, Typography } from 'antd'
import {
  DashboardOutlined, ShoppingCartOutlined, AppstoreOutlined,
  InboxOutlined, ShoppingOutlined, BankOutlined, ShopOutlined, UserOutlined, LogoutOutlined
} from '@ant-design/icons'
import { useAuthStore } from '../../store/auth.store'

const { Sider, Content, Header } = Layout

const menuItems = [
  { key: '/dashboard', icon: <DashboardOutlined />, label: 'Dashboard' },
  { key: '/orders', icon: <ShoppingCartOutlined />, label: 'Orders' },
  { key: '/products', icon: <AppstoreOutlined />, label: 'Products' },
  { key: '/inventory', icon: <InboxOutlined />, label: 'Inventory' },
  { key: '/purchase', icon: <ShoppingOutlined />, label: 'Purchase' },
  { key: '/warehouses', icon: <BankOutlined />, label: 'Warehouses' },
  { key: '/shops', icon: <ShopOutlined />, label: 'Shops' },
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
          items={menuItems}
          onClick={({ key }) => navigate(key)}
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
