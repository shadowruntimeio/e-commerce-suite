import { Form, Input, Button, message } from 'antd'
import { Link, useNavigate } from 'react-router-dom'
import { useMutation } from '@tanstack/react-query'
import { api } from '../../lib/api'
import { useAuthStore } from '../../store/auth.store'

export default function LoginPage() {
  const navigate = useNavigate()
  const setAuth = useAuthStore((s) => s.setAuth)

  const mutation = useMutation({
    mutationFn: (values: { email: string; password: string }) => api.post('/auth/login', values),
    onSuccess: (res) => {
      const { user, accessToken, refreshToken } = res.data.data
      setAuth(user, accessToken, refreshToken)
      navigate('/dashboard')
    },
    onError: () => message.error('Invalid email or password'),
  })

  return (
    <Form layout="vertical" onFinish={mutation.mutate} size="large">
      <Form.Item label="Email" name="email" rules={[{ required: true, type: 'email' }]}>
        <Input placeholder="you@example.com" />
      </Form.Item>
      <Form.Item label="Password" name="password" rules={[{ required: true }]}>
        <Input.Password placeholder="Password" />
      </Form.Item>
      <Form.Item style={{ marginBottom: 8 }}>
        <Button type="primary" htmlType="submit" block loading={mutation.isPending}>Sign In</Button>
      </Form.Item>
      <div style={{ textAlign: 'center', fontSize: 13, color: '#666' }}>
        No account? <Link to="/auth/register">Register</Link>
      </div>
    </Form>
  )
}
