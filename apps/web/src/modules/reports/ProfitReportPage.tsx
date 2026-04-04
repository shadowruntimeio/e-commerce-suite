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
    <div style={{ background: '#fff', borderRadius: 12, border: '1px solid #E2E8F0', boxShadow: '0 1px 3px rgba(0,0,0,0.06)', padding: '20px 24px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
        <span style={{ fontSize: 13, color: '#64748B', fontWeight: 500 }}>{title}</span>
        <div style={{ width: 36, height: 36, borderRadius: 10, background: `${accent}18`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          {prefix && <span style={{ color: accent, fontSize: 18 }}>{prefix}</span>}
        </div>
      </div>
      <div style={{ fontSize: 28, fontWeight: 700, color: '#0F172A', lineHeight: 1 }}>{value}</div>
    </div>
  )
}

// ─── Margin badge ────────────────────────────────────────────────────────────

function MarginCell({ value }: { value: number }) {
  const color = value >= 20 ? '#10B981' : value >= 10 ? '#F59E0B' : '#EF4444'
  const bg = value >= 20 ? '#D1FAE5' : value >= 10 ? '#FEF3C7' : '#FEE2E2'
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
        <span style={{ fontFamily: "'Courier New', monospace", color: '#6366F1', fontSize: 13 }}>{v}</span>
      ),
    },
    {
      title: 'Product',
      dataIndex: 'productName',
      ellipsis: true,
      render: (v) => <span style={{ fontWeight: 500, color: '#0F172A' }}>{v}</span>,
    },
    {
      title: 'Units Sold',
      dataIndex: 'unitsSold',
      width: 100,
      align: 'right',
      render: (v) => <span style={{ color: '#374151' }}>{(v ?? 0).toLocaleString()}</span>,
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
        <span style={{ color: v >= 0 ? '#10B981' : '#EF4444', fontWeight: 600 }}>
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
        <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700, color: '#0F172A' }}>Profit Report</h1>
        <p style={{ margin: '4px 0 0', color: '#64748B', fontSize: 14 }}>Profitability breakdown by SKU</p>
      </div>

      {/* KPI Cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 16, marginBottom: 20 }}>
        <KpiCard title="Total Revenue" value={`$${totals.grossRevenue.toFixed(2)}`} prefix={<DollarOutlined />} accent="#6366F1" />
        <KpiCard title="Total COGS" value={`$${totals.cogs.toFixed(2)}`} prefix={<DollarOutlined />} accent="#F59E0B" />
        <KpiCard title="Gross Profit" value={`$${totals.profit.toFixed(2)}`} prefix={<RiseOutlined />} accent="#10B981" />
        <KpiCard title="Overall Margin" value={`${overallMargin.toFixed(1)}%`} prefix={<PercentageOutlined />} accent={overallMargin >= 20 ? '#10B981' : overallMargin >= 10 ? '#F59E0B' : '#EF4444'} />
      </div>

      {/* Table */}
      <div style={{ background: '#fff', borderRadius: 12, border: '1px solid #E2E8F0', overflow: 'hidden' }}>
        <div style={{ padding: '16px 20px', borderBottom: '1px solid #F1F5F9' }}>
          <span style={{ fontSize: 15, fontWeight: 600, color: '#0F172A' }}>Profit by SKU</span>
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
                <BarChartOutlined style={{ fontSize: 40, color: '#CBD5E1', display: 'block', margin: '0 auto 12px' }} />
                <div style={{ fontSize: 15, fontWeight: 500, color: '#64748B' }}>No profit data yet</div>
                <div style={{ fontSize: 13, color: '#94A3B8', marginTop: 4 }}>Run the ETL job to populate profit reports</div>
              </div>
            ),
          }}
        />
      </div>
    </div>
  )
}
