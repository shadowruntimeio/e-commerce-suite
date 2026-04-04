import React from 'react'
import { Outlet, useNavigate, useLocation } from 'react-router-dom'
import { Layout, Avatar, Dropdown, Badge, Button, Tooltip } from 'antd'
import {
  DashboardOutlined, ShoppingCartOutlined, AppstoreOutlined,
  InboxOutlined, ShoppingOutlined, ShopOutlined, LogoutOutlined,
  FilterOutlined, AlertOutlined, BarChartOutlined, LineChartOutlined,
  MessageOutlined, TruckOutlined, BellOutlined, FundOutlined,
  MoonOutlined, SunOutlined, TranslationOutlined,
} from '@ant-design/icons'
import { useAuthStore } from '../../store/auth.store'
import { useSettingsStore } from '../../store/settings.store'
import { useTranslation } from 'react-i18next'

const { Sider, Content, Header } = Layout

// ─── Design tokens ────────────────────────────────────────────────────────────
const SIDEBAR_BG = '#0F172A'
const ACTIVE_BG = 'rgba(99,102,241,0.15)'
const ACTIVE_COLOR = '#818CF8'
const MUTED_COLOR = '#94A3B8'
const HOVER_COLOR = '#E2E8F0'
const HOVER_BG = 'rgba(255,255,255,0.05)'
const GROUP_LABEL_COLOR = '#475569'

interface NavItem { key: string; icon: React.ReactNode; labelKey: string }
interface NavGroup { groupKey: string; items: NavItem[] }

const navGroups: NavGroup[] = [
  {
    groupKey: 'overview',
    items: [{ key: '/dashboard', icon: <DashboardOutlined />, labelKey: 'nav.dashboard' }],
  },
  {
    groupKey: 'sales',
    items: [
      { key: '/orders', icon: <ShoppingCartOutlined />, labelKey: 'nav.orders' },
      { key: '/orders/rules', icon: <FilterOutlined />, labelKey: 'nav.rules' },
    ],
  },
  {
    groupKey: 'products',
    items: [
      { key: '/products', icon: <AppstoreOutlined />, labelKey: 'nav.productsMenu' },
      { key: '/inventory', icon: <InboxOutlined />, labelKey: 'nav.inventory' },
    ],
  },
  {
    groupKey: 'supplyChain',
    items: [
      { key: '/purchase', icon: <ShoppingOutlined />, labelKey: 'nav.purchase' },
      { key: '/purchase/restocking', icon: <AlertOutlined />, labelKey: 'nav.restocking' },
    ],
  },
  {
    groupKey: 'analytics',
    items: [
      { key: '/reports/sales', icon: <BarChartOutlined />, labelKey: 'nav.salesReport' },
      { key: '/reports/profit', icon: <LineChartOutlined />, labelKey: 'nav.profitReport' },
    ],
  },
  {
    groupKey: 'channels',
    items: [
      { key: '/shops', icon: <ShopOutlined />, labelKey: 'nav.shops' },
      { key: '/ads', icon: <FundOutlined />, labelKey: 'nav.ads' },
    ],
  },
  {
    groupKey: 'operations',
    items: [
      { key: '/logistics', icon: <TruckOutlined />, labelKey: 'nav.logistics' },
      { key: '/cs', icon: <MessageOutlined />, labelKey: 'nav.inbox' },
    ],
  },
]

const PAGE_TITLE_KEYS: Record<string, string> = {
  '/dashboard': 'pageTitles.dashboard',
  '/orders': 'pageTitles.orders',
  '/orders/rules': 'pageTitles.orderRules',
  '/products': 'pageTitles.products',
  '/inventory': 'pageTitles.inventory',
  '/purchase': 'pageTitles.purchase',
  '/purchase/restocking': 'pageTitles.restocking',
  '/reports/sales': 'pageTitles.salesReport',
  '/reports/profit': 'pageTitles.profitReport',
  '/shops': 'pageTitles.shops',
  '/ads': 'pageTitles.ads',
  '/logistics': 'pageTitles.logistics',
  '/cs': 'pageTitles.inbox',
  '/warehouses': 'pageTitles.warehouses',
}

