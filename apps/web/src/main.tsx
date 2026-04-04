import React from 'react'
import ReactDOM from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ConfigProvider, App as AntApp, theme as antTheme } from 'antd'
import { RouterProvider } from 'react-router-dom'
import { router } from './router'
import './lib/i18n'
import { useSettingsStore } from './store/settings.store'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60,
      retry: 1,
    },
  },
})

function ThemedApp() {
  const isDark = useSettingsStore((s) => s.isDark)

  return (
    <ConfigProvider
      theme={{
        algorithm: isDark ? antTheme.darkAlgorithm : antTheme.defaultAlgorithm,
        token: {
          colorPrimary: '#6366F1',
          colorSuccess: '#10B981',
          colorWarning: '#F59E0B',
          colorError: '#EF4444',
          borderRadius: 8,
          fontFamily: "'Inter', -apple-system, sans-serif",
          colorBgContainer: isDark ? '#1E293B' : '#FFFFFF',
          colorBgLayout: isDark ? '#0B1120' : '#F1F5F9',
          colorBorder: isDark ? '#334155' : '#E2E8F0',
          colorTextBase: isDark ? '#F1F5F9' : '#0F172A',
          colorTextSecondary: isDark ? '#94A3B8' : '#64748B',
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
            headerBg: isDark ? '#162032' : '#F8FAFC',
            rowHoverBg: isDark ? '#243044' : '#F8FAFC',
            borderColor: isDark ? '#334155' : '#E2E8F0',
          },
          Card: {
            borderRadiusLG: 12,
          },
          Modal: {
            contentBg: isDark ? '#1E293B' : '#ffffff',
            headerBg: isDark ? '#1E293B' : '#ffffff',
          },
          Drawer: {
            colorBgElevated: isDark ? '#1E293B' : '#ffffff',
          },
        },
      }}
    >
      <AntApp>
        <RouterProvider router={router} />
      </AntApp>
    </ConfigProvider>
  )
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <ThemedApp />
    </QueryClientProvider>
  </React.StrictMode>
)
