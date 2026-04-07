import React from 'react'
import ReactDOM from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ConfigProvider, App as AntApp, theme as antTheme } from 'antd'
import { RouterProvider } from 'react-router-dom'
import { router } from './router'
import { useSettingsStore } from './store/settings.store'
import './lib/i18n'

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

  const darkTokens = {
    algorithm: antTheme.darkAlgorithm,
    token: {
      colorPrimary: '#cc97ff',
      colorSuccess: '#10b981',
      colorWarning: '#f59e0b',
      colorError: '#ff6e84',
      borderRadius: 8,
      fontFamily: "'Inter', -apple-system, sans-serif",
      colorBgContainer: '#11192e',
      colorBgLayout: '#070d1f',
      colorBorder: 'rgba(223,228,254,0.12)',
      colorTextBase: '#dfe4fe',
      colorTextSecondary: '#a5aac2',
      boxShadow: '0 0 40px rgba(223,228,254,0.03)',
    },
    components: {
      Table: {
        headerBg: '#0c1326',
        rowHoverBg: 'rgba(28,37,62,0.6)',
        borderColor: 'rgba(223,228,254,0.08)',
      },
      Card: { borderRadiusLG: 16 },
      Modal: { contentBg: '#11192e', headerBg: '#11192e' },
      Drawer: { colorBgElevated: '#11192e' },
    },
  }

  const lightTokens = {
    algorithm: antTheme.defaultAlgorithm,
    token: {
      colorPrimary: '#3525cd',
      colorSuccess: '#059669',
      colorWarning: '#d97706',
      colorError: '#dc2626',
      borderRadius: 8,
      fontFamily: "'Inter', -apple-system, sans-serif",
      colorBgContainer: '#ffffff',
      colorBgLayout: '#f7f9fb',
      colorBorder: 'rgba(100,100,120,0.2)',
      colorTextBase: '#191c1e',
      colorTextSecondary: '#464555',
      boxShadow: '0 2px 12px rgba(25,28,30,0.06)',
    },
    components: {
      Table: {
        headerBg: '#f2f4f6',
        rowHoverBg: 'rgba(53,37,205,0.04)',
        borderColor: 'rgba(100,100,120,0.12)',
      },
      Card: { borderRadiusLG: 16 },
    },
  }

  return (
    <ConfigProvider theme={isDark ? darkTokens : lightTokens}>
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
