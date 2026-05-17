import { Table, Spin } from 'antd'
import { DollarOutlined, RiseOutlined, BarChartOutlined, PercentageOutlined } from '@ant-design/icons'
import { useQuery } from '@tanstack/react-query'
import { api } from '../../lib/api'
import type { ColumnsType } from 'antd/es/table'

// ─── KPI Card ────────────────────────────────────────────────────────────────

function KpiCard({
  title, value, prefix, accent,
}: {
  title: string; value: string; prefix?: React.ReactNode; accent: string
}) {
  return (
    <div style={{ position: 'relative', overflow: 'hidden', background: 'var(--kpi-bg)', borderRadius: 20, border: 'var(--kpi-border)', backdropFilter: 'var(--kpi-backdrop)', boxShadow: 'var(--kpi-shadow)', padding: '20px 24px' }}>
      <div style={{ position: 'absolute', top: -24, right: -24, width: 96, height: 96, borderRadius: '50%', background: accent, filter: 'blur(48px)', opacity: 0.15, pointerEvents: 'none' }} />
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
        <span style={{ fontSize: 13, color: 'var(--text-secondary)', fontWeight: 500 }}>{title}</span>
        <div style={{ width: 36, height: 36, borderRadius: 10, background: `${accent}22`, border: `1px solid ${accent}33`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          {prefix && <span style={{ color: accent, fontSize: 18 }}>{prefix}</span>}
        </div>
      </div>
      <div style={{ fontSize: 28, fontWeight: 800, color: 'var(--text-primary)', lineHeight: 1, fontFamily: "'Manrope', sans-serif" }}>{value}</div>
    </div>
  )
}

// ─── Margin badge ────────────────────────────────────────────────────────────

function MarginCell({ value }: { value: number }) {
  const color = value >= 20 ? 'var(--badge-success-fg)' : value >= 10 ? 'var(--badge-warning-fg)' : 'var(--badge-error-fg)'
  const bg = value >= 20 ? 'var(--badge-success-bg)' : value >= 10 ? 'var(--badge-warning-bg)' : 'var(--badge-error-bg)'
  return (
    <span style={{ background: bg, color, padding: '3px 10px', borderRadius: 20, fontSize: 12, fontWeight: 600, whiteSpace: 'nowrap' }}>
      {value.toFixed(1)}%
    </span>
  )
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function ProfitReportPage() {
  const { data: rows = [], isLoading } = useQuery({
    queryKey: ['reports-profit'],
    queryFn: () => api.get('/reports/profit').then((r) => r.data.data),
  })

  const totals = (rows as any[]).reduce(
    (acc: any, r: any) => ({
      grossRevenue: acc.grossRevenue + (r.grossRevenue ?? 0),
      cogs: acc.cogs + (r.cogs ?? 0),
      profit: acc.profit + (r.profit ?? 0),
    }),
    { grossRevenue: 0, cogs: 0, profit: 0 }
  )

  const overallMargin = totals.grossRevenue > 0 ? (totals.profit / totals.grossRevenue) * 100 : 0

  const columns: ColumnsType<any> = [
    {
      title: 'SKU Code',
      dataIndex: 'skuCode',
      width: 140,
      render: (v) => (
        <span style={{ fontFamily: "'Courier New', monospace", color: 'var(--mono-color)', fontSize: 13 }}>{v}</span>
      ),
    },
    {
      title: 'Product',
      dataIndex: 'productName',
      ellipsis: true,
      render: (v) => <span style={{ fontWeight: 500, color: 'var(--text-primary)' }}>{v}</span>,
    },
    {
      title: 'Units Sold',
      dataIndex: 'unitsSold',
      width: 100,
      align: 'right',
      render: (v) => <span style={{ color: 'var(--text-primary)' }}>{(v ?? 0).toLocaleString()}</span>,
    },
    {
      title: 'Revenue',
      dataIndex: 'grossRevenue',
      width: 130,
      align: 'right',
      sorter: (a: any, b: any) => a.grossRevenue - b.grossRevenue,
      render: (v: number) => <span style={{ fontWeight: 600 }}>${v.toFixed(2)}</span>,
    },
    {
      title: 'COGS',
      dataIndex: 'cogs',
      width: 110,
      align: 'right',
      render: (v: number) => `$${v.toFixed(2)}`,
    },
    {
      title: 'Platform Fee',
      dataIndex: 'platformCommission',
      width: 120,
      align: 'right',
      render: (v: number) => `$${(v ?? 0).toFixed(2)}`,
    },
    {
      title: 'Profit',
      dataIndex: 'profit',
      width: 120,
      align: 'right',
      defaultSortOrder: 'descend' as const,
      sorter: (a: any, b: any) => a.profit - b.profit,
      render: (v: number) => (
        <span style={{ color: v >= 0 ? 'var(--badge-success-fg)' : 'var(--badge-error-fg)', fontWeight: 600 }}>
          ${v.toFixed(2)}
        </span>
      ),
    },
    {
      title: 'Margin %',
      dataIndex: 'profitMargin',
      width: 110,
      align: 'right',
      sorter: (a: any, b: any) => a.profitMargin - b.profitMargin,
      render: (v: number) => <MarginCell value={v ?? 0} />,
    },
  ]

  if (isLoading) {
    return (
      <div style={{ textAlign: 'center', padding: '80px 0' }}>
        <Spin size="large" />
      </div>
    )
  }

  return (
    <div>
      {/* Page Header */}
      <div style={{ marginBottom: 24 }}>
        <p style={{ margin: '4px 0 0', color: 'var(--text-secondary)', fontSize: 14 }}>Profitability breakdown by SKU</p>
      </div>

      {/* KPI Cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 16, marginBottom: 20 }}>
        <KpiCard title="Total Revenue" value={`$${totals.grossRevenue.toFixed(2)}`} prefix={<DollarOutlined />} accent="var(--accent-primary)" />
        <KpiCard title="Total COGS" value={`$${totals.cogs.toFixed(2)}`} prefix={<DollarOutlined />} accent="#F59E0B" />
        <KpiCard title="Gross Profit" value={`$${totals.profit.toFixed(2)}`} prefix={<RiseOutlined />} accent="#10B981" />
        <KpiCard title="Overall Margin" value={`${overallMargin.toFixed(1)}%`} prefix={<PercentageOutlined />} accent={overallMargin >= 20 ? '#10B981' : overallMargin >= 10 ? '#F59E0B' : '#EF4444'} />
      </div>

      {/* Table */}
      <div style={{ background: 'var(--bg-card)', borderRadius: 12, border: '1px solid var(--border)', overflow: 'hidden' }}>
        <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border-light)' }}>
          <span style={{ fontSize: 15, fontWeight: 600, color: 'var(--text-primary)' }}>Profit by SKU</span>
        </div>
        <Table
          rowKey="systemSkuId"
          columns={columns}
          dataSource={rows}
          size="middle"
          style={{ borderRadius: 0 }}
          pagination={{
            pageSize: 50,
            showSizeChanger: false,
            showTotal: (total) => `${total.toLocaleString()} records`,
            style: { padding: '12px 20px' },
          }}
          scroll={{ x: 'max-content' }}
          locale={{
            emptyText: (
              <div style={{ padding: '48px 0', textAlign: 'center' }}>
                <BarChartOutlined style={{ fontSize: 40, color: 'var(--text-muted)', display: 'block', margin: '0 auto 12px' }} />
                <div style={{ fontSize: 15, fontWeight: 500, color: 'var(--text-secondary)' }}>No profit data yet</div>
                <div style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 4 }}>Run the ETL job to populate profit reports</div>
              </div>
            ),
          }}
        />
      </div>
    </div>
  )
}
