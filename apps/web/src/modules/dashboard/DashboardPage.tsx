import { Spin } from 'antd'
import {
  ShoppingCartOutlined, ClockCircleOutlined, DollarOutlined,
  ShopOutlined, ArrowUpOutlined, ArrowDownOutlined,
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

// ─── Build a gap-filled 30-day series from API rows ───────────────────────────
function buildChartData(rows: Array<{ date: string; revenue: number; profit: number }> | undefined) {
  const byDate = new Map(rows?.map((r) => [r.date, r]) ?? [])
  const now = dayjs()
  const out = []
  for (let i = 29; i >= 0; i--) {
    const d = now.subtract(i, 'day')
    const key = d.format('YYYY-MM-DD')
    const row = byDate.get(key)
    out.push({
      date: d.format('MM/DD'),
      revenue: row ? Math.round(row.revenue) : 0,
      profit: row ? Math.round(row.profit) : 0,
    })
  }
  return out
}

// ─── Custom Tooltip ───────────────────────────────────────────────────────────
function ChartTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null
  return (
    <div style={{
      background: 'var(--bg-surface)',
      borderRadius: 10,
      padding: '10px 14px',
      border: '1px solid var(--border)',
      boxShadow: 'var(--card-shadow)',
      fontSize: 12,
    }}>
      <div style={{ color: 'var(--text-secondary)', marginBottom: 6, fontWeight: 500 }}>{label}</div>
      <div style={{ color: 'var(--accent-primary)', marginBottom: 2 }}>
        Revenue: <strong>${payload[0]?.value?.toLocaleString()}</strong>
      </div>
      <div style={{ color: '#10b981' }}>
        Profit: <strong>${payload[1]?.value?.toLocaleString()}</strong>
      </div>
    </div>
  )
}

// ─── KPI Card ─────────────────────────────────────────────────────────────────
interface KpiCardProps {
  title: string
  value: string | number
  subtitle: string
  trend?: string
  trendUp?: boolean
  icon: React.ReactNode
  accentColor: string
}

function KpiCard({ title, value, subtitle, trend, trendUp, icon, accentColor }: KpiCardProps) {
  return (
    <div style={{
      background: 'var(--kpi-bg)',
      backdropFilter: 'var(--kpi-backdrop)',
      WebkitBackdropFilter: 'var(--kpi-backdrop)',
      border: 'var(--kpi-border)',
      borderRadius: 16,
      boxShadow: 'var(--kpi-shadow)',
      padding: '24px',
      position: 'relative',
      overflow: 'hidden',
    }}>
      {/* Ambient blob */}
      <div style={{
        position: 'absolute',
        top: 0,
        right: 0,
        width: 128,
        height: 128,
        background: `${accentColor}1a`,
        filter: 'blur(60px)',
        borderRadius: '50%',
        pointerEvents: 'none',
      }} />

      {/* Top: icon + trend */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 20, position: 'relative' }}>
        <div style={{
          width: 44,
          height: 44,
          borderRadius: 12,
          background: `${accentColor}1a`,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: accentColor,
          fontSize: 20,
        }}>
          {icon}
        </div>
        {trend && (
          <span style={{
            display: 'flex', alignItems: 'center', gap: 3,
            fontSize: 11, fontWeight: 600,
            color: trendUp ? 'var(--badge-success-fg)' : 'var(--badge-error-fg)',
            background: trendUp ? 'var(--badge-success-bg)' : 'var(--badge-error-bg)',
            border: `1px solid ${trendUp ? 'var(--badge-success-fg)' : 'var(--badge-error-fg)'}22`,
            borderRadius: 999, padding: '2px 8px',
          }}>
            {trendUp ? <ArrowUpOutlined /> : <ArrowDownOutlined />}
            {trend}
          </span>
        )}
      </div>

      <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 6, fontWeight: 500, position: 'relative' }}>{title}</div>
      <div style={{
        fontSize: 32,
        fontWeight: 900,
        color: 'var(--text-primary)',
        lineHeight: 1.1,
        fontFamily: "'Manrope', sans-serif",
        letterSpacing: '-0.02em',
        position: 'relative',
      }}>
        {value}
      </div>
      <div style={{ marginTop: 8, fontSize: 12, color: 'var(--text-muted)', position: 'relative' }}>{subtitle}</div>
    </div>
  )
}

