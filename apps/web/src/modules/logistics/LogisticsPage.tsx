import { useState } from 'react'
import { Table, Button, Form, Input, InputNumber, Modal, Select, Space } from 'antd'
import { PlusOutlined, EditOutlined, TruckOutlined } from '@ant-design/icons'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { api } from '../../lib/api'
import dayjs from 'dayjs'
import type { ColumnsType } from 'antd/es/table'

// ─── Types ───────────────────────────────────────────────────────────────────

interface Shipment {
  id: string
  trackingNumber: string | null
  carrier: string | null
  shipmentType: string
  destination: string | null
  status: string
  weightKg: number | null
  volumeCbm: number | null
  cost: number | null
  currency: string
  estimatedArrival: string | null
  departedAt: string | null
  notes: string | null
  warehouseId: string
  warehouse?: { name: string }
}

interface Warehouse {
  id: string
  name: string
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: string }) {
  const { t } = useTranslation()
  const map: Record<string, { bg: string; color: string; key: string }> = {
    PENDING:    { bg: 'var(--badge-warning-bg)', color: 'var(--badge-warning-fg)', key: 'logistics.statusPending' },
    IN_TRANSIT: { bg: 'var(--badge-info-bg)',    color: 'var(--badge-info-fg)',    key: 'logistics.statusInTransit' },
    ARRIVED:    { bg: 'var(--badge-success-bg)', color: 'var(--badge-success-fg)', key: 'logistics.statusArrived' },
    CLEARED:    { bg: 'var(--badge-success-bg)', color: 'var(--badge-success-fg)', key: 'logistics.statusCleared' },
    CANCELLED:  { bg: 'var(--badge-neutral-bg)', color: 'var(--badge-neutral-fg)', key: 'logistics.statusCancelled' },
  }
  const s = map[status]
  const label = s ? t(s.key) : status
  const bg = s?.bg ?? 'var(--badge-neutral-bg)'
  const color = s?.color ?? 'var(--badge-neutral-fg)'
  return (
    <span style={{ background: bg, color, padding: '3px 10px', borderRadius: 20, fontSize: 12, fontWeight: 500, whiteSpace: 'nowrap' }}>
      {label}
    </span>
  )
}

function TypeBadge({ type }: { type: string }) {
  const map: Record<string, { bg: string; color: string }> = {
    SEA:  { bg: 'var(--badge-info-bg)',    color: 'var(--badge-info-fg)' },
    AIR:  { bg: 'var(--badge-success-bg)', color: 'var(--badge-success-fg)' },
    RAIL: { bg: 'var(--badge-warning-bg)', color: 'var(--badge-warning-fg)' },
  }
  const s = map[type] ?? { bg: 'var(--badge-neutral-bg)', color: 'var(--badge-neutral-fg)' }
  return (
    <span style={{ background: s.bg, color: s.color, padding: '3px 10px', borderRadius: 20, fontSize: 12, fontWeight: 600, whiteSpace: 'nowrap' }}>
      {type}
    </span>
  )
}

// ─── Status tabs ─────────────────────────────────────────────────────────────

// ─── Main component ───────────────────────────────────────────────────────────

