import { Table, Tag, Select, Input, Space, Card } from 'antd'
import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { api } from '../../lib/api'
import type { ColumnsType } from 'antd/es/table'
import dayjs from 'dayjs'

const STATUS_COLOR: Record<string, string> = {
  UNPAID: 'red', PENDING: 'orange', TO_SHIP: 'blue',
  SHIPPED: 'cyan', COMPLETED: 'green', CANCELLED: 'default',
  AFTER_SALES: 'purple', EXCEPTION: 'red',
}

export default function OrdersPage() {
  const [status, setStatus] = useState<string | undefined>()
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)

  const { data, isLoading } = useQuery({
    queryKey: ['orders', { status, search, page }],
    queryFn: () => api.get('/orders', { params: { status, search: search || undefined, page, pageSize: 20 } }).then(r => r.data.data),
  })

  const columns: ColumnsType<any> = [
    { title: 'Order ID', dataIndex: 'platformOrderId', width: 180 },
    { title: 'Shop', dataIndex: ['shop', 'name'], width: 160 },
    { title: 'Platform', dataIndex: ['shop', 'platform'], width: 100, render: (v) => <Tag>{v}</Tag> },
    { title: 'Buyer', dataIndex: 'buyerName', width: 140 },
    { title: 'Status', dataIndex: 'status', width: 120, render: (s) => <Tag color={STATUS_COLOR[s] ?? 'default'}>{s}</Tag> },
    { title: 'Revenue', dataIndex: 'totalRevenue', width: 120, align: 'right', render: (v) => `$${Number(v).toFixed(2)}` },
    { title: 'Items', dataIndex: 'items', width: 80, align: 'center', render: (items) => items?.length ?? 0 },
    { title: 'Created', dataIndex: 'createdAt', width: 160, render: (v) => dayjs(v).format('MM/DD HH:mm') },
  ]

  return (
    <Card
      title="Orders"
      extra={
        <Space>
          <Input.Search placeholder="Order ID / Buyer" allowClear onSearch={setSearch} style={{ width: 220 }} />
          <Select allowClear placeholder="Status" style={{ width: 140 }} onChange={setStatus} options={[
            { value: 'PENDING', label: 'Pending' },
            { value: 'TO_SHIP', label: 'To Ship' },
            { value: 'SHIPPED', label: 'Shipped' },
            { value: 'COMPLETED', label: 'Completed' },
            { value: 'CANCELLED', label: 'Cancelled' },
          ]} />
        </Space>
      }
    >
      <Table
        rowKey="id"
        columns={columns}
        dataSource={data?.items ?? []}
        loading={isLoading}
        pagination={{
          current: page,
          pageSize: 20,
          total: data?.total ?? 0,
          onChange: setPage,
          showSizeChanger: false,
          showTotal: (total) => `${total} orders`,
        }}
        scroll={{ x: 1000 }}
        size="small"
      />
    </Card>
  )
}
