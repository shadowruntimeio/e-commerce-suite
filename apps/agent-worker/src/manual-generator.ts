import fs from 'node:fs'
import path from 'node:path'

/**
 * Builds a compact EMS feature-navigation manual by scanning the web app:
 *
 *  - `apps/web/src/components/layout/AppLayout.tsx` → main nav tree
 *  - `apps/web/src/router.tsx`                      → all known routes
 *  - `apps/web/src/locales/zh.ts`                   → Chinese labels
 *
 * Output is a small markdown block (≲ 2 KB) embedded in the system prompt.
 * The agent prefers it for "在哪里 / 怎么进入 / 怎么用 X" questions — answers
 * in ~5 s without burning subscription quota on source-code Reads.
 *
 * Regenerates on every worker boot, so it tracks the deployed code without
 * a separate build step. If parsing fails for any reason we return an empty
 * string and the agent falls back to its usual investigate-then-answer
 * path (slower, but still correct).
 */

const WORKER_DIR = path.resolve(__dirname, '..')
const REPO_ROOT = path.resolve(WORKER_DIR, '..', '..')
const WEB_SRC = path.resolve(REPO_ROOT, 'apps/web/src')

interface NavItem { path: string; labelKey: string }

// Pull labels out of zh.ts without importing it (the worker's CJS runtime
// would need an extra loader hop for arbitrary .ts files, and this file is
// a stable object literal we control).
function parseLocaleLabels(zhSrc: string): Record<string, string> {
  const out: Record<string, string> = {}
  // Match `someKey: '中文文本'` or "...". Permissive on what comes after —
  // nested objects are handled by joining the path keys when we look up.
  const stack: string[] = []
  const lines = zhSrc.split('\n')
  for (const raw of lines) {
    const line = raw.trim()
    // Opening a nested object: `key: {`
    const open = line.match(/^([A-Za-z0-9_]+):\s*\{$/)
    if (open) { stack.push(open[1]); continue }
    if (line === '},' || line === '}') { stack.pop(); continue }
    // Leaf: `key: '...'` or `key: "..."`
    const leaf = line.match(/^([A-Za-z0-9_]+):\s*['"]([^'"]*)['"][,]?$/)
    if (leaf) {
      const full = [...stack, leaf[1]].join('.')
      out[full] = leaf[2]
    }
  }
  return out
}

function extractNav(layoutSrc: string): NavItem[] {
  const out: NavItem[] = []
  // `{ key: '/xxx', ..., labelKey: 'nav.yyy', ... }`. The two fields can appear
  // in any order so allow up to ~200 chars between them.
  const re = /\{\s*key:\s*'(\/[^']+)'[^}]{0,300}labelKey:\s*'([^']+)'[^}]*\}/g
  let m: RegExpExecArray | null
  while ((m = re.exec(layoutSrc))) {
    out.push({ path: m[1], labelKey: m[2] })
  }
  return out
}

function extractRoutes(routerSrc: string): Array<{ path: string; component: string }> {
  const out: Array<{ path: string; component: string }> = []
  // `path: 'xxx', element: <Suspense fallback={<Loading />}><FooPage />...`
  // The Suspense fallback contains `}` chars so [^}]* doesn't work — use
  // non-greedy [\s\S]*? to skip across newlines and stop at the first
  // `<XxxPage>` after the path. Auth pages don't end in Page so we miss
  // them on purpose (they're never reached by an authed user anyway).
  const re = /path:\s*'([^']+)'[\s\S]*?<(\w+Page)\b/g
  let m: RegExpExecArray | null
  while ((m = re.exec(routerSrc))) {
    const p = m[1].startsWith('/') ? m[1] : '/' + m[1]
    out.push({ path: p, component: m[2] })
  }
  return out
}

export function generateFeatureManual(): string {
  try {
    const layoutSrc = fs.readFileSync(path.join(WEB_SRC, 'components/layout/AppLayout.tsx'), 'utf8')
    const routerSrc = fs.readFileSync(path.join(WEB_SRC, 'router.tsx'), 'utf8')
    const zhSrc = fs.readFileSync(path.join(WEB_SRC, 'locales/zh.ts'), 'utf8')

    const labels = parseLocaleLabels(zhSrc)
    const nav = extractNav(layoutSrc)
    const routes = extractRoutes(routerSrc)

    const lookup = (k: string): string => labels[k] ?? k

    const navPaths = new Set(nav.map((i) => i.path))
    const lines: string[] = []

    lines.push('## 主导航（用户可见）')
    for (const item of nav) {
      lines.push(`- 「${lookup(item.labelKey)}」 → ${item.path}`)
    }

    // Sub-routes not in main nav — entry usually via a button on the
    // parent page (e.g. /orders/rules from within Orders). Component
    // name is the only signal we have; it disambiguates RestockingPage
    // vs RulesPage when /xxx looks ambiguous. Auth pages are skipped:
    // the regex doesn't see the nested /auth parent so we filter by
    // known component names instead.
    const AUTH_PAGES = new Set(['LoginPage', 'RegisterPage'])
    const subPages = routes.filter(
      (r) => !navPaths.has(r.path)
        && !AUTH_PAGES.has(r.component)
        && r.path !== '/',
    )
    if (subPages.length > 0) {
      lines.push('')
      lines.push('## 子页面 / 子标签（一般从父页面入口进入）')
      for (const r of subPages) {
        // Strip the trailing "Page" so the hint reads naturally
        const hint = r.component.replace(/Page$/, '')
        lines.push(`- ${r.path}   (${hint})`)
      }
    }

    // Useful page-title labels — sometimes the URL says /shops but the
    // page header says 「店铺管理」, and the page-title labels surface that.
    const pageTitleEntries = Object.entries(labels).filter(([k]) => k.startsWith('pageTitles.'))
    if (pageTitleEntries.length > 0) {
      lines.push('')
      lines.push('## 页面标题（页内顶部显示）')
      for (const [k, v] of pageTitleEntries) {
        lines.push(`- ${k.slice('pageTitles.'.length)} → ${v}`)
      }
    }

    return lines.join('\n')
  } catch (err) {
    // Don't take down the worker over a parsing miss; just disable the
    // fast path until someone fixes the generator.
    console.warn(`[agent-worker] feature manual generation failed: ${(err as Error).message}`)
    return ''
  }
}
