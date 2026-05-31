import React from 'react'
import { Drawer, Tabs, Button, Input, List, Form, Select, message, Spin, Empty, Tooltip } from 'antd'
import { CommentOutlined, PlusOutlined, DeleteOutlined } from '@ant-design/icons'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import dayjs from 'dayjs'
import { api } from '../../lib/api'
import { useConsoleErrors } from './console-errors'

/**
 * Floating support widget — a FAB pinned to the bottom-right that opens a
 * drawer with two tabs:
 *   1. 客服问答 — chat with the EMS-scoped AI (answered by the local
 *      agent-worker; we poll the session for new assistant messages).
 *   2. 反馈 bug — submit a structured bug report; auto-includes route +
 *      consoleErrors (ring buffer) + userAgent.
 *
 * Visible to everyone authenticated. Wrapped here as one component so we
 * only mount one floating button into AppLayout.
 */

interface ChatSession { id: string; title: string | null; createdAt: string; updatedAt: string }
interface ChatMessage {
  id: string
  role: 'USER' | 'ASSISTANT'
  content: string
  inScope: boolean | null
  suggestBug: boolean | null
  errorReason: string | null
  latencyMs: number | null
  aiTaskId: string | null
  createdAt: string
}
interface PendingTask { id: string; status: 'PENDING' | 'RUNNING'; createdAt: string }

export function SupportWidget() {
  const { t } = useTranslation()
  const [open, setOpen] = React.useState(false)
  const [tab, setTab] = React.useState<'chat' | 'bug'>('chat')

  return (
    <>
      <Tooltip title={t('support.fabTooltip')}>
        <button
          aria-label={t('support.fabTooltip') ?? 'support'}
          onClick={() => setOpen(true)}
          style={{
            position: 'fixed',
            right: 24,
            bottom: 24,
            width: 52,
            height: 52,
            borderRadius: 26,
            border: 'none',
            cursor: 'pointer',
            background: 'var(--color-primary, #3525cd)',
            color: '#fff',
            boxShadow: '0 4px 20px rgba(53,37,205,0.35)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1100,
          }}
        >
          <CommentOutlined style={{ fontSize: 22 }} />
        </button>
      </Tooltip>

      <Drawer
        title={t('support.drawerTitle')}
        placement="right"
        width={460}
        open={open}
        onClose={() => setOpen(false)}
        styles={{ body: { padding: 0, display: 'flex', flexDirection: 'column' } }}
      >
        <Tabs
          activeKey={tab}
          onChange={(k) => setTab(k as typeof tab)}
          items={[
            { key: 'chat', label: t('support.tabs.chat'), children: <ChatPanel open={open && tab === 'chat'} switchToBug={() => setTab('bug')} /> },
            { key: 'bug',  label: t('support.tabs.bug'),  children: <BugPanel onSubmitted={() => setOpen(false)} /> },
          ]}
          style={{ flex: 1, padding: '0 16px', display: 'flex', flexDirection: 'column' }}
        />
        <div style={{ padding: '6px 16px 10px', borderTop: '1px solid var(--border-light)', fontSize: 11, color: 'var(--text-muted)', textAlign: 'center' }}>
          {t('support.scopeHint')}
        </div>
      </Drawer>
    </>
  )
}

// ─── Chat ───────────────────────────────────────────────────────────────────

