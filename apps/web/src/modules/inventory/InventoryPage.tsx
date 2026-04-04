import { Table, Input, Select } from 'antd'
import { InboxOutlined } from '@ant-design/icons'
import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { api } from '../../lib/api'
import type { ColumnsType } from 'antd/es/table'
import dayjs from 'dayjs'

// ─── Event type color map ────────────────────────────────────────────────────

const EVENT_TYPE_MAP: Record<string, { bg: string; color: string; label: string }> = {
  INBOUND:       { bg: '#D1FAE5', color: '#065F46', label: 'Inbound' },
  OUTBOUND:      { bg: '#FEE2E2', color: '#991B1B', label: 'Outbound' },
  ADJUSTMENT:    { bg: '#FEF3C7', color: '#92400E', label: 'Adjustment' },
  RESERVED:      { bg: '#EEF2FF', color: '#4338CA', label: 'Reserved' },
  UNRESERVED:    { bg: '#F1F5F9', color: '#475569', label: 'Unreserved' },
  TRANSFER_IN:   { bg: '#ECFEFF', color: '#155E75', label: 'Transfer In' },
  TRANSFER_OUT:  { bg: '#FFF7ED', color: '#9A3412', label: 'Transfer Out' },
}

function EventTypeBadge({ type }: { type: string }) {
  const s = EVENT_TYPE_MAP[type] ?? { bg: '#F1F5F9', color: '#475569', label: type }
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
        <span style={{ fontFamily: "'Courier New', monospace", fontSize: 12, color: '#374151' }}>{v}</span>
      ),
    },
    {
      title: 'Warehouse',
      dataIndex: ['warehouseSku', 'warehouse', 'name'],
      width: 140,
      render: (v) => v ? (
        <span style={{ background: '#F1F5F9', color: '#475569', padding: '2px 8px', borderRadius: 6, fontSize: 12 }}>
          {v}
        </span>
      ) : <span style={{ color: '#CBD5E1' }}>—</span>,
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
      render: (v) => v ?? <span style={{ color: '#CBD5E1' }}>—</span>,
    },
    {
      title: 'Notes',
      dataIndex: 'notes',
      ellipsis: true,
      render: (v) => v ?? <span style={{ color: '#CBD5E1' }}>—</span>,
    },
    {
      title: 'Date',
      dataIndex: 'createdAt',
      width: 150,
      render: (v) => (
        <span style={{ color: '#64748B', fontSize: 13 }}>{dayjs(v).format('MMM D, HH:mm')}</span>
      ),
    },
  ]

  return (
    <div>
      {/* Page Header */}
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700, color: '#0F172A' }}>Inventory Log</h1>
        <p style={{ margin: '4px 0 0', color: '#64748B', fontSize: 14 }}>All stock movements across warehouses</p>
      </div>

      {/* Filter Bar */}
      <div style={{ background: '#fff', borderRadius: 12, border: '1px solid #E2E8F0', padding: '16px 20px', marginBottom: 16, display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
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
      <div style={{ background: '#fff', borderRadius: 12, border: '1px solid #E2E8F0', overflow: 'hidden' }}>
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
                <InboxOutlined style={{ fontSize: 40, color: '#CBD5E1', display: 'block', margin: '0 auto 12px' }} />
                <div style={{ fontSize: 15, fontWeight: 500, color: '#64748B' }}>No inventory events</div>
                <div style={{ fontSize: 13, color: '#94A3B8', marginTop: 4 }}>Stock movements will appear here</div>
              </div>
            ),
          }}
        />
      </div>
    </div>
  )
}
