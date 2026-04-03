import { Table, Tag, Input, Button, Card, Space } from 'antd'
import { PlusOutlined } from '@ant-design/icons'
import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { api } from '../../lib/api'
import type { ColumnsType } from 'antd/es/table'

export default function ProductsPage() {
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)

  const { data, isLoading } = useQuery({
    queryKey: ['products', { search, page }],
    queryFn: () => api.get('/products', { params: { search: search || undefined, page, pageSize: 20 } }).then(r => r.data.data),
  })

  const columns: ColumnsType<any> = [
    { title: 'SPU Code', dataIndex: 'spuCode', width: 160 },
    { title: 'Name', dataIndex: 'name' },
    { title: 'Category', dataIndex: ['category', 'name'], width: 160, render: (v) => v ?? '-' },
    { title: 'Brand', dataIndex: 'brand', width: 120, render: (v) => v ?? '-' },
    { title: 'SKUs', dataIndex: 'skus', width: 80, align: 'center', render: (s) => s?.length ?? 0 },
    { title: 'Status', dataIndex: 'isActive', width: 100, render: (v) => <Tag color={v ? 'green' : 'red'}>{v ? 'Active' : 'Inactive'}</Tag> },
  ]

  return (
    <Card
      title="Products"
      extra={
        <Space>
          <Input.Search placeholder="Search products" allowClear onSearch={setSearch} style={{ width: 220 }} />
          <Button type="primary" icon={<PlusOutlined />}>Add Product</Button>
        </Space>
      }
    >
      <Table
        rowKey="id"
        columns={columns}
        dataSource={data?.items ?? []}
        loading={isLoading}
        pagination={{ current: page, pageSize: 20, total: data?.total ?? 0, onChange: setPage, showTotal: (t) => `${t} products` }}
        size="small"
      />
    </Card>
  )
}
