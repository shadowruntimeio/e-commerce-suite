import { Outlet } from 'react-router-dom'
import { Card } from 'antd'

export function AuthLayout() {
  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f0f2f5' }}>
      <Card style={{ width: 420, boxShadow: '0 4px 24px rgba(0,0,0,0.08)' }}>
        <div style={{ textAlign: 'center', marginBottom: 32 }}>
          <h1 style={{ margin: 0, fontSize: 24, fontWeight: 700, color: '#1677ff' }}>EMS</h1>
          <p style={{ margin: '4px 0 0', color: '#666', fontSize: 13 }}>E-commerce Management System</p>
        </div>
        <Outlet />
      </Card>
    </div>
  )
}
