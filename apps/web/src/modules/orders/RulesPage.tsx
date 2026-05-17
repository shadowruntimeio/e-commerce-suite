import { useState } from 'react'
import {
  Table, Button, Modal, Form, Input, InputNumber, Select,
  Space, Popconfirm, message, Alert,
} from 'antd'
import {
  PlusOutlined, EditOutlined, DeleteOutlined, PlayCircleOutlined, FilterOutlined,
} from '@ant-design/icons'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '../../lib/api'
import type { ColumnsType } from 'antd/es/table'

// ─── Types ───────────────────────────────────────────────────────────────────

const ACTION_TYPE_OPTIONS = [
  { value: 'add_tag', label: 'Add Tag' },
  { value: 'assign_warehouse', label: 'Assign Warehouse' },
  { value: 'flag_for_review', label: 'Flag for Review' },
  { value: 'auto_confirm', label: 'Auto Confirm' },
  { value: 'set_priority', label: 'Set Priority' },
]

interface RuleAction {
  type: string
  value?: string
}

interface OrderRule {
  id: string
  name: string
  priority: number
  isActive: boolean
  conditions: unknown
  actions: RuleAction[]
  createdAt: string
}

interface TestResult {
  matched: boolean
  message: string
  context: Record<string, unknown>
  actions: RuleAction[]
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function PriorityBadge({ value }: { value: number }) {
  return (
    <div style={{ width: 28, height: 28, borderRadius: '50%', background: 'var(--badge-info-bg)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto' }}>
      <span style={{ color: 'var(--badge-info-fg)', fontWeight: 700, fontSize: 12 }}>{value}</span>
    </div>
  )
}

function StatusToggle({ active }: { active: boolean }) {
  return (
    <span style={{
      background: active ? 'var(--badge-success-bg)' : 'var(--badge-neutral-bg)',
      color: active ? 'var(--badge-success-fg)' : 'var(--badge-neutral-fg)',
      padding: '3px 10px',
      borderRadius: 20,
      fontSize: 12,
      fontWeight: 500,
    }}>
      {active ? 'Active' : 'Inactive'}
    </span>
  )
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function RulesPage() {
  const queryClient = useQueryClient()
  const [modalOpen, setModalOpen] = useState(false)
  const [editingRule, setEditingRule] = useState<OrderRule | null>(null)
  const [testModalOpen, setTestModalOpen] = useState(false)
  const [testResult, setTestResult] = useState<TestResult | null>(null)
  const [testOrderId, setTestOrderId] = useState('')
  const [testingRuleData, setTestingRuleData] = useState<{ conditions: unknown; actions: RuleAction[] } | null>(null)
  const [form] = Form.useForm()

  const { data, isLoading } = useQuery({
    queryKey: ['order-rules'],
    queryFn: () => api.get('/orders/rules').then((r) => r.data.data as OrderRule[]),
  })

  const createMutation = useMutation({
    mutationFn: (values: unknown) => api.post('/orders/rules', values),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['order-rules'] })
      setModalOpen(false)
      form.resetFields()
      void message.success('Rule created')
    },
    onError: () => void message.error('Failed to create rule'),
  })

  const updateMutation = useMutation({
    mutationFn: ({ id, values }: { id: string; values: unknown }) =>
      api.put(`/orders/rules/${id}`, values),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['order-rules'] })
      setModalOpen(false)
      setEditingRule(null)
      form.resetFields()
      void message.success('Rule updated')
    },
    onError: () => void message.error('Failed to update rule'),
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/orders/rules/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['order-rules'] })
      void message.success('Rule deleted')
    },
    onError: () => void message.error('Failed to delete rule'),
  })

  const testMutation = useMutation({
    mutationFn: (payload: { conditions: unknown; actions: RuleAction[]; orderId: string }) =>
      api.post('/orders/rules/test', payload).then((r) => r.data.data as TestResult),
    onSuccess: (result) => setTestResult(result),
    onError: () => void message.error('Failed to test rule'),
  })

  function openCreate() {
    setEditingRule(null)
    form.resetFields()
    form.setFieldsValue({
      priority: 0,
      isActive: true,
      conditions: JSON.stringify({ operator: 'AND', rules: [{ field: 'status', op: 'eq', value: 'PENDING' }] }, null, 2),
      actions: [{ type: 'flag_for_review' }],
    })
    setModalOpen(true)
  }

  function openEdit(rule: OrderRule) {
    setEditingRule(rule)
    form.setFieldsValue({
      name: rule.name,
      priority: rule.priority,
      isActive: rule.isActive,
      conditions: JSON.stringify(rule.conditions, null, 2),
      actions: rule.actions,
    })
    setModalOpen(true)
  }

  function openTest(rule: OrderRule) {
    setTestingRuleData({ conditions: rule.conditions, actions: rule.actions })
    setTestResult(null)
    setTestOrderId('')
    setTestModalOpen(true)
  }

  function handleSubmit() {
    form.validateFields().then((values) => {
      let parsedConditions: unknown
      try {
        parsedConditions = JSON.parse(values.conditions as string)
      } catch {
        void message.error('Conditions must be valid JSON')
        return
      }
      const payload = {
        name: values.name,
        priority: values.priority ?? 0,
        isActive: values.isActive ?? true,
        conditions: parsedConditions,
        actions: values.actions,
      }
      if (editingRule) {
        updateMutation.mutate({ id: editingRule.id, values: payload })
      } else {
        createMutation.mutate(payload)
      }
    })
  }

  function handleTest() {
    if (!testingRuleData || !testOrderId.trim()) {
      void message.warning('Please enter an Order ID')
      return
    }
    testMutation.mutate({ ...testingRuleData, orderId: testOrderId.trim() })
  }

  const columns: ColumnsType<OrderRule> = [
    {
      title: 'Priority',
      dataIndex: 'priority',
      width: 80,
      align: 'center',
      render: (v: number) => <PriorityBadge value={v} />,
    },
    {
      title: 'Rule Name',
      dataIndex: 'name',
      render: (v) => <span style={{ fontWeight: 600, color: 'var(--text-primary)', fontSize: 14 }}>{v}</span>,
    },
    {
      title: 'Actions',
      dataIndex: 'actions',
      render: (actions: RuleAction[]) => (
        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
          {actions.map((a, i) => (
            <span key={i} style={{ background: 'var(--badge-info-bg)', color: 'var(--badge-info-fg)', padding: '2px 8px', borderRadius: 6, fontSize: 12, fontWeight: 500 }}>
              {a.type}{a.value ? `: ${a.value}` : ''}
            </span>
          ))}
        </div>
      ),
    },
    {
      title: 'Status',
      dataIndex: 'isActive',
      width: 100,
      render: (v: boolean) => <StatusToggle active={v} />,
    },
    {
      title: '',
      width: 140,
      render: (_: unknown, record: OrderRule) => (
        <Space size={4}>
          <Button
            type="text"
            size="small"
            icon={<PlayCircleOutlined />}
            style={{ color: '#10B981' }}
            onClick={() => openTest(record)}
          />
          <Button
            type="text"
            size="small"
            icon={<EditOutlined />}
            style={{ color: 'var(--text-secondary)' }}
            onClick={() => openEdit(record)}
          />
          <Popconfirm title="Delete this rule?" onConfirm={() => deleteMutation.mutate(record.id)}>
            <Button type="text" size="small" icon={<DeleteOutlined />} style={{ color: '#EF4444' }} />
          </Popconfirm>
        </Space>
      ),
    },
  ]

  return (
    <div>
      {/* Page Header */}
      <div style={{ marginBottom: 24 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <p style={{ margin: '4px 0 0', color: 'var(--text-secondary)', fontSize: 14 }}>Auto-process orders when conditions are met</p>
          </div>
          <Button
            type="primary"
            icon={<PlusOutlined />}
            onClick={openCreate}
            style={{ background: 'var(--accent-gradient)', border: 'none', borderRadius: 8, height: 36, fontWeight: 500, fontSize: 14 }}
          >
            New Rule
          </Button>
        </div>
      </div>

      {/* Table */}
      <div style={{ background: 'var(--bg-card)', borderRadius: 12, border: '1px solid var(--border)', overflow: 'hidden' }}>
        <Table
          rowKey="id"
          columns={columns}
          dataSource={data ?? []}
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
                <FilterOutlined style={{ fontSize: 40, color: 'var(--text-muted)', display: 'block', margin: '0 auto 12px' }} />
                <div style={{ fontSize: 15, fontWeight: 500, color: 'var(--text-secondary)' }}>No rules yet</div>
                <div style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 4 }}>Create rules to auto-process orders</div>
              </div>
            ),
          }}
        />
      </div>

      {/* Create / Edit Modal */}
      <Modal
        title={
          <span style={{ fontSize: 16, fontWeight: 700, color: 'var(--text-primary)' }}>
            {editingRule ? 'Edit Rule' : 'New Rule'}
          </span>
        }
        open={modalOpen}
        onCancel={() => { setModalOpen(false); setEditingRule(null) }}
        onOk={handleSubmit}
        confirmLoading={createMutation.isPending || updateMutation.isPending}
        okButtonProps={{ style: { background: 'var(--accent-gradient)', border: 'none', borderRadius: 8 } }}
        width={680}
        destroyOnClose
      >
        <Form form={form} layout="vertical" style={{ marginTop: 8 }}>
          <Form.Item name="name" label="Rule Name" rules={[{ required: true, message: 'Name is required' }]}>
            <Input placeholder="e.g. High-value order review" />
          </Form.Item>

          <Space style={{ width: '100%' }} size={16}>
            <Form.Item name="priority" label="Priority" style={{ width: 120 }}>
              <InputNumber min={0} max={9999} style={{ width: '100%' }} />
            </Form.Item>
            <Form.Item name="isActive" label="Status">
              <Select style={{ width: 140 }} options={[
                { value: true, label: 'Active' },
                { value: false, label: 'Inactive' },
              ]} />
            </Form.Item>
          </Space>

          <Form.Item
            name="conditions"
            label={
              <span>
                Conditions{' '}
                <span style={{ fontSize: 12, color: 'var(--text-muted)', fontWeight: 400 }}>JSON format</span>
              </span>
            }
            rules={[{ required: true, message: 'Conditions are required' }]}
            extra={
              <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                Fields: status, platform, shopId, totalRevenue, itemCount, buyerName, currency, tags
                &nbsp;•&nbsp; Ops: eq, neq, gt, gte, lt, lte, contains, in
              </span>
            }
          >
            <Input.TextArea
              rows={6}
              placeholder='{"operator":"AND","rules":[{"field":"totalRevenue","op":"gt","value":100}]}'
              style={{ fontFamily: "'Courier New', monospace", fontSize: 12, borderRadius: 8 }}
            />
          </Form.Item>

          <Form.List name="actions">
            {(fields, { add, remove }) => (
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 10 }}>
                  <span style={{ fontWeight: 600, color: 'var(--text-primary)', fontSize: 14 }}>Actions</span>
                  <Button size="small" icon={<PlusOutlined />} onClick={() => add({ type: 'add_tag' })}
                    style={{ borderRadius: 6 }}>
                    Add Action
                  </Button>
                </div>
                {fields.map(({ key, name }) => (
                  <div key={key} style={{ background: 'var(--bg-surface)', borderRadius: 8, border: '1px solid var(--border)', padding: '10px 12px', marginBottom: 8, display: 'flex', gap: 8, alignItems: 'center' }}>
                    <Form.Item name={[name, 'type']} noStyle rules={[{ required: true }]}>
                      <Select style={{ width: 180 }} options={ACTION_TYPE_OPTIONS} />
                    </Form.Item>
                    <Form.Item name={[name, 'value']} noStyle>
                      <Input placeholder="value (optional)" style={{ flex: 1 }} />
                    </Form.Item>
                    <Button size="small" type="text" danger onClick={() => remove(name)} style={{ color: '#EF4444', flexShrink: 0 }}>
                      Remove
                    </Button>
                  </div>
                ))}
                {fields.length === 0 && (
                  <div style={{ color: 'var(--text-muted)', fontSize: 13 }}>No actions yet. Add at least one action.</div>
                )}
              </div>
            )}
          </Form.List>
        </Form>
      </Modal>

      {/* Test Rule Modal */}
      <Modal
        title={<span style={{ fontSize: 16, fontWeight: 700, color: 'var(--text-primary)' }}>Test Rule (Dry Run)</span>}
        open={testModalOpen}
        onCancel={() => { setTestModalOpen(false); setTestResult(null) }}
        footer={[
          <Button key="close" onClick={() => { setTestModalOpen(false); setTestResult(null) }}>Close</Button>,
          <Button key="test" type="primary" loading={testMutation.isPending} onClick={handleTest}
            style={{ background: 'var(--accent-gradient)', border: 'none', borderRadius: 8 }}>
            Run Test
          </Button>,
        ]}
        width={560}
        destroyOnClose
      >
        <Space direction="vertical" style={{ width: '100%', marginTop: 8 }} size={14}>
          <div>
            <div style={{ fontWeight: 500, color: 'var(--text-primary)', marginBottom: 6, fontSize: 14 }}>Order ID</div>
            <Input
              placeholder="Enter order ID to test against"
              value={testOrderId}
              onChange={(e) => setTestOrderId(e.target.value)}
              style={{ fontFamily: 'monospace' }}
            />
          </div>

          {testResult && (
            <Alert
              type={testResult.matched ? 'success' : 'warning'}
              message={testResult.matched ? 'Rule Matches' : 'Rule Does Not Match'}
              description={testResult.message}
              showIcon
            />
          )}

          {testResult?.context && (
            <div>
              <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 6 }}>Order context:</div>
              <pre style={{ fontSize: 11, background: 'var(--bg-surface)', border: '1px solid var(--border)', padding: '10px 12px', borderRadius: 8, maxHeight: 200, overflow: 'auto', color: 'var(--text-primary)' }}>
                {JSON.stringify(testResult.context, null, 2)}
              </pre>
            </div>
          )}
        </Space>
      </Modal>
    </div>
  )
}
