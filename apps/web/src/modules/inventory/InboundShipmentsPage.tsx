import { useState } from 'react'
import { Table, Tag, Button, Space, Modal, Input, InputNumber, message, Spin, Popconfirm } from 'antd'
import { useTranslation } from 'react-i18next'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import dayjs from 'dayjs'
import { api } from '../../lib/api'
import { useAuthStore, isMerchant } from '../../store/auth.store'
import type { ColumnsType } from 'antd/es/table'

type Status = 'PENDING_REVIEW' | 'CONFIRMED' | 'REJECTED'

interface ShipmentItem {
  id: string
  systemSkuId: string
  expectedQuantity: number
  confirmedQuantity: number | null
  notes: string | null
  systemSku: { skuCode: string; systemProduct: { name: string } }
}

interface Shipment {
  id: string
  status: Status
  shippedAt: string
  carrier: string
  trackingNumber: string
  notes: string | null
  rejectReason: string | null
  submittedAt: string
  reviewedAt: string | null
  owner: { id: string; name: string; email: string }
  warehouse: { id: string; name: string }
  reviewer: { id: string; name: string } | null
  items: ShipmentItem[]
}

function StatusTag({ status }: { status: Status }) {
  const { t } = useTranslation()
  if (status === 'PENDING_REVIEW') return <Tag color="orange">{t('shipments.statusPending')}</Tag>
  if (status === 'CONFIRMED') return <Tag color="green">{t('shipments.statusConfirmed')}</Tag>
  return <Tag color="red">{t('shipments.statusRejected')}</Tag>
}

export default function InboundShipmentsPage() {
  const { t } = useTranslation()
  const user = useAuthStore((s) => s.user)
  const merchant = isMerchant(user)
  const [statusFilter, setStatusFilter] = useState<Status | null>(merchant ? null : 'PENDING_REVIEW')
  const [detailId, setDetailId] = useState<string | null>(null)

  const { data, isLoading } = useQuery({
    queryKey: ['inbound-shipments', statusFilter],
    queryFn: async () => {
      const r = await api.get('/inventory/inbound-shipments', {
        params: { status: statusFilter ?? undefined },
      })
      return r.data.data as Shipment[]
    },
    refetchInterval: 30_000,
  })

  const tabs: Array<{ key: Status | null; label: string }> = merchant
    ? [
        { key: null, label: t('shipments.all') },
        { key: 'PENDING_REVIEW', label: t('shipments.statusPending') },
        { key: 'CONFIRMED', label: t('shipments.statusConfirmed') },
        { key: 'REJECTED', label: t('shipments.statusRejected') },
      ]
    : [
        { key: 'PENDING_REVIEW', label: t('shipments.statusPending') },
        { key: 'CONFIRMED', label: t('shipments.statusConfirmed') },
        { key: 'REJECTED', label: t('shipments.statusRejected') },
      ]

  const columns: ColumnsType<Shipment> = [
    {
      title: t('shipments.tracking'),
      dataIndex: 'trackingNumber',
      render: (v, row) => (
        <span style={{ fontFamily: "'Courier New', monospace", fontSize: 13 }}>
          <strong>{row.carrier}</strong> {v}
        </span>
      ),
    },
    {
      title: t('shipments.merchant'),
      render: (_, row) => row.owner?.name ?? row.owner?.email ?? '—',
    },
    {
      title: t('shipments.warehouse'),
      render: (_, row) => row.warehouse?.name ?? '—',
    },
    {
      title: t('shipments.skuCount'),
      align: 'right',
      render: (_, row) => row.items.length,
    },
    {
      title: t('shipments.totalQty'),
      align: 'right',
      render: (_, row) =>
        row.items.reduce((sum, it) => sum + (it.confirmedQuantity ?? it.expectedQuantity), 0),
    },
    {
      title: t('shipments.shippedAt'),
      dataIndex: 'shippedAt',
      render: (v) => (v ? dayjs(v).format('MMM D, YYYY') : '—'),
    },
    {
      title: t('shipments.submittedAt'),
      dataIndex: 'submittedAt',
      render: (v) => (v ? dayjs(v).format('MMM D, HH:mm') : '—'),
    },
    {
      title: t('common.status'),
      dataIndex: 'status',
      render: (s) => <StatusTag status={s} />,
    },
    {
      title: t('common.actions'),
      align: 'right',
      render: (_, row) => (
        <Button size="small" onClick={() => setDetailId(row.id)}>
          {row.status === 'PENDING_REVIEW' && !merchant ? t('shipments.review') : t('common.view')}
        </Button>
      ),
    },
  ]

  return (
    <div>
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700 }}>{t('shipments.title')}</h1>
        <p style={{ margin: '4px 0 0', color: 'var(--text-secondary)', fontSize: 14 }}>
          {t(merchant ? 'shipments.subtitleMerchant' : 'shipments.subtitleWarehouse')}
        </p>
      </div>

      {/* Status tabs */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
        {tabs.map((tab) => {
          const active = statusFilter === tab.key
          return (
            <button
              key={String(tab.key)}
              onClick={() => setStatusFilter(tab.key)}
              style={{
                padding: '6px 14px',
                background: active ? 'var(--accent-gradient)' : 'var(--bg-card)',
                color: active ? '#fff' : 'var(--text-primary)',
                border: '1px solid var(--border)',
                borderRadius: 999,
                fontSize: 13,
                fontWeight: 500,
                cursor: 'pointer',
              }}
            >
              {tab.label}
            </button>
          )
        })}
      </div>

      <div style={{ background: 'var(--bg-card)', borderRadius: 12, border: '1px solid var(--border)', overflow: 'hidden' }}>
        <Table
          rowKey="id"
          loading={isLoading}
          columns={columns}
          dataSource={data ?? []}
          pagination={{ pageSize: 20, showSizeChanger: false }}
          size="middle"
        />
      </div>

      <ShipmentDetailModal id={detailId} onClose={() => setDetailId(null)} merchant={merchant} />
    </div>
  )
}

