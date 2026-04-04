import { useState } from 'react'
import { Table, Button, Form, Input, InputNumber, Modal, Select, Space } from 'antd'
import { PlusOutlined, EditOutlined, TruckOutlined } from '@ant-design/icons'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
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
  const map: Record<string, { bg: string; color: string; label: string }> = {
    PENDING:    { bg: '#FEF3C7', color: '#92400E', label: 'Pending' },
    IN_TRANSIT: { bg: '#EEF2FF', color: '#4338CA', label: 'In Transit' },
    ARRIVED:    { bg: '#D1FAE5', color: '#065F46', label: 'Arrived' },
    CLEARED:    { bg: '#ECFDF5', color: '#065F46', label: 'Cleared' },
    CANCELLED:  { bg: '#F1F5F9', color: '#475569', label: 'Cancelled' },
  }
  const s = map[status] ?? { bg: '#F1F5F9', color: '#475569', label: status }
  return (
    <span style={{ background: s.bg, color: s.color, padding: '3px 10px', borderRadius: 20, fontSize: 12, fontWeight: 500, whiteSpace: 'nowrap' }}>
      {s.label}
    </span>
  )
}

function TypeBadge({ type }: { type: string }) {
  const map: Record<string, { bg: string; color: string }> = {
    SEA:  { bg: '#EEF2FF', color: '#4338CA' },
    AIR:  { bg: '#ECFDF5', color: '#065F46' },
    RAIL: { bg: '#FEF3C7', color: '#92400E' },
  }
  const s = map[type] ?? { bg: '#F1F5F9', color: '#475569' }
  return (
    <span style={{ background: s.bg, color: s.color, padding: '3px 10px', borderRadius: 20, fontSize: 12, fontWeight: 600, whiteSpace: 'nowrap' }}>
      {type}
    </span>
  )
}

// ─── Status tabs ─────────────────────────────────────────────────────────────

const STATUS_TABS = [
  { key: '', label: 'All' },
  { key: 'PENDING', label: 'Pending' },
  { key: 'IN_TRANSIT', label: 'In Transit' },
  { key: 'ARRIVED', label: 'Arrived' },
  { key: 'CLEARED', label: 'Cleared' },
  { key: 'CANCELLED', label: 'Cancelled' },
]

// ─── Main component ───────────────────────────────────────────────────────────

