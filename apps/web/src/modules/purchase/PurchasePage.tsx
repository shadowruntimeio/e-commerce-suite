import { Table, Input, Button, Space } from 'antd'
import { PlusOutlined, EyeOutlined, CheckOutlined, ShoppingOutlined } from '@ant-design/icons'
import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { api } from '../../lib/api'
import type { ColumnsType } from 'antd/es/table'
import dayjs from 'dayjs'

// ─── Helpers ─────────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { bg: string; color: string; label: string }> = {
    DRAFT:             { bg: 'var(--badge-neutral-bg)',  color: 'var(--badge-neutral-fg)',  label: 'Draft' },
    PENDING_APPROVAL:  { bg: 'var(--badge-warning-bg)',  color: 'var(--badge-warning-fg)',  label: 'Pending Approval' },
    APPROVED:          { bg: 'var(--badge-success-bg)',  color: 'var(--badge-success-fg)',  label: 'Approved' },
    ORDERED:           { bg: 'var(--badge-info-bg)',     color: 'var(--badge-info-fg)',     label: 'Ordered' },
    PARTIALLY_RECEIVED:{ bg: 'var(--badge-purple-bg)',   color: 'var(--badge-purple-fg)',   label: 'Partial' },
    RECEIVED:          { bg: 'var(--badge-success-bg)',  color: 'var(--badge-success-fg)',  label: 'Received' },
    CANCELLED:         { bg: 'var(--badge-neutral-bg)',  color: 'var(--badge-neutral-fg)',  label: 'Cancelled' },
  }
  const s = map[status] ?? { bg: 'var(--badge-neutral-bg)', color: 'var(--badge-neutral-fg)', label: status }
  return (
    <span style={{ background: s.bg, color: s.color, padding: '3px 10px', borderRadius: 20, fontSize: 12, fontWeight: 500, whiteSpace: 'nowrap' }}>
      {s.label}
    </span>
  )
}

// ─── Status tabs ─────────────────────────────────────────────────────────────

const STATUS_TABS = [
  { key: '', label: 'All' },
  { key: 'DRAFT', label: 'Draft' },
  { key: 'PENDING_APPROVAL', label: 'Pending Approval' },
  { key: 'APPROVED', label: 'Approved' },
  { key: 'ORDERED', label: 'Ordered' },
  { key: 'RECEIVED', label: 'Received' },
]

// ─── Main component ───────────────────────────────────────────────────────────

