import { Table, DatePicker, Space, Spin } from 'antd'
import { BarChartOutlined, DollarOutlined, ShoppingCartOutlined, RiseOutlined, TrophyOutlined } from '@ant-design/icons'
import { useQuery } from '@tanstack/react-query'
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from 'recharts'
import { api } from '../../lib/api'
import dayjs from 'dayjs'
import { useState } from 'react'
import type { ColumnsType } from 'antd/es/table'

const { RangePicker } = DatePicker

// ─── KPI Card ────────────────────────────────────────────────────────────────

function KpiCard({
  title, value, prefix, accentColor,
}: {
  title: string; value: string; prefix?: React.ReactNode; accentColor: string
}) {
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
        position: 'absolute', top: 0, right: 0,
        width: 100, height: 100,
        background: `${accentColor}1a`,
        filter: 'blur(50px)', borderRadius: '50%',
        pointerEvents: 'none',
      }} />
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 16, position: 'relative' }}>
        <span style={{ fontSize: 12, color: 'var(--text-secondary)', fontWeight: 500 }}>{title}</span>
        <div style={{
          width: 36, height: 36, borderRadius: 10,
          background: `${accentColor}1a`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          {prefix && <span style={{ color: accentColor, fontSize: 18 }}>{prefix}</span>}
        </div>
      </div>
      <div style={{
        fontSize: 28, fontWeight: 900, color: 'var(--text-primary)', lineHeight: 1,
        fontFamily: "'Manrope', sans-serif", letterSpacing: '-0.02em',
        position: 'relative',
      }}>
        {value}
      </div>
    </div>
  )
}

