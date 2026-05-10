import { useRouteError } from 'react-router-dom'
import { Button, Result } from 'antd'
import { useTranslation } from 'react-i18next'

function isChunkLoadError(err: unknown): boolean {
  if (!err) return false
  const msg = err instanceof Error ? err.message : String(err)
  return (
    /Failed to fetch dynamically imported module/i.test(msg) ||
    /Importing a module script failed/i.test(msg) ||
    /ChunkLoadError/i.test(msg) ||
    /Loading chunk \d+ failed/i.test(msg) ||
    /error loading dynamically imported module/i.test(msg)
  )
}

export function RouteErrorBoundary() {
  const error = useRouteError()
  const { t, i18n } = useTranslation()
  const isZh = i18n.language?.startsWith('zh')

  if (isChunkLoadError(error)) {
    return (
      <Result
        status="info"
        title={isZh ? '应用已更新' : 'App updated'}
        subTitle={
          isZh
            ? '检测到新版本,点击下方按钮刷新即可继续使用。'
            : 'A new version is available. Refresh the page to continue.'
        }
        extra={
          <Button type="primary" onClick={() => window.location.reload()}>
            {isZh ? '刷新页面' : 'Refresh'}
          </Button>
        }
      />
    )
  }

  const message = error instanceof Error ? error.message : String(error ?? '')

  return (
    <Result
      status="error"
      title={isZh ? '出错了' : 'Something went wrong'}
      subTitle={message || (isZh ? '页面加载失败' : 'Failed to load this page')}
      extra={[
        <Button key="reload" type="primary" onClick={() => window.location.reload()}>
          {isZh ? '刷新页面' : 'Reload'}
        </Button>,
        <Button key="home" onClick={() => { window.location.href = '/' }}>
          {isZh ? '返回首页' : 'Go home'}
        </Button>,
      ]}
    />
  )
}
