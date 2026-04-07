import { Table, Input, Select, Space, DatePicker, Button } from 'antd'
import {
  SyncOutlined, DownloadOutlined, EyeOutlined, ShoppingCartOutlined,
} from '@ant-design/icons'
import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { api } from '../../lib/api'
import type { ColumnsType } from 'antd/es/table'
import dayjs from 'dayjs'

// ─── Helpers ────────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { bg: string; color: string; label: string }> = {
    PENDING:     { bg: 'var(--badge-warning-bg)',  color: 'var(--badge-warning-fg)',  label: 'Pending' },
    TO_SHIP:     { bg: 'var(--badge-info-bg)',     color: 'var(--badge-info-fg)',     label: 'To Ship' },
    SHIPPED:     { bg: 'var(--badge-success-bg)',  color: 'var(--badge-success-fg)',  label: 'Shipped' },
    COMPLETED:   { bg: 'var(--badge-success-bg)',  color: 'var(--badge-success-fg)',  label: 'Completed' },
    CANCELLED:   { bg: 'var(--badge-neutral-bg)',  color: 'var(--badge-neutral-fg)',  label: 'Cancelled' },
    AFTER_SALES: { bg: 'var(--badge-purple-bg)',   color: 'var(--badge-purple-fg)',   label: 'After Sales' },
    UNPAID:      { bg: 'var(--badge-error-bg)',    color: 'var(--badge-error-fg)',    label: 'Unpaid' },
  }
  const s = map[status] ?? { bg: 'var(--badge-neutral-bg)', color: 'var(--badge-neutral-fg)', label: status }
  return (
    <span style={{ background: s.bg, color: s.color, padding: '3px 10px', borderRadius: 20, fontSize: 12, fontWeight: 500, whiteSpace: 'nowrap' }}>
      {s.label}
    </span>
  )
}

function PlatformBadge({ platform }: { platform: string }) {
  const map: Record<string, { bg: string; color: string }> = {
    SHOPEE: { bg: '#FF6633', color: '#fff' },
    TIKTOK: { bg: '#0F172A', color: '#fff' },
    LAZADA: { bg: '#0F146D', color: '#fff' },
    MANUAL: { bg: 'var(--badge-neutral-bg)', color: 'var(--badge-neutral-fg)' },
  }
  const s = map[platform] ?? { bg: 'var(--badge-neutral-bg)', color: 'var(--badge-neutral-fg)' }
  return (
    <span style={{ background: s.bg, color: s.color, padding: '2px 8px', borderRadius: 6, fontSize: 11, fontWeight: 600, letterSpacing: '0.03em' }}>
      {platform}
    </span>
  )
}

// ─── Tab config ──────────────────────────────────────────────────────────────

const STATUS_TABS: { key: string; label: string }[] = [
  { key: '', label: 'All' },
  { key: 'UNPAID', label: 'Unpaid' },
  { key: 'PENDING', label: 'Pending' },
  { key: 'TO_SHIP', label: 'To Ship' },
  { key: 'SHIPPED', label: 'Shipped' },
  { key: 'COMPLETED', label: 'Completed' },
  { key: 'CANCELLED', label: 'Cancelled' },
]

// ─── Main component ───────────────────────────────────────────────────────────

