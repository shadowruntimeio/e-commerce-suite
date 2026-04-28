import { useState } from 'react'
import { Card, Table, Tag, Button, Modal, Form, InputNumber, Input, Select, Space, message, Popconfirm } from 'antd'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { api } from '../../lib/api'
import { useAuthStore, hasCapability, isMerchant } from '../../store/auth.store'
import dayjs from 'dayjs'

interface AfterSalesTicket {
  id: string
  orderId: string
  type: string
  status: string
  reviewStatus: 'PENDING_REVIEW' | 'CONFIRMED' | 'REJECTED'
  reviewedAt: string | null
  rejectReason: string | null
  expectedQty: number | null
  returnedQty: number | null
  condition: string
  arrivedAt: string | null
  inspectedAt: string | null
  resolvedAt: string | null
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
  const [intakeTicket, setIntakeTicket] = useState<AfterSalesTicket | null>(null)
  const [inspectTicket, setInspectTicket] = useState<AfterSalesTicket | null>(null)
  const [rejectTicket, setRejectTicket] = useState<AfterSalesTicket | null>(null)

  // Default tab depends on role
  const [reviewFilter, setReviewFilter] = useState<string | undefined>(
    merchantUser ? 'PENDING_REVIEW' : undefined
  )

  const ticketsQ = useQuery({
    queryKey: ['returns', reviewFilter],
    queryFn: async () => {
      const params: Record<string, string> = { pageSize: '100' }
      if (reviewFilter) params.reviewStatus = reviewFilter
      const r = await api.get('/returns', { params })
      return r.data.data.items as AfterSalesTicket[]
    },
  })

  const refetch = () => qc.invalidateQueries({ queryKey: ['returns'] })

