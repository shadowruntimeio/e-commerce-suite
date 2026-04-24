import { Modal, Input, InputNumber, Select, Radio, Space, message, Alert, Skeleton } from 'antd'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { api } from '../../lib/api'

type Mode = 'absolute' | 'delta'

type Props = {
  open: boolean
  warehouseSkuId: string | null
  onClose: () => void
}

const REASONS = ['STOCKTAKE_CORRECTION', 'DAMAGE', 'LOSS', 'EXPIRY', 'FOUND', 'SYSTEM_ERROR', 'OTHER'] as const

export function AdjustDialog({ open, warehouseSkuId, onClose }: Props) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const [mode, setMode] = useState<Mode>('absolute')
  const [value, setValue] = useState<number | null>(null)
  const [reason, setReason] = useState<string>('STOCKTAKE_CORRECTION')
  const [notes, setNotes] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [conflict, setConflict] = useState<number | null>(null)

  const { data: detail, isLoading, refetch } = useQuery({
    queryKey: ['inventory-stock-detail', warehouseSkuId],
    queryFn: () => api.get(`/inventory/stock/${warehouseSkuId}`).then((r) => r.data.data),
    enabled: open && !!warehouseSkuId,
    staleTime: 0,
  })

  useEffect(() => {
    if (open) {
      setMode('absolute')
      setValue(null)
      setReason('STOCKTAKE_CORRECTION')
      setNotes('')
      setConflict(null)
    }
  }, [open, warehouseSkuId])

  const currentQty = detail?.quantityOnHand ?? 0
  const previewDelta =
    value === null ? 0 : mode === 'absolute' ? value - currentQty : value
  const previewAfter = currentQty + previewDelta
  const notesRequired = reason === 'OTHER'
  const canSubmit =
    !!detail &&
    value !== null &&
    !(notesRequired && !notes.trim()) &&
    !submitting

  async function handleSubmit() {
    if (!detail || value === null) return
    setSubmitting(true)
    setConflict(null)
    try {
      await api.post('/inventory/adjust', {
        warehouseSkuId: detail.warehouseSkuId,
        expectedQuantity: detail.quantityOnHand,
        mode,
        value,
        reason,
        notes: notes.trim() || undefined,
      })
      void message.success(t('inventory.adjustSuccess'))
      queryClient.invalidateQueries({ queryKey: ['inventory-stock'] })
      queryClient.invalidateQueries({ queryKey: ['inventory-history'] })
      onClose()
    } catch (err: any) {
      if (err?.response?.status === 409) {
        const current = err.response.data?.data?.currentQuantity ?? null
        setConflict(current)
        void refetch()
      } else {
        void message.error(err?.response?.data?.error ?? t('inventory.adjustFailed'))
      }
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Modal
      open={open}
      title={t('inventory.adjustTitle')}
      onCancel={onClose}
      onOk={handleSubmit}
      okText={t('common.save')}
      okButtonProps={{ disabled: !canSubmit, loading: submitting }}
      width={520}
      destroyOnClose
    >
      {isLoading || !detail ? (
        <Skeleton active />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16, marginTop: 8 }}>
          <div style={{ background: 'var(--bg-surface)', borderRadius: 8, padding: 12 }}>
            <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
              {detail.warehouseName} · <span style={{ fontFamily: "'Courier New', monospace" }}>{detail.skuCode}</span>
            </div>
            <div style={{ fontSize: 14, color: 'var(--text-primary)', fontWeight: 500, marginTop: 2 }}>
              {detail.productName}
            </div>
            <div style={{ display: 'flex', gap: 16, marginTop: 8 }}>
              <StatCell label={t('inventory.onHand')} value={detail.quantityOnHand} />
              <StatCell label={t('inventory.reserved')} value={detail.quantityReserved} />
              <StatCell label={t('inventory.available')} value={detail.quantityAvailable} />
            </div>
          </div>

          {conflict !== null && (
            <Alert
              type="warning"
              showIcon
              message={t('inventory.conflictTitle')}
              description={t('inventory.conflictBody', { current: conflict })}
            />
          )}

          <div>
            <Label>{t('inventory.adjustMode')}</Label>
            <Radio.Group value={mode} onChange={(e) => { setMode(e.target.value); setValue(null) }}>
              <Radio value="absolute">{t('inventory.modeAbsolute')}</Radio>
              <Radio value="delta">{t('inventory.modeDelta')}</Radio>
            </Radio.Group>
          </div>

          <div>
            <Label>
              {mode === 'absolute' ? t('inventory.newQuantity') : t('inventory.quantityDelta')}
              <span style={{ color: '#EF4444' }}> *</span>
            </Label>
            <InputNumber
              value={value}
              onChange={(v) => setValue(typeof v === 'number' ? v : null)}
              style={{ width: '100%' }}
              min={mode === 'absolute' ? 0 : undefined}
              placeholder={mode === 'absolute' ? String(currentQty) : '-10 / +10'}
            />
            {value !== null && (
              <div style={{ marginTop: 6, fontSize: 12, color: 'var(--text-secondary)' }}>
                {t('inventory.previewDelta', { delta: previewDelta > 0 ? `+${previewDelta}` : String(previewDelta) })}
                {' → '}
                <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{previewAfter}</span>
              </div>
            )}
          </div>

          <div>
            <Label>{t('inventory.reason')}<span style={{ color: '#EF4444' }}> *</span></Label>
            <Select
              value={reason}
              onChange={setReason}
              style={{ width: '100%' }}
              options={REASONS.map((r) => ({ value: r, label: t(`inventory.reason_${r}`) }))}
            />
          </div>

          <div>
            <Label>
              {t('inventory.notesLabel')}
              {notesRequired && <span style={{ color: '#EF4444' }}> *</span>}
            </Label>
            <Input.TextArea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
              maxLength={500}
              placeholder={notesRequired ? t('inventory.notesRequiredHint') : t('inventory.notesOptionalHint')}
            />
          </div>
        </div>
      )}
    </Modal>
  )
}

function Label({ children }: { children: React.ReactNode }) {
  return <label style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-secondary)', display: 'block', marginBottom: 6 }}>{children}</label>
}

function StatCell({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{label}</div>
      <div style={{ fontSize: 16, fontWeight: 600, color: 'var(--text-primary)' }}>{value}</div>
    </div>
  )
}
