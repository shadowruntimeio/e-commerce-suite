import { useEffect, useRef, useState } from 'react'
import { Card, Table, Tag, Button, Modal, Form, InputNumber, Input, Select, Space, message, Popconfirm, Radio, Drawer, Descriptions, Checkbox } from 'antd'
import { ScanOutlined } from '@ant-design/icons'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { api } from '../../lib/api'
import { useAuthStore, hasCapability, isMerchant } from '../../store/auth.store'
import { useIsMobile } from '../../components/layout/AppLayout'
import dayjs from 'dayjs'

// localStorage key for the "skip confirm next time" preference. Per-user is
// unnecessary — anyone using the warehouse account on this device implicitly
// shares the preference, which is the intended behaviour for shared scanners.
const SKIP_CONFIRM_KEY = 'returns:scan-skip-confirm'

// TK tells us exactly what the seller must do via nextSellerActions; we
// route buttons off these instead of guessing from return_status.
const ACTION_WAREHOUSE_RECEIVE = 'SELLER_RESPOND_RECEIVE_PACKAGE'
const isMerchantAction = (a: string) => a.startsWith('SELLER_RESPOND_') && a !== ACTION_WAREHOUSE_RECEIVE

// Real return_status values observed against live TK shops. Anything not
// listed here will fall back to the raw string via i18n's defaultValue.
const TK_STATUS_OPTIONS = [
  'AWAITING_BUYER_SHIP',
  'BUYER_SHIPPED_ITEM',
  'RETURN_OR_REFUND_REQUEST_SUCCESS',
  'RETURN_OR_REFUND_REQUEST_COMPLETE',
  'RETURN_OR_REFUND_REQUEST_CANCEL',
]

const TK_STATUS_COLORS: Record<string, string> = {
  AWAITING_BUYER_SHIP: 'gold',
  BUYER_SHIPPED_ITEM: 'cyan',
  RETURN_OR_REFUND_REQUEST_SUCCESS: 'geekblue',
  RETURN_OR_REFUND_REQUEST_COMPLETE: 'green',
  RETURN_OR_REFUND_REQUEST_CANCEL: 'default',
}

const CONDITION_COLORS: Record<string, string> = {
  PENDING_INSPECTION: 'gold',
  SELLABLE: 'green',
  DAMAGED: 'red',
  DISPOSED: 'default',
}

interface AfterSalesTicket {
  id: string
  orderId: string
  type: string
  platformReturnId: string | null
  platformReturnStatus: string | null
  nextSellerActions: string[]
  platformPayload: Record<string, any>
  expectedQty: number | null
  returnedQty: number | null
  condition: string
  warehouseSkuId: string | null
  arrivedAt: string | null
  inspectedAt: string | null
  restockedAt: string | null
  notes: string | null
  createdAt: string
  order: {
    id: string
    platformOrderId: string
    buyerName: string | null
    shop: { id: string; name: string; ownerUserId: string; owner: { name: string } | null }
    items: Array<{ id: string; productName: string; quantity: number; sellerSku: string | null; systemSkuId: string | null }>
  }
}