// ─── Status pill ──────────────────────────────────────────────────────────────
const STATUS_BADGE: Record<string, { bg: string; fg: string }> = {
  UNPAID:      { bg: 'var(--badge-error-bg)',   fg: 'var(--badge-error-fg)' },
  PENDING:     { bg: 'var(--badge-warning-bg)', fg: 'var(--badge-warning-fg)' },
  TO_SHIP:     { bg: 'var(--badge-info-bg)',    fg: 'var(--badge-info-fg)' },
  SHIPPED:     { bg: 'var(--badge-info-bg)',    fg: 'var(--badge-info-fg)' },
  COMPLETED:   { bg: 'var(--badge-success-bg)', fg: 'var(--badge-success-fg)' },
  CANCELLED:   { bg: 'var(--badge-neutral-bg)', fg: 'var(--badge-neutral-fg)' },
  AFTER_SALES: { bg: 'var(--badge-purple-bg)',  fg: 'var(--badge-purple-fg)' },
  EXCEPTION:   { bg: 'var(--badge-error-bg)',   fg: 'var(--badge-error-fg)' },
}

function StatusPill({ status }: { status: string }) {
  const s = STATUS_BADGE[status] ?? { bg: 'var(--badge-neutral-bg)', fg: 'var(--badge-neutral-fg)' }
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center',
      padding: '2px 8px', borderRadius: 999, fontSize: 11, fontWeight: 600,
      background: s.bg, color: s.fg,
      textTransform: 'uppercase', letterSpacing: '0.04em',
    }}>
      {status.replace('_', ' ')}
    </span>
  )
}

// ─── Platform badge ───────────────────────────────────────────────────────────
function PlatformBadge({ platform }: { platform: string }) {
  const map: Record<string, { bg: string; color: string }> = {
    SHOPEE: { bg: '#FF6633', color: '#fff' },
    TIKTOK: { bg: '#0F172A', color: '#fff' },
    LAZADA: { bg: '#0F146D', color: '#fff' },
    AMAZON: { bg: '#f59e0b', color: '#fff' },
  }
  const s = map[platform] ?? { bg: 'var(--badge-neutral-bg)', color: 'var(--badge-neutral-fg)' }
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center',
      padding: '2px 8px', borderRadius: 6, fontSize: 11, fontWeight: 600,
      background: s.bg, color: s.color,
    }}>
      {platform}
    </span>
  )
}

// ─── Action required items ────────────────────────────────────────────────────
const ACTION_ITEMS = [
  { icon: <ExclamationCircleOutlined />, accentColor: 'var(--badge-error-fg)',   text: 'Orders pending review', count: 0, link: '/orders' },
  { icon: <SyncOutlined />,             accentColor: 'var(--badge-warning-fg)', text: 'Ready to ship',         count: 0, link: '/orders' },
  { icon: <WarningOutlined />,          accentColor: 'var(--accent-primary)',    text: 'Low stock alerts',      count: 0, link: '/inventory' },
]