// ─── Chart Tooltip ────────────────────────────────────────────────────────────

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
      {payload.map((p: any, i: number) => (
        <div key={i} style={{ color: p.color, marginBottom: 2 }}>
          {p.name}: <strong>${Number(p.value).toFixed(2)}</strong>
        </div>
      ))}
    </div>
  )
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function SalesReportPage() {
  const [dateRange, setDateRange] = useState<[dayjs.Dayjs, dayjs.Dayjs]>([
    dayjs().subtract(30, 'day'),
    dayjs(),
  ])

  const { data, isLoading } = useQuery({
    queryKey: ['reports-sales', dateRange[0].format('YYYY-MM-DD'), dateRange[1].format('YYYY-MM-DD')],
    queryFn: () =>
      api.get('/reports/sales', {
        params: {
          dateFrom: dateRange[0].format('YYYY-MM-DD'),
          dateTo: dateRange[1].format('YYYY-MM-DD'),
        },
      }).then((r) => r.data.data),
  })

  const rows: any[] = data?.rows ?? []
  const totals = data?.totals ?? {}
  const hasData = rows.length > 0

  const avgOrderValue = totals.ordersCount > 0 ? (totals.grossRevenue / totals.ordersCount) : 0

  const columns: ColumnsType<any> = [
    {
      title: 'Date', dataIndex: 'date', width: 120,
      render: (v: string) => <span style={{ color: 'var(--mono-color)', fontFamily: 'monospace', fontSize: 12 }}>{v}</span>,
    },
    {
      title: 'Orders', dataIndex: 'ordersCount', width: 100, align: 'right',
      render: (v: number) => <span style={{ color: 'var(--text-primary)', fontWeight: 600 }}>{v}</span>,
    },
    {
      title: 'Units', dataIndex: 'unitsSold', width: 100, align: 'right',
      render: (v: number) => <span style={{ color: 'var(--text-primary)' }}>{v}</span>,
    },
    {
      title: 'Revenue', dataIndex: 'grossRevenue', width: 130, align: 'right',
      render: (v: number) => <span style={{ fontWeight: 700, color: 'var(--accent-primary)' }}>${v.toFixed(2)}</span>,
    },
    {
      title: 'Platform Fee', dataIndex: 'platformCommission', width: 130, align: 'right',
      render: (v: number) => <span style={{ color: 'var(--text-secondary)' }}>${(v ?? 0).toFixed(2)}</span>,
    },
    {
      title: 'Profit', dataIndex: 'profit', width: 130, align: 'right',
      render: (v: number) => (
        <span style={{ color: v >= 0 ? 'var(--badge-success-fg)' : 'var(--badge-error-fg)', fontWeight: 700 }}>${v.toFixed(2)}</span>
      ),
    },
    {
      title: 'Margin %', width: 100, align: 'right',
      render: (_: unknown, r: any) => {
        const margin = r.grossRevenue > 0 ? (r.profit / r.grossRevenue) * 100 : 0
        const color = margin >= 20 ? 'var(--badge-success-fg)' : margin >= 10 ? 'var(--badge-warning-fg)' : 'var(--badge-error-fg)'
        return <span style={{ color, fontWeight: 600 }}>{margin.toFixed(1)}%</span>
      },
    },
  ]

  return (
    <div>
      {/* Page Header */}
      <div style={{ marginBottom: 28 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700, color: 'var(--text-primary)' }}>Sales Report</h1>
            <p style={{ margin: '4px 0 0', color: 'var(--text-secondary)', fontSize: 14 }}>Revenue and profit overview by date</p>
          </div>
          <Space>
            <RangePicker
              value={dateRange}
              onChange={(vals) => {
                if (vals && vals[0] && vals[1]) setDateRange([vals[0], vals[1]])
              }}
              style={{ borderRadius: 8 }}
            />
          </Space>
        </div>
      </div>

      {isLoading ? (
        <div style={{ textAlign: 'center', padding: '80px 0' }}><Spin size="large" /></div>
      ) : !hasData ? (
        <div style={{
          background: 'var(--kpi-bg)',
          backdropFilter: 'var(--kpi-backdrop)',
          WebkitBackdropFilter: 'var(--kpi-backdrop)',
          border: 'var(--kpi-border)',
          borderRadius: 16,
          padding: '64px 40px', textAlign: 'center',
        }}>
          <BarChartOutlined style={{ fontSize: 48, color: 'var(--text-muted)', marginBottom: 16 }} />
          <div style={{ fontSize: 16, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 6 }}>No data for this period</div>
          <div style={{ fontSize: 14, color: 'var(--text-secondary)' }}>Run the ETL job to populate sales reports</div>
        </div>
      ) : (
        <>
          {/* KPI Cards */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 16, marginBottom: 20 }}>
            <KpiCard title="Total Revenue" value={`$${(totals.grossRevenue ?? 0).toFixed(2)}`} prefix={<DollarOutlined />} accentColor="#cc97ff" />
            <KpiCard title="Total Profit" value={`$${(totals.profit ?? 0).toFixed(2)}`} prefix={<RiseOutlined />} accentColor="#10b981" />
            <KpiCard title="Total Orders" value={(totals.ordersCount ?? 0).toLocaleString()} prefix={<ShoppingCartOutlined />} accentColor="#53ddfc" />
            <KpiCard title="Avg Order Value" value={`$${avgOrderValue.toFixed(2)}`} prefix={<TrophyOutlined />} accentColor="#f59e0b" />
          </div>

          {/* Chart */}
          <div style={{
            background: 'var(--kpi-bg)',
            backdropFilter: 'var(--kpi-backdrop)',
            WebkitBackdropFilter: 'var(--kpi-backdrop)',
            border: 'var(--kpi-border)',
            borderRadius: 16,
            boxShadow: 'var(--kpi-shadow)',
            padding: '24px 24px 8px',
            marginBottom: 20,
          }}>
            <div style={{
              fontSize: 16, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 16,
              fontFamily: "'Manrope', sans-serif",
            }}>Revenue & Profit Trend</div>
            <ResponsiveContainer width="100%" height={280}>
              <AreaChart data={rows} margin={{ top: 4, right: 16, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="revGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#cc97ff" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="#cc97ff" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="profGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#10b981" stopOpacity={0.25} />
                    <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(128,128,160,0.12)" vertical={false} />
                <XAxis dataKey="date" tick={{ fontSize: 12, fill: 'var(--text-muted)' } as any} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 12, fill: 'var(--text-muted)' } as any} axisLine={false} tickLine={false} />
                <Tooltip content={<ChartTooltip />} cursor={{ stroke: 'rgba(128,128,160,0.15)', strokeWidth: 1 }} />
                <Legend
                  wrapperStyle={{ fontSize: 13, color: 'var(--text-secondary)' }}
                  formatter={(value) => <span style={{ color: 'var(--text-secondary)' }}>{value}</span>}
                />
                <Area type="monotone" dataKey="grossRevenue" name="Revenue" stroke="#cc97ff" fill="url(#revGrad)" strokeWidth={2} dot={false} />
                <Area type="monotone" dataKey="profit" name="Profit" stroke="#10b981" fill="url(#profGrad)" strokeWidth={2} dot={false} />
              </AreaChart>
            </ResponsiveContainer>
          </div>

          {/* Table */}
          <div style={{ background: 'var(--bg-card)', borderRadius: 12, border: '1px solid var(--border)', overflow: 'hidden' }}>
            <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border-light)' }}>
              <span style={{ fontSize: 15, fontWeight: 600, color: 'var(--text-primary)' }}>Daily Breakdown</span>
            </div>
            <Table
              rowKey="date"
              columns={columns}
              dataSource={rows}
              size="middle"
              style={{ borderRadius: 0 }}
              pagination={{
                pageSize: 31,
                showSizeChanger: false,
                showTotal: (total) => `${total.toLocaleString()} records`,
                style: { padding: '12px 20px' },
              }}
              scroll={{ x: 'max-content' }}
            />
          </div>
        </>
      )}
    </div>
  )
}