// ─── Detail / review modal ────────────────────────────────────────────────

function ShipmentDetailModal({
  id,
  onClose,
  merchant,
}: {
  id: string | null
  onClose: () => void
  merchant: boolean
}) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const [editedQty, setEditedQty] = useState<Record<string, number>>({})
  const [rejectOpen, setRejectOpen] = useState(false)
  const [rejectReason, setRejectReason] = useState('')

  const { data, isLoading } = useQuery({
    enabled: !!id,
    queryKey: ['inbound-shipment', id],
    queryFn: async () => (await api.get(`/inventory/inbound-shipments/${id}`)).data.data as Shipment,
  })

  const confirmMut = useMutation({
    mutationFn: () => {
      // Send every item — the InputNumber is uncontrolled, so editedQty only
      // contains rows the user actually changed. Fall back to expectedQuantity
      // for the rest so the request never goes out with an empty items array.
      const items = (data?.items ?? []).map((it) => ({
        itemId: it.id,
        confirmedQuantity: editedQty[it.id] ?? it.confirmedQuantity ?? it.expectedQuantity,
      }))
      return api.post(`/inventory/inbound-shipments/${id}/confirm`, { items })
    },
    onSuccess: () => {
      void message.success(t('shipments.confirmedToast'))
      queryClient.invalidateQueries({ queryKey: ['inbound-shipments'] })
      queryClient.invalidateQueries({ queryKey: ['inbound-shipment'] })
      queryClient.invalidateQueries({ queryKey: ['inventory-stock'] })
      onClose()
    },
    onError: (err: any) => void message.error(err?.response?.data?.error ?? t('shipments.confirmFailed')),
  })

  const rejectMut = useMutation({
    mutationFn: () =>
      api.post(`/inventory/inbound-shipments/${id}/reject`, { reason: rejectReason.trim() }),
    onSuccess: () => {
      void message.success(t('shipments.rejectedToast'))
      queryClient.invalidateQueries({ queryKey: ['inbound-shipments'] })
      queryClient.invalidateQueries({ queryKey: ['inbound-shipment'] })
      onClose()
    },
    onError: (err: any) => void message.error(err?.response?.data?.error ?? t('shipments.rejectFailed')),
  })

  const isPending = data?.status === 'PENDING_REVIEW'
  const canReview = !merchant && isPending

  const itemColumns: ColumnsType<ShipmentItem> = [
    {
      title: t('shipments.skuCode'),
      render: (_, row) => (
        <span style={{ fontFamily: "'Courier New', monospace", fontSize: 12 }}>{row.systemSku.skuCode}</span>
      ),
    },
    {
      title: t('shipments.productName'),
      render: (_, row) => row.systemSku.systemProduct?.name ?? '—',
    },
    {
      title: t('shipments.expectedQty'),
      dataIndex: 'expectedQuantity',
      align: 'right' as const,
      width: 100,
    },
    {
      title: t('shipments.confirmedQty'),
      align: 'right' as const,
      width: 130,
      render: (_, row) => {
        if (canReview) {
          return (
            <InputNumber
              size="small"
              min={0}
              max={9999}
              defaultValue={row.confirmedQuantity ?? row.expectedQuantity}
              onChange={(v) => {
                if (typeof v === 'number') {
                  setEditedQty((prev) => ({ ...prev, [row.id]: v }))
                }
              }}
              style={{ width: 90 }}
            />
          )
        }
        if (row.confirmedQuantity == null) return <span style={{ color: 'var(--text-muted)' }}>—</span>
        const adjusted = row.confirmedQuantity !== row.expectedQuantity
        return (
          <span style={{ color: adjusted ? '#EF4444' : 'var(--text-primary)', fontWeight: adjusted ? 600 : 400 }}>
            {row.confirmedQuantity}
          </span>
        )
      },
    },
  ]

  return (
    <Modal
      open={!!id}
      onCancel={onClose}
      footer={null}
      width={820}
      destroyOnClose
      title={t('shipments.detailTitle')}
    >
      {isLoading || !data ? (
        <div style={{ padding: '40px 0', textAlign: 'center' }}>
          <Spin />
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {/* Header */}
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <span style={{ fontFamily: "'Courier New', monospace", fontWeight: 600 }}>
                {data.carrier} {data.trackingNumber}
              </span>
              <StatusTag status={data.status} />
            </div>
            <div style={{ marginTop: 6, fontSize: 12, color: 'var(--text-muted)' }}>
              {t('shipments.shippedAt')}: {dayjs(data.shippedAt).format('YYYY-MM-DD')} ·{' '}
              {t('shipments.submittedAt')}: {dayjs(data.submittedAt).format('YYYY-MM-DD HH:mm')}
              {data.reviewedAt && (
                <> · {t('shipments.reviewedAt')}: {dayjs(data.reviewedAt).format('YYYY-MM-DD HH:mm')} ({data.reviewer?.name ?? '—'})</>
              )}
            </div>
            {data.rejectReason && (
              <div style={{ marginTop: 8, padding: '8px 12px', background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: 6, fontSize: 13 }}>
                <strong>{t('shipments.rejectReason')}:</strong> {data.rejectReason}
              </div>
            )}
          </div>

          {/* Metadata grid */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, fontSize: 13 }}>
            <div><span style={{ color: 'var(--text-muted)' }}>{t('shipments.merchant')}:</span> {data.owner?.name ?? data.owner?.email ?? '—'}</div>
            <div><span style={{ color: 'var(--text-muted)' }}>{t('shipments.warehouse')}:</span> {data.warehouse?.name ?? '—'}</div>
          </div>

          {/* Items */}
          <Table<ShipmentItem>
            rowKey="id"
            columns={itemColumns}
            dataSource={data.items}
            size="small"
            pagination={false}
            scroll={{ y: 360 }}
          />

          {/* Actions */}
          {canReview && (
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <Button danger onClick={() => setRejectOpen(true)}>
                {t('shipments.rejectBtn')}
              </Button>
              <Popconfirm
                title={t('shipments.confirmConfirmTitle')}
                description={t('shipments.confirmConfirmDesc')}
                onConfirm={() => confirmMut.mutate()}
                okText={t('common.confirm')}
                cancelText={t('common.cancel')}
              >
                <Button type="primary" loading={confirmMut.isPending} style={{ background: 'var(--accent-gradient)', border: 'none' }}>
                  {t('shipments.confirmBtn')}
                </Button>
              </Popconfirm>
            </div>
          )}
        </div>
      )}

      <Modal
        open={rejectOpen}
        onCancel={() => setRejectOpen(false)}
        title={t('shipments.rejectModalTitle')}
        onOk={() => rejectMut.mutate()}
        okButtonProps={{ disabled: !rejectReason.trim(), loading: rejectMut.isPending, danger: true }}
        okText={t('shipments.rejectBtn')}
        cancelText={t('common.cancel')}
      >
        <Input.TextArea
          rows={3}
          value={rejectReason}
          onChange={(e) => setRejectReason(e.target.value)}
          placeholder={t('shipments.rejectReasonPlaceholder')}
          maxLength={500}
        />
      </Modal>
    </Modal>
  )
}
