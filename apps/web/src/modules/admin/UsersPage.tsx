import { useState } from 'react'
import {
  Table, Tag, Space, Button, Modal, Form, Input, Select, InputNumber, Switch, message, Card,
} from 'antd'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
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
  const { t } = useTranslation()
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
    onSuccess: () => { message.success(t('admin.users.created')); setCreateOpen(false); refetch() },
    onError: (err: any) => message.error(err?.response?.data?.error ?? t('admin.users.createFailed')),
  })
  const updateMut = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Record<string, unknown> }) =>
      api.patch(`/admin/users/${id}`, data),
    onSuccess: () => { message.success(t('common.updated')); setEditingUser(null); refetch() },
    onError: (err: any) => message.error(err?.response?.data?.error ?? t('admin.users.updateFailed')),
  })

  const columns = [
    { title: t('common.name'), dataIndex: 'name', key: 'name' },
    { title: t('common.email'), dataIndex: 'email', key: 'email' },
    {
      title: t('common.role'), dataIndex: 'role', key: 'role',
      render: (r: UserRole) => {
        const colors: Record<UserRole, string> = {
          ADMIN: 'red', WAREHOUSE_STAFF: 'blue', MERCHANT: 'green',
        }
        return <Tag color={colors[r]}>{t(`nav.role.${r}`)}</Tag>
      },
    },
    {
      title: t('admin.users.capabilitiesSettings'), key: 'caps',
      render: (_: unknown, u: SubUser) => {
        if (u.role === 'ADMIN') return <i style={{ color: 'var(--text-muted)' }}>{t('admin.users.allCapabilities')}</i>
        if (u.role === 'MERCHANT') {
          const hours = (u.settings as { autoConfirmHours?: number } | null)?.autoConfirmHours ?? 24
          return <span>{t('admin.users.autoConfirm', { hours })}</span>
        }
        return (
          <Space size={4} wrap>
            {u.capabilities.map((c) => <Tag key={c}>{c}</Tag>)}
            {u.warehouseScope.length > 0 && <Tag color="purple">{t('admin.users.warehouseScopeTag', { n: u.warehouseScope.length })}</Tag>}
          </Space>
        )
      },
    },
    {
      title: t('common.status'), dataIndex: 'isActive', key: 'isActive',
      render: (v: boolean) => v ? <Tag color="success">{t('common.active')}</Tag> : <Tag color="default">{t('common.inactive')}</Tag>,
    },
    {
      title: t('common.actions'), key: 'actions',
      render: (_: unknown, u: SubUser) => (
        u.role === 'ADMIN' ? null : (
          <Space>
            <Button size="small" onClick={() => setEditingUser(u)}>{t('common.edit')}</Button>
            <Button
              size="small"
              danger={u.isActive}
              onClick={() => updateMut.mutate({ id: u.id, data: { isActive: !u.isActive } })}
            >
              {u.isActive ? t('admin.users.deactivate') : t('admin.users.reactivate')}
            </Button>
          </Space>
        )
      ),
    },
  ]

  return (
    <Card>
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginBottom: 12 }}>
        <Button type="primary" onClick={() => setCreateOpen(true)}>{t('admin.users.addNew')}</Button>
      </div>
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
  const { t } = useTranslation()
  const [form] = Form.useForm()
  const role = Form.useWatch('role', form)

  return (
    <Modal
      open={open}
      title={t('admin.users.createTitle')}
      onCancel={() => { form.resetFields(); onClose() }}
      onOk={() => form.submit()}
      okText={t('common.create')}
      cancelText={t('common.cancel')}
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
        <Form.Item label={t('common.role')} name="role" rules={[{ required: true }]}>
          <Select options={[
            { value: 'WAREHOUSE_STAFF', label: t('admin.users.roleWarehouseStaff') },
            { value: 'MERCHANT', label: t('admin.users.roleMerchant') },
          ]} />
        </Form.Item>
        <Form.Item label={t('common.name')} name="name" rules={[{ required: true }]}>
          <Input />
        </Form.Item>
        <Form.Item label={t('common.email')} name="email" rules={[{ required: true, type: 'email' }]}>
          <Input />
        </Form.Item>
        <Form.Item label={t('common.password')} name="password" rules={[{ required: true, min: 8 }]}>
          <Input.Password />
        </Form.Item>
        {role === 'WAREHOUSE_STAFF' && (
          <>
            <Form.Item
              label={t('admin.users.capabilities')}
              name="capabilities"
              rules={[{ required: true, message: t('admin.users.atLeastOneCap') }, {
                validator: (_, v) => Array.isArray(v) && v.length > 0
                  ? Promise.resolve() : Promise.reject(new Error(t('admin.users.atLeastOneCap'))),
              }]}
            >
              <Select
                mode="multiple"
                placeholder={t('admin.users.selectCapabilities')}
                options={ALL_CAPABILITIES.map((c) => ({ value: c, label: c }))}
              />
            </Form.Item>
            <Form.Item label={t('admin.users.warehouseScope')} name="warehouseScope">
              <Select
                mode="multiple"
                placeholder={t('inventory.allWarehouses')}
                options={warehouses.map((w) => ({ value: w.id, label: w.name }))}
              />
            </Form.Item>
          </>
        )}
        {role === 'MERCHANT' && (
          <Form.Item label={t('admin.users.autoConfirmHours')} name="autoConfirmHours" tooltip={t('admin.users.autoConfirmTooltip')}>
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
  const { t } = useTranslation()
  const [form] = Form.useForm()
  if (!user) return null
  return (
    <Modal
      open={!!user}
      title={t('admin.users.editTitle', { name: user.name })}
      onCancel={() => { form.resetFields(); onClose() }}
      onOk={() => form.submit()}
      okText={t('common.save')}
      cancelText={t('common.cancel')}
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
        <Form.Item label={t('common.name')} name="name" rules={[{ required: true }]}>
          <Input />
        </Form.Item>
        <Form.Item label={t('common.active')} name="isActive" valuePropName="checked">
          <Switch />
        </Form.Item>
        {user.role === 'WAREHOUSE_STAFF' && (
          <>
            <Form.Item
              label={t('admin.users.capabilities')}
              name="capabilities"
              rules={[{
                validator: (_, v) => Array.isArray(v) && v.length > 0
                  ? Promise.resolve() : Promise.reject(new Error(t('admin.users.atLeastOneCap'))),
              }]}
            >
              <Select mode="multiple" options={ALL_CAPABILITIES.map((c) => ({ value: c, label: c }))} />
            </Form.Item>
            <Form.Item label={t('admin.users.warehouseScope')} name="warehouseScope">
              <Select
                mode="multiple"
                placeholder={t('inventory.allWarehouses')}
                options={warehouses.map((w) => ({ value: w.id, label: w.name }))}
              />
            </Form.Item>
          </>
        )}
        {user.role === 'MERCHANT' && (
          <Form.Item label={t('admin.users.autoConfirmHours')} name="autoConfirmHours">
            <InputNumber min={1} max={168} />
          </Form.Item>
        )}
      </Form>
    </Modal>
  )
}
