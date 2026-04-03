import { Card, Col, Row, Statistic, Spin } from 'antd'
import { ShoppingCartOutlined, ClockCircleOutlined, DollarOutlined, ShopOutlined } from '@ant-design/icons'
import { useQuery } from '@tanstack/react-query'
import { api } from '../../lib/api'

export default function DashboardPage() {
  const { data, isLoading } = useQuery({
    queryKey: ['dashboard'],
    queryFn: () => api.get('/dashboard').then((r) => r.data.data),
    refetchInterval: 30_000,
  })

  if (isLoading) return <Spin size="large" style={{ display: 'block', margin: '80px auto' }} />

  return (
    <div>
      <h2 style={{ marginTop: 0 }}>Dashboard</h2>
      <Row gutter={[16, 16]}>
        <Col xs={24} sm={12} lg={6}>
          <Card>
            <Statistic title="Today's Orders" value={data?.todayOrdersCount ?? 0} prefix={<ShoppingCartOutlined />} />
          </Card>
        </Col>
        <Col xs={24} sm={12} lg={6}>
          <Card>
            <Statistic title="Pending Review" value={data?.pendingOrders ?? 0} prefix={<ClockCircleOutlined />} valueStyle={{ color: '#faad14' }} />
          </Card>
        </Col>
        <Col xs={24} sm={12} lg={6}>
          <Card>
            <Statistic title="To Ship" value={data?.toShipOrders ?? 0} prefix={<ShoppingCartOutlined />} valueStyle={{ color: '#1677ff' }} />
          </Card>
        </Col>
        <Col xs={24} sm={12} lg={6}>
          <Card>
            <Statistic title="Today's Revenue" value={Number(data?.todayRevenue ?? 0).toFixed(2)} prefix={<DollarOutlined />} valueStyle={{ color: '#52c41a' }} />
          </Card>
        </Col>
      </Row>
    </div>
  )
}
