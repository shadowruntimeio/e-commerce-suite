import { Table, Input, Select, Button, Space } from 'antd'
import { PlusOutlined, EditOutlined, DeleteOutlined, AppstoreOutlined } from '@ant-design/icons'
import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { api } from '../../lib/api'
import type { ColumnsType } from 'antd/es/table'

// ─── Helpers ────────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { bg: string; color: string; label: string }> = {
    ACTIVE:   { bg: '#D1FAE5', color: '#065F46', label: 'Active' },
    INACTIVE: { bg: '#F1F5F9', color: '#475569', label: 'Inactive' },
  }
  const s = map[status] ?? { bg: '#F1F5F9', color: '#475569', label: status }
  return (
    <span style={{ background: s.bg, color: s.color, padding: '3px 10px', borderRadius: 20, fontSize: 12, fontWeight: 500, whiteSpace: 'nowrap' }}>
      {s.label}
    </span>
  )
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function ProductsPage() {
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)

  const { data, isLoading } = useQuery({
    queryKey: ['products', { search, page }],
    queryFn: () =>
      api.get('/products', { params: { search: search || undefined, page, pageSize: 20 } }).then((r) => r.data.data),
  })

  const columns: ColumnsType<any> = [
    {
      title: 'SPU Code',
      dataIndex: 'spuCode',
      width: 140,
      render: (v) => (
        <span style={{ fontFamily: "'Courier New', monospace", color: '#6366F1', fontSize: 13 }}>{v}</span>
      ),
    },
    {
      title: 'Product Name',
      dataIndex: 'name',
      render: (v, record) => (
        <div>
          <div style={{ fontWeight: 500, color: '#0F172A', fontSize: 14 }}>{v}</div>
          {record.category?.name && (
            <span style={{ fontSize: 11, color: '#64748B', background: '#F1F5F9', padding: '1px 6px', borderRadius: 4, marginTop: 2, display: 'inline-block' }}>
              {record.category.name}
            </span>
          )}
        </div>
      ),
    },
    {
      title: 'Brand',
      dataIndex: 'brand',
      width: 100,
      render: (v) => v ?? <span style={{ color: '#CBD5E1' }}>—</span>,
    },
    {
      title: 'SKUs',
      dataIndex: 'skus',
      width: 80,
      align: 'center',
      render: (s) => (
        <span style={{ background: '#EEF2FF', color: '#4338CA', borderRadius: 20, padding: '2px 10px', fontSize: 12, fontWeight: 600 }}>
          {s?.length ?? 0}
        </span>
      ),
    },
    {
      title: 'Status',
      dataIndex: 'isActive',
      width: 100,
      render: (v) => <StatusBadge status={v ? 'ACTIVE' : 'INACTIVE'} />,
    },
    {
      title: '',
      key: 'actions',
      width: 80,
      render: () => (
        <Space size={4}>
          <Button type="text" size="small" icon={<EditOutlined />} style={{ color: '#64748B' }} />
          <Button type="text" size="small" icon={<DeleteOutlined />} style={{ color: '#EF4444' }} />
        </Space>
      ),
    },
  ]

  return (
    <div>
      {/* Page Header */}
      <div style={{ marginBottom: 24 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700, color: '#0F172A' }}>Products</h1>
            <p style={{ margin: '4px 0 0', color: '#64748B', fontSize: 14 }}>Manage your product catalog and SKUs</p>
          </div>
          <Space>
            <Button
              type="primary"
              icon={<PlusOutlined />}
              style={{ background: '#6366F1', border: 'none', borderRadius: 8, height: 36, fontWeight: 500, fontSize: 14 }}
            >
              Add Product
            </Button>
          </Space>
        </div>
      </div>

      {/* Filter Bar */}
      <div style={{ background: '#fff', borderRadius: 12, border: '1px solid #E2E8F0', padding: '16px 20px', marginBottom: 16, display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
        <Input.Search
          placeholder="Search products..."
          allowClear
          onSearch={(v) => { setSearch(v); setPage(1) }}
          style={{ width: 260 }}
        />
        <Select
          allowClear
          placeholder="All categories"
          style={{ width: 180 }}
        />
        <Select
          allowClear
          placeholder="All statuses"
          style={{ width: 140 }}
          options={[
            { value: 'true', label: 'Active' },
            { value: 'false', label: 'Inactive' },
          ]}
        />
      </div>

      {/* Table */}
      <div style={{ background: '#fff', borderRadius: 12, border: '1px solid #E2E8F0', overflow: 'hidden' }}>
        <Table
          rowKey="id"
          columns={columns}
          dataSource={data?.items ?? []}
          loading={isLoading}
          size="middle"
          style={{ borderRadius: 0 }}
          onRow={() => ({ style: { cursor: 'pointer' } })}
          pagination={{
            current: page,
            pageSize: 20,
            total: data?.total ?? 0,
            onChange: (p) => setPage(p),
            showSizeChanger: false,
            showTotal: (total) => `${total.toLocaleString()} records`,
            style: { padding: '12px 20px' },
          }}
          scroll={{ x: 'max-content' }}
          locale={{
            emptyText: (
              <div style={{ padding: '48px 0', textAlign: 'center' }}>
                <AppstoreOutlined style={{ fontSize: 40, color: '#CBD5E1', display: 'block', margin: '0 auto 12px' }} />
                <div style={{ fontSize: 15, fontWeight: 500, color: '#64748B' }}>No products yet</div>
                <div style={{ fontSize: 13, color: '#94A3B8', marginTop: 4 }}>Add your first product to get started</div>
              </div>
            ),
          }}
        />
      </div>
    </div>
  )
}