export default function ReturnsPage() {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const user = useAuthStore((s) => s.user)
  const merchantUser = isMerchant(user)
  const isMobile = useIsMobile()
  const canIntake = hasCapability(user, 'RETURN_INTAKE')
  const [processTicket, setProcessTicket] = useState<AfterSalesTicket | null>(null)
  const [rejectTicket, setRejectTicket] = useState<AfterSalesTicket | null>(null)
  const [detailTicket, setDetailTicket] = useState<AfterSalesTicket | null>(null)
  // Scan-to-intake flow state
  const [scannerOpen, setScannerOpen] = useState(false)
  const [scanConfirmTicket, setScanConfirmTicket] = useState<AfterSalesTicket | null>(null)
  // Persist the "don't ask again" preference across reloads, but re-read on
  // every confirm modal mount so toggling it off in one session sticks.
  const skipConfirmRef = useRef<boolean>(
    typeof localStorage !== 'undefined' && localStorage.getItem(SKIP_CONFIRM_KEY) === '1',
  )

  // Warehouse split: "actionable" (default) vs "done" (recent processed).
  const [view, setView] = useState<'actionable' | 'done'>('actionable')
  const [statusFilter, setStatusFilter] = useState<string | undefined>(undefined)

  const ticketsQ = useQuery({
    queryKey: ['returns', merchantUser ? 'merchant' : view, statusFilter],
    queryFn: async () => {
      const params: Record<string, string> = { pageSize: '100' }
      if (!merchantUser) params.view = view
      if (statusFilter) params.platformReturnStatus = statusFilter
      const r = await api.get('/returns', { params })
      return r.data.data.items as AfterSalesTicket[]
    },
  })

  const refetch = () => qc.invalidateQueries({ queryKey: ['returns'] })

  const approveMut = useMutation({
    mutationFn: (id: string) => api.post(`/returns/${id}/approve`),
    onSuccess: () => { void message.success(t('returns.approved')); refetch() },
    onError: (err: any) => message.error(err?.response?.data?.error ?? t('returns.failed')),
  })
  const rejectMut = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) =>
      api.post(`/returns/${id}/reject`, { reason }),
    onSuccess: () => { void message.success(t('returns.rejected')); setRejectTicket(null); refetch() },
    onError: (err: any) => message.error(err?.response?.data?.error ?? t('returns.failed')),
  })
  const processMut = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Record<string, unknown> }) =>
      api.post(`/returns/${id}/process`, data),
    onSuccess: () => { void message.success(t('returns.processed')); setProcessTicket(null); refetch() },
    onError: (err: any) => message.error(err?.response?.data?.error ?? t('returns.failed')),
  })

  // Scan-intake (mobile warehouse flow). Lookup first to surface a clear
  // "no match" error before we ever hit the intake endpoint.
  const scanIntakeMut = useMutation({
    mutationFn: (id: string) => api.post(`/returns/${id}/scan-intake`),
    onSuccess: (res, _id) => {
      const t1 = res.data?.data
      const already = res.data?.alreadyArrived
      void message.success(
        already
          ? t('returns.scanArrivedAlready', { when: dayjs(t1?.arrivedAt).format('YYYY-MM-DD HH:mm') })
          : t('returns.scanSuccess', { orderId: scanConfirmTicket?.order.platformOrderId ?? '' }),
      )
      setScanConfirmTicket(null)
      refetch()
    },
    onError: (err: any) => message.error(err?.response?.data?.error ?? t('returns.failed')),
  })

  async function handleScanDecode(code: string) {
    // Close the camera modal immediately — we don't want a second decode
    // firing while we resolve the match.
    setScannerOpen(false)
    try {
      const res = await api.post('/returns/scan-lookup', { code })
      const ticket = res.data?.data as AfterSalesTicket | undefined
      if (!ticket) {
        Modal.error({
          title: t('returns.scanLookupFailedTitle'),
          content: t('returns.scanLookupFailed', { code }),
          okText: t('returns.scanLookupFailedRetry'),
          onOk: () => setScannerOpen(true),
        })
        return
      }
      // Skip-confirm path: fire intake directly. We still show the success
      // toast so the warehouse worker gets visible feedback.
      if (skipConfirmRef.current) {
        scanIntakeMut.mutate(ticket.id)
        // Need this for the success toast's interpolation, even though we
        // don't open the confirm modal.
        setScanConfirmTicket(ticket)
        return
      }
      setScanConfirmTicket(ticket)
    } catch (err: any) {
      if (err?.response?.status === 404) {
        Modal.error({
          title: t('returns.scanLookupFailedTitle'),
          content: t('returns.scanLookupFailed', { code }),
          okText: t('returns.scanLookupFailedRetry'),
          onOk: () => setScannerOpen(true),
        })
      } else {
        void message.error(err?.response?.data?.error ?? t('returns.failed'))
      }
    }
  }

  const renderTkStatus = (s: string | null) => {
    if (!s) return <span style={{ color: 'var(--text-muted)' }}>—</span>
    return <Tag color={TK_STATUS_COLORS[s] ?? 'default'}>{t(`returns.tk.${s}`, { defaultValue: s })}</Tag>
  }

  const renderWarehouseStatus = (r: AfterSalesTicket) => {
    if (!r.arrivedAt) return <Tag color="default">{t('returns.notArrived')}</Tag>
    return (
      <Space size={4}>
        <Tag color={CONDITION_COLORS[r.condition] ?? 'default'}>
          {t(`returns.cond.${r.condition}`, { defaultValue: r.condition })}
        </Tag>
        {r.restockedAt && <Tag color="green">{t('returns.restocked')}</Tag>}
      </Space>
    )
  }

  const columns = [
    {
      title: t('returns.order'), dataIndex: ['order', 'platformOrderId'], key: 'order',
      render: (v: string) => (
        <span style={{ fontFamily: "'Courier New', monospace", fontSize: 13 }}>{v}</span>
      ),
    },
    { title: t('returns.shop'), dataIndex: ['order', 'shop', 'name'], key: 'shop', ellipsis: true },
    ...(!merchantUser ? [{
      title: t('returns.merchant'),
      key: 'merchant',
      ellipsis: true,
      render: (_: unknown, r: AfterSalesTicket) => r.order.shop.owner?.name ?? '—',
    }] : []),
    {
      title: t('returns.platformStatus'),
      dataIndex: 'platformReturnStatus',
      key: 'platformReturnStatus',
      render: renderTkStatus,
    },
    {
      title: t('returns.warehouseStatus'),
      key: 'warehouseStatus',
      render: (_: unknown, r: AfterSalesTicket) => renderWarehouseStatus(r),
    },
    {
      title: t('returns.qty'), key: 'qty',
      render: (_: unknown, r: AfterSalesTicket) => (
        <span style={{ fontFamily: "'Courier New', monospace", fontSize: 13 }}>
          {r.returnedQty ?? '—'} / {r.expectedQty ?? '?'}
        </span>
      ),
    },
    {
      title: t('returns.arrived'), dataIndex: 'arrivedAt', key: 'arrivedAt',
      render: (v: string | null) => v ? dayjs(v).format('YYYY-MM-DD HH:mm') : '—',
    },
    {
      title: t('returns.actions'), key: 'actions',
      render: (_: unknown, r: AfterSalesTicket) => {
        const isMerchantOrAdmin = merchantUser || user?.role === 'ADMIN'
        const merchantActionPending = (r.nextSellerActions ?? []).some(isMerchantAction)
        const warehouseActionPending = (r.nextSellerActions ?? []).includes(ACTION_WAREHOUSE_RECEIVE)
        const canApprove = isMerchantOrAdmin && merchantActionPending
        const canProcess = hasCapability(user, 'RETURN_INTAKE') && warehouseActionPending && !r.arrivedAt
        const hasAnyAction = canApprove || canProcess
        return (
          <Space size={4}>
            {canApprove && (
              <>
                <Popconfirm
                  title={t('returns.approveTitle')}
                  okText={t('returns.approveBtn')}
                  cancelText={t('common.cancel')}
                  onConfirm={() => approveMut.mutate(r.id)}
                >
                  <Button size="small" type="primary" loading={approveMut.isPending}>
                    {t('returns.approveBtn')}
                  </Button>
                </Popconfirm>
                <Button size="small" danger onClick={() => setRejectTicket(r)}>
                  {t('returns.rejectBtn')}
                </Button>
              </>
            )}
            {canProcess && (
              <Button size="small" type="primary" onClick={() => setProcessTicket(r)}>
                {t('returns.processBtn')}
              </Button>
            )}
            {!hasAnyAction && (
              <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>
                {(r.nextSellerActions ?? []).length === 0
                  ? t('returns.noActionNeeded')
                  : warehouseActionPending
                    ? t('returns.waitingWarehouse')
                    : merchantActionPending
                      ? t('returns.waitingMerchant')
                      : t('returns.actionElsewhere')}
              </span>
            )}
            <Button size="small" type="link" onClick={() => setDetailTicket(r)}>
              {t('returns.detailBtn')}
            </Button>
          </Space>
        )
      },
    },
  ]

  const tickets = ticketsQ.data ?? []

  return (
    <Card styles={{ body: { padding: isMobile ? 12 : 24 } }}>
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        gap: 8,
        marginBottom: 12,
        flexWrap: 'wrap',
      }}>
        {/* Scan button — only renders for warehouse users with the capability
            and on mobile, since the camera flow is the whole point. */}
        {isMobile && canIntake ? (
          <Button
            type="primary"
            icon={<ScanOutlined />}
            onClick={() => setScannerOpen(true)}
            style={{ flexShrink: 0 }}
          >
            {t('returns.scanIntakeBtn')}
          </Button>
        ) : <span />}
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'flex-end', flex: 1 }}>
          {!merchantUser && (
            <Radio.Group value={view} onChange={(e) => setView(e.target.value)} optionType="button" buttonStyle="solid" size={isMobile ? 'small' : 'middle'}>
              <Radio.Button value="actionable">{t('returns.viewActionable')}</Radio.Button>
              <Radio.Button value="done">{t('returns.viewDone')}</Radio.Button>
            </Radio.Group>
          )}
          <Select
            allowClear
            placeholder={t('returns.allPlatformStates')}
            style={{ width: isMobile ? '100%' : 240 }}
            size={isMobile ? 'middle' : 'middle'}
            value={statusFilter}
            onChange={setStatusFilter}
            options={TK_STATUS_OPTIONS.map((s) => ({
              value: s,
              label: t(`returns.tk.${s}`, { defaultValue: s }),
            }))}
          />
        </div>
      </div>

      {isMobile ? (
        <MobileTicketList
          tickets={tickets}
          loading={ticketsQ.isLoading}
          merchantUser={merchantUser}
          user={user}
          approveMut={approveMut}
          processMut={processMut}
          onReject={setRejectTicket}
          onProcess={setProcessTicket}
          onDetail={setDetailTicket}
        />
      ) : (
        <Table
          rowKey="id"
          loading={ticketsQ.isLoading}
          dataSource={tickets}
          columns={columns}
          pagination={{ pageSize: 20 }}
          scroll={{ x: 'max-content' }}
        />
      )}

      {rejectTicket && (
        <RejectModal
          ticket={rejectTicket}
          onClose={() => setRejectTicket(null)}
          onSubmit={(reason) => rejectMut.mutate({ id: rejectTicket.id, reason })}
          loading={rejectMut.isPending}
        />
      )}

      {processTicket && (
        <ProcessModal
          ticket={processTicket}
          onClose={() => setProcessTicket(null)}
          onSubmit={(data) => processMut.mutate({ id: processTicket.id, data })}
          loading={processMut.isPending}
        />
      )}

      {scannerOpen && (
        <ScannerModal
          onClose={() => setScannerOpen(false)}
          onDecode={handleScanDecode}
        />
      )}

      {scanConfirmTicket && !skipConfirmRef.current && (
        <ScanConfirmModal
          ticket={scanConfirmTicket}
          loading={scanIntakeMut.isPending}
          onCancel={() => setScanConfirmTicket(null)}
          onConfirm={(skip) => {
            if (skip) {
              localStorage.setItem(SKIP_CONFIRM_KEY, '1')
              skipConfirmRef.current = true
              void message.info(t('returns.scanSkipReminderOn'))
            }
            scanIntakeMut.mutate(scanConfirmTicket.id)
          }}
        />
      )}

      <DetailDrawer ticket={detailTicket} onClose={() => setDetailTicket(null)} />
    </Card>
  )
}

