import { Form, Input, Button, message } from 'antd'
import { Link, useNavigate } from 'react-router-dom'
import { useMutation } from '@tanstack/react-query'
import { api } from '../../lib/api'
import { useAuthStore } from '../../store/auth.store'

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
    <Form layout="vertical" onFinish={mutation.mutate} size="large">
      <Form.Item label="Company / Store Name" name="tenantName" rules={[{ required: true }]}>
        <Input placeholder="My Store" />
      </Form.Item>
      <Form.Item label="Your Name" name="name" rules={[{ required: true }]}>
        <Input placeholder="John Doe" />
      </Form.Item>
      <Form.Item label="Email" name="email" rules={[{ required: true, type: 'email' }]}>
        <Input placeholder="you@example.com" />
      </Form.Item>
      <Form.Item label="Password" name="password" rules={[{ required: true, min: 8 }]}>
        <Input.Password placeholder="Min. 8 characters" />
      </Form.Item>
      <Form.Item style={{ marginBottom: 8 }}>
        <Button type="primary" htmlType="submit" block loading={mutation.isPending}>Create Account</Button>
      </Form.Item>
      <div style={{ textAlign: 'center', fontSize: 13, color: '#666' }}>
        Already have an account? <Link to="/auth/login">Sign in</Link>
      </div>
    </Form>
  )
}
