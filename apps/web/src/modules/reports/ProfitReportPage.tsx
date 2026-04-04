import { Card, Col, Row, Statistic, Table, Spin } from 'antd'
import { DollarOutlined, RiseOutlined } from '@ant-design/icons'
import { useQuery } from '@tanstack/react-query'
import { api } from '../../lib/api'
import type { ColumnsType } from 'antd/es/table'

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

  const overallMargin =
    totals.grossRevenue > 0 ? (totals.profit / totals.grossRevenue) * 100 : 0

  const columns: ColumnsType<any> = [
    { title: 'SKU Code', dataIndex: 'skuCode', width: 140 },
    { title: 'Product', dataIndex: 'productName', ellipsis: true },
    { title: 'Units Sold', dataIndex: 'unitsSold', width: 100, align: 'right' },
    {
      title: 'Revenue',
      dataIndex: 'grossRevenue',
      width: 120,
      align: 'right',
      sorter: (a: any, b: any) => a.grossRevenue - b.grossRevenue,
      render: (v: number) => `$${v.toFixed(2)}`,
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
      render: (v: number) => `$${v.toFixed(2)}`,
    },
    {
      title: 'Profit',
      dataIndex: 'profit',
      width: 110,
      align: 'right',
      defaultSortOrder: 'descend',
      sorter: (a: any, b: any) => a.profit - b.profit,
      render: (v: number) => (
        <span style={{ color: v >= 0 ? '#52c41a' : '#ff4d4f', fontWeight: 600 }}>
          ${v.toFixed(2)}
        </span>
      ),
    },
    {
      title: 'Margin %',
      dataIndex: 'profitMargin',
      width: 100,
      align: 'right',
      sorter: (a: any, b: any) => a.profitMargin - b.profitMargin,
      render: (v: number) => (
        <span style={{ color: v >= 0 ? '#52c41a' : '#ff4d4f' }}>{v.toFixed(1)}%</span>
      ),
    },
  ]

  if (isLoading) return <Spin size="large" style={{ display: 'block', margin: '80px auto' }} />

  return (
    <div>
      <h2 style={{ marginTop: 0 }}>Profit Report</h2>

      <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
        <Col xs={24} sm={12} lg={6}>
          <Card>
            <Statistic
              title="Total Revenue"
              value={totals.grossRevenue.toFixed(2)}
              prefix={<DollarOutlined />}
              valueStyle={{ color: '#1677ff' }}
            />
          </Card>
        </Col>
        <Col xs={24} sm={12} lg={6}>
          <Card>
            <Statistic
              title="Total COGS"
              value={totals.cogs.toFixed(2)}
              prefix={<DollarOutlined />}
              valueStyle={{ color: '#faad14' }}
            />
          </Card>
        </Col>
        <Col xs={24} sm={12} lg={6}>
          <Card>
            <Statistic
              title="Total Profit"
              value={totals.profit.toFixed(2)}
              prefix={<RiseOutlined />}
              valueStyle={{ color: totals.profit >= 0 ? '#52c41a' : '#ff4d4f' }}
            />
          </Card>
        </Col>
        <Col xs={24} sm={12} lg={6}>
          <Card>
            <Statistic
              title="Overall Margin"
              value={overallMargin.toFixed(1)}
              suffix="%"
              valueStyle={{ color: overallMargin >= 0 ? '#52c41a' : '#ff4d4f' }}
            />
          </Card>
        </Col>
      </Row>

      <Card title="Profit by SKU">
        <Table
          rowKey="systemSkuId"
          columns={columns}
          dataSource={rows}
          size="small"
          pagination={{ pageSize: 50, showSizeChanger: false }}
        />
      </Card>
    </div>
  )
}
