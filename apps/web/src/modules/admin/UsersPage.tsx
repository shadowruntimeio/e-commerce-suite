import { useState } from 'react'
import {
  Table, Tag, Space, Button, Modal, Form, Input, Select, InputNumber, Switch, message, Card,
} from 'antd'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '../../lib/api'
import { ALL_CAPABILITIES, type Capability, type UserRole } from '../../store/auth.store'

interface SubUser {
  id: string
  email: string
  name: string
  role: UserRole
  capabilities: Capability[]
  warehouseScope: string[]
  settings: Record<string, unknown> | null
  isActive: boolean
  createdByUserId: string | null
  createdAt: string
}

interface Warehouse { id: string; name: string }

export default function AdminUsersPage() {
  const qc = useQueryClient()
  const [editingUser, setEditingUser] = useState<SubUser | null>(null)
  const [createOpen, setCreateOpen] = useState(false)

  const usersQ = useQuery({
    queryKey: ['admin-users'],
    queryFn: async () => (await api.get('/admin/users')).data.data as SubUser[],
  })
  const warehousesQ = useQuery({
    queryKey: ['warehouses'],
    queryFn: async () => (await api.get('/warehouses')).data.data as Warehouse[],
  })

  const refetch = () => qc.invalidateQueries({ queryKey: ['admin-users'] })

  const createMut = useMutation({
    mutationFn: (data: Record<string, unknown>) => api.post('/admin/users', data),
    onSuccess: () => { message.success('Sub-account created'); setCreateOpen(false); refetch() },
    onError: (err: any) => message.error(err?.response?.data?.error ?? 'Failed to create'),
  })
  const updateMut = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Record<string, unknown> }) =>
      api.patch(`/admin/users/${id}`, data),
    onSuccess: () => { message.success('Updated'); setEditingUser(null); refetch() },
    onError: (err: any) => message.error(err?.response?.data?.error ?? 'Failed to update'),
  })

  const columns = [
    { title: 'Name', dataIndex: 'name', key: 'name' },
    { title: 'Email', dataIndex: 'email', key: 'email' },
    {
      title: 'Role', dataIndex: 'role', key: 'role',
      render: (r: UserRole) => {
        const colors: Record<UserRole, string> = {
          ADMIN: 'red', WAREHOUSE_STAFF: 'blue', MERCHANT: 'green',
        }
        return <Tag color={colors[r]}>{r}</Tag>
      },
    },
    {
      title: 'Capabilities / Settings', key: 'caps',
      render: (_: unknown, u: SubUser) => {
        if (u.role === 'ADMIN') return <i style={{ color: 'var(--text-muted)' }}>(all)</i>
        if (u.role === 'MERCHANT') {
          const hours = (u.settings as { autoConfirmHours?: number } | null)?.autoConfirmHours ?? 24
          return <span>auto-confirm: {hours}h</span>
        }
        return (
          <Space size={4} wrap>
            {u.capabilities.map((c) => <Tag key={c}>{c}</Tag>)}
            {u.warehouseScope.length > 0 && <Tag color="purple">scope: {u.warehouseScope.length} wh</Tag>}
          </Space>
        )
      },
    },
    {
      title: 'Status', dataIndex: 'isActive', key: 'isActive',
      render: (v: boolean) => v ? <Tag color="success">Active</Tag> : <Tag color="default">Inactive</Tag>,
    },
    {
      title: 'Actions', key: 'actions',
      render: (_: unknown, u: SubUser) => (
        u.role === 'ADMIN' ? null : (
          <Space>
            <Button size="small" onClick={() => setEditingUser(u)}>Edit</Button>
            <Button
              size="small"
              danger={u.isActive}
              onClick={() => updateMut.mutate({ id: u.id, data: { isActive: !u.isActive } })}
            >
              {u.isActive ? 'Deactivate' : 'Reactivate'}
            </Button>
          </Space>
        )
      ),
    },
  ]

  return (
    <Card
      title="Sub-accounts"
      extra={<Button type="primary" onClick={() => setCreateOpen(true)}>+ New sub-account</Button>}
    >
      <Table
        rowKey="id"
        loading={usersQ.isLoading}
        dataSource={usersQ.data ?? []}
        columns={columns}
        pagination={false}
      />
      <CreateUserModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onSubmit={(data) => createMut.mutate(data)}
        warehouses={warehousesQ.data ?? []}
      />
      <EditUserModal
        user={editingUser}
        onClose={() => setEditingUser(null)}
        onSubmit={(data) => editingUser && updateMut.mutate({ id: editingUser.id, data })}
        warehouses={warehousesQ.data ?? []}
      />
    </Card>
  )
}