function DetailDrawer({ ticket, onClose }: { ticket: AfterSalesTicket | null; onClose: () => void }) {
  const { t } = useTranslation()
  if (!ticket) return null
  const payload = ticket.platformPayload ?? {}
  const lineItems: Array<{ seller_sku?: string; product_name?: string; sku_name?: string }> = (payload.return_line_items ?? []) as any
  const refund = payload.refund_amount ?? {}
  return (
    <Drawer
      open
      onClose={onClose}
      width={520}
      title={`${t('returns.detailTitle')} · ${ticket.order.platformOrderId}`}
    >
      <Descriptions column={1} size="small" bordered>
        <Descriptions.Item label={t('returns.platformStatus')}>
          <Tag color={TK_STATUS_COLORS[ticket.platformReturnStatus ?? ''] ?? 'default'}>
            {t(`returns.tk.${ticket.platformReturnStatus ?? ''}`, { defaultValue: ticket.platformReturnStatus ?? '—' })}
          </Tag>
        </Descriptions.Item>
        <Descriptions.Item label={t('returns.platformReturnId')}>
          <span style={{ fontFamily: 'monospace', fontSize: 12 }}>{ticket.platformReturnId ?? '—'}</span>
        </Descriptions.Item>
        <Descriptions.Item label={t('returns.reason')}>
          {payload.return_reason_text ?? payload.return_reason ?? '—'}
        </Descriptions.Item>
        <Descriptions.Item label={t('returns.refundTotal')}>
          {refund.refund_total ? `${refund.currency ?? ''} ${refund.refund_total}` : '—'}
        </Descriptions.Item>
        <Descriptions.Item label={t('returns.returnTracking')}>
          <span style={{ fontFamily: 'monospace', fontSize: 12 }}>
            {payload.return_tracking_number ?? '—'}
            {payload.return_provider_name && <span style={{ color: 'var(--text-muted)', marginLeft: 6 }}>({payload.return_provider_name})</span>}
          </span>
        </Descriptions.Item>
        <Descriptions.Item label={t('returns.warehouseStatus')}>
          {ticket.arrivedAt
            ? `${t(`returns.cond.${ticket.condition}`, { defaultValue: ticket.condition })} · ${ticket.returnedQty ?? '—'}${ticket.restockedAt ? ' · ' + t('returns.restocked') : ''}`
            : t('returns.notArrived')}
        </Descriptions.Item>
        <Descriptions.Item label={t('returns.expectedQty')}>{ticket.expectedQty ?? '—'}</Descriptions.Item>
        {ticket.nextSellerActions.length > 0 && (
          <Descriptions.Item label={t('returns.nextActions')}>
            <Space wrap size={4}>
              {ticket.nextSellerActions.map((a) => (
                <Tag key={a} color="orange">{a}</Tag>
              ))}
            </Space>
          </Descriptions.Item>
        )}
      </Descriptions>

      {lineItems.length > 0 && (
        <div style={{ marginTop: 16 }}>
          <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>{t('returns.lineItems')}</div>
          {lineItems.map((li, i) => (
            <div key={i} style={{ background: 'var(--bg-surface)', borderRadius: 6, padding: '8px 10px', marginBottom: 6, fontSize: 12 }}>
              <div style={{ fontWeight: 500 }}>{li.product_name ?? '—'}</div>
              <div style={{ color: 'var(--text-muted)', marginTop: 2 }}>
                {li.seller_sku && <span style={{ fontFamily: 'monospace' }}>{li.seller_sku}</span>}
                {li.sku_name && <span style={{ marginLeft: 6 }}>· {li.sku_name}</span>}
              </div>
            </div>
          ))}
        </div>
      )}
    </Drawer>
  )
}

