import { lazy, type ComponentType } from 'react'

const RELOAD_FLAG = 'ems:chunk-reload'

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

export function lazyWithRetry<T extends ComponentType<unknown>>(
  factory: () => Promise<{ default: T }>,
): ReturnType<typeof lazy<T>> {
  return lazy(async () => {
    try {
      const mod = await factory()
      sessionStorage.removeItem(RELOAD_FLAG)
      return mod
    } catch (err) {
      if (isChunkLoadError(err) && !sessionStorage.getItem(RELOAD_FLAG)) {
        sessionStorage.setItem(RELOAD_FLAG, '1')
        window.location.reload()
        return new Promise<never>(() => {})
      }
      throw err
    }
  })
}
