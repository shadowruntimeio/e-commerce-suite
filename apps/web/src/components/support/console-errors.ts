import { create } from 'zustand'

/**
 * Ring-buffer for browser errors. Attached at app boot in main.tsx via
 * `installConsoleErrorCapture`. When the user submits a bug we snapshot the
 * current ring and ship it along — it's the single most useful piece of
 * context for triage.
 *
 * Keep entries small: long messages get truncated, stacks are trimmed to the
 * first few frames. The ring caps at 100 to bound memory.
 */
const RING_CAPACITY = 100
const MAX_MESSAGE_LEN = 800
const MAX_STACK_LINES = 8

export interface CapturedError {
  ts: string
  kind: 'error' | 'unhandledrejection' | 'console.error'
  message: string
  stack?: string
  source?: string
  line?: number
}

interface ConsoleErrorState {
  errors: CapturedError[]
  push: (e: CapturedError) => void
  snapshot: () => CapturedError[]
  clear: () => void
}

export const useConsoleErrors = create<ConsoleErrorState>((set, get) => ({
  errors: [],
  push: (e) => {
    const trimmed: CapturedError = {
      ...e,
      message: e.message.slice(0, MAX_MESSAGE_LEN),
      stack: e.stack ? e.stack.split('\n').slice(0, MAX_STACK_LINES).join('\n') : undefined,
    }
    const next = [...get().errors, trimmed]
    if (next.length > RING_CAPACITY) next.splice(0, next.length - RING_CAPACITY)
    set({ errors: next })
  },
  snapshot: () => [...get().errors],
  clear: () => set({ errors: [] }),
}))

let installed = false

export function installConsoleErrorCapture() {
  if (installed) return
  installed = true

  window.addEventListener('error', (ev) => {
    useConsoleErrors.getState().push({
      ts: new Date().toISOString(),
      kind: 'error',
      message: ev.message,
      stack: (ev.error as Error | undefined)?.stack,
      source: ev.filename,
      line: ev.lineno,
    })
  })

  window.addEventListener('unhandledrejection', (ev) => {
    const reason = ev.reason
    const message =
      reason instanceof Error
        ? reason.message
        : typeof reason === 'string'
          ? reason
          : (() => {
              try { return JSON.stringify(reason) } catch { return String(reason) }
            })()
    useConsoleErrors.getState().push({
      ts: new Date().toISOString(),
      kind: 'unhandledrejection',
      message,
      stack: reason instanceof Error ? reason.stack : undefined,
    })
  })

  // Tap console.error so React's "Each child should have a unique key" type
  // warnings and explicit error logs make it into the snapshot too. We don't
  // replace console.error — we just listen.
  const orig = console.error
  console.error = (...args: unknown[]) => {
    try {
      const message = args
        .map((a) => (a instanceof Error ? a.message : typeof a === 'string' ? a : (() => {
          try { return JSON.stringify(a) } catch { return String(a) }
        })()))
        .join(' ')
      useConsoleErrors.getState().push({
        ts: new Date().toISOString(),
        kind: 'console.error',
        message,
        stack: args.find((a): a is Error => a instanceof Error)?.stack,
      })
    } catch {
      // never let our tap break the real error path
    }
    return orig.apply(console, args as [])
  }
}
