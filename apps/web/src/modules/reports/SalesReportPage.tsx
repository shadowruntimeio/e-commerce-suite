import { Card, Col, Row, Statistic, Table, DatePicker, Space, Spin } from 'antd'
import { DollarOutlined, ShoppingCartOutlined, RiseOutlined } from '@ant-design/icons'
import { useQuery } from '@tanstack/react-query'
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from 'recharts'
import { api } from '../../lib/api'
import dayjs from 'dayjs'
import { useState } from 'react'
import type { ColumnsType } from 'antd/es/table'

const { RangePicker } = DatePicker

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

  const avgOrderValue =
    totals.ordersCount > 0 ? (totals.grossRevenue / totals.ordersCount) : 0

  const columns: ColumnsType<any> = [
    { title: 'Date', dataIndex: 'date', width: 120 },
    { title: 'Orders', dataIndex: 'ordersCount', width: 100, align: 'right' },
    { title: 'Units Sold', dataIndex: 'unitsSold', width: 100, align: 'right' },
    {
      title: 'Revenue',
      dataIndex: 'grossRevenue',
      width: 130,
      align: 'right',
      render: (v: number) => `$${v.toFixed(2)}`,
    },
    {
      title: 'Platform Fee',
      dataIndex: 'platformCommission',
      width: 130,
      align: 'right',
      render: (v: number) => `$${v.toFixed(2)}`,
    },
    {
      title: 'Profit',
      dataIndex: 'profit',
      width: 130,
      align: 'right',
      render: (v: number) => (
        <span style={{ color: v >= 0 ? '#52c41a' : '#ff4d4f' }}>${v.toFixed(2)}</span>
      ),
    },
  ]

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <h2 style={{ margin: 0 }}>Sales Report</h2>
        <Space>
          <RangePicker
            value={dateRange}
            onChange={(vals) => {
              if (vals && vals[0] && vals[1]) {
                setDateRange([vals[0], vals[1]])
              }
            }}
          />
        </Space>
      </div>

      {isLoading ? (
        <Spin size="large" style={{ display: 'block', margin: '80px auto' }} />
      ) : (
        <>
          <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
            <Col xs={24} sm={12} lg={6}>
              <Card>
                <Statistic
                  title="Total Revenue"
                  value={(totals.grossRevenue ?? 0).toFixed(2)}
                  prefix={<DollarOutlined />}
                  valueStyle={{ color: '#1677ff' }}
                />
              </Card>
            </Col>
            <Col xs={24} sm={12} lg={6}>
              <Card>
                <Statistic
                  title="Total Profit"
                  value={(totals.profit ?? 0).toFixed(2)}
                  prefix={<RiseOutlined />}
                  valueStyle={{ color: (totals.profit ?? 0) >= 0 ? '#52c41a' : '#ff4d4f' }}
                />
              </Card>
            </Col>
            <Col xs={24} sm={12} lg={6}>
              <Card>
                <Statistic
                  title="Total Orders"
                  value={totals.ordersCount ?? 0}
                  prefix={<ShoppingCartOutlined />}
                />
              </Card>
            </Col>
            <Col xs={24} sm={12} lg={6}>
              <Card>
                <Statistic
                  title="Avg Order Value"
                  value={avgOrderValue.toFixed(2)}
                  prefix={<DollarOutlined />}
                />
              </Card>
            </Col>
          </Row>

          <Card style={{ marginBottom: 16 }}>
            <ResponsiveContainer width="100%" height={300}>
              <LineChart data={rows}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="date" tick={{ fontSize: 12 }} />
                <YAxis tick={{ fontSize: 12 }} />
                <Tooltip formatter={(v: number) => `$${v.toFixed(2)}`} />
                <Legend />
                <Line
                  type="monotone"
                  dataKey="grossRevenue"
                  name="Revenue"
                  stroke="#1677ff"
                  dot={false}
                  strokeWidth={2}
                />
                <Line
                  type="monotone"
                  dataKey="profit"
                  name="Profit"
                  stroke="#52c41a"
                  dot={false}
                  strokeWidth={2}
                />
              </LineChart>
            </ResponsiveContainer>
          </Card>

          <Card title="Daily Breakdown">
            <Table
              rowKey="date"
              columns={columns}
              dataSource={rows}
              size="small"
              pagination={{ pageSize: 31, showSizeChanger: false }}
            />
          </Card>
        </>
      )}
    </div>
  )
}
