import React from 'react'
import { Outlet, useNavigate, useLocation } from 'react-router-dom'
import { Layout, Avatar, Dropdown, Badge, Divider, Typography, Button } from 'antd'
import {
  DashboardOutlined, ShoppingCartOutlined, AppstoreOutlined,
  InboxOutlined, ShoppingOutlined, ShopOutlined, LogoutOutlined,
  FilterOutlined, AlertOutlined, BarChartOutlined, LineChartOutlined,
  MessageOutlined, TruckOutlined, BellOutlined, FundOutlined,
  RocketOutlined,
} from '@ant-design/icons'
import { useAuthStore } from '../../store/auth.store'

const { Sider, Content, Header } = Layout

// ─── Design tokens ────────────────────────────────────────────────────────────
const SIDEBAR_BG = '#0F172A'
const ACTIVE_BG = 'rgba(99,102,241,0.15)'
const ACTIVE_COLOR = '#818CF8'
const MUTED_COLOR = '#94A3B8'
const HOVER_COLOR = '#E2E8F0'
const HOVER_BG = 'rgba(255,255,255,0.05)'
const GROUP_LABEL_COLOR = '#475569'

// ─── Nav structure ────────────────────────────────────────────────────────────
interface NavItem {
  key: string
  icon: React.ReactNode
  label: string
}
interface NavGroup {
  group: string
  items: NavItem[]
}

const navGroups: NavGroup[] = [
  {
    group: 'OVERVIEW',
    items: [
      { key: '/dashboard', icon: <DashboardOutlined />, label: 'Dashboard' },
    ],
  },
  {
    group: 'SALES',
    items: [
      { key: '/orders', icon: <ShoppingCartOutlined />, label: 'Orders' },
      { key: '/orders/rules', icon: <FilterOutlined />, label: 'Rules' },
    ],
  },
  {
    group: 'PRODUCTS',
    items: [
      { key: '/products', icon: <AppstoreOutlined />, label: 'Products' },
      { key: '/inventory', icon: <InboxOutlined />, label: 'Inventory' },
    ],
  },
  {
    group: 'SUPPLY CHAIN',
    items: [
      { key: '/purchase', icon: <ShoppingOutlined />, label: 'Purchase' },
      { key: '/purchase/restocking', icon: <AlertOutlined />, label: 'Restocking' },
    ],
  },
  {
    group: 'ANALYTICS',
    items: [
      { key: '/reports/sales', icon: <BarChartOutlined />, label: 'Sales Report' },
      { key: '/reports/profit', icon: <LineChartOutlined />, label: 'Profit Report' },
    ],
  },
  {
    group: 'CHANNELS',
    items: [
      { key: '/shops', icon: <ShopOutlined />, label: 'Shops' },
      { key: '/ads', icon: <FundOutlined />, label: 'Ads' },
    ],
  },
  {
    group: 'OPERATIONS',
    items: [
      { key: '/logistics', icon: <TruckOutlined />, label: 'Logistics' },
      { key: '/cs', icon: <MessageOutlined />, label: 'Inbox' },
    ],
  },
]

