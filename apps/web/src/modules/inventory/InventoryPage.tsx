import { Table, Input, Select } from 'antd'
import { InboxOutlined } from '@ant-design/icons'
import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { api } from '../../lib/api'
import type { ColumnsType } from 'antd/es/table'
import dayjs from 'dayjs'

// ─── Event type color map ────────────────────────────────────────────────────

const EVENT_TYPE_MAP: Record<string, { bg: string; color: string; label: string }> = {
  INBOUND:       { bg: 'var(--badge-success-bg)', color: 'var(--badge-success-fg)', label: 'Inbound' },
  OUTBOUND:      { bg: 'var(--badge-error-bg)',   color: 'var(--badge-error-fg)',   label: 'Outbound' },
  ADJUSTMENT:    { bg: 'var(--badge-warning-bg)', color: 'var(--badge-warning-fg)', label: 'Adjustment' },
  RESERVED:      { bg: 'var(--badge-info-bg)',    color: 'var(--badge-info-fg)',    label: 'Reserved' },
  UNRESERVED:    { bg: 'var(--badge-neutral-bg)', color: 'var(--badge-neutral-fg)', label: 'Unreserved' },
  TRANSFER_IN:   { bg: 'var(--badge-info-bg)',    color: 'var(--badge-info-fg)',    label: 'Transfer In' },
  TRANSFER_OUT:  { bg: 'var(--badge-purple-bg)',  color: 'var(--badge-purple-fg)',  label: 'Transfer Out' },
}

function EventTypeBadge({ type }: { type: string }) {
  const s = EVENT_TYPE_MAP[type] ?? { bg: 'var(--badge-neutral-bg)', color: 'var(--badge-neutral-fg)', label: type }
  return (
    <span style={{ background: s.bg, color: s.color, padding: '3px 10px', borderRadius: 20, fontSize: 12, fontWeight: 500, whiteSpace: 'nowrap' }}>
      {s.label}
    </span>
  )
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function InventoryPage() {
  const [search, setSearch] = useState('')
  const [eventType, setEventType] = useState<string | undefined>()

  const { data, isLoading } = useQuery({
    queryKey: ['inventory-events', { search, eventType }],
    queryFn: () =>
      api.get('/inventory/events', { params: { limit: 50, eventType: eventType || undefined } }).then((r) => r.data.data),
  })

  const filtered = (data ?? []).filter((row: any) => {
    if (!search) return true
    const s = search.toLowerCase()
    return (
      (row.warehouseSkuId ?? '').toLowerCase().includes(s) ||
      (row.referenceType ?? '').toLowerCase().includes(s) ||
      (row.notes ?? '').toLowerCase().includes(s)
    )
  })

  const columns: ColumnsType<any> = [
    {
      title: 'Event Type',
      dataIndex: 'eventType',
      width: 150,
      render: (v) => <EventTypeBadge type={v} />,
    },
    {
      title: 'SKU',
      dataIndex: 'warehouseSkuId',
      width: 220,
      render: (v) => (
        <span style={{ fontFamily: "'Courier New', monospace", fontSize: 12, color: 'var(--mono-color)' }}>{v}</span>
      ),
    },
    {
      title: 'Warehouse',
      dataIndex: ['warehouseSku', 'warehouse', 'name'],
      width: 140,
      render: (v) => v ? (
        <span style={{ background: 'var(--bg-surface)', color: 'var(--text-secondary)', padding: '2px 8px', borderRadius: 6, fontSize: 12, border: '1px solid var(--border-light)' }}>
          {v}
        </span>
      ) : <span style={{ color: 'var(--text-muted)' }}>—</span>,
    },
    {
      title: 'Delta',
      dataIndex: 'quantityDelta',
      width: 90,
      align: 'right',
      render: (v) => (
        <span style={{ color: v > 0 ? '#10B981' : '#EF4444', fontWeight: 600, fontSize: 14 }}>
          {v > 0 ? `+${v}` : v}
        </span>
      ),
    },
    {
      title: 'Reference',
      dataIndex: 'referenceType',
      width: 120,
      render: (v) => v ?? <span style={{ color: 'var(--text-muted)' }}>—</span>,
    },
    {
      title: 'Notes',
      dataIndex: 'notes',
      ellipsis: true,
      render: (v) => v ?? <span style={{ color: 'var(--text-muted)' }}>—</span>,
    },
    {
      title: 'Date',
      dataIndex: 'createdAt',
      width: 150,
      render: (v) => (
        <span style={{ color: 'var(--text-secondary)', fontSize: 13 }}>{dayjs(v).format('MMM D, HH:mm')}</span>
      ),
    },
  ]

  return (
    <div>
      {/* Page Header */}
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700, color: 'var(--text-primary)' }}>Inventory Log</h1>
        <p style={{ margin: '4px 0 0', color: 'var(--text-secondary)', fontSize: 14 }}>All stock movements across warehouses</p>
      </div>

      {/* Filter Bar */}
      <div style={{ background: 'var(--bg-card)', borderRadius: 12, border: '1px solid var(--border)', padding: '16px 20px', marginBottom: 16, display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
        <Input.Search
          placeholder="Search SKU, reference, notes..."
          allowClear
          onSearch={setSearch}
          style={{ width: 280 }}
        />
        <Select
          allowClear
          placeholder="All event types"
          style={{ width: 180 }}
          onChange={setEventType}
          options={Object.entries(EVENT_TYPE_MAP).map(([k, v]) => ({ value: k, label: v.label }))}
        />
      </div>

      {/* Table */}
      <div style={{ background: 'var(--bg-card)', borderRadius: 12, border: '1px solid var(--border)', overflow: 'hidden' }}>
        <Table
          rowKey="id"
          columns={columns}
          dataSource={filtered}
          loading={isLoading}
          size="middle"
          style={{ borderRadius: 0 }}
          pagination={{
            pageSize: 20,
            showSizeChanger: false,
            showTotal: (total) => `${total.toLocaleString()} records`,
            style: { padding: '12px 20px' },
          }}
          scroll={{ x: 'max-content' }}
          locale={{
            emptyText: (
              <div style={{ padding: '48px 0', textAlign: 'center' }}>
                <InboxOutlined style={{ fontSize: 40, color: 'var(--text-muted)', display: 'block', margin: '0 auto 12px' }} />
                <div style={{ fontSize: 15, fontWeight: 500, color: 'var(--text-secondary)' }}>No inventory events</div>
                <div style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 4 }}>Stock movements will appear here</div>
              </div>
            ),
          }}
        />
      </div>
    </div>
  )
}