export default function OrdersPage() {
  const [status, setStatus] = useState('')
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)

  const { data, isLoading } = useQuery({
    queryKey: ['orders', { status, search, page }],
    queryFn: () =>
      api.get('/orders', {
        params: { status: status || undefined, search: search || undefined, page, pageSize: 20 },
      }).then((r) => r.data.data),
  })

  const columns: ColumnsType<any> = [
    {
      title: 'Order ID',
      dataIndex: 'platformOrderId',
      width: 160,
      render: (v) => (
        <span style={{ fontFamily: "'Courier New', monospace", color: 'var(--mono-color)', fontSize: 13 }}>{v}</span>
      ),
    },
    {
      title: 'Platform',
      dataIndex: ['shop', 'platform'],
      width: 100,
      render: (v) => v ? <PlatformBadge platform={v} /> : '—',
    },
    { title: 'Shop', dataIndex: ['shop', 'name'], width: 120, ellipsis: true },
    { title: 'Buyer', dataIndex: 'buyerName', width: 140, ellipsis: true },
    {
      title: 'Items',
      dataIndex: 'items',
      width: 60,
      align: 'center',
      render: (items) => (
        <span style={{ background: 'rgba(28,37,62,0.8)', color: 'var(--text-secondary)', borderRadius: 20, padding: '2px 8px', fontSize: 12, fontWeight: 500 }}>
          {items?.length ?? 0}
        </span>
      ),
    },
    {
      title: 'Status',
      dataIndex: 'status',
      width: 120,
      render: (s) => <StatusBadge status={s} />,
    },
    {
      title: 'Revenue',
      dataIndex: 'totalRevenue',
      width: 120,
      align: 'right',
      render: (v) => (
        <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>${Number(v).toFixed(2)}</span>
      ),
    },
    {
      title: 'Date',
      dataIndex: 'createdAt',
      width: 140,
      render: (v) => dayjs(v).format('MMM D, HH:mm'),
    },
    {
      title: '',
      key: 'actions',
      width: 48,
      render: () => (
        <Button type="text" size="small" icon={<EyeOutlined />} style={{ color: 'var(--text-secondary)' }} />
      ),
    },
  ]

  return (
    <div>
      {/* Page Header */}
      <div style={{ marginBottom: 24 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700, color: 'var(--text-primary)' }}>Orders</h1>
            <p style={{ margin: '4px 0 0', color: 'var(--text-secondary)', fontSize: 14 }}>Manage and track all platform orders</p>
          </div>
          <Space>
            <Button
              icon={<SyncOutlined />}
              style={{ background: 'var(--accent-gradient)', color: '#fff', border: 'none', borderRadius: 8, height: 36, fontWeight: 600, fontSize: 14, boxShadow: '0 0 16px rgba(204,151,255,0.3)' }}
            >
              Sync Now
            </Button>
          </Space>
        </div>
      </div>

      {/* Status Tabs */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 16, flexWrap: 'wrap' }}>
        {STATUS_TABS.map((tab) => {
          const isActive = status === tab.key
          return (
            <button
              key={tab.key}
              onClick={() => { setStatus(tab.key); setPage(1) }}
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
      <div style={{ background: 'var(--bg-card)', borderRadius: 12, border: '1px solid var(--border)', padding: '16px 20px', marginBottom: 16, display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
        <Input.Search
          placeholder="Order ID / Buyer name"
          allowClear
          onSearch={(v) => { setSearch(v); setPage(1) }}
          style={{ width: 260 }}
        />
        <Select
          allowClear
          placeholder="All shops"
          style={{ width: 180 }}
        />
        <DatePicker.RangePicker style={{ borderRadius: 8 }} />
        <div style={{ marginLeft: 'auto' }}>
          <Button
            icon={<DownloadOutlined />}
            style={{ background: 'var(--header-btn-bg)', color: 'var(--header-btn-color)', border: 'var(--header-btn-border)', borderRadius: 8, height: 36, fontWeight: 500, fontSize: 14 }}
          >
            Export
          </Button>
        </div>
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
          onRow={() => ({ style: { cursor: 'pointer' } })}
          rowHoverable
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
              <div style={{ padding: '48px 0', color: 'var(--text-muted)', textAlign: 'center' }}>
                <ShoppingCartOutlined style={{ fontSize: 40, marginBottom: 12, display: 'block', margin: '0 auto 12px' }} />
                <div style={{ fontSize: 15, fontWeight: 500, color: 'var(--text-secondary)' }}>No orders yet</div>
                <div style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 4 }}>Sync your shops to import orders</div>
              </div>
            ),
          }}
        />
      </div>
    </div>
  )
}
