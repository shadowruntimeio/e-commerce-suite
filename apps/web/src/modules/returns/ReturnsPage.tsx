import { useState } from 'react'
import { Card, Table, Tag, Button, Modal, Form, InputNumber, Input, Select, Space, message, Popconfirm, Radio } from 'antd'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { api } from '../../lib/api'
import { useAuthStore, hasCapability, isMerchant } from '../../store/auth.store'
import dayjs from 'dayjs'

// Statuses where the merchant still has a pending action on TikTok's side.
const PENDING_MERCHANT_REVIEW = new Set(['REQUEST_PENDING'])
// Statuses where the warehouse should expect / has just received goods.
const WAREHOUSE_ACTIONABLE_TK_STATUSES = new Set(['RECEIVE_PENDING', 'RETURN_OR_REFUND_PROCESSING'])

const TK_STATUS_OPTIONS = [
  'REQUEST_PENDING',
  'SHIP_PENDING',
  'RECEIVE_PENDING',
  'RETURN_OR_REFUND_PROCESSING',
  'COMPLETED',
  'CLOSED',
  'RETURN_OR_REFUND_REJECT_BY_SELLER',
  'RETURN_OR_REFUND_REJECT_BY_PLATFORM',
  'BUYER_CANCEL',
]

const TK_STATUS_COLORS: Record<string, string> = {
  REQUEST_PENDING: 'gold',
  SHIP_PENDING: 'blue',
  RECEIVE_PENDING: 'cyan',
  RETURN_OR_REFUND_PROCESSING: 'geekblue',
  COMPLETED: 'green',
  CLOSED: 'default',
  RETURN_OR_REFUND_REJECT_BY_SELLER: 'red',
  RETURN_OR_REFUND_REJECT_BY_PLATFORM: 'red',
  BUYER_CANCEL: 'default',
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
  const [processTicket, setProcessTicket] = useState<AfterSalesTicket | null>(null)
  const [rejectTicket, setRejectTicket] = useState<AfterSalesTicket | null>(null)

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
        const canApprove = isMerchantOrAdmin && PENDING_MERCHANT_REVIEW.has(r.platformReturnStatus ?? '')
        const canProcess = hasCapability(user, 'RETURN_INTAKE') && !r.arrivedAt
        return (
          <Space>
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
          </Space>
        )
      },
    },
  ]

  return (
    <Card
      title={t('returns.title')}
      extra={
        <Space>
          {!merchantUser && (
            <Radio.Group value={view} onChange={(e) => setView(e.target.value)} optionType="button" buttonStyle="solid">
              <Radio.Button value="actionable">{t('returns.viewActionable')}</Radio.Button>
              <Radio.Button value="done">{t('returns.viewDone')}</Radio.Button>
            </Radio.Group>
          )}
          <Select
            allowClear
            placeholder={t('returns.allPlatformStates')}
            style={{ width: 240 }}
            value={statusFilter}
            onChange={setStatusFilter}
            options={TK_STATUS_OPTIONS.map((s) => ({
              value: s,
              label: t(`returns.tk.${s}`, { defaultValue: s }),
            }))}
          />
        </Space>
      }
    >
      <Table
        rowKey="id"
        loading={ticketsQ.isLoading}
        dataSource={ticketsQ.data ?? []}
        columns={columns}
        pagination={{ pageSize: 20 }}
        scroll={{ x: 'max-content' }}
      />

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
    </Card>
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

  const tkStatusHint = ticket.platformReturnStatus && !WAREHOUSE_ACTIONABLE_TK_STATUSES.has(ticket.platformReturnStatus)
    ? t('returns.processTkStatusWarn', { status: t(`returns.tk.${ticket.platformReturnStatus}`, { defaultValue: ticket.platformReturnStatus }) })
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
        initialValues={{ condition: 'SELLABLE', returnedQty: ticket.expectedQty ?? 1 }}
      >
        <Form.Item label={t('returns.condition')} name="condition" rules={[{ required: true }]}>
          <Select options={[
            { value: 'SELLABLE', label: t('returns.cond.SELLABLE') },
            { value: 'DAMAGED', label: t('returns.cond.DAMAGED') },
            { value: 'DISPOSED', label: t('returns.cond.DISPOSED') },
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
