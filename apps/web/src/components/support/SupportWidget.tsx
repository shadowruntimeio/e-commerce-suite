import React from 'react'
import { Drawer, Tabs, Button, Input, Form, Select, message, Spin, Empty, Tooltip } from 'antd'
import { CommentOutlined, PlusOutlined, DeleteOutlined, PaperClipOutlined, CloseCircleFilled, PictureOutlined } from '@ant-design/icons'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { create } from 'zustand'
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
  attachmentMimeType: string | null
  attachmentSizeBytes: number | null
}
interface PendingTask { id: string; status: 'PENDING' | 'RUNNING'; createdAt: string }
interface AbuseSummary {
  offTopicCount: number
  threshold: number
  banTier: number
  bannedUntil: string | null
}

// 2MB / image (server-enforced too). 20 uploads / 24h rolling window per user.
const IMAGE_MAX_BYTES = 2 * 1024 * 1024
const IMAGE_ACCEPT = 'image/png,image/jpeg,image/webp,image/gif'

/**
 * In-memory blob URL map keyed by chat_messages.id. Populated only after a
 * successful upload so the user sees their image in the bubble during this
 * browser session. NOT persisted — on reload these URLs are gone and the
 * bubble falls back to a "🖼️ 图片不再可见" placeholder (per spec, images are
 * session-scoped only).
 */