// ─── SideNavItem ──────────────────────────────────────────────────────────────
function SideNavItem({ icon, label, isActive, onClick }: {
  icon: React.ReactNode; label: string; isActive: boolean; onClick: () => void
}) {
  const [hovered, setHovered] = React.useState(false)
  return (
    <div
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: 'flex', alignItems: 'center', gap: 10,
        padding: '0 12px', height: 40, margin: '1px 8px', borderRadius: 6,
        cursor: 'pointer', userSelect: 'none',
        color: isActive ? ACTIVE_COLOR : hovered ? HOVER_COLOR : MUTED_COLOR,
        background: isActive ? ACTIVE_BG : hovered ? HOVER_BG : 'transparent',
        fontWeight: isActive ? 500 : 400, fontSize: 13.5,
        transition: 'background 0.15s, color 0.15s',
      }}
    >
      <span style={{ fontSize: 16, display: 'flex', alignItems: 'center', flexShrink: 0 }}>{icon}</span>
      <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{label}</span>
      {isActive && <span style={{ width: 4, height: 16, borderRadius: 2, background: ACTIVE_COLOR, flexShrink: 0 }} />}
    </div>
  )
}

// ─── Main ─────────────────────────────────────────────────────────────────────
export function AppLayout() {
  const navigate = useNavigate()
  const location = useLocation()
  const { user, logout } = useAuthStore()
  const { isDark, lang, toggleDark, setLang } = useSettingsStore()
  const { t } = useTranslation()

  const pageTitleKey = PAGE_TITLE_KEYS[location.pathname] ?? 'pageTitles.dashboard'
  const pageTitle = t(pageTitleKey)

  const initials = (user?.name ?? 'U')
    .split(' ').map((w: string) => w[0]).join('').toUpperCase().slice(0, 2)

  return (
    <Layout style={{ minHeight: '100vh', background: 'var(--bg-page)' }}>
      {/* ── Sidebar ── */}
      <Sider
        width={220}
        trigger={null}
        style={{
          position: 'fixed', height: '100vh', left: 0, top: 0, bottom: 0,
          background: SIDEBAR_BG, display: 'flex', flexDirection: 'column',
          zIndex: 100, overflowY: 'auto', overflowX: 'hidden',
        } as React.CSSProperties}
      >
        {/* Logo */}
        <div style={{
          padding: '0 16px', height: 64, display: 'flex', alignItems: 'center', gap: 10,
          borderBottom: '1px solid rgba(255,255,255,0.06)', flexShrink: 0,
        }}>
          <div style={{
            width: 32, height: 32, borderRadius: 8, flexShrink: 0,
            background: 'linear-gradient(135deg, #6366F1 0%, #8B5CF6 100%)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <span style={{ color: '#fff', fontWeight: 700, fontSize: 14, letterSpacing: '-0.5px' }}>EMS</span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            <div style={{ color: '#F1F5F9', fontWeight: 700, fontSize: 15, lineHeight: 1.2, letterSpacing: '-0.3px' }}>EMS</div>
            <div style={{ color: MUTED_COLOR, fontSize: 10, lineHeight: 1.2 }}>E-commerce Suite</div>
          </div>
        </div>

        {/* Nav groups */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '8px 0' }}>
          {navGroups.map((group) => (
            <div key={group.groupKey}>
              <div style={{
                padding: '16px 16px 4px', fontSize: 10, fontWeight: 600,
                letterSpacing: '0.08em', color: GROUP_LABEL_COLOR, userSelect: 'none',
              }}>
                {t(`nav.${group.groupKey}`)}
              </div>
              {group.items.map((item) => (
                <SideNavItem
                  key={item.key}
                  icon={item.icon}
                  label={t(item.labelKey)}
                  isActive={location.pathname === item.key}
                  onClick={() => navigate(item.key)}
                />
              ))}
            </div>
          ))}
        </div>

        {/* User section */}
        <div style={{ flexShrink: 0, borderTop: '1px solid rgba(255,255,255,0.06)', padding: '12px 8px' }}>
          <div style={{
            display: 'flex', alignItems: 'center', gap: 10,
            padding: '8px 10px', borderRadius: 8, background: 'rgba(255,255,255,0.04)',
          }}>
            <Avatar
              size={32}
              style={{ background: 'linear-gradient(135deg, #6366F1 0%, #8B5CF6 100%)', flexShrink: 0, fontSize: 12, fontWeight: 600 }}
            >
              {initials}
            </Avatar>
            <div style={{ flex: 1, overflow: 'hidden' }}>
              <div style={{ color: HOVER_COLOR, fontSize: 13, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', lineHeight: 1.3 }}>
                {user?.name ?? 'User'}
              </div>
              <div style={{ color: MUTED_COLOR, fontSize: 11, lineHeight: 1.3 }}>{t('nav.administrator')}</div>
            </div>
            <Button
              type="text" size="small" icon={<LogoutOutlined />}
              style={{ color: MUTED_COLOR, flexShrink: 0, padding: '0 4px' }}
              title={t('nav.logout')}
              onClick={() => { logout(); navigate('/auth/login') }}
            />
          </div>
        </div>
      </Sider>

      {/* ── Main area ── */}
      <Layout style={{ marginLeft: 220, background: 'var(--bg-page)' }}>
        {/* Header */}
        <Header style={{
          position: 'sticky', top: 0, zIndex: 99,
          background: 'var(--bg-header)',
          height: 64, padding: '0 24px',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          borderBottom: '1px solid var(--border)',
          boxShadow: 'var(--header-shadow)',
        }}>
          <span style={{ fontSize: 18, fontWeight: 600, color: 'var(--text-primary)', letterSpacing: '-0.3px' }}>
            {pageTitle}
          </span>

          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {/* Language toggle */}
            <Tooltip title={t('settings.language')}>
              <Dropdown
                menu={{
                  items: [
                    {
                      key: 'en',
                      label: t('settings.english'),
                      onClick: () => setLang('en'),
                    },
                    {
                      key: 'zh',
                      label: t('settings.chinese'),
                      onClick: () => setLang('zh'),
                    },
                  ],
                  selectedKeys: [lang],
                }}
                placement="bottomRight"
              >
                <button style={{
                  width: 36, height: 36, borderRadius: 8,
                  border: '1px solid var(--border)', display: 'flex',
                  alignItems: 'center', justifyContent: 'center',
                  cursor: 'pointer', background: 'var(--bg-btn)',
                  color: 'var(--text-secondary)',
                }}>
                  <TranslationOutlined style={{ fontSize: 16 }} />
                </button>
              </Dropdown>
            </Tooltip>

            {/* Dark mode toggle */}
            <Tooltip title={isDark ? t('settings.lightMode') : t('settings.darkMode')}>
              <button
                onClick={toggleDark}
                style={{
                  width: 36, height: 36, borderRadius: 8,
                  border: '1px solid var(--border)', display: 'flex',
                  alignItems: 'center', justifyContent: 'center',
                  cursor: 'pointer', background: 'var(--bg-btn)',
                  color: 'var(--text-secondary)',
                }}
              >
                {isDark ? <SunOutlined style={{ fontSize: 16 }} /> : <MoonOutlined style={{ fontSize: 16 }} />}
              </button>
            </Tooltip>

            {/* Notifications */}
            <Badge count={3} size="small" offset={[-2, 2]}>
              <button style={{
                width: 36, height: 36, borderRadius: 8,
                border: '1px solid var(--border)', display: 'flex',
                alignItems: 'center', justifyContent: 'center',
                cursor: 'pointer', background: 'var(--bg-btn)',
                color: 'var(--text-secondary)',
              }}>
                <BellOutlined style={{ fontSize: 16 }} />
              </button>
            </Badge>

            <div style={{ width: 1, height: 24, background: 'var(--border)', margin: '0 4px' }} />

            {/* User chip */}
            <Dropdown
              menu={{
                items: [{
                  key: 'logout',
                  icon: <LogoutOutlined />,
                  label: t('nav.logout'),
                  onClick: () => { logout(); navigate('/auth/login') },
                }],
              }}
              placement="bottomRight"
            >
              <div style={{
                display: 'flex', alignItems: 'center', gap: 8,
                padding: '4px 10px 4px 4px', borderRadius: 8, cursor: 'pointer',
                border: '1px solid var(--border)', background: 'var(--bg-btn)',
              }}>
                <Avatar
                  size={28}
                  style={{ background: 'linear-gradient(135deg, #6366F1 0%, #8B5CF6 100%)', fontSize: 11, fontWeight: 600 }}
                >
                  {initials}
                </Avatar>
                <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-primary)' }}>
                  {user?.name}
                </span>
              </div>
            </Dropdown>
          </div>
        </Header>

        {/* Content */}
        <Content style={{ margin: 24, minHeight: 'calc(100vh - 112px)' }}>
          <Outlet />
        </Content>
      </Layout>
    </Layout>
  )
}