function RejectModal({
  ticket, onClose, onSubmit, loading,
}: {
  ticket: AfterSalesTicket
  onClose: () => void
  onSubmit: (reason: string) => void
  loading: boolean
}) {
  const { t } = useTranslation()
  const [form] = Form.useForm()
  return (
    <Modal
      open
      title={t('returns.rejectTitle')}
      onCancel={() => { form.resetFields(); onClose() }}
      onOk={() => form.submit()}
      okText={t('returns.rejectBtn')}
      okButtonProps={{ danger: true, loading }}
      cancelText={t('common.cancel')}
      destroyOnClose
    >
      <p>{t('returns.order')}: {ticket.order.platformOrderId}</p>
      <Form form={form} layout="vertical" onFinish={(v) => onSubmit(v.reason)}>
        <Form.Item label={t('returns.rejectReason')} name="reason" rules={[{ required: true }]}>
          <Input.TextArea rows={3} placeholder={t('returns.rejectReasonPlaceholder')} />
        </Form.Item>
      </Form>
    </Modal>
  )
}

function ProcessModal({
  ticket, onClose, onSubmit, loading,
}: {
  ticket: AfterSalesTicket
  onClose: () => void
  onSubmit: (data: Record<string, unknown>) => void
  loading: boolean
}) {
  const { t } = useTranslation()
  const [form] = Form.useForm()
  const condition = Form.useWatch('condition', form)
  const stockQ = useQuery({
    enabled: condition === 'SELLABLE',
    queryKey: ['inventory-stock-for-return', ticket.order.shop.ownerUserId],
    queryFn: async () => (await api.get('/inventory/stock', {
      params: { ownerUserId: ticket.order.shop.ownerUserId, pageSize: 100 },
    })).data.data.items,
  })

  const tkStatusHint = !(ticket.nextSellerActions ?? []).includes('SELLER_RESPOND_RECEIVE_PACKAGE')
    ? t('returns.processTkStatusWarn', { status: t(`returns.tk.${ticket.platformReturnStatus ?? ''}`, { defaultValue: ticket.platformReturnStatus ?? '—' }) })
    : null

  return (
    <Modal
      open
      title={t('returns.processTitle')}
      onCancel={() => { form.resetFields(); onClose() }}
      onOk={() => form.submit()}
      okText={t('returns.processOk')}
      okButtonProps={{ loading }}
      cancelText={t('common.cancel')}
      destroyOnClose
      width={520}
    >
      <p style={{ marginBottom: 4 }}>{t('returns.order')}: <strong>{ticket.order.platformOrderId}</strong></p>
      <p style={{ marginTop: 0, color: 'var(--text-muted)', fontSize: 13 }}>
        {t('returns.expectedQty')}: {ticket.expectedQty ?? '—'}
      </p>
      {tkStatusHint && (
        <div style={{ background: 'var(--badge-warning-bg)', color: 'var(--badge-warning-fg)', padding: '8px 12px', borderRadius: 6, marginBottom: 16, fontSize: 13 }}>
          {tkStatusHint}
        </div>
      )}
      <Form
        form={form}
        layout="vertical"
        onFinish={(v) => {
          const data: Record<string, unknown> = {
            condition: v.condition,
            returnedQty: v.returnedQty,
            notes: v.notes,
          }
          if (v.condition === 'SELLABLE') data.warehouseSkuId = v.warehouseSkuId
          onSubmit(data)
        }}
        initialValues={{
          condition: 'SELLABLE',
          returnedQty: ticket.expectedQty ?? 1,
          warehouseSkuId: ticket.warehouseSkuId ?? undefined,
        }}
      >
        <Form.Item label={t('returns.condition')} name="condition" rules={[{ required: true }]}>
          <Select options={[
            { value: 'SELLABLE', label: t('returns.cond.SELLABLE') },
            { value: 'DAMAGED', label: t('returns.cond.DAMAGED') },
          ]} />
        </Form.Item>
        <Form.Item label={t('returns.returnedQty')} name="returnedQty" rules={[{ required: true }]}>
          <InputNumber min={0} style={{ width: '100%' }} />
        </Form.Item>
        {condition === 'SELLABLE' && (
          <Form.Item label={t('returns.restockTo')} name="warehouseSkuId" rules={[{ required: true }]}>
            <Select
              showSearch
              placeholder={t('returns.pickWhSku')}
              optionFilterProp="label"
              options={(stockQ.data ?? []).map((s: any) => ({
                value: s.warehouseSkuId,
                label: `${s.skuCode} • ${s.warehouseName} (${t('returns.onHand')}: ${s.quantityOnHand})`,
              }))}
            />
          </Form.Item>
        )}
        <Form.Item label={t('returns.notes')} name="notes">
          <Input.TextArea rows={2} />
        </Form.Item>
      </Form>
    </Modal>
  )
}

