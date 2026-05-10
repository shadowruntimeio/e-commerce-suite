import { Table, Input, Select, Space, DatePicker, Button, Modal, Tag, Popconfirm } from 'antd'
import {
  SyncOutlined, DownloadOutlined, EyeOutlined, ShoppingCartOutlined,
  PrinterOutlined, CheckOutlined, CloseOutlined,
} from '@ant-design/icons'
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query'
import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { message } from 'antd'
import { api } from '../../lib/api'
import { useAuthStore, isMerchant } from '../../store/auth.store'
import type { ColumnsType } from 'antd/es/table'
import dayjs from 'dayjs'

// Statuses whose labels TikTok will actually return. Anything else
// (SHIPPED, COMPLETED, CANCELLED, UNPAID, AFTER_SALES) is filtered out of
// bulk print to avoid pointless API calls.
const PRINTABLE_STATUSES = new Set(['TO_SHIP', 'PENDING'])

// An order may be split into multiple packages (TikTok assigns one package_id
// per line_item, but multiple items can share a package). Return the distinct
// package_ids in line-item order. Empty if no packages are present yet.
function packageIdsForOrder(order: { platformMetadata?: any }): string[] {
  const items = (order?.platformMetadata?.line_items ?? []) as Array<{ package_id?: string }>
  const seen = new Set<string>()
  const ordered: string[] = []
  for (const it of items) {
    if (it?.package_id && !seen.has(it.package_id)) {
      seen.add(it.package_id)
      ordered.push(it.package_id)
    }
  }
  return ordered
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: string }) {
  const { t } = useTranslation()
  const map: Record<string, { bg: string; color: string; label: string }> = {
    PENDING:     { bg: 'var(--badge-warning-bg)',  color: 'var(--badge-warning-fg)',  label: t('orders.pending') },
    TO_SHIP:     { bg: 'var(--badge-info-bg)',     color: 'var(--badge-info-fg)',     label: t('orders.toShip') },
    SHIPPED:     { bg: 'var(--badge-success-bg)',  color: 'var(--badge-success-fg)',  label: t('orders.shipped') },
    COMPLETED:   { bg: 'var(--badge-success-bg)',  color: 'var(--badge-success-fg)',  label: t('orders.completed') },
    CANCELLED:   { bg: 'var(--badge-neutral-bg)',  color: 'var(--badge-neutral-fg)',  label: t('orders.cancelled') },
    AFTER_SALES: { bg: 'var(--badge-purple-bg)',   color: 'var(--badge-purple-fg)',   label: t('orders.afterSales') },
    UNPAID:      { bg: 'var(--badge-error-bg)',    color: 'var(--badge-error-fg)',    label: t('orders.unpaid') },
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

// ─── Main component ───────────────────────────────────────────────────────────

export default function OrdersPage() {
  const { t } = useTranslation()
  const user = useAuthStore((s) => s.user)
  const merchantUser = isMerchant(user)
  const [statuses, setStatuses] = useState<string[]>(merchantUser ? [] : ['TO_SHIP'])
  const [search, setSearch] = useState('')
  const [shopId, setShopId] = useState<string | undefined>(undefined)
  const [merchantId, setMerchantId] = useState<string | undefined>(undefined)
  const [confirmStatus, setConfirmStatus] = useState<string | undefined>(
    merchantUser ? 'PENDING_CONFIRM' : undefined
  )
  const [page, setPage] = useState(1)
  const [bulkPrinting, setBulkPrinting] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [detailId, setDetailId] = useState<string | null>(null)
  const [sortBy, setSortBy] = useState<'sku' | 'date'>('sku')
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc')
  const queryClient = useQueryClient()

  // Sub-account list (for warehouse/admin merchant filter)
  const { data: merchants } = useQuery({
    enabled: !merchantUser,
    queryKey: ['merchants-for-filter'],
    queryFn: async () => (await api.get('/admin/users', { params: { role: 'MERCHANT' } })).data.data as Array<{ id: string; name: string; email: string }>,
  })

  const confirmMut = useMutation({
    mutationFn: ({ id, action }: { id: string; action: 'confirm' | 'cancel' }) =>
      api.post(`/orders/${id}/merchant-${action}`),
    onSuccess: () => {
      message.success(t('common.updated'))
      queryClient.invalidateQueries({ queryKey: ['orders'] })
    },
    onError: (err: any) => message.error(err?.response?.data?.error ?? t('returns.failed')),
  })

  function toggleStatus(key: string) {
    setPage(1)
    if (key === '') { setStatuses([]); return }
    setStatuses((prev) => prev.includes(key) ? prev.filter((s) => s !== key) : [...prev, key])
  }

  // Quiet sync: fire-and-forget trigger for all active shops, no UI. Used on
  // page mount and after order-mutating actions (print). Fires the sync and
  // invalidates the list after a delay long enough for (a) the worker to run
  // and (b) TikTok's own update-time propagation to settle (roughly 20s).
  const syncQuiet = useCallback(async () => {
    try {
      await api.post('/shops/sync-all')
      window.setTimeout(() => {
        void queryClient.invalidateQueries({ queryKey: ['orders'] })
      }, 20000)
    } catch {
      // Silent — this is a background nicety, not user-triggered.
    }
  }, [queryClient])

  // On mount (including when returning to this page from another route),
  // enqueue a sync so the list reflects fresh platform state.
  useEffect(() => {
    void syncQuiet()
  }, [syncQuiet])

  async function handleSyncNow() {
    if (!shops || shops.length === 0) {
      void message.warning(t('orders.noShopsToSync'))
      return
    }
    const targets = shopId ? shops.filter((s) => s.id === shopId) : shops
    if (targets.length === 0) return
    setSyncing(true)
    const hide = message.loading({ content: t('orders.syncing'), duration: 0, key: 'sync' })
    try {
      await Promise.all(targets.map((s) => api.post(`/shops/${s.id}/sync`)))
      // The sync runs asynchronously via BullMQ. Give it a beat then refetch.
      await new Promise((r) => setTimeout(r, 8000))
      await queryClient.invalidateQueries({ queryKey: ['orders'] })
      hide()
      void message.success({ content: t('orders.syncDone'), key: 'sync' })
    } catch (err: any) {
      hide()
      void message.error(err?.response?.data?.error ?? t('orders.syncFailed'))
    } finally {
      setSyncing(false)
    }
  }

  const { data: shops } = useQuery({
    queryKey: ['shops'],
    queryFn: () => api.get('/shops').then((r) => r.data.data as Array<{ id: string; name: string; platform: string }>),
  })

  async function handlePrintLabel(order: { id: string; platformMetadata?: any }) {
    const pkgs = packageIdsForOrder(order)
    const toastKey = `print-${order.id}`
    void message.loading({ content: t('orders.printing'), duration: 0, key: toastKey })
    try {
      // Single package (or unknown): original single-URL flow.
      if (pkgs.length <= 1) {
        const res = await api.get(`/orders/${order.id}/shipping-label`, {
          params: pkgs[0] ? { packageId: pkgs[0] } : undefined,
        })
        window.open(res.data.data.docUrl, '_blank')
        message.destroy(toastKey)
        void message.success(t('orders.printOpened'))
        void syncQuiet()
        return
      }
      // Multi-package: fetch each label, merge via pdf-lib, open one blob.
      const urls: string[] = []
      for (const pkg of pkgs) {
        const r = await api.get(`/orders/${order.id}/shipping-label`, { params: { packageId: pkg } })
        if (r.data?.data?.docUrl) urls.push(r.data.data.docUrl)
      }
      if (urls.length === 0) throw new Error('no labels')
      const { PDFDocument } = await import('pdf-lib')
      const merged = await PDFDocument.create()
      for (const u of urls) {
        const res = await api.get('/orders/label-proxy', { params: { url: u }, responseType: 'arraybuffer' })
        const src = await PDFDocument.load(res.data as ArrayBuffer)
        const pages = await merged.copyPages(src, src.getPageIndices())
        pages.forEach((p) => merged.addPage(p))
      }
      const blob = new Blob([new Uint8Array(await merged.save()).buffer], { type: 'application/pdf' })
      window.open(URL.createObjectURL(blob), '_blank')
      message.destroy(toastKey)
      void message.success(t('orders.printOpened'))
      void syncQuiet()
    } catch (err: any) {
      message.destroy(toastKey)
      void message.error(err?.response?.data?.error ?? t('orders.labelFailed'))
    }
  }

  const statusTabs = [
    { key: '', label: t('orders.all') },
    { key: 'UNPAID', label: t('orders.unpaid') },
    { key: 'PENDING', label: t('orders.pending') },
    { key: 'TO_SHIP', label: t('orders.toShip') },
    { key: 'SHIPPED', label: t('orders.shipped') },
    { key: 'COMPLETED', label: t('orders.completed') },
    { key: 'CANCELLED', label: t('orders.cancelled') },
  ]

  const { data, isLoading } = useQuery({
    queryKey: ['orders', { statuses, search, shopId, merchantId, confirmStatus, page, sortBy, sortOrder }],
    queryFn: () =>
      api.get('/orders', {
        params: {
          status: statuses.length ? statuses.join(',') : undefined,
          search: search || undefined,
          shopId: shopId || undefined,
          ownerUserId: merchantId || undefined,
          merchantConfirm: confirmStatus || undefined,
          page,
          pageSize: 20,
          sortBy,
          sortOrder,
        },
      }).then((r) => r.data.data),
    // Auto-poll so the list reflects backend updates (from both the 1-min
    // scheduled sync and action-triggered syncs) without manual refresh.
    refetchInterval: 30_000,
    refetchIntervalInBackground: false,
  })

  async function handlePrintAll() {
    // Re-fetch the entire filtered list (up to 200) and restrict to printable
    // statuses server-side filtering gave us.
    const res = await api.get('/orders', {
      params: {
        status: statuses.length ? statuses.join(',') : undefined,
        search: search || undefined,
        shopId: shopId || undefined,
        page: 1,
        pageSize: 200,
      },
    })
    const all = (res.data.data?.items ?? []) as Array<{ id: string; platformOrderId: string; status: string; platformMetadata?: any }>
    const printable = all.filter((o) => PRINTABLE_STATUSES.has(o.status))
    const skipped = all.length - printable.length

    if (printable.length === 0) {
      void message.info(t('orders.noneToPrint'))
      return
    }

    // Expand each order into one (orderId, packageId) task per distinct package.
    // Preserves order-then-package ordering so labels for the same order stay
    // adjacent in the merged PDF.
    const tasks: Array<{ orderId: string; packageId?: string }> = []
    for (const o of printable) {
      const pkgs = packageIdsForOrder(o)
      if (pkgs.length === 0) tasks.push({ orderId: o.id })
      else for (const pkg of pkgs) tasks.push({ orderId: o.id, packageId: pkg })
    }

    const content = t('orders.bulkPrintConfirm', { n: tasks.length })
      + (skipped > 0 ? ' ' + t('orders.bulkPrintSkipped', { skipped }) : '')
    const confirmed = await new Promise<boolean>((resolve) => {
      Modal.confirm({
        title: t('orders.bulkPrintTitle'),
        content,
        okText: t('orders.bulkPrintOk'),
        cancelText: t('common.cancel'),
        onOk: () => resolve(true),
        onCancel: () => resolve(false),
      })
    })
    if (!confirmed) return

    setBulkPrinting(true)
    let hide = message.loading(t('orders.bulkPrintProgress', { done: 0, total: tasks.length }), 0)
    let done = 0
    let failed = 0
    const urls: string[] = []
    try {
      for (const task of tasks) {
        try {
          const r = await api.get(`/orders/${task.orderId}/shipping-label`, {
            params: task.packageId ? { packageId: task.packageId } : undefined,
          })
          const url = r.data?.data?.docUrl
          if (url) urls.push(url)
          else failed++
        } catch {
          failed++
        }
        done++
        hide()
        hide = message.loading(t('orders.bulkPrintProgress', { done, total: tasks.length }), 0)
      }

      if (urls.length === 0) {
        void message.error(t('orders.bulkPrintDone', { done: 0, failed }))
        return
      }

      // Merge all PDFs into a single document so the user gets one print window
      // instead of N. Dynamic import keeps pdf-lib out of the main bundle.
      const { PDFDocument } = await import('pdf-lib')
      const merged = await PDFDocument.create()
      for (const u of urls) {
        try {
          // Fetch via our backend proxy — TikTok's CDN blocks browser CORS.
          const res = await api.get('/orders/label-proxy', {
            params: { url: u },
            responseType: 'arraybuffer',
          })
          const src = await PDFDocument.load(res.data as ArrayBuffer)
          const pages = await merged.copyPages(src, src.getPageIndices())
          pages.forEach((p) => merged.addPage(p))
        } catch {
          failed++
        }
      }
      const blob = new Blob([new Uint8Array(await merged.save()).buffer], { type: 'application/pdf' })
      const blobUrl = URL.createObjectURL(blob)
      window.open(blobUrl, '_blank')
    } finally {
      hide()
      setBulkPrinting(false)
    }
    void message.success(t('orders.bulkPrintDone', { done: urls.length, failed }))
    void syncQuiet()
  }

  const columns: ColumnsType<any> = [
    {
      title: t('orders.orderId'),
      dataIndex: 'platformOrderId',
      width: 160,
      render: (v) => (
        <span style={{ fontFamily: "'Courier New', monospace", color: 'var(--mono-color)', fontSize: 13 }}>{v}</span>
      ),
    },
    {
      title: t('orders.platform'),
      dataIndex: ['shop', 'platform'],
      width: 100,
      render: (v) => v ? <PlatformBadge platform={v} /> : '—',
    },
    { title: t('orders.shop'), dataIndex: ['shop', 'name'], width: 120, ellipsis: true },
    ...(!merchantUser ? [{
      title: t('orders.merchant'),
      key: 'merchant',
      width: 130,
      ellipsis: true,
      render: (_: any, r: any) => r.shop?.owner?.name ?? '—',
    }] : []),
    {
      title: t('orders.merchantConfirm'),
      dataIndex: 'merchantConfirmStatus',
      width: 140,
      render: (s: string) => {
        const colors: Record<string, string> = {
          PENDING_CONFIRM: 'gold',
          CONFIRMED: 'green',
          AUTO_CONFIRMED: 'blue',
          CANCELLED_BY_MERCHANT: 'red',
        }
        return <Tag color={colors[s] ?? 'default'} style={{ fontSize: 11 }}>{s}</Tag>
      },
    },
    { title: t('orders.buyer'), dataIndex: 'buyerName', width: 140, ellipsis: true },
    {
      title: t('orders.items'),
      dataIndex: 'items',
      width: 60,
      align: 'center',
      render: (items) => (
        <span style={{ background: 'var(--badge-neutral-bg)', color: 'var(--badge-neutral-fg)', borderRadius: 20, padding: '2px 8px', fontSize: 12, fontWeight: 500 }}>
          {items?.length ?? 0}
        </span>
      ),
    },
    {
      title: t('orders.sku'),
      dataIndex: 'items',
      key: 'sku',
      width: 140,
      sorter: true,
      sortOrder: sortBy === 'sku' ? (sortOrder === 'asc' ? 'ascend' : 'descend') : undefined,
      render: (items: Array<{ sellerSku?: string | null; quantity: number }>) => {
        if (!items?.length) return <span style={{ color: 'var(--text-muted)' }}>—</span>
        return (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2, fontSize: 12, fontFamily: "'Courier New', monospace" }}>
            {items.map((it, i) => (
              <span key={i} style={{ color: it.sellerSku ? 'var(--text-primary)' : 'var(--text-muted)' }}>
                {it.sellerSku ?? '—'}{it.quantity > 1 ? ` × ${it.quantity}` : ''}
              </span>
            ))}
          </div>
        )
      },
    },
    {
      title: t('common.status'),
      dataIndex: 'status',
      width: 120,
      render: (s) => <StatusBadge status={s} />,
    },
    {
      title: t('orders.revenue'),
      dataIndex: 'totalRevenue',
      width: 120,
      align: 'right',
      render: (v) => (
        <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>${Number(v).toFixed(2)}</span>
      ),
    },
    {
      title: t('orders.date'),
      dataIndex: 'createdAt',
      key: 'date',
      width: 140,
      sorter: true,
      sortOrder: sortBy === 'date' ? (sortOrder === 'asc' ? 'ascend' : 'descend') : undefined,
      render: (v) => dayjs(v).format('MMM D, HH:mm'),
    },
    {
      title: '',
      key: 'actions',
      width: 180,
      render: (_: any, record: any) => {
        const isPending = record.merchantConfirmStatus === 'PENDING_CONFIRM'
        const canMerchantAct = (merchantUser || user?.role === 'ADMIN') && isPending
        return (
          <div style={{ display: 'flex', gap: 2, alignItems: 'center' }}>
            {canMerchantAct && (
              <>
                <Popconfirm
                  title={t('orders.popconfirmConfirm')}
                  okText={t('common.confirm')}
                  cancelText={t('common.cancel')}
                  onConfirm={() => confirmMut.mutate({ id: record.id, action: 'confirm' })}
                >
                  <Button type="text" size="small" icon={<CheckOutlined />} style={{ color: 'var(--success-color, #16a34a)' }} title={t('orders.confirmTitle')} />
                </Popconfirm>
                <Popconfirm
                  title={t('orders.popconfirmCancel')}
                  okText={t('common.confirm')}
                  cancelText={t('common.cancel')}
                  onConfirm={() => confirmMut.mutate({ id: record.id, action: 'cancel' })}
                >
                  <Button type="text" size="small" icon={<CloseOutlined />} danger title={t('orders.cancelTitle')} />
                </Popconfirm>
              </>
            )}
            <Button
              type="text"
              size="small"
              icon={<EyeOutlined />}
              style={{ color: 'var(--text-secondary)' }}
              title={t('orders.viewDetail')}
              onClick={(e) => { e.stopPropagation(); setDetailId(record.id) }}
            />
            <Button
              type="text"
              size="small"
              icon={<PrinterOutlined />}
              style={{ color: 'var(--text-secondary)' }}
              onClick={(e) => {
                e.stopPropagation()
                handlePrintLabel(record)
              }}
            />
          </div>
        )
      },
    },
  ]

  return (
    <div>
      {/* Page Header */}
      <div style={{ marginBottom: 24 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700, color: 'var(--text-primary)' }}>{t('orders.title')}</h1>
            <p style={{ margin: '4px 0 0', color: 'var(--text-secondary)', fontSize: 14 }}>{t('orders.subtitle')}</p>
          </div>
          <Space>
            <Button
              icon={<SyncOutlined spin={syncing} />}
              loading={syncing}
              onClick={handleSyncNow}
              style={{ background: 'var(--accent-gradient)', color: '#fff', border: 'none', borderRadius: 8, height: 36, fontWeight: 600, fontSize: 14, boxShadow: '0 0 16px rgba(204,151,255,0.3)' }}
            >
              {t('common.syncNow')}
            </Button>
          </Space>
        </div>
      </div>

      {/* Status Tabs (multi-select; "All" clears) */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 16, flexWrap: 'wrap' }}>
        {statusTabs.map((tab) => {
          const isActive = tab.key === '' ? statuses.length === 0 : statuses.includes(tab.key)
          return (
            <button
              key={tab.key}
              onClick={() => toggleStatus(tab.key)}
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
          placeholder={t('orders.searchPlaceholder')}
          allowClear
          onSearch={(v) => { setSearch(v); setPage(1) }}
          style={{ width: 260 }}
        />
        {!merchantUser && (
          <Select
            allowClear
            placeholder={t('orders.allMerchants')}
            style={{ width: 200 }}
            value={merchantId}
            onChange={(v) => { setMerchantId(v); setPage(1) }}
            options={(merchants ?? []).map((m) => ({ value: m.id, label: m.name }))}
          />
        )}
        <Select
          allowClear
          placeholder={t('orders.allShops')}
          style={{ width: 180 }}
          value={shopId}
          onChange={(v) => { setShopId(v); setPage(1) }}
          options={(shops ?? []).map((s) => ({ value: s.id, label: s.name }))}
        />
        <Select
          allowClear
          placeholder={t('orders.confirmFilter')}
          style={{ width: 200 }}
          value={confirmStatus}
          onChange={(v) => { setConfirmStatus(v); setPage(1) }}
          options={[
            { value: 'PENDING_CONFIRM', label: t('orders.cfPending') },
            { value: 'CONFIRMED', label: t('orders.cfConfirmed') },
            { value: 'AUTO_CONFIRMED', label: t('orders.cfAuto') },
            { value: 'CANCELLED_BY_MERCHANT', label: t('orders.cfCancelled') },
          ]}
        />
        <DatePicker.RangePicker style={{ borderRadius: 8 }} />
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
          <Button
            icon={<PrinterOutlined />}
            loading={bulkPrinting}
            onClick={handlePrintAll}
            style={{ background: 'var(--accent-gradient)', color: '#fff', border: 'none', borderRadius: 8, height: 36, fontWeight: 600, fontSize: 14, boxShadow: '0 0 16px rgba(204,151,255,0.3)' }}
          >
            {t('orders.printAll')}
          </Button>
          <Button
            icon={<DownloadOutlined />}
            style={{ background: 'var(--header-btn-bg)', color: 'var(--header-btn-color)', border: 'var(--header-btn-border)', borderRadius: 8, height: 36, fontWeight: 500, fontSize: 14 }}
          >
            {t('common.export')}
          </Button>
        </div>
      </div>

      {/* Filter totals — counts span the entire filtered set, not just the current page. */}
      <div style={{
        display: 'flex',
        gap: 24,
        marginBottom: 12,
        padding: '10px 20px',
        background: 'var(--bg-card)',
        border: '1px solid var(--border)',
        borderRadius: 12,
        fontSize: 13,
        color: 'var(--text-secondary)',
      }}>
        <span>{t('orders.footerOrders')}<strong style={{ color: 'var(--text-primary)', marginLeft: 6 }}>{data?.total ?? 0}</strong></span>
        <span>{t('orders.footerItems')}<strong style={{ color: 'var(--text-primary)', marginLeft: 6 }}>{data?.totalItems ?? 0}</strong></span>
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
          onChange={(_p, _f, sorter) => {
            const s = Array.isArray(sorter) ? sorter[0] : sorter
            const key = (s?.columnKey as 'sku' | 'date') ?? 'sku'
            const order = s?.order === 'ascend' ? 'asc' : 'desc'
            // Antd emits order=undefined when user clicks a sorter to "none".
            // Keep SKU-desc as the fallback so the list is never unsorted.
            setSortBy(s?.order ? key : 'sku')
            setSortOrder(s?.order ? order : 'desc')
            setPage(1)
          }}
          pagination={{
            current: page,
            pageSize: 20,
            total: data?.total ?? 0,
            onChange: (p) => setPage(p),
            showSizeChanger: false,
            showTotal: (total) => t('common.records', { count: total }),
            style: { padding: '12px 20px' },
          }}
          scroll={{ x: 'max-content' }}
          locale={{
            emptyText: (
              <div style={{ padding: '48px 0', color: 'var(--text-muted)', textAlign: 'center' }}>
                <ShoppingCartOutlined style={{ fontSize: 40, marginBottom: 12, display: 'block', margin: '0 auto 12px' }} />
                <div style={{ fontSize: 15, fontWeight: 500, color: 'var(--text-secondary)' }}>{t('orders.noOrders')}</div>
                <div style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 4 }}>{t('orders.noOrdersHint')}</div>
              </div>
            ),
          }}
        />
      </div>

      <OrderDetailModal id={detailId} onClose={() => setDetailId(null)} />
    </div>
  )
}

// ─── Order detail modal ─────────────────────────────────────────────────────

function OrderDetailModal({ id, onClose }: { id: string | null; onClose: () => void }) {
  const { t } = useTranslation()
  const { data, isLoading } = useQuery({
    enabled: !!id,
    queryKey: ['order-detail', id],
    queryFn: () => api.get(`/orders/${id}`).then((r) => r.data.data),
  })

  const order = data
  const addr = order?.shippingAddress as
    | { full_address?: string; name?: string; phone_number?: string; region_code?: string }
    | undefined

  return (
    <Modal
      open={!!id}
      onCancel={onClose}
      footer={null}
      width={760}
      title={t('orders.detailTitle')}
      destroyOnClose
    >
      {isLoading || !order ? (
        <div style={{ padding: '40px 0', textAlign: 'center', color: 'var(--text-muted)' }}>{t('common.loading')}</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          {/* Header */}
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <span style={{ fontFamily: "'Courier New', monospace", fontSize: 14, fontWeight: 600 }}>{order.platformOrderId}</span>
              <StatusBadge status={order.status} />
              <Tag color={order.merchantConfirmStatus === 'CONFIRMED' ? 'green'
                : order.merchantConfirmStatus === 'AUTO_CONFIRMED' ? 'blue'
                : order.merchantConfirmStatus === 'CANCELLED_BY_MERCHANT' ? 'red'
                : 'orange'}>
                {order.merchantConfirmStatus}
              </Tag>
            </div>
            <div style={{ marginTop: 6, fontSize: 12, color: 'var(--text-muted)' }}>
              {order.platformCreatedAt ? dayjs(order.platformCreatedAt).format('YYYY-MM-DD HH:mm') : '—'}
            </div>
          </div>

          {/* Two-column metadata */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 16 }}>
            <DetailField label={t('orders.detailShop')} value={`${order.shop?.name ?? '—'} (${order.shop?.platform ?? '—'})`} />
            <DetailField label={t('orders.detailMerchant')} value={order.shop?.owner?.name ?? order.shop?.owner?.email ?? '—'} />
            <DetailField label={t('orders.detailBuyer')} value={order.buyerName ?? '—'} />
            <DetailField label={t('orders.detailPhone')} value={order.buyerPhone ?? '—'} />
            <DetailField
              label={t('orders.detailAddress')}
              value={addr?.full_address ?? '—'}
              span={2}
            />
            <DetailField label={t('orders.detailTotal')} value={`${order.currency ?? ''} ${order.totalRevenue ?? 0}`} />
            <DetailField label={t('orders.detailFirstSku')} value={order.firstSellerSku ?? '—'} />
          </div>

          {/* Items */}
          <div>
            <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8, color: 'var(--text-primary)' }}>
              {t('orders.detailItems')} ({order.items?.length ?? 0})
            </div>
            <Table
              size="small"
              rowKey="id"
              pagination={false}
              dataSource={order.items ?? []}
              columns={[
                { title: t('orders.detailItemSku'), dataIndex: 'sellerSku', key: 'sellerSku', render: (v: string | null) => v || <span style={{ color: 'var(--text-muted)' }}>—</span> },
                { title: t('orders.detailItemName'), dataIndex: 'productName', key: 'productName', ellipsis: true },
                { title: t('orders.detailItemVariant'), dataIndex: 'skuName', key: 'skuName', render: (v: string | null) => v || <span style={{ color: 'var(--text-muted)' }}>—</span> },
                { title: t('orders.detailItemQty'), dataIndex: 'quantity', key: 'quantity', width: 70, align: 'right' as const },
                { title: t('orders.detailItemPrice'), dataIndex: 'unitPrice', key: 'unitPrice', width: 100, align: 'right' as const, render: (v: any) => `${order.currency ?? ''} ${v ?? 0}` },
              ]}
            />
          </div>

          {/* After-sales tickets if any */}
          {order.afterSalesTickets?.length > 0 && (
            <div>
              <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>{t('orders.detailReturns')}</div>
              {order.afterSalesTickets.map((tk: any) => (
                <div key={tk.id} style={{ fontSize: 12, color: 'var(--text-secondary)', padding: '6px 10px', background: 'var(--bg-surface)', borderRadius: 6, marginBottom: 4 }}>
                  {tk.type} · {tk.status} · review={tk.reviewStatus}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </Modal>
  )
}

function DetailField({ label, value, span = 1 }: { label: string; value: React.ReactNode; span?: number }) {
  return (
    <div style={{ gridColumn: `span ${span}` }}>
      <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 4, textTransform: 'uppercase', letterSpacing: 0.4 }}>{label}</div>
      <div style={{ fontSize: 13, color: 'var(--text-primary)' }}>{value}</div>
    </div>
  )
}