function CreateUserModal({
  open, onClose, onSubmit, warehouses,
}: {
  open: boolean
  onClose: () => void
  onSubmit: (data: Record<string, unknown>) => void
  warehouses: Warehouse[]
}) {
  const [form] = Form.useForm()
  const role = Form.useWatch('role', form)

  return (
    <Modal
      open={open}
      title="Create sub-account"
      onCancel={() => { form.resetFields(); onClose() }}
      onOk={() => form.submit()}
      okText="Create"
    >
      <Form
        form={form}
        layout="vertical"
        initialValues={{ role: 'WAREHOUSE_STAFF', capabilities: ['ORDER_VIEW'], autoConfirmHours: 24 }}
        onFinish={(v) => {
          if (v.role === 'WAREHOUSE_STAFF') {
            onSubmit({
              role: 'WAREHOUSE_STAFF',
              email: v.email, password: v.password, name: v.name,
              capabilities: v.capabilities ?? [],
              warehouseScope: v.warehouseScope ?? [],
            })
          } else {
            onSubmit({
              role: 'MERCHANT',
              email: v.email, password: v.password, name: v.name,
              settings: { autoConfirmHours: v.autoConfirmHours ?? 24 },
            })
          }
        }}
      >
        <Form.Item label="Role" name="role" rules={[{ required: true }]}>
          <Select options={[
            { value: 'WAREHOUSE_STAFF', label: 'Warehouse staff' },
            { value: 'MERCHANT', label: 'Merchant' },
          ]} />
        </Form.Item>
        <Form.Item label="Name" name="name" rules={[{ required: true }]}>
          <Input />
        </Form.Item>
        <Form.Item label="Email" name="email" rules={[{ required: true, type: 'email' }]}>
          <Input />
        </Form.Item>
        <Form.Item label="Password" name="password" rules={[{ required: true, min: 8 }]}>
          <Input.Password />
        </Form.Item>
        {role === 'WAREHOUSE_STAFF' && (
          <>
            <Form.Item
              label="Capabilities"
              name="capabilities"
              rules={[{ required: true, message: 'Select at least one capability' }, {
                validator: (_, v) => Array.isArray(v) && v.length > 0
                  ? Promise.resolve() : Promise.reject(new Error('At least one capability required')),
              }]}
            >
              <Select
                mode="multiple"
                placeholder="Select capabilities"
                options={ALL_CAPABILITIES.map((c) => ({ value: c, label: c }))}
              />
            </Form.Item>
            <Form.Item label="Warehouse scope (empty = all)" name="warehouseScope">
              <Select
                mode="multiple"
                placeholder="All warehouses"
                options={warehouses.map((w) => ({ value: w.id, label: w.name }))}
              />
            </Form.Item>
          </>
        )}
        {role === 'MERCHANT' && (
          <Form.Item label="Auto-confirm hours" name="autoConfirmHours" tooltip="Orders auto-confirm after this many hours if merchant doesn't act">
            <InputNumber min={1} max={168} />
          </Form.Item>
        )}
      </Form>
    </Modal>
  )
}

function EditUserModal({
  user, onClose, onSubmit, warehouses,
}: {
  user: SubUser | null
  onClose: () => void
  onSubmit: (data: Record<string, unknown>) => void
  warehouses: Warehouse[]
}) {
  const [form] = Form.useForm()
  if (!user) return null
  return (
    <Modal
      open={!!user}
      title={`Edit ${user.name}`}
      onCancel={() => { form.resetFields(); onClose() }}
      onOk={() => form.submit()}
      okText="Save"
      destroyOnClose
    >
      <Form
        form={form}
        layout="vertical"
        initialValues={{
          name: user.name,
          capabilities: user.capabilities,
          warehouseScope: user.warehouseScope,
          autoConfirmHours: (user.settings as { autoConfirmHours?: number } | null)?.autoConfirmHours ?? 24,
          isActive: user.isActive,
        }}
        onFinish={(v) => {
          const data: Record<string, unknown> = { name: v.name, isActive: v.isActive }
          if (user.role === 'WAREHOUSE_STAFF') {
            data.capabilities = v.capabilities
            data.warehouseScope = v.warehouseScope ?? []
          } else if (user.role === 'MERCHANT') {
            data.settings = { autoConfirmHours: v.autoConfirmHours ?? 24 }
          }
          onSubmit(data)
        }}
      >
        <Form.Item label="Name" name="name" rules={[{ required: true }]}>
          <Input />
        </Form.Item>
        <Form.Item label="Active" name="isActive" valuePropName="checked">
          <Switch />
        </Form.Item>
        {user.role === 'WAREHOUSE_STAFF' && (
          <>
            <Form.Item
              label="Capabilities"
              name="capabilities"
              rules={[{
                validator: (_, v) => Array.isArray(v) && v.length > 0
                  ? Promise.resolve() : Promise.reject(new Error('At least one capability required')),
              }]}
            >
              <Select mode="multiple" options={ALL_CAPABILITIES.map((c) => ({ value: c, label: c }))} />
            </Form.Item>
            <Form.Item label="Warehouse scope (empty = all)" name="warehouseScope">
              <Select
                mode="multiple"
                placeholder="All warehouses"
                options={warehouses.map((w) => ({ value: w.id, label: w.name }))}
              />
            </Form.Item>
          </>
        )}
        {user.role === 'MERCHANT' && (
          <Form.Item label="Auto-confirm hours" name="autoConfirmHours">
            <InputNumber min={1} max={168} />
          </Form.Item>
        )}
      </Form>
    </Modal>
  )
}
