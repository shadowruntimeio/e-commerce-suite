import { useState } from 'react'
import { Card, Table, Tag, Button, Modal, Form, InputNumber, Input, Select, Space, message } from 'antd'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '../../lib/api'
import { useAuthStore, hasCapability, isMerchant } from '../../store/auth.store'
import dayjs from 'dayjs'

interface AfterSalesTicket {
  id: string
  orderId: string
  type: string
  status: string
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
    shop: { id: string; name: string; ownerUserId: string }
    items: Array<{ id: string; productName: string; quantity: number; sellerSku: string | null; systemSkuId: string | null }>
  }
}

export default function ReturnsPage() {
  const qc = useQueryClient()
  const user = useAuthStore((s) => s.user)
  const [createOpen, setCreateOpen] = useState(false)
  const [intakeTicket, setIntakeTicket] = useState<AfterSalesTicket | null>(null)
  const [inspectTicket, setInspectTicket] = useState<AfterSalesTicket | null>(null)

  const ticketsQ = useQuery({
    queryKey: ['returns'],
    queryFn: async () => (await api.get('/returns', { params: { pageSize: 100 } })).data.data.items as AfterSalesTicket[],
  })

  const refetch = () => qc.invalidateQueries({ queryKey: ['returns'] })

  const intakeMut = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Record<string, unknown> }) =>
      api.post(`/returns/${id}/intake`, data),
    onSuccess: () => { message.success('Marked as arrived'); setIntakeTicket(null); refetch() },
    onError: (err: any) => message.error(err?.response?.data?.error ?? 'Failed'),
  })

  const inspectMut = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Record<string, unknown> }) =>
      api.post(`/returns/${id}/inspect`, data),
    onSuccess: () => { message.success('Inspection recorded'); setInspectTicket(null); refetch() },
    onError: (err: any) => message.error(err?.response?.data?.error ?? 'Failed'),
  })

  const columns = [
    { title: 'Order', dataIndex: ['order', 'platformOrderId'], key: 'order' },
    { title: 'Shop', dataIndex: ['order', 'shop', 'name'], key: 'shop' },
    { title: 'Type', dataIndex: 'type', key: 'type', render: (v: string) => <Tag>{v}</Tag> },
    {
      title: 'Status', dataIndex: 'status', key: 'status',
      render: (v: string) => {
        const colors: Record<string, string> = { OPEN: 'gold', PROCESSING: 'blue', RESOLVED: 'green', CLOSED: 'default' }
        return <Tag color={colors[v]}>{v}</Tag>
      },
    },
    {
      title: 'Condition', dataIndex: 'condition', key: 'condition',
      render: (v: string) => {
        const colors: Record<string, string> = { PENDING_INSPECTION: 'gold', SELLABLE: 'green', DAMAGED: 'red', DISPOSED: 'default' }
        return <Tag color={colors[v]}>{v}</Tag>
      },
    },
    {
      title: 'Qty', key: 'qty',
      render: (_: unknown, t: AfterSalesTicket) => (
        <span>{t.returnedQty ?? '—'} / {t.expectedQty ?? '?'}</span>
      ),
    },
    {
      title: 'Arrived', dataIndex: 'arrivedAt', key: 'arrivedAt',
      render: (v: string | null) => v ? dayjs(v).format('YYYY-MM-DD HH:mm') : '—',
    },
    {
      title: 'Actions', key: 'actions',
      render: (_: unknown, t: AfterSalesTicket) => {
        const canIntake = hasCapability(user, 'RETURN_INTAKE')
        return (
          <Space>
            {canIntake && !t.arrivedAt && (
              <Button size="small" onClick={() => setIntakeTicket(t)}>Mark arrived</Button>
            )}
            {canIntake && t.arrivedAt && t.status !== 'RESOLVED' && (
              <Button size="small" type="primary" onClick={() => setInspectTicket(t)}>Inspect</Button>
            )}
          </Space>
        )
      },
    },
  ]

  return (
    <Card
      title="Returns"
      extra={
        isMerchant(user) || user?.role === 'ADMIN' ? (
          <Button type="primary" onClick={() => setCreateOpen(true)}>+ New return</Button>
        ) : null
      }
    >
      <Table
        rowKey="id"
        loading={ticketsQ.isLoading}
        dataSource={ticketsQ.data ?? []}
        columns={columns}
        pagination={{ pageSize: 20 }}
      />
      <CreateReturnModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={refetch}
      />
      {intakeTicket && (
        <Modal
          open
          title="Mark goods as arrived"
          onCancel={() => setIntakeTicket(null)}
          onOk={() => intakeMut.mutate({ id: intakeTicket.id, data: {} })}
          okText="Confirm arrival"
        >
          <p>Order: {intakeTicket.order.platformOrderId}</p>
          <p>Expected qty: {intakeTicket.expectedQty ?? '(unspecified)'}</p>
        </Modal>
      )}
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

function CreateReturnModal({
  open, onClose, onCreated,
}: { open: boolean; onClose: () => void; onCreated: () => void }) {
  const [form] = Form.useForm()
  const ordersQ = useQuery({
    enabled: open,
    queryKey: ['orders-for-return'],
    queryFn: async () => (await api.get('/orders', { params: { pageSize: 50 } })).data.data.items,
  })
  const mut = useMutation({
    mutationFn: (data: Record<string, unknown>) => api.post('/returns', data),
    onSuccess: () => { message.success('Return created'); form.resetFields(); onClose(); onCreated() },
    onError: (err: any) => message.error(err?.response?.data?.error ?? 'Failed'),
  })

  return (
    <Modal
      open={open}
      title="Create return ticket"
      onCancel={() => { form.resetFields(); onClose() }}
      onOk={() => form.submit()}
      okText="Create"
      destroyOnClose
    >
      <Form form={form} layout="vertical" onFinish={(v) => mut.mutate(v)} initialValues={{ type: 'RETURN' }}>
        <Form.Item label="Order" name="orderId" rules={[{ required: true }]}>
          <Select
            showSearch optionFilterProp="label" placeholder="Pick order"
            options={(ordersQ.data ?? []).map((o: any) => ({
              value: o.id,
              label: `${o.platformOrderId} • ${o.shop?.name ?? ''} • ${o.buyerName ?? ''}`,
            }))}
          />
        </Form.Item>
        <Form.Item label="Type" name="type">
          <Select options={[
            { value: 'RETURN', label: 'Return' },
            { value: 'REFUND', label: 'Refund' },
            { value: 'EXCHANGE', label: 'Exchange' },
            { value: 'DISPUTE', label: 'Dispute' },
          ]} />
        </Form.Item>
        <Form.Item label="Expected return qty" name="expectedQty">
          <InputNumber min={1} />
        </Form.Item>
        <Form.Item label="Notes" name="notes">
          <Input.TextArea rows={3} />
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
      title="Inspect returned goods"
      onCancel={() => { form.resetFields(); onClose() }}
      onOk={() => form.submit()}
      okText="Save inspection"
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
        <Form.Item label="Condition" name="condition" rules={[{ required: true }]}>
          <Select options={[
            { value: 'SELLABLE', label: 'Sellable (restock to inventory)' },
            { value: 'DAMAGED', label: 'Damaged (no restock)' },
            { value: 'DISPOSED', label: 'Disposed (no restock)' },
          ]} />
        </Form.Item>
        <Form.Item label="Returned qty" name="returnedQty" rules={[{ required: true }]}>
          <InputNumber min={0} />
        </Form.Item>
        {condition === 'SELLABLE' && (
          <Form.Item label="Restock to warehouse SKU" name="warehouseSkuId" rules={[{ required: true }]}>
            <Select
              showSearch
              placeholder="Pick warehouse-sku"
              optionFilterProp="label"
              options={(stockQ.data ?? []).map((s: any) => ({
                value: s.warehouseSkuId,
                label: `${s.skuCode} • ${s.warehouseName} (on hand: ${s.quantityOnHand})`,
              }))}
            />
          </Form.Item>
        )}
        <Form.Item label="Notes" name="notes">
          <Input.TextArea rows={2} />
        </Form.Item>
      </Form>
    </Modal>
  )
}