export default function LogisticsPage() {
  const [modalOpen, setModalOpen] = useState(false)
  const [editingShipment, setEditingShipment] = useState<Shipment | null>(null)
  const [statusFilter, setStatusFilter] = useState('')
  const [form] = Form.useForm()
  const queryClient = useQueryClient()

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
      title: 'Tracking #',
      dataIndex: 'trackingNumber',
      width: 160,
      render: (v) => v
        ? <span style={{ fontFamily: "'Courier New', monospace", color: '#6366F1', fontSize: 13 }}>{v}</span>
        : <span style={{ color: 'var(--text-muted)' }}>—</span>,
    },
    {
      title: 'Carrier',
      dataIndex: 'carrier',
      width: 110,
      render: (v) => v ?? <span style={{ color: 'var(--text-muted)' }}>—</span>,
    },
    {
      title: 'Type',
      dataIndex: 'shipmentType',
      width: 90,
      render: (v) => <TypeBadge type={v} />,
    },
    {
      title: 'Destination',
      dataIndex: 'destination',
      width: 140,
      render: (v) => v ?? <span style={{ color: 'var(--text-muted)' }}>—</span>,
    },
    {
      title: 'Status',
      dataIndex: 'status',
      width: 120,
      render: (v: string) => <StatusBadge status={v} />,
    },
    {
      title: 'Weight (kg)',
      dataIndex: 'weightKg',
      width: 110,
      align: 'right',
      render: (v) => v != null ? Number(v).toFixed(2) : <span style={{ color: 'var(--text-muted)' }}>—</span>,
    },
    {
      title: 'Cost',
      dataIndex: 'cost',
      width: 110,
      align: 'right',
      render: (v, r) => v != null
        ? <span style={{ fontWeight: 600 }}>{r.currency} {Number(v).toFixed(2)}</span>
        : <span style={{ color: 'var(--text-muted)' }}>—</span>,
    },
    {
      title: 'ETA',
      dataIndex: 'estimatedArrival',
      width: 120,
      render: (v) => v ? dayjs(v).format('MMM D, YYYY') : <span style={{ color: 'var(--text-muted)' }}>—</span>,
    },
    {
      title: 'Warehouse',
      dataIndex: ['warehouse', 'name'],
      width: 130,
      render: (v, r) => (
        <span style={{ background: '#F1F5F9', color: '#475569', padding: '2px 8px', borderRadius: 6, fontSize: 12 }}>
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
            <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700, color: 'var(--text-primary)' }}>First-Leg Shipments</h1>
            <p style={{ margin: '4px 0 0', color: 'var(--text-secondary)', fontSize: 14 }}>Track inbound logistics from suppliers</p>
          </div>
          <Button
            type="primary"
            icon={<PlusOutlined />}
            onClick={openCreate}
            style={{ background: '#6366F1', border: 'none', borderRadius: 8, height: 36, fontWeight: 500, fontSize: 14 }}
          >
            New Shipment
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
                background: isActive ? '#6366F1' : 'var(--bg-card)',
                color: isActive ? '#fff' : 'var(--text-secondary)',
                border: isActive ? '1px solid #6366F1' : '1px solid var(--border)',
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
            showTotal: (total) => `${total.toLocaleString()} records`,
            style: { padding: '12px 20px' },
          }}
          scroll={{ x: 'max-content' }}
          locale={{
            emptyText: (
              <div style={{ padding: '48px 0', textAlign: 'center' }}>
                <TruckOutlined style={{ fontSize: 40, color: 'var(--text-muted)', display: 'block', margin: '0 auto 12px' }} />
                <div style={{ fontSize: 15, fontWeight: 500, color: 'var(--text-secondary)' }}>No shipments</div>
                <div style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 4 }}>Create your first shipment to track inbound logistics</div>
              </div>
            ),
          }}
        />
      </div>

      {/* Create / Edit Modal */}
      <Modal
        title={
          <span style={{ fontSize: 16, fontWeight: 700, color: 'var(--text-primary)' }}>
            {editingShipment ? 'Edit Shipment' : 'New Shipment'}
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
        okButtonProps={{ style: { background: '#6366F1', border: 'none', borderRadius: 8 } }}
        width={600}
      >
        <Form form={form} layout="vertical" style={{ marginTop: 16 }}>
          {!editingShipment && (
            <Form.Item name="warehouseId" label="Warehouse" rules={[{ required: true }]}>
              <Select
                options={warehouses.map((w) => ({ value: w.id, label: w.name }))}
                placeholder="Select warehouse"
              />
            </Form.Item>
          )}
          <Space style={{ width: '100%' }} size={12}>
            <Form.Item name="trackingNumber" label="Tracking Number" style={{ flex: 1 }}>
              <Input style={{ fontFamily: 'monospace' }} />
            </Form.Item>
            <Form.Item name="carrier" label="Carrier" style={{ flex: 1 }}>
              <Input />
            </Form.Item>
          </Space>
          <Space style={{ width: '100%' }} size={12}>
            <Form.Item name="shipmentType" label="Type" style={{ flex: 1 }}>
              <Select options={[
                { value: 'SEA', label: 'Sea' },
                { value: 'AIR', label: 'Air' },
                { value: 'RAIL', label: 'Rail' },
              ]} />
            </Form.Item>
            <Form.Item name="destination" label="Destination" style={{ flex: 1 }}>
              <Input />
            </Form.Item>
          </Space>
          {editingShipment && (
            <Form.Item name="status" label="Status">
              <Select options={[
                { value: 'PENDING', label: 'Pending' },
                { value: 'IN_TRANSIT', label: 'In Transit' },
                { value: 'ARRIVED', label: 'Arrived' },
                { value: 'CLEARED', label: 'Cleared' },
                { value: 'CANCELLED', label: 'Cancelled' },
              ]} />
            </Form.Item>
          )}
          <Space style={{ width: '100%' }} size={12}>
            <Form.Item name="weightKg" label="Weight (kg)" style={{ flex: 1 }}>
              <InputNumber min={0} precision={3} style={{ width: '100%' }} />
            </Form.Item>
            <Form.Item name="volumeCbm" label="Volume (CBM)" style={{ flex: 1 }}>
              <InputNumber min={0} precision={4} style={{ width: '100%' }} />
            </Form.Item>
          </Space>
          <Space style={{ width: '100%' }} size={12}>
            <Form.Item name="cost" label="Cost" style={{ flex: 1 }}>
              <InputNumber min={0} precision={2} style={{ width: '100%' }} />
            </Form.Item>
            <Form.Item name="currency" label="Currency" initialValue="USD" style={{ flex: 1 }}>
              <Select options={[
                { value: 'USD', label: 'USD' },
                { value: 'CNY', label: 'CNY' },
                { value: 'EUR', label: 'EUR' },
              ]} />
            </Form.Item>
          </Space>
          <Form.Item name="notes" label="Notes">
            <Input.TextArea rows={3} />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  )
}
