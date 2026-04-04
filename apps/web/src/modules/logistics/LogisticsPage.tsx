import { useState } from 'react'
import { Button, Card, Form, Input, InputNumber, Modal, Select, Table, Tag } from 'antd'
import { PlusOutlined, EditOutlined } from '@ant-design/icons'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '../../lib/api'
import dayjs from 'dayjs'
import type { ColumnsType } from 'antd/es/table'

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

const STATUS_COLOR: Record<string, string> = {
  PENDING: 'orange',
  IN_TRANSIT: 'blue',
  ARRIVED: 'green',
  CLEARED: 'cyan',
  CANCELLED: 'default',
}

export default function LogisticsPage() {
  const [modalOpen, setModalOpen] = useState(false)
  const [editingShipment, setEditingShipment] = useState<Shipment | null>(null)
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
      // validation error, do nothing
    }
  }

  const shipments: Shipment[] = data?.items ?? []

  const columns: ColumnsType<Shipment> = [
    {
      title: 'Tracking #',
      dataIndex: 'trackingNumber',
      width: 150,
      render: (v) => v ?? <span style={{ color: '#bfbfbf' }}>—</span>,
    },
    { title: 'Carrier', dataIndex: 'carrier', width: 100, render: (v) => v ?? '—' },
    {
      title: 'Type',
      dataIndex: 'shipmentType',
      width: 80,
      render: (v) => <Tag>{v}</Tag>,
    },
    { title: 'Destination', dataIndex: 'destination', width: 140, render: (v) => v ?? '—' },
    {
      title: 'Status',
      dataIndex: 'status',
      width: 110,
      render: (v: string) => <Tag color={STATUS_COLOR[v] ?? 'default'}>{v}</Tag>,
    },
    {
      title: 'Weight (kg)',
      dataIndex: 'weightKg',
      width: 110,
      align: 'right',
      render: (v) => (v != null ? Number(v).toFixed(2) : '—'),
    },
    {
      title: 'Cost',
      dataIndex: 'cost',
      width: 100,
      align: 'right',
      render: (v, r) => (v != null ? `${r.currency} ${Number(v).toFixed(2)}` : '—'),
    },
    {
      title: 'ETA',
      dataIndex: 'estimatedArrival',
      width: 120,
      render: (v) => (v ? dayjs(v).format('YYYY-MM-DD') : '—'),
    },
    { title: 'Warehouse', dataIndex: ['warehouse', 'name'], width: 140, render: (v, r) => v ?? r.warehouseId },
    {
      title: 'Actions',
      key: 'actions',
      width: 100,
      render: (_, record) => (
        <Button
          size="small"
          icon={<EditOutlined />}
          onClick={() => openEdit(record)}
        >
          Edit
        </Button>
      ),
    },
  ]

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <h2 style={{ margin: 0 }}>First-Leg Logistics</h2>
        <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
          New Shipment
        </Button>
      </div>

      <Card>
        <Table
          rowKey="id"
          columns={columns}
          dataSource={shipments}
          loading={isLoading}
          size="small"
          pagination={{ pageSize: 20 }}
          scroll={{ x: 1100 }}
        />
      </Card>

      <Modal
        title={editingShipment ? 'Edit Shipment' : 'New Shipment'}
        open={modalOpen}
        onCancel={() => {
          setModalOpen(false)
          form.resetFields()
          setEditingShipment(null)
        }}
        onOk={handleSubmit}
        confirmLoading={createMutation.isPending || updateMutation.isPending}
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
          <Form.Item name="trackingNumber" label="Tracking Number">
            <Input />
          </Form.Item>
          <Form.Item name="carrier" label="Carrier">
            <Input />
          </Form.Item>
          <Form.Item name="shipmentType" label="Shipment Type">
            <Select
              options={[
                { value: 'SEA', label: 'Sea' },
                { value: 'AIR', label: 'Air' },
                { value: 'RAIL', label: 'Rail' },
              ]}
            />
          </Form.Item>
          <Form.Item name="destination" label="Destination">
            <Input />
          </Form.Item>
          {editingShipment && (
            <Form.Item name="status" label="Status">
              <Select
                options={[
                  { value: 'PENDING', label: 'Pending' },
                  { value: 'IN_TRANSIT', label: 'In Transit' },
                  { value: 'ARRIVED', label: 'Arrived' },
                  { value: 'CLEARED', label: 'Cleared' },
                  { value: 'CANCELLED', label: 'Cancelled' },
                ]}
              />
            </Form.Item>
          )}
          <Form.Item name="weightKg" label="Weight (kg)">
            <InputNumber min={0} precision={3} style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item name="volumeCbm" label="Volume (CBM)">
            <InputNumber min={0} precision={4} style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item name="cost" label="Cost">
            <InputNumber min={0} precision={2} style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item name="currency" label="Currency" initialValue="USD">
            <Select
              options={[
                { value: 'USD', label: 'USD' },
                { value: 'CNY', label: 'CNY' },
                { value: 'EUR', label: 'EUR' },
              ]}
            />
          </Form.Item>
          <Form.Item name="notes" label="Notes">
            <Input.TextArea rows={3} />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  )
}
