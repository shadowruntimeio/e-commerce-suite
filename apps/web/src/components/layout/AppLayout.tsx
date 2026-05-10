import React from 'react'
import { Outlet, useNavigate, useLocation } from 'react-router-dom'
import { Layout, Avatar, Dropdown, Tooltip } from 'antd'
import {
  DashboardOutlined, ShoppingCartOutlined, AppstoreOutlined,
  InboxOutlined, ShopOutlined, LogoutOutlined, BankOutlined,
  BarChartOutlined, TruckOutlined,
  MoonOutlined, SunOutlined, TranslationOutlined,
  MenuFoldOutlined, MenuUnfoldOutlined,
  TeamOutlined, AuditOutlined, RollbackOutlined,
} from '@ant-design/icons'
import { useAuthStore, hasCapability, type UserRole, type Capability } from '../../store/auth.store'
import { useSettingsStore } from '../../store/settings.store'
import { useTranslation } from 'react-i18next'

const { Content, Header } = Layout

// ─── Design tokens ────────────────────────────────────────────────────────────
const SIDEBAR_COLLAPSED_W = 80
const SIDEBAR_EXPANDED_W = 256

interface NavItem {
  key: string
  icon: React.ReactNode
  labelKey: string
  // Visible if the user is in `roles` AND (no `caps` OR has at least one cap).
  // ADMIN always passes.
  roles?: UserRole[]
  caps?: Capability[]
}
interface NavGroup { groupKey: string; items: NavItem[]; roles?: UserRole[] }

const navGroups: NavGroup[] = [
  {
    groupKey: 'overview',
    items: [{ key: '/dashboard', icon: <DashboardOutlined />, labelKey: 'nav.dashboard' }],
  },
  {
    groupKey: 'sales',
    items: [
      { key: '/orders', icon: <ShoppingCartOutlined />, labelKey: 'nav.orders', caps: ['ORDER_VIEW'] },
      { key: '/returns', icon: <RollbackOutlined />, labelKey: 'nav.returns' },
    ],
  },
  {
    groupKey: 'products',
    items: [
      { key: '/products', icon: <AppstoreOutlined />, labelKey: 'nav.productsMenu' },
      { key: '/inventory', icon: <InboxOutlined />, labelKey: 'nav.inventory', caps: ['INVENTORY_VIEW'] },
    ],
  },
  {
    groupKey: 'analytics',
    items: [
      { key: '/reports/sales', icon: <BarChartOutlined />, labelKey: 'nav.salesReport', roles: ['ADMIN', 'WAREHOUSE_STAFF'] },
    ],
  },
  {
    groupKey: 'channels',
    items: [
      { key: '/shops', icon: <ShopOutlined />, labelKey: 'nav.shops' },
    ],
  },
  {
    groupKey: 'operations',
    items: [
      { key: '/warehouses', icon: <BankOutlined />, labelKey: 'nav.warehouses', roles: ['ADMIN', 'WAREHOUSE_STAFF'] },
      { key: '/logistics', icon: <TruckOutlined />, labelKey: 'nav.logistics', roles: ['ADMIN', 'WAREHOUSE_STAFF'] },
    ],
  },
  {
    groupKey: 'admin',
    roles: ['ADMIN'],
    items: [
      { key: '/admin/users', icon: <TeamOutlined />, labelKey: 'nav.adminUsers', roles: ['ADMIN'] },
      { key: '/admin/audit', icon: <AuditOutlined />, labelKey: 'nav.adminAudit', roles: ['ADMIN'] },
    ],
  },
]

const PAGE_TITLE_KEYS: Record<string, string> = {
  '/dashboard': 'pageTitles.dashboard',
  '/orders': 'pageTitles.orders',
  '/products': 'pageTitles.products',
  '/inventory': 'pageTitles.inventory',
  '/reports/sales': 'pageTitles.salesReport',
  '/shops': 'pageTitles.shops',
  '/logistics': 'pageTitles.logistics',
  '/warehouses': 'pageTitles.warehouses',
  '/admin/users': 'pageTitles.adminUsers',
  '/admin/audit': 'pageTitles.adminAudit',
  '/returns': 'pageTitles.returns',
}

