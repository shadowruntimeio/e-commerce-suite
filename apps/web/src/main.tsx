import React from 'react'
import ReactDOM from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ConfigProvider, App as AntApp } from 'antd'
import { RouterProvider } from 'react-router-dom'
import { router } from './router'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60, // 1 min
      retry: 1,
    },
  },
})

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <ConfigProvider
        theme={{
          token: {
            colorPrimary: '#6366F1',
            colorSuccess: '#10B981',
            colorWarning: '#F59E0B',
            colorError: '#EF4444',
            borderRadius: 8,
            fontFamily: "'Inter', -apple-system, sans-serif",
            colorBgContainer: '#FFFFFF',
            colorBgLayout: '#F1F5F9',
            colorBorder: '#E2E8F0',
            colorTextBase: '#0F172A',
            colorTextSecondary: '#64748B',
            boxShadow: '0 1px 3px rgba(0,0,0,0.06)',
          },
          components: {
            Menu: {
              darkItemBg: '#0F172A',
              darkSubMenuItemBg: '#0F172A',
              darkItemSelectedBg: 'rgba(99,102,241,0.15)',
              darkItemSelectedColor: '#818CF8',
              darkItemColor: '#94A3B8',
              darkItemHoverColor: '#E2E8F0',
              darkItemHoverBg: 'rgba(255,255,255,0.05)',
            },
            Table: {
              headerBg: '#F8FAFC',
              rowHoverBg: '#F8FAFC',
              borderColor: '#E2E8F0',
            },
            Card: {
              borderRadiusLG: 12,
            },
          },
        }}
      >
        <AntApp>
          <RouterProvider router={router} />
        </AntApp>
      </ConfigProvider>
    </QueryClientProvider>
  </React.StrictMode>
)
