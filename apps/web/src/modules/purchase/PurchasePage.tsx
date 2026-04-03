import { Card, Table, Tag, Button } from 'antd'
import { PlusOutlined } from '@ant-design/icons'
import { useQuery } from '@tanstack/react-query'
import { api } from '../../lib/api'
import type { ColumnsType } from 'antd/es/table'
import dayjs from 'dayjs'

const STATUS_COLOR: Record<string, string> = {
  DRAFT: 'default', PENDING_APPROVAL: 'orange', APPROVED: 'blue',
  ORDERED: 'cyan', PARTIALLY_RECEIVED: 'purple', RECEIVED: 'green', CANCELLED: 'red',
}

export default function PurchasePage() {
  const { data, isLoading } = useQuery({
    queryKey: ['purchase-orders'],
    queryFn: () => api.get('/purchase/orders').then(r => r.data.data),
  })

  const columns: ColumnsType<any> = [
    { title: 'Supplier', dataIndex: ['supplier', 'name'], width: 180 },
    { title: 'Warehouse', dataIndex: ['warehouse', 'name'], width: 160 },
    { title: 'Status', dataIndex: 'status', width: 160, render: (s) => <Tag color={STATUS_COLOR[s] ?? 'default'}>{s.replace(/_/g, ' ')}</Tag> },
    { title: 'Total', dataIndex: 'totalAmount', width: 120, align: 'right', render: (v, r) => `${r.currency} ${Number(v).toFixed(2)}` },
    { title: 'ETA', dataIndex: 'eta', width: 120, render: (v) => v ? dayjs(v).format('MM/DD/YYYY') : '-' },
    { title: 'Created', dataIndex: 'createdAt', width: 160, render: (v) => dayjs(v).format('MM/DD HH:mm') },
  ]

  return (
    <Card title="Purchase Orders" extra={<Button type="primary" icon={<PlusOutlined />}>New PO</Button>}>
      <Table rowKey="id" columns={columns} dataSource={data?.items ?? []} loading={isLoading} size="small"
        pagination={{ pageSize: 20, total: data?.total, showTotal: (t) => `${t} orders` }} />
    </Card>
  )
}
