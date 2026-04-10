import { Form, Input, Button, message } from 'antd'
import { Link, useNavigate } from 'react-router-dom'
import { useMutation } from '@tanstack/react-query'
import {
  CheckCircleFilled,
  ShopOutlined,
  TeamOutlined,
  LockOutlined,
} from '@ant-design/icons'
import { useTranslation } from 'react-i18next'
import { api } from '../../lib/api'
import { useAuthStore } from '../../store/auth.store'

const styles = {
  page: { minHeight: '100vh', display: 'flex' } as React.CSSProperties,
  left: { width: '55%', background: 'linear-gradient(135deg, #4F46E5 0%, #7C3AED 100%)', display: 'flex', flexDirection: 'column' as const, alignItems: 'center', justifyContent: 'center', padding: '60px 64px', position: 'relative' as const, overflow: 'hidden' },
  leftOverlay: { position: 'absolute' as const, inset: 0, background: 'radial-gradient(ellipse at 70% 80%, rgba(255,255,255,0.06) 0%, transparent 60%)', pointerEvents: 'none' as const },
  leftContent: { position: 'relative' as const, zIndex: 1, maxWidth: 420, width: '100%' },
  brandMark: { display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 56, height: 56, borderRadius: 16, background: 'rgba(255,255,255,0.15)', backdropFilter: 'blur(12px)', border: '1px solid rgba(255,255,255,0.2)', marginBottom: 28 },
  brandText: { fontSize: 22, fontWeight: 800, color: '#fff', letterSpacing: '-0.5px' },
  headline: { fontSize: 32, fontWeight: 700, color: '#fff', lineHeight: 1.25, letterSpacing: '-0.5px', marginBottom: 14, marginTop: 0 },
  tagline: { fontSize: 15, color: 'rgba(255,255,255,0.7)', lineHeight: 1.6, marginBottom: 40 },
  featureList: { display: 'flex', flexDirection: 'column' as const, gap: 14 },
  featureItem: { display: 'flex', alignItems: 'flex-start', gap: 12, fontSize: 14, color: 'rgba(255,255,255,0.85)', lineHeight: 1.5 },
  featureIcon: { color: '#A5F3A1', fontSize: 16, marginTop: 1, flexShrink: 0 },
  right: { width: '45%', background: 'var(--bg-card)', display: 'flex', flexDirection: 'column' as const, alignItems: 'center', justifyContent: 'center', padding: '60px 56px' },
  rightContent: { maxWidth: 360, width: '100%' },
  rightHeading: { fontSize: 26, fontWeight: 700, color: 'var(--text-primary)', letterSpacing: '-0.4px', marginBottom: 6, marginTop: 0 },
  rightSub: { fontSize: 14, color: 'var(--text-secondary)', marginBottom: 28 },
  submitBtn: { height: 44, fontWeight: 600, fontSize: 14, background: 'linear-gradient(135deg,#9c48ea,#cc97ff)', borderColor: 'transparent', boxShadow: '0 4px 20px rgba(204,151,255,0.35)' },
  footerText: { textAlign: 'center' as const, fontSize: 13, color: 'var(--text-muted)' },
  link: { color: '#cc97ff', fontWeight: 500, textDecoration: 'none' },
  circle1: { position: 'absolute' as const, top: -80, right: -80, width: 320, height: 320, borderRadius: '50%', background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', pointerEvents: 'none' as const },
  circle2: { position: 'absolute' as const, bottom: -60, left: -60, width: 240, height: 240, borderRadius: '50%', background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)', pointerEvents: 'none' as const },
}

export default function RegisterPage() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const setAuth = useAuthStore((s) => s.setAuth)

  const features = [
    { icon: <ShopOutlined />,  text: t('auth.feature1Register') },
    { icon: <TeamOutlined />,  text: t('auth.feature2Register') },
    { icon: <LockOutlined />,  text: t('auth.feature3Register') },
  ]

  const mutation = useMutation({
    mutationFn: (values: any) => api.post('/auth/register', values),
    onSuccess: (res) => {
      const { user, accessToken, refreshToken } = res.data.data
      setAuth(user, accessToken, refreshToken)
      navigate('/dashboard')
    },
    onError: (err: any) => message.error(err.response?.data?.error ?? t('auth.registerFailed')),
  })

  return (
    <div style={styles.page}>
      <div style={styles.left}>
        <div style={styles.leftOverlay} />
        <div style={styles.circle1} />
        <div style={styles.circle2} />
        <div style={styles.leftContent}>
          <div style={styles.brandMark}><span style={styles.brandText}>E</span></div>
          <h1 style={styles.headline}>{t('auth.heroRegister').split('\n').map((line, i) => <span key={i}>{line}<br /></span>)}</h1>
          <p style={styles.tagline}>{t('auth.heroRegisterSub')}</p>
          <div style={styles.featureList}>
            {features.map((f, i) => (
              <div key={i} style={styles.featureItem}>
                <CheckCircleFilled style={styles.featureIcon} />
                <span>{f.text}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div style={styles.right}>
        <div style={styles.rightContent}>
          <h2 style={styles.rightHeading}>{t('auth.createAccount')}</h2>
          <p style={styles.rightSub}>{t('auth.registerSubtitle')}</p>
          <Form layout="vertical" onFinish={mutation.mutate} size="large">
            <Form.Item
              label={<span style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-primary)' }}>{t('auth.companyName')}</span>}
              name="tenantName"
              rules={[{ required: true, message: t('auth.companyNameRequired') }]}
            >
              <Input placeholder={t('auth.companyNamePlaceholder')} style={{ height: 42 }} />
            </Form.Item>
            <Form.Item
              label={<span style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-primary)' }}>{t('auth.yourName')}</span>}
              name="name"
              rules={[{ required: true, message: t('auth.yourNameRequired') }]}
            >
              <Input placeholder={t('auth.yourNamePlaceholder')} style={{ height: 42 }} />
            </Form.Item>
            <Form.Item
              label={<span style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-primary)' }}>{t('auth.workEmail')}</span>}
              name="email"
              rules={[{ required: true, type: 'email', message: t('auth.emailRequired') }]}
            >
              <Input placeholder={t('auth.emailPlaceholder')} style={{ height: 42 }} />
            </Form.Item>
            <Form.Item
              label={<span style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-primary)' }}>{t('auth.password')}</span>}
              name="password"
              rules={[{ required: true, min: 8, message: t('auth.passwordMinLength') }]}
              style={{ marginBottom: 20 }}
            >
              <Input.Password placeholder={t('auth.passwordHint')} style={{ height: 42 }} />
            </Form.Item>
            <Form.Item style={{ marginBottom: 16 }}>
              <Button type="primary" htmlType="submit" block loading={mutation.isPending} style={styles.submitBtn}>
                {t('auth.createAccountBtn')}
              </Button>
            </Form.Item>
            <div style={styles.footerText}>
              {t('auth.hasAccount')}{' '}
              <Link to="/auth/login" style={styles.link}>{t('auth.signInLink')}</Link>
            </div>
          </Form>
        </div>
      </div>
    </div>
  )
}