// ─── Page title map ───────────────────────────────────────────────────────────
const PAGE_TITLES: Record<string, string> = {
  '/dashboard': 'Dashboard',
  '/orders': 'Orders',
  '/orders/rules': 'Order Rules',
  '/products': 'Products',
  '/inventory': 'Inventory',
  '/purchase': 'Purchase Orders',
  '/purchase/restocking': 'Restocking',
  '/reports/sales': 'Sales Report',
  '/reports/profit': 'Profit Report',
  '/shops': 'Shops',
  '/ads': 'Ads',
  '/logistics': 'Logistics',
  '/cs': 'Inbox',
  '/warehouses': 'Warehouses',
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const styles = {
  sider: {
    position: 'fixed' as const,
    height: '100vh',
    left: 0,
    top: 0,
    bottom: 0,
    background: SIDEBAR_BG,
    display: 'flex',
    flexDirection: 'column' as const,
    zIndex: 100,
    overflowY: 'auto' as const,
    overflowX: 'hidden' as const,
  },
  logoSection: {
    padding: '0 16px',
    height: 64,
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    borderBottom: '1px solid rgba(255,255,255,0.06)',
    flexShrink: 0,
  },
  logoIcon: {
    width: 32,
    height: 32,
    borderRadius: 8,
    background: 'linear-gradient(135deg, #6366F1 0%, #8B5CF6 100%)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  logoIconText: {
    color: '#fff',
    fontWeight: 700,
    fontSize: 14,
    letterSpacing: '-0.5px',
  },
  logoText: {
    display: 'flex',
    flexDirection: 'column' as const,
    gap: 0,
  },
  logoName: {
    color: '#F1F5F9',
    fontWeight: 700,
    fontSize: 15,
    lineHeight: 1.2,
    letterSpacing: '-0.3px',
  },
  logoSub: {
    color: MUTED_COLOR,
    fontSize: 10,
    lineHeight: 1.2,
    fontWeight: 400,
  },
  navScroll: {
    flex: 1,
    overflowY: 'auto' as const,
    padding: '8px 0',
  },
  groupLabel: {
    padding: '16px 16px 4px',
    fontSize: 10,
    fontWeight: 600,
    letterSpacing: '0.08em',
    color: GROUP_LABEL_COLOR,
    userSelect: 'none' as const,
  },
  navItem: (isActive: boolean, isHovered: boolean): React.CSSProperties => ({
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    padding: '0 12px',
    height: 40,
    margin: '1px 8px',
    borderRadius: 6,
    cursor: 'pointer',
    color: isActive ? ACTIVE_COLOR : HOVER_COLOR,
    background: isActive ? ACTIVE_BG : isHovered ? HOVER_BG : 'transparent',
    fontWeight: isActive ? 500 : 400,
    fontSize: 13.5,
    transition: 'background 0.15s, color 0.15s',
    userSelect: 'none',
  }),
  navIcon: {
    fontSize: 16,
    display: 'flex',
    alignItems: 'center',
    flexShrink: 0,
  },
  navLabel: {
    flex: 1,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap' as const,
  },
  activeIndicator: {
    width: 4,
    height: 16,
    borderRadius: 2,
    background: ACTIVE_COLOR,
    flexShrink: 0,
  },
  bottomSection: {
    flexShrink: 0,
    borderTop: '1px solid rgba(255,255,255,0.06)',
    padding: '12px 8px',
  },
  userCard: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    padding: '8px 10px',
    borderRadius: 8,
    background: 'rgba(255,255,255,0.04)',
  },
  userInfo: {
    flex: 1,
    overflow: 'hidden',
  },
  userName: {
    color: HOVER_COLOR,
    fontSize: 13,
    fontWeight: 500,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap' as const,
    lineHeight: 1.3,
  },
  userRole: {
    color: MUTED_COLOR,
    fontSize: 11,
    lineHeight: 1.3,
  },
  header: {
    position: 'sticky' as const,
    top: 0,
    zIndex: 99,
    background: '#FFFFFF',
    height: 64,
    padding: '0 24px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderBottom: '1px solid #E2E8F0',
    boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
  },
  pageTitle: {
    fontSize: 18,
    fontWeight: 600,
    color: '#0F172A',
    letterSpacing: '-0.3px',
  },
  headerRight: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
  },
  bellBtn: {
    width: 36,
    height: 36,
    borderRadius: 8,
    border: '1px solid #E2E8F0',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    cursor: 'pointer',
    background: '#fff',
    color: '#64748B',
    transition: 'background 0.15s',
  },
  headerDivider: {
    width: 1,
    height: 24,
    background: '#E2E8F0',
    margin: '0 4px',
  },
  headerUserChip: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    padding: '4px 10px 4px 4px',
    borderRadius: 8,
    cursor: 'pointer',
    border: '1px solid #E2E8F0',
    background: '#fff',
    transition: 'background 0.15s',
  },
  content: {
    margin: '24px',
    minHeight: 'calc(100vh - 112px)',
  },
}