function ChatPanel({ open, switchToBug }: { open: boolean; switchToBug: () => void }) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const [activeSessionId, setActiveSessionId] = React.useState<string | null>(null)
  const [draft, setDraft] = React.useState('')

  const sessionsQ = useQuery({
    queryKey: ['support', 'sessions'],
    queryFn: async () => (await api.get('/support/chat/sessions')).data.data as ChatSession[],
    enabled: open,
    refetchInterval: open ? 15_000 : false,
  })

  // Auto-select the most recent session when the panel opens.
  React.useEffect(() => {
    if (!activeSessionId && sessionsQ.data && sessionsQ.data.length > 0) {
      setActiveSessionId(sessionsQ.data[0].id)
    }
  }, [sessionsQ.data, activeSessionId])

  const detailQ = useQuery({
    queryKey: ['support', 'session', activeSessionId],
    queryFn: async () => {
      const r = await api.get(`/support/chat/sessions/${activeSessionId}`)
      return r.data.data as { session: ChatSession; messages: ChatMessage[]; pendingTask: PendingTask | null }
    },
    enabled: open && !!activeSessionId,
    // Poll fast while an AI answer is pending; slow otherwise. The query
    // observer re-evaluates this between fetches.
    refetchInterval: (q) => {
      const data = q.state.data as { pendingTask: PendingTask | null } | undefined
      if (!open) return false
      return data?.pendingTask ? 1500 : 8000
    },
  })

  const newSession = useMutation({
    mutationFn: async (initial?: string) => {
      const r = await api.post('/support/chat/sessions', initial ? { initialMessage: initial } : {})
      return r.data.data as { session: ChatSession; userMessageId: string | null }
    },
    onSuccess: ({ session }) => {
      setActiveSessionId(session.id)
      queryClient.invalidateQueries({ queryKey: ['support', 'sessions'] })
      queryClient.invalidateQueries({ queryKey: ['support', 'session', session.id] })
    },
  })

  const send = useMutation({
    mutationFn: async ({ sessionId, content }: { sessionId: string; content: string }) => {
      return (await api.post(`/support/chat/sessions/${sessionId}/messages`, { content })).data.data
    },
    onSuccess: (_, vars) => {
      queryClient.invalidateQueries({ queryKey: ['support', 'session', vars.sessionId] })
    },
    onError: () => {
      message.error(t('support.sendFailed'))
    },
  })

  const del = useMutation({
    mutationFn: async (id: string) => api.delete(`/support/chat/sessions/${id}`),
    onSuccess: (_, id) => {
      if (activeSessionId === id) setActiveSessionId(null)
      queryClient.invalidateQueries({ queryKey: ['support', 'sessions'] })
    },
  })

  const messagesEndRef = React.useRef<HTMLDivElement>(null)
  React.useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [detailQ.data?.messages.length, detailQ.data?.pendingTask?.id])

  function handleSend() {
    const content = draft.trim()
    if (!content) return
    if (activeSessionId) {
      send.mutate({ sessionId: activeSessionId, content })
    } else {
      newSession.mutate(content)
    }
    setDraft('')
  }

  const messages = detailQ.data?.messages ?? []
  const pending = detailQ.data?.pendingTask
  const inputDisabled = send.isPending || newSession.isPending || !!pending

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: 'calc(100vh - 200px)' }}>
      {/* Session strip */}
      <div style={{ display: 'flex', gap: 8, padding: '8px 0', overflowX: 'auto', flexShrink: 0 }}>
        <Button size="small" icon={<PlusOutlined />} onClick={() => { setActiveSessionId(null); setDraft('') }}>
          {t('support.newSession')}
        </Button>
        {(sessionsQ.data ?? []).map((s) => (
          <div
            key={s.id}
            onClick={() => setActiveSessionId(s.id)}
            style={{
              flexShrink: 0,
              padding: '4px 10px',
              borderRadius: 14,
              border: '1px solid var(--border-light)',
              background: s.id === activeSessionId ? 'var(--color-primary-bg, rgba(53,37,205,0.08))' : 'transparent',
              fontSize: 12,
              cursor: 'pointer',
              maxWidth: 180,
              display: 'flex',
              alignItems: 'center',
              gap: 6,
            }}
          >
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {s.title ?? t('support.untitledSession')}
            </span>
            <DeleteOutlined
              onClick={(e) => { e.stopPropagation(); del.mutate(s.id) }}
              style={{ fontSize: 11, color: 'var(--text-muted)', cursor: 'pointer' }}
            />
          </div>
        ))}
      </div>

      {/* Message list */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '8px 0' }}>
        {!activeSessionId && messages.length === 0 && (
          <Empty
            description={t('support.emptyHint')}
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            style={{ marginTop: 40 }}
          />
        )}
        {messages.map((m) => (
          <MessageBubble key={m.id} m={m} onSwitchToBug={switchToBug} />
        ))}
        {pending && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', color: 'var(--text-muted)', fontSize: 12 }}>
            <Spin size="small" /> {t('support.thinking')}
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Composer */}
      <div style={{ borderTop: '1px solid var(--border-light)', padding: '10px 0', flexShrink: 0 }}>
        <Input.TextArea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onPressEnter={(e) => {
            if (!e.shiftKey) {
              e.preventDefault()
              if (!inputDisabled) handleSend()
            }
          }}
          placeholder={t('support.composerPlaceholder')}
          autoSize={{ minRows: 2, maxRows: 5 }}
          disabled={inputDisabled}
        />
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 8 }}>
          <Button type="primary" loading={send.isPending || newSession.isPending} disabled={inputDisabled || !draft.trim()} onClick={handleSend}>
            {t('support.send')}
          </Button>
        </div>
      </div>
    </div>
  )
}