// ─── Main component ───────────────────────────────────────────────────────────
export default function DashboardPage() {
  const { data, isLoading } = useQuery({
    queryKey: ['dashboard'],
    queryFn: () => api.get('/dashboard').then((r) => r.data.data),
    refetchInterval: 30_000,
  })

  const { data: chartRows } = useQuery({
    queryKey: ['dashboard-stats'],
    queryFn: () => api.get('/reports/dashboard-stats').then((r) => r.data.data),
    refetchInterval: 60_000,
  })

  const chartData = buildChartData(chartRows)

  const { data: recentOrders, isLoading: ordersLoading } = useQuery({
    queryKey: ['orders', { page: 1 }],
    queryFn: () => api.get('/orders', { params: { page: 1, pageSize: 5 } }).then(r => r.data.data),
  })

  const fmtTrend = (pct: number | null | undefined): string | undefined =>
    pct == null ? undefined : `${pct >= 0 ? '+' : ''}${pct.toFixed(1)}%`

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
          title="Today's Revenue"
          value={`$${Number(data?.todayRevenue ?? 0).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`}
          subtitle="vs yesterday"
          trend={fmtTrend(data?.revenueTrendPct)}
          trendUp={(data?.revenueTrendPct ?? 0) >= 0}
          icon={<DollarOutlined />}
          accentColor="#cc97ff"
        />
        <KpiCard
          title="Today's Orders"
          value={data?.todayOrdersCount ?? 0}
          subtitle="vs yesterday"
          trend={fmtTrend(data?.ordersTrendPct)}
          trendUp={(data?.ordersTrendPct ?? 0) >= 0}
          icon={<ShoppingCartOutlined />}
          accentColor="#53ddfc"
        />
        <KpiCard
          title="Pending Review"
          value={data?.pendingOrders ?? 0}
          subtitle="needs attention"
          icon={<ClockCircleOutlined />}
          accentColor="#ff6daf"
        />
        <KpiCard
          title="To Ship"
          value={data?.toShipOrders ?? 0}
          subtitle="awaiting shipment"
          icon={<ShopOutlined />}
          accentColor="#f59e0b"
        />
      </div>

      {/* ── Charts row ── */}
      <div style={{ display: 'grid', gridTemplateColumns: '65fr 35fr', gap: 16 }}>

        {/* Revenue chart */}
        <div style={{
          background: 'var(--kpi-bg)',
          backdropFilter: 'var(--kpi-backdrop)',
          WebkitBackdropFilter: 'var(--kpi-backdrop)',
          border: 'var(--kpi-border)',
          borderRadius: 16,
          boxShadow: 'var(--kpi-shadow)',
          padding: '24px 24px 12px',
        }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 20 }}>
            <div>
              <div style={{
                fontSize: 16,
                fontWeight: 700,
                color: 'var(--text-primary)',
                marginBottom: 4,
                fontFamily: "'Manrope', sans-serif",
              }}>Revenue & Profit</div>
              <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Last 30 days</div>
            </div>
            <div style={{
              fontSize: 12, color: 'var(--text-secondary)',
              background: 'var(--bg-surface-alt)',
              border: '1px solid var(--border-light)',
              borderRadius: 8,
              padding: '4px 10px', fontWeight: 500,
            }}>
              {dayjs().subtract(29, 'day').format('MMM D')} – {dayjs().format('MMM D, YYYY')}
            </div>
          </div>

          {/* Legend */}
          <div style={{ display: 'flex', gap: 16, marginBottom: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--text-secondary)' }}>
              <div style={{ width: 12, height: 3, borderRadius: 2, background: 'var(--accent-primary)' }} />
              Revenue
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--text-secondary)' }}>
              <div style={{ width: 12, height: 3, borderRadius: 2, background: '#10b981' }} />
              Profit
            </div>
          </div>

          <ResponsiveContainer width="100%" height={220}>
            <AreaChart data={chartData} margin={{ top: 4, right: 4, left: -10, bottom: 0 }}>
              <defs>
                <linearGradient id="colorRevenue" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#cc97ff" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="#cc97ff" stopOpacity={0} />
                </linearGradient>
                <linearGradient id="colorProfit" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#10b981" stopOpacity={0.25} />
                  <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(128,128,160,0.12)" vertical={false} />
              <XAxis
                dataKey="date"
                tick={{ fontSize: 11, fill: 'var(--text-muted)' } as any}
                tickLine={false}
                axisLine={false}
                interval={5}
              />
              <YAxis
                tick={{ fontSize: 11, fill: 'var(--text-muted)' } as any}
                tickLine={false}
                axisLine={false}
                tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`}
              />
              <Tooltip content={<ChartTooltip />} cursor={{ stroke: 'rgba(128,128,160,0.15)', strokeWidth: 1 }} />
              <Area
                type="monotone"
                dataKey="revenue"
                stroke="#cc97ff"
                strokeWidth={2}
                fill="url(#colorRevenue)"
                dot={false}
                activeDot={{ r: 4, fill: '#cc97ff', strokeWidth: 0 }}
              />
              <Area
                type="monotone"
                dataKey="profit"
                stroke="#10b981"
                strokeWidth={2}
                fill="url(#colorProfit)"
                dot={false}
                activeDot={{ r: 4, fill: '#10b981', strokeWidth: 0 }}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>

        {/* Action required */}
        <div style={{
          background: 'var(--kpi-bg)',
          backdropFilter: 'var(--kpi-backdrop)',
          WebkitBackdropFilter: 'var(--kpi-backdrop)',
          border: 'var(--kpi-border)',
          borderRadius: 16,
          boxShadow: 'var(--kpi-shadow)',
          padding: '24px',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
            <div style={{
              fontSize: 16,
              fontWeight: 700,
              color: 'var(--text-primary)',
              fontFamily: "'Manrope', sans-serif",
            }}>Action Required</div>
            {totalActions > 0 && (
              <span style={{
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                minWidth: 22, height: 22, borderRadius: 999,
                background: 'var(--badge-error-fg)', color: '#fff',
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
                  borderRadius: 12,
                  border: '1px solid var(--border-light)',
                  background: 'var(--bg-surface)',
                  cursor: 'pointer',
                  transition: 'background 0.15s, border-color 0.15s',
                }}>
                  <div style={{
                    width: 36, height: 36, borderRadius: 10,
                    background: 'var(--bg-surface-alt)',
                    color: item.accentColor,
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
          <div style={{
            marginTop: 16, padding: '14px', borderRadius: 12,
            background: 'var(--tab-active-bg)',
            border: 'var(--tab-active-border)',
          }}>
            <div style={{
              fontSize: 11, color: 'var(--tab-active-fg)', fontWeight: 700, marginBottom: 8,
              textTransform: 'uppercase', letterSpacing: '0.08em',
            }}>
              This Month
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <div>
                <div style={{
                  fontSize: 20, fontWeight: 800, color: 'var(--text-primary)',
                  fontFamily: "'Manrope', sans-serif",
                }}>{data?.thisMonthOrdersCount ?? 0}</div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>Total Orders</div>
              </div>
              <div>
                <div style={{
                  fontSize: 20, fontWeight: 800, color: 'var(--badge-success-fg)',
                  fontFamily: "'Manrope', sans-serif",
                }}>
                  ${Number(data?.thisMonthRevenue ?? 0).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
                </div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>Revenue</div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ── Recent Orders ── */}
      <div style={{
        background: 'var(--kpi-bg)',
        backdropFilter: 'var(--kpi-backdrop)',
        WebkitBackdropFilter: 'var(--kpi-backdrop)',
        border: 'var(--kpi-border)',
        borderRadius: 16,
        boxShadow: 'var(--kpi-shadow)',
        padding: '24px',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
          <div style={{
            fontSize: 16,
            fontWeight: 700,
            color: 'var(--text-primary)',
            fontFamily: "'Manrope', sans-serif",
          }}>Recent Orders</div>
          <Link to="/orders" style={{ fontSize: 13, color: 'var(--accent-primary)', fontWeight: 500, textDecoration: 'none', display: 'flex', alignItems: 'center', gap: 4 }}>
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
                <tr style={{ borderBottom: '1px solid var(--border-light)' }}>
                  {['Order ID', 'Platform', 'Buyer', 'Status', 'Revenue', 'Time'].map((h) => (
                    <th key={h} style={{
                      padding: '8px 12px', textAlign: 'left',
                      fontSize: 10, fontWeight: 700, color: 'var(--text-secondary)',
                      textTransform: 'uppercase', letterSpacing: '0.08em',
                      background: 'var(--bg-surface)',
                      whiteSpace: 'nowrap',
                    }}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {(recentOrders?.items ?? []).slice(0, 5).map((order: any) => (
                  <tr key={order.id}
                    style={{ borderBottom: '1px solid var(--border-light)' }}
                    onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--row-hover)')}
                    onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                  >
                    <td style={{ padding: '12px', fontFamily: 'monospace', fontSize: 12, color: 'var(--mono-color)', fontWeight: 500 }}>
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
                    <td style={{ padding: '12px', color: 'var(--text-primary)', fontWeight: 600 }}>
                      ${Number(order.totalRevenue).toFixed(2)}
                    </td>
                    <td style={{ padding: '12px', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                      {dayjs(order.platformCreatedAt ?? order.createdAt).format('MM/DD HH:mm')}
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
