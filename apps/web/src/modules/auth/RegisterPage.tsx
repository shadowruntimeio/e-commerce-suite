import { Form, Input, Button, message } from 'antd'
import { Link, useNavigate } from 'react-router-dom'
import { useMutation } from '@tanstack/react-query'
import {
  CheckCircleFilled,
  ShopOutlined,
  TeamOutlined,
  LockOutlined,
} from '@ant-design/icons'
import { api } from '../../lib/api'
import { useAuthStore } from '../../store/auth.store'

const features = [
  { icon: <ShopOutlined />,  text: 'Connect multiple stores in minutes' },
  { icon: <TeamOutlined />,  text: 'Invite team members with role-based access' },
  { icon: <LockOutlined />,  text: 'Enterprise-grade security and data privacy' },
]

const styles = {
  page: {
    minHeight: '100vh',
    display: 'flex',
  } as React.CSSProperties,
  left: {
    width: '55%',
    background: 'linear-gradient(135deg, #4F46E5 0%, #7C3AED 100%)',
    display: 'flex',
    flexDirection: 'column' as const,
    alignItems: 'center',
    justifyContent: 'center',
    padding: '60px 64px',
    position: 'relative' as const,
    overflow: 'hidden',
  },
  leftOverlay: {
    position: 'absolute' as const,
    inset: 0,
    background: 'radial-gradient(ellipse at 70% 80%, rgba(255,255,255,0.06) 0%, transparent 60%)',
    pointerEvents: 'none' as const,
  },
  leftContent: {
    position: 'relative' as const,
    zIndex: 1,
    maxWidth: 420,
    width: '100%',
  },
  brandMark: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: 56,
    height: 56,
    borderRadius: 16,
    background: 'rgba(255,255,255,0.15)',
    backdropFilter: 'blur(12px)',
    border: '1px solid rgba(255,255,255,0.2)',
    marginBottom: 28,
  },
  brandText: {
    fontSize: 22,
    fontWeight: 800,
    color: '#fff',
    letterSpacing: '-0.5px',
  },
  headline: {
    fontSize: 32,
    fontWeight: 700,
    color: '#fff',
    lineHeight: 1.25,
    letterSpacing: '-0.5px',
    marginBottom: 14,
    marginTop: 0,
  },
  tagline: {
    fontSize: 15,
    color: 'rgba(255,255,255,0.7)',
    lineHeight: 1.6,
    marginBottom: 40,
  },
  featureList: {
    display: 'flex',
    flexDirection: 'column' as const,
    gap: 14,
  },
  featureItem: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: 12,
    fontSize: 14,
    color: 'rgba(255,255,255,0.85)',
    lineHeight: 1.5,
  },
  featureIcon: {
    color: '#A5F3A1',
    fontSize: 16,
    marginTop: 1,
    flexShrink: 0,
  },
  right: {
    width: '45%',
    background: '#fff',
    display: 'flex',
    flexDirection: 'column' as const,
    alignItems: 'center',
    justifyContent: 'center',
    padding: '60px 56px',
  },
  rightContent: {
    maxWidth: 360,
    width: '100%',
  },
  rightHeading: {
    fontSize: 26,
    fontWeight: 700,
    color: '#0F172A',
    letterSpacing: '-0.4px',
    marginBottom: 6,
    marginTop: 0,
  },
  rightSub: {
    fontSize: 14,
    color: '#64748B',
    marginBottom: 28,
  },
  submitBtn: {
    height: 44,
    fontWeight: 600,
    fontSize: 14,
    background: '#6366F1',
    borderColor: '#6366F1',
    boxShadow: '0 4px 12px rgba(99,102,241,0.3)',
  },
  footerText: {
    textAlign: 'center' as const,
    fontSize: 13,
    color: '#94A3B8',
  },
  link: {
    color: '#6366F1',
    fontWeight: 500,
    textDecoration: 'none',
  },
  circle1: {
    position: 'absolute' as const,
    top: -80,
    right: -80,
    width: 320,
    height: 320,
    borderRadius: '50%',
    background: 'rgba(255,255,255,0.04)',
    border: '1px solid rgba(255,255,255,0.08)',
    pointerEvents: 'none' as const,
  },
  circle2: {
    position: 'absolute' as const,
    bottom: -60,
    left: -60,
    width: 240,
    height: 240,
    borderRadius: '50%',
    background: 'rgba(255,255,255,0.03)',
    border: '1px solid rgba(255,255,255,0.06)',
    pointerEvents: 'none' as const,
  },
}