// ─── Mobile card list ─────────────────────────────────────────────────────────

// Stacked-card alternative to the desktop table. Reuses the same per-row
// gating logic (canApprove / canProcess / etc) so behaviour stays consistent;
// only the layout changes.
function MobileTicketList({
  tickets, loading, merchantUser, user,
  approveMut, processMut, onReject, onProcess, onDetail,
}: {
  tickets: AfterSalesTicket[]
  loading: boolean
  merchantUser: boolean
  user: ReturnType<typeof useAuthStore.getState>['user']
  approveMut: ReturnType<typeof useMutation<unknown, unknown, string>>
  processMut: ReturnType<typeof useMutation<unknown, unknown, { id: string; data: Record<string, unknown> }>>
  onReject: (t: AfterSalesTicket) => void
  onProcess: (t: AfterSalesTicket) => void
  onDetail: (t: AfterSalesTicket) => void
}) {
  const { t } = useTranslation()
  if (loading) {
    return <div style={{ padding: 32, textAlign: 'center', color: 'var(--text-muted)' }}>{t('common.loading')}</div>
  }
  if (tickets.length === 0) {
    return <div style={{ padding: 32, textAlign: 'center', color: 'var(--text-muted)' }}>{t('common.noData')}</div>
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {tickets.map((r) => {
        const isMerchantOrAdmin = merchantUser || user?.role === 'ADMIN'
        const merchantActionPending = (r.nextSellerActions ?? []).some(isMerchantAction)
        const warehouseActionPending = (r.nextSellerActions ?? []).includes(ACTION_WAREHOUSE_RECEIVE)
        const canApprove = isMerchantOrAdmin && merchantActionPending
        const canProcess = hasCapability(user, 'RETURN_INTAKE') && warehouseActionPending && !r.arrivedAt
        return (
          <div key={r.id} style={{
            border: '1px solid var(--border)',
            borderRadius: 10,
            padding: 12,
            background: 'var(--bg-card)',
            display: 'flex',
            flexDirection: 'column',
            gap: 8,
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontFamily: "'Courier New', monospace", fontSize: 13, fontWeight: 600 }}>
                  {r.order.platformOrderId}
                </div>
                <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
                  {r.order.shop.name}
                </div>
              </div>
              <Tag color={TK_STATUS_COLORS[r.platformReturnStatus ?? ''] ?? 'default'} style={{ marginRight: 0 }}>
                {t(`returns.tk.${r.platformReturnStatus ?? ''}`, { defaultValue: r.platformReturnStatus ?? '—' })}
              </Tag>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: 'var(--text-secondary)' }}>
              <span>
                {r.arrivedAt ? (
                  <>
                    <Tag color={CONDITION_COLORS[r.condition] ?? 'default'} style={{ marginRight: 4 }}>
                      {t(`returns.cond.${r.condition}`, { defaultValue: r.condition })}
                    </Tag>
                    {r.restockedAt && <Tag color="green">{t('returns.restocked')}</Tag>}
                  </>
                ) : (
                  <Tag color="default">{t('returns.notArrived')}</Tag>
                )}
              </span>
              <span style={{ fontFamily: "'Courier New', monospace" }}>
                {r.returnedQty ?? '—'} / {r.expectedQty ?? '?'}
              </span>
            </div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {canApprove && (
                <>
                  <Popconfirm
                    title={t('returns.approveTitle')}
                    okText={t('returns.approveBtn')}
                    cancelText={t('common.cancel')}
                    onConfirm={() => approveMut.mutate(r.id)}
                  >
                    <Button size="small" type="primary" loading={approveMut.isPending}>
                      {t('returns.approveBtn')}
                    </Button>
                  </Popconfirm>
                  <Button size="small" danger onClick={() => onReject(r)}>
                    {t('returns.rejectBtn')}
                  </Button>
                </>
              )}
              {canProcess && (
                <Button size="small" type="primary" onClick={() => onProcess(r)} loading={processMut.isPending}>
                  {t('returns.processBtn')}
                </Button>
              )}
              <Button size="small" type="link" onClick={() => onDetail(r)}>
                {t('returns.detailBtn')}
              </Button>
            </div>
          </div>
        )
      })}
    </div>
  )
}