// ─── SideNavItem ──────────────────────────────────────────────────────────────
function SideNavItem({ icon, label, isActive, onClick, isExpanded }: {
  icon: React.ReactNode; label: string; isActive: boolean; onClick: () => void; isExpanded: boolean
}) {
  const [hovered, setHovered] = React.useState(false)

  const color = isActive
    ? 'var(--sidebar-active-color)'
    : hovered
    ? 'var(--sidebar-hover-color)'
    : 'var(--sidebar-item-color)'

  const bg = isActive
    ? 'var(--sidebar-active-bg)'
    : hovered
    ? 'var(--sidebar-hover-bg)'
    : 'transparent'

  return (
    <div
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: isExpanded ? 12 : 0,
        padding: isExpanded ? '0 16px' : '0',
        justifyContent: isExpanded ? 'flex-start' : 'center',
        height: 42,
        margin: '1px 8px',
        borderRadius: 10,
        cursor: 'pointer',
        userSelect: 'none',
        color,
        background: bg,
        boxShadow: isActive ? 'var(--sidebar-active-shadow)' : 'none',
        fontWeight: isActive ? 600 : 400,
        fontSize: 13.5,
        transition: 'background 0.15s, color 0.15s, box-shadow 0.15s, padding 0.2s, justify-content 0.2s',
        overflow: 'hidden',
        whiteSpace: 'nowrap',
      }}
    >
      <span style={{
        fontSize: 17,
        display: 'flex',
        alignItems: 'center',
        flexShrink: 0,
        transition: 'transform 0.2s',
      }}>
        {icon}
      </span>
      <span style={{
        opacity: isExpanded ? 1 : 0,
        maxWidth: isExpanded ? 160 : 0,
        overflow: 'hidden',
        transition: 'opacity 0.2s, max-width 0.2s',
        whiteSpace: 'nowrap',
      }}>
        {label}
      </span>
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
  const [isPinned, setIsPinned] = React.useState(true)
  const [isHovered, setIsHovered] = React.useState(false)
  const isExpanded = isPinned || isHovered

  const pageTitleKey = PAGE_TITLE_KEYS[location.pathname] ?? 'pageTitles.dashboard'
  const pageTitle = t(pageTitleKey)

  const initials = (user?.name ?? 'U')
    .split(' ').map((w: string) => w[0]).join('').toUpperCase().slice(0, 2)

  const sidebarW = isExpanded ? SIDEBAR_EXPANDED_W : SIDEBAR_COLLAPSED_W

  return (
    <Layout style={{ minHeight: '100vh', background: 'var(--bg-page)' }}>
      {/* ── Sidebar ── */}
      <div
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
        style={{
          position: 'fixed',
          height: '100vh',
          left: 0,
          top: 0,
          bottom: 0,
          width: sidebarW,
          background: 'var(--sidebar-bg)',
          borderRight: '1px solid var(--sidebar-border)',
          display: 'flex',
          flexDirection: 'column',
          zIndex: 100,
          overflowY: 'auto',
          overflowX: 'hidden',
          transition: 'width 0.22s cubic-bezier(0.4,0,0.2,1)',
        } as React.CSSProperties}
      >
        {/* Logo */}
        <div style={{
          padding: '0 16px',
          height: 64,
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          borderBottom: '1px solid var(--sidebar-border)',
          flexShrink: 0,
          overflow: 'hidden',
        }}>
          <div style={{
            width: 40,
            height: 40,
            borderRadius: 12,
            flexShrink: 0,
            background: 'linear-gradient(135deg, #9c48ea 0%, #cc97ff 100%)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            boxShadow: '0 0 16px rgba(204,151,255,0.4)',
          }}>
            <span style={{ color: '#fff', fontWeight: 800, fontSize: 13, letterSpacing: '-0.5px', fontFamily: "'Manrope', sans-serif" }}>E</span>
          </div>
          <div style={{
            opacity: isExpanded ? 1 : 0,
            maxWidth: isExpanded ? 120 : 0,
            overflow: 'hidden',
            transition: 'opacity 0.2s, max-width 0.2s',
            whiteSpace: 'nowrap',
            flex: 1,
          }}>
            <div style={{ color: 'var(--sidebar-title-color)', fontWeight: 800, fontSize: 15, lineHeight: 1.2, letterSpacing: '-0.3px', fontFamily: "'Manrope', sans-serif" }}>EMS</div>
            <div style={{ color: 'var(--sidebar-muted-color)', fontSize: 10, lineHeight: 1.2 }}>E-commerce Suite</div>
          </div>
          {isExpanded && (
            <span
              onClick={() => setIsPinned(!isPinned)}
              title={isPinned ? 'Collapse sidebar' : 'Pin sidebar'}
              style={{
                color: isPinned ? 'var(--sidebar-active-color)' : 'var(--sidebar-muted-color)',
                cursor: 'pointer',
                fontSize: 16,
                flexShrink: 0,
                display: 'flex',
                alignItems: 'center',
                padding: 4,
                borderRadius: 6,
                transition: 'color 0.15s',
              }}
            >
              {isPinned ? <MenuFoldOutlined /> : <MenuUnfoldOutlined />}
            </span>
          )}
        </div>

        {/* Nav groups */}
        <div style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden', padding: '8px 0' }}>
          {navGroups.map((group) => {
            // Filter group by role
            if (group.roles && user && !group.roles.includes(user.role)) return null
            const items = group.items.filter((item) => {
              if (!user) return false
              if (user.role === 'ADMIN') return true
              if (item.roles && !item.roles.includes(user.role)) return false
              // Merchants always pass cap checks — they're scoped to own resources at API.
              if (user.role === 'MERCHANT') return true
              if (item.caps && !item.caps.some((c) => hasCapability(user, c))) return false
              return true
            })
            if (items.length === 0) return null
            return (
              <div key={group.groupKey}>
                <div style={{
                  padding: isExpanded ? '14px 20px 4px' : '14px 0 4px',
                  fontSize: 9,
                  fontWeight: 700,
                  letterSpacing: '0.1em',
                  color: 'var(--sidebar-group-label)',
                  userSelect: 'none',
                  textAlign: isExpanded ? 'left' : 'center',
                  textTransform: 'uppercase',
                  overflow: 'hidden',
                  whiteSpace: 'nowrap',
                  transition: 'padding 0.2s, text-align 0.2s',
                }}>
                  {isExpanded ? t(`nav.${group.groupKey}`) : '·'}
                </div>
                {items.map((item) => (
                  <SideNavItem
                    key={item.key}
                    icon={item.icon}
                    label={t(item.labelKey)}
                    isActive={location.pathname === item.key}
                    onClick={() => navigate(item.key)}
                    isExpanded={isExpanded}
                  />
                ))}
              </div>
            )
          })}
        </div>

        {/* User section */}
        <div style={{
          flexShrink: 0,
          borderTop: '1px solid var(--sidebar-border)',
          padding: '12px 8px',
          overflow: 'hidden',
        }}>
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: isExpanded ? 10 : 0,
            justifyContent: isExpanded ? 'flex-start' : 'center',
            padding: isExpanded ? '8px 10px' : '8px 0',
            borderRadius: 10,
            background: 'var(--sidebar-user-hover-bg)',
            cursor: 'pointer',
            transition: 'padding 0.2s, gap 0.2s',
          }}>
            <Avatar
              size={32}
              style={{
                background: 'linear-gradient(135deg, #9c48ea 0%, #cc97ff 100%)',
                flexShrink: 0,
                fontSize: 12,
                fontWeight: 700,
                boxShadow: '0 0 12px rgba(204,151,255,0.3)',
              }}
            >
              {initials}
            </Avatar>
            <div style={{
              flex: 1,
              overflow: 'hidden',
              opacity: isExpanded ? 1 : 0,
              maxWidth: isExpanded ? 120 : 0,
              transition: 'opacity 0.2s, max-width 0.2s',
              whiteSpace: 'nowrap',
            }}>
              <div style={{ color: 'var(--sidebar-title-color)', fontSize: 13, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', lineHeight: 1.3 }}>
                {user?.name ?? 'User'}
              </div>
              <div style={{ color: 'var(--sidebar-muted-color)', fontSize: 11, lineHeight: 1.3 }}>{user?.role ? t(`nav.role.${user.role}`) : t('nav.administrator')}</div>
            </div>
            {isExpanded && (
              <span
                title={t('nav.logout')}
                onClick={() => { logout(); navigate('/auth/login') }}
                style={{ color: 'var(--sidebar-muted-color)', flexShrink: 0, padding: '0 4px', cursor: 'pointer', fontSize: 14 }}
              >
                <LogoutOutlined />
              </span>
            )}
          </div>
        </div>
      </div>

      {/* ── Main area ── */}
      <Layout style={{ marginLeft: sidebarW, background: 'var(--bg-page)', transition: 'margin-left 0.22s cubic-bezier(0.4,0,0.2,1)' }}>
        {/* Header */}
        <Header style={{
          position: 'sticky',
          top: 0,
          zIndex: 99,
          background: 'var(--bg-header)',
          backdropFilter: 'blur(16px)',
          WebkitBackdropFilter: 'blur(16px)',
          height: 64,
          padding: '0 24px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          borderBottom: '1px solid var(--border-light)',
          boxShadow: 'var(--header-shadow)',
        }}>
          <span style={{
            fontSize: 20,
            fontWeight: 800,
            color: 'var(--header-title)',
            letterSpacing: '-0.3px',
            fontFamily: "'Manrope', sans-serif",
          }}>
            {pageTitle}
          </span>

          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {/* Language toggle */}
            <Tooltip title={t('settings.language')}>
              <Dropdown
                menu={{
                  items: [
                    { key: 'en', label: t('settings.english'), onClick: () => setLang('en') },
                    { key: 'zh', label: t('settings.chinese'), onClick: () => setLang('zh') },
                  ],
                  selectedKeys: [lang],
                }}
                placement="bottomRight"
              >
                <button style={{
                  width: 36, height: 36, borderRadius: 8,
                  border: '1px solid var(--header-btn-border)', display: 'flex',
                  alignItems: 'center', justifyContent: 'center',
                  cursor: 'pointer', background: 'var(--header-btn-bg)',
                  color: 'var(--header-btn-color)',
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
                  border: '1px solid var(--header-btn-border)', display: 'flex',
                  alignItems: 'center', justifyContent: 'center',
                  cursor: 'pointer', background: 'var(--header-btn-bg)',
                  color: 'var(--header-btn-color)',
                }}
              >
                {isDark ? <SunOutlined style={{ fontSize: 16 }} /> : <MoonOutlined style={{ fontSize: 16 }} />}
              </button>
            </Tooltip>

            <div style={{ width: 1, height: 24, background: 'var(--divider)', margin: '0 4px' }} />

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
              trigger={['click']}
            >
              <div style={{
                display: 'inline-flex', alignItems: 'center', gap: 8,
                padding: '4px 12px 4px 4px', borderRadius: 999, cursor: 'pointer',
                background: 'transparent',
                maxWidth: 200,
                userSelect: 'none',
              }}>
                <Avatar
                  size={28}
                  style={{
                    background: 'var(--accent-gradient)',
                    fontSize: 11,
                    fontWeight: 700,
                    flexShrink: 0,
                  }}
                >
                  {initials}
                </Avatar>
                <span style={{
                  fontSize: 13,
                  fontWeight: 500,
                  color: 'var(--header-text)',
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  maxWidth: 140,
                }}>
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