export default function LogisticsPage() {
  const { t } = useTranslation()
  const [modalOpen, setModalOpen] = useState(false)
  const [editingShipment, setEditingShipment] = useState<Shipment | null>(null)
  const [statusFilter, setStatusFilter] = useState('')
  const [form] = Form.useForm()
  const queryClient = useQueryClient()

  const STATUS_TABS = [
    { key: '', label: t('common.all') },
    { key: 'PENDING', label: t('logistics.statusPending') },
    { key: 'IN_TRANSIT', label: t('logistics.statusInTransit') },
    { key: 'ARRIVED', label: t('logistics.statusArrived') },
    { key: 'CLEARED', label: t('logistics.statusCleared') },
    { key: 'CANCELLED', label: t('logistics.statusCancelled') },
  ]

  const { data, isLoading } = useQuery<{ items: Shipment[]; total: number }>({
    queryKey: ['shipments'],
    queryFn: () => api.get('/logistics/shipments', { params: { pageSize: 100 } }).then((r) => r.data.data),
  })

  const { data: warehouses = [] } = useQuery<Warehouse[]>({
    queryKey: ['warehouses-list'],
    queryFn: () => api.get('/warehouses').then((r) => r.data.data?.items ?? r.data.data ?? []),
  })

  const createMutation = useMutation({
    mutationFn: (body: any) => api.post('/logistics/shipments', body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['shipments'] })
      setModalOpen(false)
      form.resetFields()
    },
  })

  const updateMutation = useMutation({
    mutationFn: ({ id, body }: { id: string; body: any }) =>
      api.patch(`/logistics/shipments/${id}`, body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['shipments'] })
      setModalOpen(false)
      form.resetFields()
      setEditingShipment(null)
    },
  })

  const cancelMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/logistics/shipments/${id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['shipments'] }),
  })

  const openCreate = () => {
    setEditingShipment(null)
    form.resetFields()
    setModalOpen(true)
  }

  const openEdit = (shipment: Shipment) => {
    setEditingShipment(shipment)
    form.setFieldsValue({
      warehouseId: shipment.warehouseId,
      trackingNumber: shipment.trackingNumber,
      carrier: shipment.carrier,
      shipmentType: shipment.shipmentType,
      destination: shipment.destination,
      status: shipment.status,
      weightKg: shipment.weightKg,
      volumeCbm: shipment.volumeCbm,
      cost: shipment.cost,
      currency: shipment.currency,
      notes: shipment.notes,
    })
    setModalOpen(true)
  }

  const handleSubmit = async () => {
    try {
      const values = await form.validateFields()
      if (editingShipment) {
        updateMutation.mutate({ id: editingShipment.id, body: values })
      } else {
        createMutation.mutate(values)
      }
    } catch {
      // validation error
    }
  }

  const allShipments: Shipment[] = data?.items ?? []
  const shipments = statusFilter ? allShipments.filter((s) => s.status === statusFilter) : allShipments

  const columns: ColumnsType<Shipment> = [
    {
      title: t('logistics.trackingNumber'),
      dataIndex: 'trackingNumber',
      width: 160,
      render: (v) => v
        ? <span style={{ fontFamily: "'Courier New', monospace", color: 'var(--mono-color)', fontSize: 13 }}>{v}</span>
        : <span style={{ color: 'var(--text-muted)' }}>—</span>,
    },
    {
      title: t('logistics.carrier'),
      dataIndex: 'carrier',
      width: 110,
      render: (v) => v ?? <span style={{ color: 'var(--text-muted)' }}>—</span>,
    },
    {
      title: t('logistics.type'),
      dataIndex: 'shipmentType',
      width: 90,
      render: (v) => <TypeBadge type={v} />,
    },
    {
      title: t('logistics.destination'),
      dataIndex: 'destination',
      width: 140,
      render: (v) => v ?? <span style={{ color: 'var(--text-muted)' }}>—</span>,
    },
    {
      title: t('common.status'),
      dataIndex: 'status',
      width: 120,
      render: (v: string) => <StatusBadge status={v} />,
    },
    {
      title: t('logistics.weight'),
      dataIndex: 'weightKg',
      width: 110,
      align: 'right',
      render: (v) => v != null ? Number(v).toFixed(2) : <span style={{ color: 'var(--text-muted)' }}>—</span>,
    },
    {
      title: t('logistics.cost'),
      dataIndex: 'cost',
      width: 110,
      align: 'right',
      render: (v, r) => v != null
        ? <span style={{ fontWeight: 600 }}>{r.currency} {Number(v).toFixed(2)}</span>
        : <span style={{ color: 'var(--text-muted)' }}>—</span>,
    },
    {
      title: t('logistics.eta'),
      dataIndex: 'estimatedArrival',
      width: 120,
      render: (v) => v ? dayjs(v).format('MMM D, YYYY') : <span style={{ color: 'var(--text-muted)' }}>—</span>,
    },
    {
      title: t('logistics.warehouse'),
      dataIndex: ['warehouse', 'name'],
      width: 130,
      render: (v, r) => (
        <span style={{ background: 'var(--bg-surface)', color: 'var(--text-secondary)', padding: '2px 8px', borderRadius: 6, fontSize: 12, border: '1px solid var(--border-light)' }}>
          {v ?? r.warehouseId}
        </span>
      ),
    },
    {
      title: '',
      key: 'actions',
      width: 60,
      render: (_, record) => (
        <Button
          type="text"
          size="small"
          icon={<EditOutlined />}
          style={{ color: 'var(--text-secondary)' }}
          onClick={() => openEdit(record)}
        />
      ),
    },
  ]

  // suppress "unused" warning for cancelMutation
  void cancelMutation

  return (
    <div>
      {/* Page Header */}
      <div style={{ marginBottom: 24 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <p style={{ margin: '4px 0 0', color: 'var(--text-secondary)', fontSize: 14 }}>{t('logistics.subtitle')}</p>
          </div>
          <Button
            type="primary"
            icon={<PlusOutlined />}
            onClick={openCreate}
            style={{ background: 'var(--accent-gradient)', border: 'none', borderRadius: 8, height: 36, fontWeight: 600, fontSize: 14, boxShadow: '0 0 16px rgba(204,151,255,0.3)' }}
          >
            {t('logistics.newShipment')}
          </Button>
        </div>
      </div>

      {/* Status Tabs */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 16, flexWrap: 'wrap' }}>
        {STATUS_TABS.map((tab) => {
          const isActive = statusFilter === tab.key
          return (
            <button
              key={tab.key}
              onClick={() => setStatusFilter(tab.key)}
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

      {/* Table */}
      <div style={{ background: 'var(--bg-card)', borderRadius: 12, border: '1px solid var(--border)', overflow: 'hidden' }}>
        <Table
          rowKey="id"
          columns={columns}
          dataSource={shipments}
          loading={isLoading}
          size="middle"
          style={{ borderRadius: 0 }}
          pagination={{
            pageSize: 20,
            showSizeChanger: false,
            showTotal: (total) => t('common.records', { count: total }),
            style: { padding: '12px 20px' },
          }}
          scroll={{ x: 'max-content' }}
          locale={{
            emptyText: (
              <div style={{ padding: '48px 0', textAlign: 'center' }}>
                <TruckOutlined style={{ fontSize: 40, color: 'var(--text-muted)', display: 'block', margin: '0 auto 12px' }} />
                <div style={{ fontSize: 15, fontWeight: 500, color: 'var(--text-secondary)' }}>{t('logistics.noShipments')}</div>
                <div style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 4 }}>{t('logistics.noShipmentsHint')}</div>
              </div>
            ),
          }}
        />
      </div>

      {/* Create / Edit Modal */}
      <Modal
        title={
          <span style={{ fontSize: 16, fontWeight: 700, color: 'var(--text-primary)' }}>
            {editingShipment ? t('logistics.editShipment') : t('logistics.newShipment')}
          </span>
        }
        open={modalOpen}
        onCancel={() => {
          setModalOpen(false)
          form.resetFields()
          setEditingShipment(null)
        }}
        onOk={handleSubmit}
        confirmLoading={createMutation.isPending || updateMutation.isPending}
        okButtonProps={{ style: { background: 'var(--accent-gradient)', border: 'none', borderRadius: 8 } }}
        cancelText={t('common.cancel')}
        okText={editingShipment ? t('common.save') : t('common.create')}
        width={600}
      >
        <Form form={form} layout="vertical" style={{ marginTop: 16 }}>
          {!editingShipment && (
            <Form.Item name="warehouseId" label={t('logistics.warehouse')} rules={[{ required: true }]}>
              <Select
                options={warehouses.map((w) => ({ value: w.id, label: w.name }))}
                placeholder={t('inventory.selectWarehouse')}
              />
            </Form.Item>
          )}
          <Space style={{ width: '100%' }} size={12}>
            <Form.Item name="trackingNumber" label={t('logistics.trackingNumber')} style={{ flex: 1 }}>
              <Input style={{ fontFamily: 'monospace' }} />
            </Form.Item>
            <Form.Item name="carrier" label={t('logistics.carrier')} style={{ flex: 1 }}>
              <Input />
            </Form.Item>
          </Space>
          <Space style={{ width: '100%' }} size={12}>
            <Form.Item name="shipmentType" label={t('logistics.type')} style={{ flex: 1 }}>
              <Select options={[
                { value: 'SEA', label: t('logistics.typeSea') },
                { value: 'AIR', label: t('logistics.typeAir') },
                { value: 'RAIL', label: t('logistics.typeRail') },
              ]} />
            </Form.Item>
            <Form.Item name="destination" label={t('logistics.destination')} style={{ flex: 1 }}>
              <Input />
            </Form.Item>
          </Space>
          {editingShipment && (
            <Form.Item name="status" label={t('common.status')}>
              <Select options={[
                { value: 'PENDING', label: t('logistics.statusPending') },
                { value: 'IN_TRANSIT', label: t('logistics.statusInTransit') },
                { value: 'ARRIVED', label: t('logistics.statusArrived') },
                { value: 'CLEARED', label: t('logistics.statusCleared') },
                { value: 'CANCELLED', label: t('logistics.statusCancelled') },
              ]} />
            </Form.Item>
          )}
          <Space style={{ width: '100%' }} size={12}>
            <Form.Item name="weightKg" label={t('logistics.weight')} style={{ flex: 1 }}>
              <InputNumber min={0} precision={3} style={{ width: '100%' }} />
            </Form.Item>
            <Form.Item name="volumeCbm" label={t('logistics.volume')} style={{ flex: 1 }}>
              <InputNumber min={0} precision={4} style={{ width: '100%' }} />
            </Form.Item>
          </Space>
          <Space style={{ width: '100%' }} size={12}>
            <Form.Item name="cost" label={t('logistics.cost')} style={{ flex: 1 }}>
              <InputNumber min={0} precision={2} style={{ width: '100%' }} />
            </Form.Item>
            <Form.Item name="currency" label={t('logistics.currency')} initialValue="USD" style={{ flex: 1 }}>
              <Select options={[
                { value: 'USD', label: 'USD' },
                { value: 'CNY', label: 'CNY' },
                { value: 'EUR', label: 'EUR' },
              ]} />
            </Form.Item>
          </Space>
          <Form.Item name="notes" label={t('logistics.notes')}>
            <Input.TextArea rows={3} />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  )
}