export default function RegisterPage() {
  const navigate = useNavigate()
  const setAuth = useAuthStore((s) => s.setAuth)

  const mutation = useMutation({
    mutationFn: (values: any) => api.post('/auth/register', values),
    onSuccess: (res) => {
      const { user, accessToken, refreshToken } = res.data.data
      setAuth(user, accessToken, refreshToken)
      navigate('/dashboard')
    },
    onError: (err: any) => message.error(err.response?.data?.error ?? 'Registration failed'),
  })

  return (
    <div style={styles.page}>
      {/* Left: brand panel */}
      <div style={styles.left}>
        <div style={styles.leftOverlay} />
        <div style={styles.circle1} />
        <div style={styles.circle2} />

        <div style={styles.leftContent}>
          <div style={styles.brandMark}>
            <span style={styles.brandText}>E</span>
          </div>

          <h1 style={styles.headline}>
            Start managing<br />your stores<br />in minutes
          </h1>
          <p style={styles.tagline}>
            Join thousands of cross-border sellers using EMS to scale their business.
          </p>

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

      {/* Right: register form */}
      <div style={styles.right}>
        <div style={styles.rightContent}>
          <h2 style={styles.rightHeading}>Create your account</h2>
          <p style={styles.rightSub}>Get started — it's free for 14 days</p>

          <Form layout="vertical" onFinish={mutation.mutate} size="large">
            <Form.Item
              label={<span style={{ fontSize: 13, fontWeight: 500, color: '#374151' }}>Company Name</span>}
              name="tenantName"
              rules={[{ required: true, message: 'Please enter your company name' }]}
            >
              <Input placeholder="Acme Commerce Co." style={{ height: 42 }} />
            </Form.Item>

            <Form.Item
              label={<span style={{ fontSize: 13, fontWeight: 500, color: '#374151' }}>Your Name</span>}
              name="name"
              rules={[{ required: true, message: 'Please enter your name' }]}
            >
              <Input placeholder="John Doe" style={{ height: 42 }} />
            </Form.Item>

            <Form.Item
              label={<span style={{ fontSize: 13, fontWeight: 500, color: '#374151' }}>Work Email</span>}
              name="email"
              rules={[{ required: true, type: 'email', message: 'Please enter a valid email' }]}
            >
              <Input placeholder="you@company.com" style={{ height: 42 }} />
            </Form.Item>

            <Form.Item
              label={<span style={{ fontSize: 13, fontWeight: 500, color: '#374151' }}>Password</span>}
              name="password"
              rules={[{ required: true, min: 8, message: 'Minimum 8 characters' }]}
              style={{ marginBottom: 20 }}
            >
              <Input.Password placeholder="Min. 8 characters" style={{ height: 42 }} />
            </Form.Item>

            <Form.Item style={{ marginBottom: 16 }}>
              <Button
                type="primary"
                htmlType="submit"
                block
                loading={mutation.isPending}
                style={styles.submitBtn}
              >
                Create Account
              </Button>
            </Form.Item>

            <div style={styles.footerText}>
              Already have an account?{' '}
              <Link to="/auth/login" style={styles.link}>
                Sign in
              </Link>
            </div>
          </Form>
        </div>
      </div>
    </div>
  )
}
