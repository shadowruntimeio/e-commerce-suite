import { Spin } from 'antd'
import {
  ShoppingCartOutlined, ClockCircleOutlined, DollarOutlined,
  RocketOutlined, ArrowUpOutlined, ArrowDownOutlined,
  ExclamationCircleOutlined, SyncOutlined, WarningOutlined,
  RightOutlined,
} from '@ant-design/icons'
import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer,
} from 'recharts'
import dayjs from 'dayjs'
import { api } from '../../lib/api'

// ─── Design tokens ──────────────────────────────────────────────────────────
const CARD_STYLE: React.CSSProperties = {
  background: 'var(--bg-card)',
  borderRadius: 12,
  border: '1px solid var(--border)',
  boxShadow: 'var(--card-shadow)',
}

// ─── Sample revenue data (30 days) ──────────────────────────────────────────
function generateChartData() {
  const data = []
  const now = dayjs()
  let prevRevenue = 12000
  let prevProfit = 4200
  for (let i = 29; i >= 0; i--) {
    const revDelta = (Math.random() - 0.4) * 2000
    const profDelta = (Math.random() - 0.4) * 600
    prevRevenue = Math.max(6000, prevRevenue + revDelta)
    prevProfit = Math.max(1200, prevProfit + profDelta)
    data.push({
      date: now.subtract(i, 'day').format('MM/DD'),
      revenue: Math.round(prevRevenue),
      profit: Math.round(prevProfit),
    })
  }
  return data
}

const chartData = generateChartData()

// ─── Custom Tooltip ──────────────────────────────────────────────────────────
function ChartTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null
  return (
    <div style={{
      background: '#0F172A',
      borderRadius: 8,
      padding: '10px 14px',
      boxShadow: '0 4px 12px rgba(0,0,0,0.2)',
      fontSize: 12,
    }}>
      <div style={{ color: '#94A3B8', marginBottom: 6, fontWeight: 500 }}>{label}</div>
      <div style={{ color: '#818CF8', marginBottom: 2 }}>
        Revenue: <strong>${payload[0]?.value?.toLocaleString()}</strong>
      </div>
      <div style={{ color: '#34D399' }}>
        Profit: <strong>${payload[1]?.value?.toLocaleString()}</strong>
      </div>
    </div>
  )
}

// ─── KPI Card ────────────────────────────────────────────────────────────────
interface KpiCardProps {
  title: string
  value: string | number
  subtitle: string
  trend?: string
  trendUp?: boolean
  icon: React.ReactNode
  color: string
  borderColor: string
}