// ─── NavItem with hover state ─────────────────────────────────────────────────
function SideNavItem({ item, isActive, onClick }: { item: NavItem; isActive: boolean; onClick: () => void }) {
  const [hovered, setHovered] = React.useState(false)
  return (
    <div
      style={styles.navItem(isActive, hovered)}
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <span style={{ ...styles.navIcon, color: isActive ? ACTIVE_COLOR : hovered ? HOVER_COLOR : MUTED_COLOR }}>
        {item.icon}
      </span>
      <span style={styles.navLabel}>{item.label}</span>
      {isActive && <span style={styles.activeIndicator} />}
    </div>
  )
}

// ─── Main component ───────────────────────────────────────────────────────────
export function AppLayout() {
  const navigate = useNavigate()
  const location = useLocation()
  const { user, logout } = useAuthStore()

  const pageTitle = PAGE_TITLES[location.pathname] ?? 'EMS'

  const initials = (user?.name ?? 'U')
    .split(' ')
    .map((w: string) => w[0])
    .join('')
    .toUpperCase()
    .slice(0, 2)

  return (
    <Layout style={{ minHeight: '100vh' }}>
      {/* ── Sidebar ── */}
      <Sider width={220} style={styles.sider as React.CSSProperties} trigger={null}>
        {/* Logo */}
        <div style={styles.logoSection}>
          <div style={styles.logoIcon}>
            <span style={styles.logoIconText}>EMS</span>
          </div>
          <div style={styles.logoText}>
            <div style={styles.logoName}>EMS</div>
            <div style={styles.logoSub}>E-commerce Suite</div>
          </div>
        </div>

        {/* Nav groups */}
        <div style={styles.navScroll}>
          {navGroups.map((group) => (
            <div key={group.group}>
              <div style={styles.groupLabel}>{group.group}</div>
              {group.items.map((item) => (
                <SideNavItem
                  key={item.key}
                  item={item}
                  isActive={location.pathname === item.key}
                  onClick={() => navigate(item.key)}
                />
              ))}
            </div>
          ))}
        </div>

        {/* Bottom user section */}
        <div style={styles.bottomSection}>
          <div style={styles.userCard}>
            <Avatar
              size={32}
              style={{ background: 'linear-gradient(135deg, #6366F1 0%, #8B5CF6 100%)', flexShrink: 0, fontSize: 12, fontWeight: 600 }}
            >
              {initials}
            </Avatar>
            <div style={styles.userInfo}>
              <div style={styles.userName}>{user?.name ?? 'User'}</div>
              <div style={styles.userRole}>Administrator</div>
            </div>
            <Button
              type="text"
              size="small"
              icon={<LogoutOutlined />}
              style={{ color: MUTED_COLOR, flexShrink: 0, padding: '0 4px' }}
              title="Logout"
              onClick={() => { logout(); navigate('/auth/login') }}
            />
          </div>
        </div>
      </Sider>

      {/* ── Main content area ── */}
      <Layout style={{ marginLeft: 220 }}>
        {/* Header */}
        <Header style={styles.header}>
          <span style={styles.pageTitle}>{pageTitle}</span>

          <div style={styles.headerRight}>
            <Badge count={3} size="small" offset={[-2, 2]}>
              <div style={styles.bellBtn}>
                <BellOutlined style={{ fontSize: 16 }} />
              </div>
            </Badge>

            <div style={styles.headerDivider} />

            <Dropdown
              menu={{
                items: [
                  {
                    key: 'logout',
                    icon: <LogoutOutlined />,
                    label: 'Logout',
                    onClick: () => { logout(); navigate('/auth/login') },
                  },
                ],
              }}
              placement="bottomRight"
            >
              <div style={styles.headerUserChip}>
                <Avatar
                  size={28}
                  style={{ background: 'linear-gradient(135deg, #6366F1 0%, #8B5CF6 100%)', fontSize: 11, fontWeight: 600 }}
                >
                  {initials}
                </Avatar>
                <Typography.Text style={{ fontSize: 13, fontWeight: 500, color: '#0F172A' }}>
                  {user?.name}
                </Typography.Text>
              </div>
            </Dropdown>
          </div>
        </Header>

        {/* Page content */}
        <Content style={styles.content}>
          <Outlet />
        </Content>
      </Layout>
    </Layout>
  )
}
