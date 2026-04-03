import { Card, Table, Tag } from 'antd'
import { useQuery } from '@tanstack/react-query'
import { api } from '../../lib/api'
import type { ColumnsType } from 'antd/es/table'
import dayjs from 'dayjs'

export default function InventoryPage() {
  const { data, isLoading } = useQuery({
    queryKey: ['inventory-events'],
    queryFn: () => api.get('/inventory/events', { params: { limit: 50 } }).then(r => r.data.data),
  })

  const columns: ColumnsType<any> = [
    { title: 'Event Type', dataIndex: 'eventType', width: 160, render: (v) => <Tag>{v}</Tag> },
    { title: 'SKU', dataIndex: 'warehouseSkuId', width: 200 },
    { title: 'Delta', dataIndex: 'quantityDelta', width: 100, align: 'right',
      render: (v) => <span style={{ color: v > 0 ? '#52c41a' : '#ff4d4f' }}>{v > 0 ? `+${v}` : v}</span> },
    { title: 'Reference', dataIndex: 'referenceType', width: 120, render: (v) => v ?? '-' },
    { title: 'Notes', dataIndex: 'notes', render: (v) => v ?? '-' },
    { title: 'Date', dataIndex: 'createdAt', width: 160, render: (v) => dayjs(v).format('MM/DD HH:mm') },
  ]

  return (
    <Card title="Inventory Log">
      <Table rowKey="id" columns={columns} dataSource={data ?? []} loading={isLoading} size="small" />
    </Card>
  )
}
