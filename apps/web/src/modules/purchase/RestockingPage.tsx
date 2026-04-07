import { Table, Button, Popconfirm, message, Space } from 'antd'
import { AlertOutlined, ShoppingOutlined } from '@ant-design/icons'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '../../lib/api'
import type { ColumnsType } from 'antd/es/table'

// ─── Types ───────────────────────────────────────────────────────────────────

interface RestockingSuggestion {
  id: string
  suggestedQty: number
  status: string
  createdAt: string
  expiresAt: string
  reason: {
    daysOfStock: number
    avgDailySales: number
    currentStock: number
  }
  systemSku: {
    id: string
    skuCode: string
    attributes: Record<string, unknown>
    systemProduct: {
      id: string
      name: string
      spuCode: string
    }
  }
  warehouseSku: {
    id: string
    safetyStockDays: number
    reorderPoint: number
    warehouse: {
      id: string
      name: string
    }
  }
}

// ─── Stock indicator ─────────────────────────────────────────────────────────

function StockIndicator({ days, units }: { days: number; units: number }) {
  const color = days < 7 ? 'var(--badge-error-fg)' : days < 14 ? 'var(--badge-warning-fg)' : 'var(--badge-success-fg)'
  const bg = days < 7 ? 'var(--badge-error-bg)' : days < 14 ? 'var(--badge-warning-bg)' : 'var(--badge-success-bg)'
  return (
    <div>
      <span style={{ background: bg, color, padding: '3px 10px', borderRadius: 20, fontSize: 12, fontWeight: 600 }}>
        {days.toFixed(1)} days
      </span>
      <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>{units} units on hand</div>
    </div>
  )
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function RestockingPage() {
  const queryClient = useQueryClient()

  const { data, isLoading } = useQuery({
    queryKey: ['restocking-suggestions'],
    queryFn: () =>
      api.get('/purchase/suggestions').then((r) => r.data.data as RestockingSuggestion[]),
  })

  const acceptMutation = useMutation({
    mutationFn: (id: string) => api.post(`/purchase/suggestions/${id}/accept`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['restocking-suggestions'] })
      void message.success('Purchase order draft created')
    },
    onError: (err: unknown) => {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error
      void message.error(msg ?? 'Failed to create purchase order')
    },
  })

  const dismissMutation = useMutation({
    mutationFn: (id: string) => api.post(`/purchase/suggestions/${id}/dismiss`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['restocking-suggestions'] })
      void message.success('Suggestion dismissed')
    },
    onError: () => void message.error('Failed to dismiss suggestion'),
  })

  const columns: ColumnsType<RestockingSuggestion> = [
    {
      title: 'SKU Code',
      width: 160,
      render: (_: unknown, record: RestockingSuggestion) => (
        <div>
          <div style={{ fontFamily: "'Courier New', monospace", color: 'var(--mono-color)', fontSize: 13, fontWeight: 600 }}>
            {record.systemSku.skuCode}
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 2 }}>
            {record.systemSku.systemProduct.name}
          </div>
        </div>
      ),
    },
    {
      title: 'Warehouse',
      dataIndex: ['warehouseSku', 'warehouse', 'name'],
      width: 150,
      render: (v) => (
        <span style={{ background: 'var(--bg-surface)', color: 'var(--text-secondary)', padding: '2px 8px', borderRadius: 6, fontSize: 12, border: '1px solid var(--border-light)' }}>
          {v}
        </span>
      ),
    },
    {
      title: 'Current Stock',
      width: 150,
      render: (_: unknown, record: RestockingSuggestion) => (
        <StockIndicator days={record.reason.daysOfStock} units={record.reason.currentStock} />
      ),
    },
    {
      title: 'Avg Daily Sales',
      width: 130,
      render: (_: unknown, record: RestockingSuggestion) => (
        <span style={{ color: 'var(--text-primary)', fontSize: 14 }}>
          {record.reason.avgDailySales.toFixed(2)}<span style={{ color: 'var(--text-muted)', fontSize: 12 }}> / day</span>
        </span>
      ),
    },
    {
      title: 'Suggested Qty',
      dataIndex: 'suggestedQty',
      width: 120,
      align: 'right',
      render: (v: number) => (
        <span style={{ color: 'var(--accent-primary)', fontWeight: 700, fontSize: 16 }}>{v}</span>
      ),
    },
    {
      title: 'Safety Stock',
      width: 110,
      render: (_: unknown, record: RestockingSuggestion) => (
        <span style={{ color: 'var(--text-secondary)', fontSize: 13 }}>{record.warehouseSku.safetyStockDays} days</span>
      ),
    },
    {
      title: 'Actions',
      width: 180,
      render: (_: unknown, record: RestockingSuggestion) => (
        <Space>
          <Popconfirm
            title="Create a draft purchase order from this suggestion?"
            onConfirm={() => acceptMutation.mutate(record.id)}
          >
            <Button
              type="primary"
              size="small"
              icon={<ShoppingOutlined />}
              loading={acceptMutation.isPending}
              style={{ background: 'var(--accent-gradient)', border: 'none', borderRadius: 6, fontWeight: 500 }}
            >
              Create PO
            </Button>
          </Popconfirm>
          <Popconfirm
            title="Dismiss this suggestion?"
            onConfirm={() => dismissMutation.mutate(record.id)}
          >
            <Button
              type="link"
              size="small"
              loading={dismissMutation.isPending}
              style={{ color: 'var(--text-muted)', padding: 0, height: 'auto', fontWeight: 500 }}
            >
              Dismiss
            </Button>
          </Popconfirm>
        </Space>
      ),
    },
  ]

  return (
    <div>
      {/* Page Header */}
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700, color: 'var(--text-primary)' }}>Restocking Suggestions</h1>
        <p style={{ margin: '4px 0 0', color: 'var(--text-secondary)', fontSize: 14 }}>Auto-generated based on 30-day sales velocity</p>
      </div>

      {/* Info Banner */}
      <div style={{
        background: 'var(--badge-warning-bg)',
        border: '1px solid rgba(var(--badge-warning-fg-raw, 245,158,11),0.3)',
        borderRadius: 12,
        padding: '14px 20px',
        marginBottom: 20,
        display: 'flex',
        alignItems: 'center',
        gap: 12,
      }}>
        <AlertOutlined style={{ color: 'var(--badge-warning-fg)', fontSize: 18, flexShrink: 0 }} />
        <div>
          <span style={{ color: 'var(--text-primary)', fontWeight: 600, fontSize: 14 }}>Run the restocking job manually</span>
          <span style={{ color: 'var(--text-secondary)', fontSize: 14 }}> to generate or refresh suggestions based on current sales data.</span>
        </div>
      </div>

      {/* Table */}
      <div style={{ background: 'var(--bg-card)', borderRadius: 12, border: '1px solid var(--border)', overflow: 'hidden' }}>
        <Table
          rowKey="id"
          columns={columns}
          dataSource={data ?? []}
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
                <AlertOutlined style={{ fontSize: 40, color: 'var(--text-muted)', display: 'block', margin: '0 auto 12px' }} />
                <div style={{ fontSize: 15, fontWeight: 500, color: 'var(--text-secondary)' }}>No restocking suggestions</div>
                <div style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 4 }}>Run the restocking job to generate suggestions</div>
              </div>
            ),
          }}
        />
      </div>
    </div>
  )
}