function MessageBubble({ m, onSwitchToBug }: { m: ChatMessage; onSwitchToBug: () => void }) {
  const { t } = useTranslation()
  const isUser = m.role === 'USER'

  return (
    <div style={{ display: 'flex', justifyContent: isUser ? 'flex-end' : 'flex-start', padding: '4px 0' }}>
      <div
        style={{
          maxWidth: '85%',
          background: isUser ? 'var(--color-primary, #3525cd)' : 'var(--bg-card)',
          color: isUser ? '#fff' : 'var(--text-primary)',
          padding: '8px 12px',
          borderRadius: 12,
          border: isUser ? 'none' : '1px solid var(--border-light)',
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
          fontSize: 13,
          lineHeight: 1.5,
        }}
      >
        {m.errorReason ? (
          <span style={{ color: '#dc2626' }}>{m.content}</span>
        ) : (
          <span dangerouslySetInnerHTML={{ __html: renderInlineMd(m.content) }} />
        )}
        {!isUser && m.suggestBug && (
          <div style={{ marginTop: 8 }}>
            <Button size="small" onClick={onSwitchToBug} type="dashed">
              {t('support.gotoBugTab')}
            </Button>
          </div>
        )}
        <div style={{ marginTop: 4, fontSize: 10, opacity: 0.6 }}>
          {dayjs(m.createdAt).format('HH:mm')}
        </div>
      </div>
    </div>
  )
}

// Tiny inline-Markdown for **bold** and `code`. Anything else stays as plain
// text. We deliberately avoid pulling in react-markdown to keep the bundle
// small — assistant answers are usually short prose / numbered lists.
function renderInlineMd(src: string): string {
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  return esc(src)
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/`([^`]+)`/g, '<code style="padding:1px 4px;border-radius:4px;background:rgba(127,127,127,0.18);">$1</code>')
}

// ─── Bug report ─────────────────────────────────────────────────────────────

function BugPanel({ onSubmitted }: { onSubmitted: () => void }) {
  const { t } = useTranslation()
  const [form] = Form.useForm()

  const submit = useMutation({
    mutationFn: async (values: { summary: string; description?: string; severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL' }) => {
      const consoleErrors = useConsoleErrors.getState().snapshot()
      return (await api.post('/support/bugs', {
        ...values,
        route: window.location.href,
        consoleErrors,
        userAgent: navigator.userAgent,
        emsCommitSha: import.meta.env.VITE_COMMIT_SHA ?? undefined,
      })).data.data
    },
    onSuccess: () => {
      message.success(t('support.bugSubmitted'))
      form.resetFields()
      onSubmitted()
    },
    onError: () => message.error(t('support.bugSubmitFailed')),
  })

  const errorCount = useConsoleErrors((s) => s.errors.length)

  return (
    <div style={{ padding: '12px 0' }}>
      <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 12 }}>
        {t('support.bugIntro')}
      </div>
      <Form form={form} layout="vertical" onFinish={(v) => submit.mutate(v)} initialValues={{ severity: 'MEDIUM' }}>
        <Form.Item name="summary" label={t('support.bug.summary')} rules={[{ required: true, max: 200 }]}>
          <Input placeholder={t('support.bug.summaryPlaceholder')} />
        </Form.Item>
        <Form.Item name="severity" label={t('support.bug.severity')}>
          <Select
            options={[
              { value: 'LOW', label: t('support.severity.LOW') },
              { value: 'MEDIUM', label: t('support.severity.MEDIUM') },
              { value: 'HIGH', label: t('support.severity.HIGH') },
              { value: 'CRITICAL', label: t('support.severity.CRITICAL') },
            ]}
          />
        </Form.Item>
        <Form.Item name="description" label={t('support.bug.description')}>
          <Input.TextArea rows={5} placeholder={t('support.bug.descriptionPlaceholder')} maxLength={4000} showCount />
        </Form.Item>

        <div style={{
          background: 'var(--bg-page, rgba(127,127,127,0.06))',
          padding: 10,
          borderRadius: 8,
          fontSize: 11,
          color: 'var(--text-muted)',
          marginBottom: 12,
        }}>
          <div>{t('support.bug.autoAttached')}</div>
          <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>
            <li>{t('support.bug.autoRoute')}: <code>{window.location.pathname}</code></li>
            <li>{t('support.bug.autoConsole', { count: errorCount })}</li>
            <li>{t('support.bug.autoUA')}</li>
          </ul>
        </div>

        <Button type="primary" htmlType="submit" block loading={submit.isPending}>
          {t('support.bug.submit')}
        </Button>
      </Form>
    </div>
  )
}
