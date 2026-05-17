import { Table, Input, Select, Button, Space, Switch, Tooltip, Badge } from 'antd'
import { InboxOutlined, UploadOutlined, EditOutlined, HistoryOutlined } from '@ant-design/icons'
import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { api } from '../../lib/api'
import { useAuthStore, isMerchant } from '../../store/auth.store'
import type { ColumnsType } from 'antd/es/table'
import dayjs from 'dayjs'
import { AdjustDialog } from './AdjustDialog'
import { ImportDialog } from './ImportDialog'

type StockRow = {
  warehouseSkuId: string
  warehouseId: string
  warehouseName: string
  ownerUserId?: string
  ownerName?: string | null
  skuCode: string
  productName: string
  categoryId: string | null
  categoryName: string | null
  quantityOnHand: number
  quantityReserved: number
  quantityAvailable: number
  reorderPoint: number
  lastEventAt: string | null
}

export default function InventoryPage() {
  const { t } = useTranslation()
  const user = useAuthStore((s) => s.user)
  const merchantUser = isMerchant(user)
  const [warehouseId, setWarehouseId] = useState<string | undefined>()
  const [categoryId, setCategoryId] = useState<string | undefined>()
  const [merchantId, setMerchantId] = useState<string | undefined>()
  const [skuSearch, setSkuSearch] = useState('')
  const [lowStockOnly, setLowStockOnly] = useState(false)
  const [page, setPage] = useState(1)
  const pageSize = 50

  const { data: merchants } = useQuery({
    enabled: !merchantUser,
    queryKey: ['merchants-for-inventory'],
    queryFn: async () => (await api.get('/admin/users', { params: { role: 'MERCHANT' } })).data.data as Array<{ id: string; name: string }>,
  })

  const [editingRow, setEditingRow] = useState<string | null>(null)
  const [showImportDialog, setShowImportDialog] = useState(false)

  const { data: warehouses } = useQuery({
    queryKey: ['warehouses'],
    queryFn: () => api.get('/warehouses').then((r) => r.data.data),
  })

  // Drives the badge on the "Inbound shipments" button. Refresh every minute
  // so the count stays roughly current without spamming the API.
  const { data: pendingShipments } = useQuery({
    queryKey: ['inbound-shipments-pending-count'],
    queryFn: async () =>
      (await api.get('/inventory/inbound-shipments', { params: { status: 'PENDING_REVIEW' } }))
        .data.data as Array<{ id: string }>,
    refetchInterval: 60_000,
  })
  const pendingShipmentsCount = pendingShipments?.length ?? 0

  const { data: categories } = useQuery({
    queryKey: ['categories'],
    queryFn: () => api.get('/categories').then((r) => r.data.data),
  })

  const { data, isLoading } = useQuery({
    queryKey: ['inventory-stock', { warehouseId, categoryId, merchantId, skuSearch, lowStockOnly, page }],
    queryFn: () =>
      api
        .get('/inventory/stock', {
          params: {
            warehouseId: warehouseId || undefined,
            categoryId: categoryId || undefined,
            ownerUserId: merchantId || undefined,
            skuSearch: skuSearch.trim() || undefined,
            lowStockOnly: lowStockOnly ? 'true' : undefined,
            page,
            pageSize,
          },
        })
        .then((r) => r.data.data as { items: StockRow[]; total: number; page: number; pageSize: number; totalPages: number }),
  })

  const warehouseOptions = (Array.isArray(warehouses) ? warehouses : []).map((w: any) => ({ value: w.id, label: w.name }))
  const categoryOptions = (Array.isArray(categories) ? categories : []).map((c: any) => ({ value: c.id, label: c.name }))

  const columns: ColumnsType<StockRow> = [
    {
      title: t('inventory.warehouse'),
      dataIndex: 'warehouseName',
      render: (v) => (
        <span style={{ background: 'var(--bg-surface)', color: 'var(--text-secondary)', padding: '2px 8px', borderRadius: 6, fontSize: 12, border: '1px solid var(--border-light)' }}>
          {v}
        </span>
      ),
    },
    ...(!merchantUser ? [{
      title: t('inventory.merchant'),
      dataIndex: 'ownerName',
      render: (v: string | null) => v ?? '—',
    }] : []),
    {
      title: t('inventory.sku'),
      dataIndex: 'skuCode',
      render: (v) => (
        <span style={{ fontFamily: "'Courier New', monospace", fontSize: 12, color: 'var(--mono-color)' }}>{v}</span>
      ),
    },
    {
      title: t('inventory.productName'),
      dataIndex: 'productName',
      ellipsis: true,
    },
    {
      title: t('inventory.category'),
      dataIndex: 'categoryName',
      render: (v) => v ?? <span style={{ color: 'var(--text-muted)' }}>—</span>,
    },
    {
      title: t('inventory.stock'),
      dataIndex: 'quantityOnHand',
      align: 'right',
      render: (v, row) => {
        const low = v <= row.reorderPoint
        return (
          <span style={{ fontWeight: 600, color: low ? '#EF4444' : 'var(--text-primary)' }}>
            {v}
            {low && row.reorderPoint > 0 && (
              <Tooltip title={t('inventory.lowStockTooltip', { reorder: row.reorderPoint })}>
                <span style={{ marginLeft: 6, fontSize: 11, color: '#EF4444' }}>●</span>
              </Tooltip>
            )}
          </span>
        )
      },
    },
    {
      title: t('inventory.lastUpdated'),
      dataIndex: 'lastEventAt',
      render: (v) =>
        v ? (
          <span style={{ color: 'var(--text-secondary)', fontSize: 13 }}>{dayjs(v).format('MMM D, HH:mm')}</span>
        ) : (
          <span style={{ color: 'var(--text-muted)' }}>—</span>
        ),
    },
    {
      title: t('common.actions'),
      fixed: 'right',
      width: 96,
      render: (_, row) => (
        <Button size="small" icon={<EditOutlined />} onClick={() => setEditingRow(row.warehouseSkuId)}>
          {t('common.edit')}
        </Button>
      ),
    },
  ]

  return (
    <div>
      {/* Page Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 }}>
        <div>
          <p style={{ margin: '4px 0 0', color: 'var(--text-secondary)', fontSize: 14 }}>{t('inventory.subtitle')}</p>
        </div>
        <Space>
          <Link to="/inventory/inbound-shipments">
            <Badge count={pendingShipmentsCount} offset={[-4, 4]}>
              <Button icon={<InboxOutlined />} style={{ borderRadius: 8, height: 36, fontWeight: 500 }}>
                {t('inventory.inboundShipments')}
              </Button>
            </Badge>
          </Link>
          <Link to="/inventory/history">
            <Button icon={<HistoryOutlined />} style={{ borderRadius: 8, height: 36, fontWeight: 500 }}>
              {t('inventory.history')}
            </Button>
          </Link>
          {/* Export hidden for now — re-enable when there's a clear use case
              beyond debugging. Logic + endpoint kept intact. */}
          <Button
            type="primary"
            icon={<UploadOutlined />}
            onClick={() => setShowImportDialog(true)}
            style={{ background: 'var(--accent-gradient)', border: 'none', borderRadius: 8, height: 36, fontWeight: 500 }}
          >
            {t('inventory.importCsv')}
          </Button>
        </Space>
      </div>

      {/* Filter Bar */}
      <div style={{ background: 'var(--bg-card)', borderRadius: 12, border: '1px solid var(--border)', padding: '16px 20px', marginBottom: 16, display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
        <Select
          allowClear
          placeholder={t('inventory.allWarehouses')}
          value={warehouseId}
          style={{ width: 200 }}
          onChange={(v) => { setWarehouseId(v); setPage(1) }}
          options={warehouseOptions}
        />
        <Select
          allowClear
          placeholder={t('inventory.allCategories')}
          value={categoryId}
          style={{ width: 200 }}
          onChange={(v) => { setCategoryId(v); setPage(1) }}
          options={categoryOptions}
          notFoundContent={<span style={{ color: 'var(--text-muted)', fontSize: 13 }}>{t('inventory.noCategoriesHint')}</span>}
        />
        {!merchantUser && (
          <Select
            allowClear
            placeholder={t('inventory.allMerchants')}
            value={merchantId}
            style={{ width: 200 }}
            onChange={(v) => { setMerchantId(v); setPage(1) }}
            options={(merchants ?? []).map((m) => ({ value: m.id, label: m.name }))}
          />
        )}
        <Input.Search
          placeholder={t('inventory.skuSearchPlaceholder')}
          allowClear
          onSearch={(v) => { setSkuSearch(v); setPage(1) }}
          style={{ width: 260 }}
        />
        <Space size={8}>
          <Switch checked={lowStockOnly} onChange={(v) => { setLowStockOnly(v); setPage(1) }} />
          <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>{t('inventory.lowStockOnly')}</span>
        </Space>
      </div>

      {/* Table */}
      <div style={{ background: 'var(--bg-card)', borderRadius: 12, border: '1px solid var(--border)', overflow: 'hidden' }}>
        <Table<StockRow>
          rowKey="warehouseSkuId"
          columns={columns}
          dataSource={data?.items ?? []}
          loading={isLoading}
          size="middle"
          scroll={{ x: 1200 }}
          pagination={{
            current: data?.page ?? page,
            pageSize: data?.pageSize ?? pageSize,
            total: data?.total ?? 0,
            showSizeChanger: false,
            showTotal: (total) => t('common.records', { count: total }),
            onChange: (p) => setPage(p),
            style: { padding: '12px 20px' },
          }}
          locale={{
            emptyText: (
              <div style={{ padding: '48px 0', textAlign: 'center' }}>
                <InboxOutlined style={{ fontSize: 40, color: 'var(--text-muted)', display: 'block', margin: '0 auto 12px' }} />
                <div style={{ fontSize: 15, fontWeight: 500, color: 'var(--text-secondary)' }}>{t('inventory.noStock')}</div>
                <div style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 4 }}>{t('inventory.noStockHint')}</div>
              </div>
            ),
          }}
        />
      </div>

      <AdjustDialog open={!!editingRow} warehouseSkuId={editingRow} onClose={() => setEditingRow(null)} />
      <ImportDialog open={showImportDialog} onClose={() => setShowImportDialog(false)} />
    </div>
  )
}