  const confirmMut = useMutation({
    mutationFn: (id: string) => api.post(`/returns/${id}/merchant-confirm`),
    onSuccess: () => { message.success(t('returns.confirmed')); refetch() },
    onError: (err: any) => message.error(err?.response?.data?.error ?? t('returns.failed')),
  })
  const rejectMut = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) =>
      api.post(`/returns/${id}/merchant-reject`, { reason }),
    onSuccess: () => { message.success(t('returns.rejected')); setRejectTicket(null); refetch() },
    onError: (err: any) => message.error(err?.response?.data?.error ?? t('returns.failed')),
  })
  const intakeMut = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Record<string, unknown> }) =>
      api.post(`/returns/${id}/intake`, data),
    onSuccess: () => { message.success(t('returns.intakeDone')); setIntakeTicket(null); refetch() },
    onError: (err: any) => message.error(err?.response?.data?.error ?? t('returns.failed')),
  })
  const inspectMut = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Record<string, unknown> }) =>
      api.post(`/returns/${id}/inspect`, data),
    onSuccess: () => { message.success(t('returns.inspectDone')); setInspectTicket(null); refetch() },
    onError: (err: any) => message.error(err?.response?.data?.error ?? t('returns.failed')),
  })

  const reviewColors: Record<string, string> = {
    PENDING_REVIEW: 'gold',
    CONFIRMED: 'green',
    REJECTED: 'default',
  }
  const statusColors: Record<string, string> = {
    OPEN: 'gold', PROCESSING: 'blue', RESOLVED: 'green', CLOSED: 'default',
  }
  const conditionColors: Record<string, string> = {
    PENDING_INSPECTION: 'gold', SELLABLE: 'green', DAMAGED: 'red', DISPOSED: 'default',
  }

  const columns = [
    { title: t('returns.order'), dataIndex: ['order', 'platformOrderId'], key: 'order' },
    { title: t('returns.shop'), dataIndex: ['order', 'shop', 'name'], key: 'shop' },
    ...(!merchantUser ? [{
      title: t('returns.merchant'),
      key: 'merchant',
      render: (_: unknown, r: AfterSalesTicket) => r.order.shop.owner?.name ?? '—',
    }] : []),
    { title: t('returns.type'), dataIndex: 'type', key: 'type', render: (v: string) => <Tag>{v}</Tag> },
    {
      title: t('returns.reviewStatus'), dataIndex: 'reviewStatus', key: 'reviewStatus',
      render: (v: string) => <Tag color={reviewColors[v] ?? 'default'}>{t(`returns.review.${v}`)}</Tag>,
    },
    {
      title: t('returns.status'), dataIndex: 'status', key: 'status',
      render: (v: string) => <Tag color={statusColors[v]}>{v}</Tag>,
    },
    {
      title: t('returns.condition'), dataIndex: 'condition', key: 'condition',
      render: (v: string) => <Tag color={conditionColors[v]}>{v}</Tag>,
    },
    {
      title: t('returns.qty'), key: 'qty',
      render: (_: unknown, r: AfterSalesTicket) => <span>{r.returnedQty ?? '—'} / {r.expectedQty ?? '?'}</span>,
    },
    {
      title: t('returns.arrived'), dataIndex: 'arrivedAt', key: 'arrivedAt',
      render: (v: string | null) => v ? dayjs(v).format('YYYY-MM-DD HH:mm') : '—',
    },
    {
      title: t('returns.actions'), key: 'actions',
      render: (_: unknown, r: AfterSalesTicket) => {
        const canIntake = hasCapability(user, 'RETURN_INTAKE')
        const isMerchantPending = (merchantUser || user?.role === 'ADMIN') && r.reviewStatus === 'PENDING_REVIEW'
        return (
          <Space>
            {isMerchantPending && (
              <>
                <Popconfirm
                  title={t('returns.confirmTitle')}
                  okText={t('returns.confirmOk')}
                  cancelText={t('common.cancel')}
                  onConfirm={() => confirmMut.mutate(r.id)}
                >
                  <Button size="small" type="primary">{t('returns.confirmBtn')}</Button>
                </Popconfirm>
                <Button size="small" danger onClick={() => setRejectTicket(r)}>
                  {t('returns.rejectBtn')}
                </Button>
              </>
            )}
            {canIntake && r.reviewStatus === 'CONFIRMED' && !r.arrivedAt && (
              <Button size="small" onClick={() => setIntakeTicket(r)}>{t('returns.markArrived')}</Button>
            )}
            {canIntake && r.arrivedAt && r.status !== 'RESOLVED' && (
              <Button size="small" type="primary" onClick={() => setInspectTicket(r)}>{t('returns.inspect')}</Button>
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
        <Select
          allowClear
          placeholder={t('returns.allReviewStates')}
          style={{ width: 220 }}
          value={reviewFilter}
          onChange={setReviewFilter}
          options={[
            { value: 'PENDING_REVIEW', label: t('returns.review.PENDING_REVIEW') },
            { value: 'CONFIRMED', label: t('returns.review.CONFIRMED') },
            { value: 'REJECTED', label: t('returns.review.REJECTED') },
          ]}
        />
      }
    >
      <Table
        rowKey="id"
        loading={ticketsQ.isLoading}
        dataSource={ticketsQ.data ?? []}
        columns={columns}
        pagination={{ pageSize: 20 }}
      />

      {/* Reject reason modal */}
      {rejectTicket && (
        <RejectModal
          ticket={rejectTicket}
          onClose={() => setRejectTicket(null)}
          onSubmit={(reason) => rejectMut.mutate({ id: rejectTicket.id, reason })}
        />
      )}

      {/* Warehouse intake confirmation */}
      {intakeTicket && (
        <Modal
          open
          title={t('returns.markArrivedTitle')}
          onCancel={() => setIntakeTicket(null)}
          onOk={() => intakeMut.mutate({ id: intakeTicket.id, data: {} })}
          okText={t('returns.markArrived')}
          cancelText={t('common.cancel')}
        >
          <p>{t('returns.order')}: {intakeTicket.order.platformOrderId}</p>
          <p>{t('returns.expectedQty')}: {intakeTicket.expectedQty ?? '—'}</p>
        </Modal>
      )}

      {/* Warehouse inspection */}
      {inspectTicket && (
        <InspectModal
          ticket={inspectTicket}
          onClose={() => setInspectTicket(null)}
          onSubmit={(data) => inspectMut.mutate({ id: inspectTicket.id, data })}
        />
      )}
    </Card>
  )
}

function RejectModal({
  ticket, onClose, onSubmit,
}: {
  ticket: AfterSalesTicket
  onClose: () => void
  onSubmit: (reason: string) => void
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
      okButtonProps={{ danger: true }}
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

function InspectModal({
  ticket, onClose, onSubmit,
}: {
  ticket: AfterSalesTicket
  onClose: () => void
  onSubmit: (data: Record<string, unknown>) => void
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

  return (
    <Modal
      open
      title={t('returns.inspectTitle')}
      onCancel={() => { form.resetFields(); onClose() }}
      onOk={() => form.submit()}
      okText={t('returns.saveInspection')}
      cancelText={t('common.cancel')}
      destroyOnClose
    >
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
            { value: 'SELLABLE', label: t('returns.condSellable') },
            { value: 'DAMAGED', label: t('returns.condDamaged') },
            { value: 'DISPOSED', label: t('returns.condDisposed') },
          ]} />
        </Form.Item>
        <Form.Item label={t('returns.returnedQty')} name="returnedQty" rules={[{ required: true }]}>
          <InputNumber min={0} />
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