interface AttachmentBlobsState {
  byMessageId: Map<string, string>
  add: (messageId: string, blobUrl: string) => void
  get: (messageId: string) => string | undefined
}
const useAttachmentBlobs = create<AttachmentBlobsState>((set, get) => ({
  byMessageId: new Map(),
  add: (messageId, blobUrl) => {
    const next = new Map(get().byMessageId)
    next.set(messageId, blobUrl)
    set({ byMessageId: next })
  },
  get: (messageId) => get().byMessageId.get(messageId),
}))

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
  const [pendingImage, setPendingImage] = React.useState<{ file: File; previewUrl: string } | null>(null)
  const fileInputRef = React.useRef<HTMLInputElement>(null)
  const addBlob = useAttachmentBlobs((s) => s.add)

  const sessionsQ = useQuery({
    queryKey: ['support', 'sessions'],
    queryFn: async () => (await api.get('/support/chat/sessions')).data.data as ChatSession[],
    enabled: open,
    refetchInterval: open ? 15_000 : false,
  })

  const quotaQ = useQuery({
    queryKey: ['support', 'imageQuota'],
    queryFn: async () =>
      (await api.get('/support/chat/quota/image')).data.data as { used: number; limit: number; maxBytes: number },
    enabled: open,
    refetchInterval: open ? 60_000 : false,
  })

  // Auto-select the most recent session when the panel opens.
  React.useEffect(() => {
    if (!activeSessionId && sessionsQ.data && sessionsQ.data.length > 0) {
      setActiveSessionId(sessionsQ.data[0].id)
    }
  }, [sessionsQ.data, activeSessionId])

  const abuseQ = useQuery({
    queryKey: ['support', 'abuseStatus'],
    queryFn: async () =>
      (await api.get('/support/chat/abuse-status')).data.data as AbuseSummary,
    enabled: open,
    refetchInterval: open ? 30_000 : false,
  })

  const detailQ = useQuery({
    queryKey: ['support', 'session', activeSessionId],
    queryFn: async () => {
      const r = await api.get(`/support/chat/sessions/${activeSessionId}`)
      return r.data.data as {
        session: ChatSession
        messages: ChatMessage[]
        pendingTask: PendingTask | null
        abuse: AbuseSummary
      }
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
      return r.data.data as { session: ChatSession; userMessageId: string | null; aiTaskId: string | null }
    },
    onSuccess: ({ session }) => {
      setActiveSessionId(session.id)
      queryClient.invalidateQueries({ queryKey: ['support', 'sessions'] })
      queryClient.invalidateQueries({ queryKey: ['support', 'session', session.id] })
    },
  })

  const send = useMutation({
    mutationFn: async ({ sessionId, content, image }: { sessionId: string; content: string; image: File | null }) => {
      if (image) {
        const fd = new FormData()
        fd.append('content', content)
        fd.append('image', image, image.name || 'image')
        const r = await api.post(`/support/chat/sessions/${sessionId}/messages`, fd, {
          headers: { 'Content-Type': 'multipart/form-data' },
        })
        return r.data.data as { userMessageId: string; aiTaskId: string }
      }
      return (await api.post(`/support/chat/sessions/${sessionId}/messages`, { content })).data.data as {
        userMessageId: string
        aiTaskId: string
      }
    },
    onSuccess: (data, vars) => {
      // Carry the local blob URL forward so the message bubble can render the
      // image we just sent. The server doesn't echo bytes back; this is
      // session-scoped only (cleared on reload — see spec).
      if (vars.image && pendingImage) {
        addBlob(data.userMessageId, pendingImage.previewUrl)
        setPendingImage(null)
      }
      queryClient.invalidateQueries({ queryKey: ['support', 'session', vars.sessionId] })
      queryClient.invalidateQueries({ queryKey: ['support', 'imageQuota'] })
      // Abuse counter may have moved if the worker decides this turn was
      // off-topic — invalidate so the warning bar / ban dialog refreshes
      // after the assistant reply lands.
      queryClient.invalidateQueries({ queryKey: ['support', 'abuseStatus'] })
    },
    onError: (err: unknown, vars) => {
      const resp = (err as { response?: { status?: number; data?: {
        error?: string
        data?: { used?: number; limit?: number; bannedUntil?: string; tier?: number }
      } } })?.response
      if (resp?.status === 403 && resp.data?.error === 'CHAT_BANNED') {
        // Server-enforced ban; refresh local view so the dialog renders.
        queryClient.invalidateQueries({ queryKey: ['support', 'abuseStatus'] })
        queryClient.invalidateQueries({ queryKey: ['support', 'session', vars.sessionId] })
        return
      }
      if (resp?.status === 429 && resp.data?.error === 'IMAGE_QUOTA_EXCEEDED') {
        message.warning(t('support.imageQuotaExceeded', { used: resp.data.data?.used, limit: resp.data.data?.limit }))
        queryClient.invalidateQueries({ queryKey: ['support', 'imageQuota'] })
        return
      }
      if (resp?.status === 413) {
        message.error(t('support.imageTooLarge'))
        return
      }
      if (resp?.status === 415) {
        message.error(t('support.imageUnsupportedType'))
        return
      }
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
    const image = pendingImage?.file ?? null

    if (activeSessionId) {
      send.mutate({ sessionId: activeSessionId, content, image })
    } else if (image) {
      // First send with an image needs two steps: create the session, then
      // post the multipart message — POST /sessions doesn't accept files.
      newSession.mutate(undefined, {
        onSuccess: ({ session }) => {
          send.mutate({ sessionId: session.id, content, image })
        },
      })
    } else {
      newSession.mutate(content)
    }
    setDraft('')
  }

  function handlePickImage(file: File | null) {
    if (!file) return
    if (!file.type || !IMAGE_ACCEPT.split(',').includes(file.type)) {
      message.error(t('support.imageUnsupportedType'))
      return
    }
    if (file.size > IMAGE_MAX_BYTES) {
      message.error(t('support.imageTooLarge'))
      return
    }
    // Revoke any previous preview URL before swapping to avoid leaking memory.
    if (pendingImage) URL.revokeObjectURL(pendingImage.previewUrl)
    setPendingImage({ file, previewUrl: URL.createObjectURL(file) })
  }

  function clearPendingImage() {
    if (pendingImage) URL.revokeObjectURL(pendingImage.previewUrl)
    setPendingImage(null)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  // Free the preview URL when ChatPanel unmounts.
  React.useEffect(() => () => {
    if (pendingImage) URL.revokeObjectURL(pendingImage.previewUrl)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const quotaUsed = quotaQ.data?.used ?? 0
  const quotaLimit = quotaQ.data?.limit ?? 20
  const quotaExhausted = quotaUsed >= quotaLimit

  // Prefer the per-session response's abuse summary (fresher — it refreshes
  // after each assistant reply); fall back to the standalone status query.
  const abuse: AbuseSummary | undefined = detailQ.data?.abuse ?? abuseQ.data
  const bannedUntilMs = abuse?.bannedUntil ? Date.parse(abuse.bannedUntil) : 0
  const isBanned = bannedUntilMs > Date.now()

  const messages = detailQ.data?.messages ?? []
  const pending = detailQ.data?.pendingTask
  // Composer is locked while: a response is mid-flight, OR the user is in a
  // ban window. The ban locks both text input and the upload button.
  const inputDisabled = send.isPending || newSession.isPending || !!pending || isBanned

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

      {/* Abuse warning + ban banner. Rendered ABOVE the composer so it's
         always visible while typing (or, when banned, while the input is
         disabled). */}
      {isBanned ? (
        <div style={{
          margin: '8px 0 0',
          padding: '10px 12px',
          borderRadius: 8,
          background: 'rgba(220,38,38,0.10)',
          border: '1px solid rgba(220,38,38,0.30)',
          color: '#b91c1c',
          fontSize: 12,
          lineHeight: 1.5,
        }}>
          <div style={{ fontWeight: 600, marginBottom: 2 }}>
            {t('support.abuse.bannedTitle')}
          </div>
          <div>
            {t('support.abuse.bannedBody', {
              until: dayjs(bannedUntilMs).format('YYYY-MM-DD HH:mm'),
              tier: abuse?.banTier ?? 1,
            })}
          </div>
        </div>
      ) : abuse && abuse.offTopicCount > 0 ? (
        <div style={{
          margin: '8px 0 0',
          padding: '8px 12px',
          borderRadius: 8,
          background: 'rgba(245,158,11,0.10)',
          border: '1px solid rgba(245,158,11,0.30)',
          color: '#b45309',
          fontSize: 12,
          lineHeight: 1.5,
        }}>
          {t('support.abuse.warning', {
            used: abuse.offTopicCount,
            limit: abuse.threshold,
            remaining: Math.max(0, abuse.threshold - abuse.offTopicCount),
          })}
        </div>
      ) : null}

      {/* Composer */}
      <div style={{ borderTop: '1px solid var(--border-light)', padding: '10px 0', flexShrink: 0 }}>
        {pendingImage && (
          <div style={{
            position: 'relative',
            display: 'inline-block',
            marginBottom: 8,
            borderRadius: 8,
            overflow: 'hidden',
            border: '1px solid var(--border-light)',
          }}>
            <img
              src={pendingImage.previewUrl}
              alt="preview"
              style={{ display: 'block', maxHeight: 80, maxWidth: 120 }}
            />
            <Tooltip title={t('support.imageRemove')}>
              <button
                onClick={clearPendingImage}
                aria-label={t('support.imageRemove') ?? 'remove'}
                style={{
                  position: 'absolute', top: 2, right: 2,
                  background: 'transparent', border: 'none', padding: 0, cursor: 'pointer',
                  color: '#fff', textShadow: '0 0 3px rgba(0,0,0,0.6)',
                }}
              >
                <CloseCircleFilled style={{ fontSize: 18 }} />
              </button>
            </Tooltip>
          </div>
        )}
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
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 8 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <input
              ref={fileInputRef}
              type="file"
              accept={IMAGE_ACCEPT}
              style={{ display: 'none' }}
              onChange={(e) => handlePickImage(e.target.files?.[0] ?? null)}
            />
            <Tooltip
              title={
                quotaExhausted
                  ? t('support.imageQuotaExhaustedTooltip', { limit: quotaLimit })
                  : pendingImage
                    ? t('support.imageReplace')
                    : t('support.imageAdd', { used: quotaUsed, limit: quotaLimit })
              }
            >
              <Button
                icon={<PaperClipOutlined />}
                disabled={quotaExhausted || inputDisabled}
                onClick={() => fileInputRef.current?.click()}
              />
            </Tooltip>
            <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
              {t('support.imageQuotaLabel', { used: quotaUsed, limit: quotaLimit })}
            </span>
          </div>
          <Button
            type="primary"
            loading={send.isPending || newSession.isPending}
            disabled={inputDisabled || !draft.trim()}
            onClick={handleSend}
          >
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
  const blobUrl = useAttachmentBlobs((s) => (m.attachmentMimeType ? s.byMessageId.get(m.id) : undefined))
  const hasAttachment = !!m.attachmentMimeType

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
        {/* Image attachment, if any. Browser-local blob URL only — after a
           page reload we just show a placeholder, matching the design
           decision to keep images session-scoped. */}
        {hasAttachment && (
          <div style={{ marginBottom: m.content ? 6 : 0 }}>
            {blobUrl ? (
              <img
                src={blobUrl}
                alt="attached"
                style={{ display: 'block', maxWidth: '100%', maxHeight: 220, borderRadius: 8 }}
              />
            ) : (
              <div style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                padding: '6px 10px',
                borderRadius: 8,
                background: isUser ? 'rgba(255,255,255,0.18)' : 'rgba(127,127,127,0.12)',
                fontSize: 12,
              }}>
                <PictureOutlined /> {t('support.imageNoLongerVisible')}
              </div>
            )}
          </div>
        )}

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