function KpiCard({ title, value, subtitle, trend, trendUp, icon, color, borderColor }: KpiCardProps) {
  return (
    <div style={{
      ...CARD_STYLE,
      padding: '20px 20px 18px',
      borderLeft: `3px solid ${borderColor}`,
      display: 'flex',
      flexDirection: 'column',
      gap: 12,
    }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
        <div>
          <div style={{ fontSize: 12, fontWeight: 500, color: 'var(--text-secondary)', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            {title}
          </div>
          <div style={{ fontSize: 28, fontWeight: 700, color: 'var(--text-primary)', lineHeight: 1, letterSpacing: '-0.5px' }}>
            {value}
          </div>
        </div>
        <div style={{
          width: 44,
          height: 44,
          borderRadius: 10,
          background: `${color}1A`,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: color,
          fontSize: 20,
          flexShrink: 0,
        }}>
          {icon}
        </div>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        {trend && (
          <span style={{ display: 'flex', alignItems: 'center', gap: 2, fontSize: 12, fontWeight: 500, color: trendUp ? '#10B981' : '#EF4444' }}>
            {trendUp ? <ArrowUpOutlined /> : <ArrowDownOutlined />}
            {trend}
          </span>
        )}
        <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{subtitle}</span>
      </div>
    </div>
  )
}

// ─── Status pill ─────────────────────────────────────────────────────────────
const STATUS_STYLES: Record<string, { bg: string; color: string }> = {
  UNPAID:      { bg: '#FEE2E2', color: '#DC2626' },
  PENDING:     { bg: '#FEF3C7', color: '#D97706' },
  TO_SHIP:     { bg: '#DBEAFE', color: '#2563EB' },
  SHIPPED:     { bg: '#CFFAFE', color: '#0891B2' },
  COMPLETED:   { bg: '#D1FAE5', color: '#059669' },
  CANCELLED:   { bg: '#F1F5F9', color: '#64748B' },
  AFTER_SALES: { bg: '#EDE9FE', color: '#7C3AED' },
  EXCEPTION:   { bg: '#FEE2E2', color: '#DC2626' },
}

function StatusPill({ status }: { status: string }) {
  const s = STATUS_STYLES[status] ?? { bg: '#F1F5F9', color: '#64748B' }
  return (
    <span style={{
      display: 'inline-flex',
      alignItems: 'center',
      padding: '2px 8px',
      borderRadius: 999,
      fontSize: 11,
      fontWeight: 600,
      background: s.bg,
      color: s.color,
      textTransform: 'uppercase',
      letterSpacing: '0.04em',
    }}>
      {status.replace('_', ' ')}
    </span>
  )
}

// ─── Platform badge ───────────────────────────────────────────────────────────
const PLATFORM_STYLES: Record<string, { bg: string; color: string }> = {
  SHOPEE:  { bg: '#FFF0E6', color: '#F97316' },
  TIKTOK:  { bg: '#F1F5F9', color: '#0F172A' },
  LAZADA:  { bg: '#EEF2FF', color: '#4F46E5' },
  AMAZON:  { bg: '#FEF9C3', color: '#92400E' },
}

function PlatformBadge({ platform }: { platform: string }) {
  const s = PLATFORM_STYLES[platform] ?? { bg: '#F1F5F9', color: '#64748B' }
  return (
    <span style={{
      display: 'inline-flex',
      alignItems: 'center',
      padding: '2px 8px',
      borderRadius: 6,
      fontSize: 11,
      fontWeight: 600,
      background: s.bg,
      color: s.color,
    }}>
      {platform}
    </span>
  )
}

// ─── Action required items ────────────────────────────────────────────────────
const ACTION_ITEMS = [
  { icon: <ExclamationCircleOutlined />, color: '#EF4444', bg: '#FEE2E2', text: 'Orders pending review', count: 0, link: '/orders' },
  { icon: <SyncOutlined />,             color: '#F59E0B', bg: '#FEF3C7', text: 'Ready to ship',         count: 0, link: '/orders' },
  { icon: <WarningOutlined />,          color: '#8B5CF6', bg: '#EDE9FE', text: 'Low stock alerts',      count: 0, link: '/inventory' },
]

// ─── Main component ───────────────────────────────────────────────────────────
export default function DashboardPage() {
  const { data, isLoading } = useQuery({
    queryKey: ['dashboard'],
    queryFn: () => api.get('/dashboard').then((r) => r.data.data),
    refetchInterval: 30_000,
  })

  const { data: recentOrders, isLoading: ordersLoading } = useQuery({
    queryKey: ['orders', { page: 1 }],
    queryFn: () => api.get('/orders', { params: { page: 1, pageSize: 5 } }).then(r => r.data.data),
  })

  if (isLoading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: 320 }}>
        <Spin size="large" />
      </div>
    )
  }

  const actionItems = [
    { ...ACTION_ITEMS[0], count: data?.pendingOrders ?? 0 },
    { ...ACTION_ITEMS[1], count: data?.toShipOrders ?? 0 },
    { ...ACTION_ITEMS[2], count: 0 },
  ]

  const totalActions = actionItems.reduce((s, i) => s + i.count, 0)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>

      {/* ── KPI Row ── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16 }}>
        <KpiCard
          title="Today's Orders"
          value={data?.todayOrdersCount ?? 0}
          subtitle="vs yesterday"
          trend="+12%"
          trendUp={true}
          icon={<ShoppingCartOutlined />}
          color="#6366F1"
          borderColor="#6366F1"
        />
        <KpiCard
          title="Pending Review"
          value={data?.pendingOrders ?? 0}
          subtitle="needs attention"
          icon={<ClockCircleOutlined />}
          color="#F59E0B"
          borderColor="#F59E0B"
        />
        <KpiCard
          title="To Ship"
          value={data?.toShipOrders ?? 0}
          subtitle="awaiting shipment"
          icon={<RocketOutlined />}
          color="#8B5CF6"
          borderColor="#8B5CF6"
        />
        <KpiCard
          title="Today's Revenue"
          value={`$${Number(data?.todayRevenue ?? 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
          subtitle="vs yesterday"
          trend="+8.3%"
          trendUp={true}
          icon={<DollarOutlined />}
          color="#10B981"
          borderColor="#10B981"
        />
      </div>

      {/* ── Charts row ── */}
      <div style={{ display: 'grid', gridTemplateColumns: '65fr 35fr', gap: 16 }}>

        {/* Revenue chart */}
        <div style={{ ...CARD_STYLE, padding: '20px 20px 12px' }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 20 }}>
            <div>
              <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 2 }}>Revenue & Profit</div>
              <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Last 30 days</div>
            </div>
            <div style={{
              fontSize: 12, color: 'var(--text-secondary)', background: 'var(--bg-surface)',
              border: '1px solid var(--border)', borderRadius: 6,
              padding: '4px 10px', fontWeight: 500,
            }}>
              {dayjs().subtract(29, 'day').format('MMM D')} – {dayjs().format('MMM D, YYYY')}
            </div>
          </div>

          {/* Legend */}
          <div style={{ display: 'flex', gap: 16, marginBottom: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--text-secondary)' }}>
              <div style={{ width: 12, height: 3, borderRadius: 2, background: '#6366F1' }} />
              Revenue
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--text-secondary)' }}>
              <div style={{ width: 12, height: 3, borderRadius: 2, background: '#10B981' }} />
              Profit
            </div>
          </div>

          <ResponsiveContainer width="100%" height={220}>
            <AreaChart data={chartData} margin={{ top: 4, right: 4, left: -10, bottom: 0 }}>
              <defs>
                <linearGradient id="colorRevenue" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#6366F1" stopOpacity={0.2} />
                  <stop offset="95%" stopColor="#6366F1" stopOpacity={0} />
                </linearGradient>
                <linearGradient id="colorProfit" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#10B981" stopOpacity={0.2} />
                  <stop offset="95%" stopColor="#10B981" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#F1F5F9" vertical={false} />
              <XAxis
                dataKey="date"
                tick={{ fontSize: 11, fill: '#94A3B8' }}
                tickLine={false}
                axisLine={false}
                interval={5}
              />
              <YAxis
                tick={{ fontSize: 11, fill: '#94A3B8' }}
                tickLine={false}
                axisLine={false}
                tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`}
              />
              <Tooltip content={<ChartTooltip />} cursor={{ stroke: '#E2E8F0', strokeWidth: 1 }} />
              <Area
                type="monotone"
                dataKey="revenue"
                stroke="#6366F1"
                strokeWidth={2}
                fill="url(#colorRevenue)"
                dot={false}
                activeDot={{ r: 4, fill: '#6366F1', strokeWidth: 0 }}
              />
              <Area
                type="monotone"
                dataKey="profit"
                stroke="#10B981"
                strokeWidth={2}
                fill="url(#colorProfit)"
                dot={false}
                activeDot={{ r: 4, fill: '#10B981', strokeWidth: 0 }}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>

        {/* Action required */}
        <div style={{ ...CARD_STYLE, padding: '20px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
            <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--text-primary)' }}>Action Required</div>
            {totalActions > 0 && (
              <span style={{
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                minWidth: 22, height: 22, borderRadius: 999,
                background: '#EF4444', color: '#fff',
                fontSize: 11, fontWeight: 700, padding: '0 6px',
              }}>
                {totalActions}
              </span>
            )}
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {actionItems.map((item, idx) => (
              <Link key={idx} to={item.link} style={{ textDecoration: 'none' }}>
                <div style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 12,
                  padding: '12px',
                  borderRadius: 10,
                  border: '1px solid var(--border)',
                  background: 'var(--bg-surface)',
                  cursor: 'pointer',
                  transition: 'background 0.15s',
                }}>
                  <div style={{
                    width: 36, height: 36, borderRadius: 8,
                    background: item.bg, color: item.color,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 16, flexShrink: 0,
                  }}>
                    {item.icon}
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-primary)' }}>{item.text}</div>
                    <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                      {item.count > 0 ? `${item.count} items` : 'All clear'}
                    </div>
                  </div>
                  <RightOutlined style={{ color: 'var(--text-muted)', fontSize: 11 }} />
                </div>
              </Link>
            ))}
          </div>

          {/* Quick stats */}
          <div style={{ marginTop: 16, padding: '14px', borderRadius: 10, background: 'linear-gradient(135deg, rgba(99,102,241,0.06) 0%, rgba(139,92,246,0.06) 100%)', border: '1px solid rgba(99,102,241,0.12)' }}>
            <div style={{ fontSize: 11, color: '#6366F1', fontWeight: 600, marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
              This Month
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <div>
                <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--text-primary)' }}>{data?.todayOrdersCount ?? 0}</div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>Total Orders</div>
              </div>
              <div>
                <div style={{ fontSize: 18, fontWeight: 700, color: '#10B981' }}>
                  ${Number(data?.todayRevenue ?? 0).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
                </div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>Revenue</div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ── Recent Orders ── */}
      <div style={{ ...CARD_STYLE, padding: '20px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
          <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--text-primary)' }}>Recent Orders</div>
          <Link to="/orders" style={{ fontSize: 13, color: '#6366F1', fontWeight: 500, textDecoration: 'none', display: 'flex', alignItems: 'center', gap: 4 }}>
            View all <RightOutlined style={{ fontSize: 10 }} />
          </Link>
        </div>

        {ordersLoading ? (
          <div style={{ display: 'flex', justifyContent: 'center', padding: '40px 0' }}>
            <Spin />
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--border)' }}>
                  {['Order ID', 'Platform', 'Buyer', 'Status', 'Revenue', 'Time'].map((h) => (
                    <th key={h} style={{ padding: '8px 12px', textAlign: 'left', fontSize: 11, fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em', background: 'var(--bg-surface)', whiteSpace: 'nowrap' }}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {(recentOrders?.items ?? []).slice(0, 5).map((order: any) => (
                  <tr key={order.id} style={{ borderBottom: '1px solid var(--border-light)' }}>
                    <td style={{ padding: '12px', fontFamily: 'monospace', fontSize: 12, color: '#6366F1', fontWeight: 500 }}>
                      {order.platformOrderId}
                    </td>
                    <td style={{ padding: '12px' }}>
                      <PlatformBadge platform={order.shop?.platform ?? ''} />
                    </td>
                    <td style={{ padding: '12px', color: 'var(--text-primary)', fontWeight: 400 }}>
                      {order.buyerName}
                    </td>
                    <td style={{ padding: '12px' }}>
                      <StatusPill status={order.status} />
                    </td>
                    <td style={{ padding: '12px', color: 'var(--text-primary)', fontWeight: 500 }}>
                      ${Number(order.totalRevenue).toFixed(2)}
                    </td>
                    <td style={{ padding: '12px', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                      {dayjs(order.createdAt).format('MM/DD HH:mm')}
                    </td>
                  </tr>
                ))}
                {(recentOrders?.items ?? []).length === 0 && (
                  <tr>
                    <td colSpan={6} style={{ padding: '40px', textAlign: 'center', color: 'var(--text-muted)' }}>
                      No recent orders
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>

    </div>
  )
}