export default function PurchasePage() {
  const [statusFilter, setStatusFilter] = useState('')
  const [search, setSearch] = useState('')

  const { data, isLoading } = useQuery({
    queryKey: ['purchase-orders', { statusFilter, search }],
    queryFn: () =>
      api.get('/purchase/orders', {
        params: { status: statusFilter || undefined, search: search || undefined },
      }).then((r) => r.data.data),
  })

  const columns: ColumnsType<any> = [
    {
      title: 'PO #',
      dataIndex: 'id',
      width: 160,
      render: (v) => (
        <span style={{ fontFamily: "'Courier New', monospace", color: 'var(--mono-color)', fontSize: 13 }}>
          {String(v).slice(0, 8).toUpperCase()}
        </span>
      ),
    },
    {
      title: 'Supplier',
      dataIndex: ['supplier', 'name'],
      width: 160,
      ellipsis: true,
      render: (v) => v ?? <span style={{ color: 'var(--text-muted)' }}>—</span>,
    },
    {
      title: 'Warehouse',
      dataIndex: ['warehouse', 'name'],
      width: 140,
      ellipsis: true,
      render: (v) => v ?? <span style={{ color: 'var(--text-muted)' }}>—</span>,
    },
    {
      title: 'Status',
      dataIndex: 'status',
      width: 160,
      render: (s) => <StatusBadge status={s} />,
    },
    {
      title: 'Items',
      dataIndex: 'items',
      width: 70,
      align: 'center',
      render: (v) => (
        <span style={{ background: 'rgba(28,37,62,0.8)', color: 'var(--text-secondary)', borderRadius: 20, padding: '2px 8px', fontSize: 12, fontWeight: 500 }}>
          {Array.isArray(v) ? v.length : (v ?? 0)}
        </span>
      ),
    },
    {
      title: 'Total',
      dataIndex: 'totalAmount',
      width: 130,
      align: 'right',
      render: (v, r) => (
        <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>
          {r.currency ?? 'USD'} {Number(v ?? 0).toFixed(2)}
        </span>
      ),
    },
    {
      title: 'ETA',
      dataIndex: 'eta',
      width: 120,
      render: (v) => v ? dayjs(v).format('MMM D, YYYY') : <span style={{ color: 'var(--text-muted)' }}>—</span>,
    },
    {
      title: 'Created',
      dataIndex: 'createdAt',
      width: 140,
      render: (v) => <span style={{ color: 'var(--text-secondary)', fontSize: 13 }}>{dayjs(v).format('MMM D, HH:mm')}</span>,
    },
    {
      title: '',
      key: 'actions',
      width: 72,
      render: () => (
        <Space size={4}>
          <Button type="text" size="small" icon={<EyeOutlined />} style={{ color: 'var(--text-secondary)' }} />
          <Button type="text" size="small" icon={<CheckOutlined />} style={{ color: '#10B981' }} />
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
            <p style={{ margin: '4px 0 0', color: 'var(--text-secondary)', fontSize: 14 }}>Track and manage supplier purchase orders</p>
          </div>
          <Button
            type="primary"
            icon={<PlusOutlined />}
            style={{ background: 'var(--accent-gradient)', border: 'none', borderRadius: 8, height: 36, fontWeight: 600, fontSize: 14, boxShadow: '0 0 16px rgba(204,151,255,0.3)' }}
          >
            New PO
          </Button>
        </div>
      </div>

      {/* Status Tabs */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 16, flexWrap: 'wrap' }}>
        {STATUS_TABS.map((tab) => {
          const isActive = statusFilter === tab.key
          return (
            <button
              key={tab.key}
              onClick={() => setStatusFilter(tab.key)}
              style={{
                background: isActive ? 'var(--tab-active-bg)' : 'var(--bg-surface)',
                color: isActive ? 'var(--tab-active-fg)' : 'var(--text-secondary)',
                border: isActive ? 'var(--tab-active-border)' : '1px solid var(--border)',
                borderRadius: 20,
                padding: '5px 14px',
                fontSize: 13,
                fontWeight: isActive ? 600 : 400,
                cursor: 'pointer',
                transition: 'all 0.15s',
              }}
            >
              {tab.label}
            </button>
          )
        })}
      </div>

      {/* Filter Bar */}
      <div style={{ background: 'var(--bg-card)', borderRadius: 12, border: '1px solid var(--border)', padding: '16px 20px', marginBottom: 16, display: 'flex', gap: 12, alignItems: 'center' }}>
        <Input.Search
          placeholder="Search supplier..."
          allowClear
          onSearch={setSearch}
          style={{ width: 260 }}
        />
      </div>

      {/* Table */}
      <div style={{ background: 'var(--bg-card)', borderRadius: 12, border: '1px solid var(--border)', overflow: 'hidden' }}>
        <Table
          rowKey="id"
          columns={columns}
          dataSource={data?.items ?? []}
          loading={isLoading}
          size="middle"
          style={{ borderRadius: 0 }}
          pagination={{
            pageSize: 20,
            total: data?.total ?? 0,
            showSizeChanger: false,
            showTotal: (total) => `${total.toLocaleString()} records`,
            style: { padding: '12px 20px' },
          }}
          scroll={{ x: 'max-content' }}
          locale={{
            emptyText: (
              <div style={{ padding: '48px 0', textAlign: 'center' }}>
                <ShoppingOutlined style={{ fontSize: 40, color: 'var(--text-muted)', display: 'block', margin: '0 auto 12px' }} />
                <div style={{ fontSize: 15, fontWeight: 500, color: 'var(--text-secondary)' }}>No purchase orders</div>
                <div style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 4 }}>Create your first PO to start tracking purchases</div>
              </div>
            ),
          }}
        />
      </div>
    </div>
  )
}