// ─── Scanner modal ────────────────────────────────────────────────────────────

// Live camera preview that emits decoded text (QR or 1D barcode) via onDecode.
// We pick the back camera by string-matching the label since iOS Safari
// doesn't expose the proper facingMode constraint on every device.
function ScannerModal({ onDecode, onClose }: { onDecode: (code: string) => void; onClose: () => void }) {
  const { t } = useTranslation()
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const [error, setError] = useState<string | null>(null)
  // Guard against re-entrant decodes during cleanup — once we've fired the
  // first valid result, ignore everything else until the modal remounts.
  const decodedRef = useRef(false)

  useEffect(() => {
    let stopped = false
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let controls: { stop: () => void } | null = null
    ;(async () => {
      try {
        const { BrowserMultiFormatReader } = await import('@zxing/browser')
        const reader = new BrowserMultiFormatReader()
        const devices = await BrowserMultiFormatReader.listVideoInputDevices()
        if (devices.length === 0) {
          setError(t('returns.scanNoCamera'))
          return
        }
        // Prefer rear/back camera. Falls back to first device when nothing matches.
        const back = devices.find((d) => /back|rear|environment|后/i.test(d.label))
        const deviceId = back?.deviceId ?? devices[0].deviceId
        if (stopped || !videoRef.current) return
        controls = await reader.decodeFromVideoDevice(deviceId, videoRef.current, (result) => {
          if (result && !decodedRef.current) {
            decodedRef.current = true
            onDecode(result.getText())
          }
        })
      } catch (err) {
        setError((err as Error)?.message ?? t('returns.scanCameraDenied'))
      }
    })()
    return () => {
      stopped = true
      controls?.stop()
    }
  }, [onDecode, t])

  return (
    <Modal
      open
      onCancel={onClose}
      footer={null}
      title={t('returns.scanTitle')}
      destroyOnClose
      width={420}
    >
      {error ? (
        <div style={{ padding: 24, textAlign: 'center', color: 'var(--badge-error-fg)' }}>
          {error}
        </div>
      ) : (
        <>
          <div style={{
            position: 'relative',
            width: '100%',
            aspectRatio: '1 / 1',
            background: '#000',
            borderRadius: 8,
            overflow: 'hidden',
          }}>
            <video
              ref={videoRef}
              autoPlay
              playsInline
              muted
              style={{ width: '100%', height: '100%', objectFit: 'cover' }}
            />
            {/* Sight box — purely cosmetic, helps the user aim. */}
            <div style={{
              position: 'absolute',
              inset: '15%',
              border: '2px solid rgba(255,255,255,0.7)',
              borderRadius: 8,
              pointerEvents: 'none',
            }} />
          </div>
          <div style={{ marginTop: 12, fontSize: 12, color: 'var(--text-muted)', textAlign: 'center' }}>
            {t('returns.scanHint')}
          </div>
        </>
      )}
    </Modal>
  )
}

// ─── Scan confirm modal ───────────────────────────────────────────────────────

function ScanConfirmModal({
  ticket, loading, onCancel, onConfirm,
}: {
  ticket: AfterSalesTicket
  loading: boolean
  onCancel: () => void
  onConfirm: (skipNext: boolean) => void
}) {
  const { t } = useTranslation()
  const [skipNext, setSkipNext] = useState(false)
  return (
    <Modal
      open
      onCancel={onCancel}
      onOk={() => onConfirm(skipNext)}
      okText={t('returns.scanConfirmOk')}
      cancelText={t('common.cancel')}
      title={t('returns.scanConfirmTitle')}
      confirmLoading={loading}
      destroyOnClose
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div style={{ fontSize: 14 }}>{t('returns.scanConfirmBody', { orderId: ticket.order.platformOrderId })}</div>
        {ticket.platformReturnId && (
          <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>
            {t('returns.scanConfirmExtra', { returnId: ticket.platformReturnId })}
          </div>
        )}
        <div style={{ marginTop: 8 }}>
          <Checkbox checked={skipNext} onChange={(e) => setSkipNext(e.target.checked)}>
            {t('returns.scanConfirmSkipNext')}
          </Checkbox>
        </div>
      </div>
    </Modal>
  )
}
