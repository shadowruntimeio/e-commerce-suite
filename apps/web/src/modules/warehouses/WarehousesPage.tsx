import { Card, Table, Tag, Button } from 'antd'
import { PlusOutlined } from '@ant-design/icons'
import { useQuery } from '@tanstack/react-query'
import { api } from '../../lib/api'

export default function WarehousesPage() {
  const { data, isLoading } = useQuery({
    queryKey: ['warehouses'],
    queryFn: () => api.get('/warehouses').then(r => r.data.data),
  })

  return (
    <Card title="Warehouses" extra={<Button type="primary" icon={<PlusOutlined />}>Add Warehouse</Button>}>
      <Table rowKey="id" dataSource={data ?? []} loading={isLoading} size="small"
        columns={[
          { title: 'Name', dataIndex: 'name' },
          { title: 'Type', dataIndex: 'type', render: (v) => <Tag>{v}</Tag> },
          { title: 'Default', dataIndex: 'isDefault', render: (v) => v ? <Tag color="green">Yes</Tag> : '-' },
        ]}
      />
    </Card>
  )
}
