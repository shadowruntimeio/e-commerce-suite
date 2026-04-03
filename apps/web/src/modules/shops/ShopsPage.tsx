import { Card, Table, Tag, Button } from 'antd'
import { PlusOutlined } from '@ant-design/icons'
import { useQuery } from '@tanstack/react-query'
import { api } from '../../lib/api'
import dayjs from 'dayjs'

export default function ShopsPage() {
  const { data, isLoading } = useQuery({
    queryKey: ['shops'],
    queryFn: () => api.get('/shops').then(r => r.data.data),
  })

  return (
    <Card title="Connected Shops" extra={<Button type="primary" icon={<PlusOutlined />}>Connect Shop</Button>}>
      <Table rowKey="id" dataSource={data ?? []} loading={isLoading} size="small"
        columns={[
          { title: 'Name', dataIndex: 'name' },
          { title: 'Platform', dataIndex: 'platform', render: (v) => <Tag color="blue">{v}</Tag> },
          { title: 'Status', dataIndex: 'status', render: (v) => <Tag color={v === 'ACTIVE' ? 'green' : 'red'}>{v}</Tag> },
          { title: 'Token Expires', dataIndex: 'tokenExpiresAt', render: (v) => v ? dayjs(v).format('MM/DD/YYYY') : '-' },
          { title: 'Last Sync', dataIndex: 'lastSyncAt', render: (v) => v ? dayjs(v).format('MM/DD HH:mm') : 'Never' },
        ]}
      />
    </Card>
  )
}
