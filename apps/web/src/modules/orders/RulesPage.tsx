import { useState } from 'react'
import {
  Card, Table, Button, Modal, Form, Input, InputNumber, Select,
  Space, Tag, Popconfirm, message, Typography, Alert,
} from 'antd'
import { PlusOutlined, EditOutlined, DeleteOutlined, PlayCircleOutlined } from '@ant-design/icons'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '../../lib/api'
import type { ColumnsType } from 'antd/es/table'

const { TextArea } = Input
const { Text } = Typography

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
    onSuccess: (result) => {
      setTestResult(result)
    },
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
    { title: 'Name', dataIndex: 'name', width: 200 },
    { title: 'Priority', dataIndex: 'priority', width: 80, align: 'center' },
    {
      title: 'Status',
      dataIndex: 'isActive',
      width: 90,
      render: (v: boolean) => <Tag color={v ? 'green' : 'default'}>{v ? 'Active' : 'Inactive'}</Tag>,
    },
    {
      title: 'Actions',
      dataIndex: 'actions',
      render: (actions: RuleAction[]) => (
        <Space size={4} wrap>
          {actions.map((a, i) => (
            <Tag key={i}>{a.type}{a.value ? `: ${a.value}` : ''}</Tag>
          ))}
        </Space>
      ),
    },
    {
      title: '',
      width: 160,
      render: (_: unknown, record: OrderRule) => (
        <Space>
          <Button size="small" icon={<PlayCircleOutlined />} onClick={() => openTest(record)}>Test</Button>
          <Button size="small" icon={<EditOutlined />} onClick={() => openEdit(record)}>Edit</Button>
          <Popconfirm title="Delete this rule?" onConfirm={() => deleteMutation.mutate(record.id)}>
            <Button size="small" danger icon={<DeleteOutlined />} />
          </Popconfirm>
        </Space>
      ),
    },
  ]

  return (
    <>
      <Card
        title="Order Rules"
        extra={<Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>New Rule</Button>}
      >
        <Table
          rowKey="id"
          columns={columns}
          dataSource={data ?? []}
          loading={isLoading}
          size="small"
          pagination={{ pageSize: 20, showSizeChanger: false }}
        />
      </Card>

      {/* Create / Edit Modal */}
      <Modal
        title={editingRule ? 'Edit Rule' : 'New Rule'}
        open={modalOpen}
        onCancel={() => { setModalOpen(false); setEditingRule(null) }}
        onOk={handleSubmit}
        confirmLoading={createMutation.isPending || updateMutation.isPending}
        width={680}
        destroyOnClose
      >
        <Form form={form} layout="vertical">
          <Form.Item name="name" label="Rule Name" rules={[{ required: true, message: 'Name is required' }]}>
            <Input placeholder="e.g. High-value order review" />
          </Form.Item>

          <Space style={{ width: '100%' }} size={16}>
            <Form.Item name="priority" label="Priority" style={{ width: 120 }}>
              <InputNumber min={0} max={9999} style={{ width: '100%' }} />
            </Form.Item>
            <Form.Item name="isActive" label="Status">
              <Select style={{ width: 120 }} options={[{ value: true, label: 'Active' }, { value: false, label: 'Inactive' }]} />
            </Form.Item>
          </Space>

          <Form.Item
            name="conditions"
            label={
              <Space>
                <span>Conditions</span>
                <Text type="secondary" style={{ fontSize: 12 }}>JSON format</Text>
              </Space>
            }
            rules={[{ required: true, message: 'Conditions are required' }]}
            extra={
              <Text type="secondary" style={{ fontSize: 11 }}>
                Fields: status, platform, shopId, totalRevenue, itemCount, buyerName, currency, tags
                <br />
                Ops: eq, neq, gt, gte, lt, lte, contains, in
              </Text>
            }
          >
            <TextArea rows={6} placeholder='{"operator":"AND","rules":[{"field":"totalRevenue","op":"gt","value":100}]}' style={{ fontFamily: 'monospace', fontSize: 12 }} />
          </Form.Item>

          <Form.List name="actions">
            {(fields, { add, remove }) => (
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                  <Text strong>Actions</Text>
                  <Button size="small" icon={<PlusOutlined />} onClick={() => add({ type: 'add_tag' })}>
                    Add Action
                  </Button>
                </div>
                {fields.map(({ key, name }) => (
                  <Card key={key} size="small" style={{ marginBottom: 8 }}>
                    <Space style={{ width: '100%' }}>
                      <Form.Item name={[name, 'type']} noStyle rules={[{ required: true }]}>
                        <Select style={{ width: 180 }} options={ACTION_TYPE_OPTIONS} />
                      </Form.Item>
                      <Form.Item name={[name, 'value']} noStyle>
                        <Input placeholder="value (optional)" style={{ width: 200 }} />
                      </Form.Item>
                      <Button size="small" danger onClick={() => remove(name)}>Remove</Button>
                    </Space>
                  </Card>
                ))}
                {fields.length === 0 && (
                  <Text type="secondary">No actions yet. Add at least one action.</Text>
                )}
              </div>
            )}
          </Form.List>
        </Form>
      </Modal>

      {/* Test Rule Modal */}
      <Modal
        title="Test Rule (Dry Run)"
        open={testModalOpen}
        onCancel={() => { setTestModalOpen(false); setTestResult(null) }}
        footer={[
          <Button key="close" onClick={() => { setTestModalOpen(false); setTestResult(null) }}>Close</Button>,
          <Button key="test" type="primary" loading={testMutation.isPending} onClick={handleTest}>
            Run Test
          </Button>,
        ]}
        width={560}
        destroyOnClose
      >
        <Space direction="vertical" style={{ width: '100%' }} size={12}>
          <div>
            <Text strong>Order ID</Text>
            <Input
              style={{ marginTop: 4 }}
              placeholder="Enter order ID to test against"
              value={testOrderId}
              onChange={(e) => setTestOrderId(e.target.value)}
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
              <Text type="secondary">Order context:</Text>
              <pre style={{ fontSize: 11, background: '#f5f5f5', padding: 8, borderRadius: 4, maxHeight: 200, overflow: 'auto' }}>
                {JSON.stringify(testResult.context, null, 2)}
              </pre>
            </div>
          )}
        </Space>
      </Modal>
    </>
  )
}
