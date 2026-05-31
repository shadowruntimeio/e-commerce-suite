import { spawn } from 'node:child_process'
import path from 'node:path'
import fs from 'node:fs'
import crypto from 'node:crypto'

const CLAUDE_BIN = process.env.CLAUDE_BIN ?? 'claude'
const MODEL = process.env.AGENT_MODEL ?? 'sonnet'
// Tier-2 (image / investigation) is multi-turn and can run much longer than
// a single Q&A turn. Default to 4 min per task; the worker's claim hold is
// untouched (next claim only happens after this returns).
const TIMEOUT_MS = Number(process.env.AGENT_TIMEOUT_MS ?? 90_000)
const INVESTIGATOR_TIMEOUT_MS = Number(process.env.AGENT_INVESTIGATOR_TIMEOUT_MS ?? 240_000)
const SANDBOX_ROOT = process.env.AGENT_SANDBOX_DIR ?? path.join(process.cwd(), '.agent-sandbox')

// Repo root is two levels up from this workspace (apps/agent-worker/src → repo root).
const WORKER_ROOT = path.resolve(__dirname, '..')
const REPO_ROOT = path.resolve(WORKER_ROOT, '..', '..')

// Read-only mirror dir for source-code access. Created on demand; contains
// only symlinks to whitelisted source subtrees — never .env, dist, secrets,
// or node_modules. The mirror is what we pass to `--add-dir` in Tier-2 so
// the agent's Read tool can only see what's here.
const READONLY_MIRROR_DIR = path.join(WORKER_ROOT, '.agent-readonly')

// RPC scripts the Tier-2 agent is allowed to invoke via Bash. Path-locked
// via --allowedTools so no other Bash command can run.
export const RPC_DIR = path.join(WORKER_ROOT, 'src', 'rpc')

// Sandbox root: ensures no project CLAUDE.md / settings leak into the prompt.
// For text-only tasks we reuse it as cwd. For tasks with image attachments
// we create a fresh per-task subdir so enabling `--tools "Read"` can only see
// the one image file we just wrote — even if the model went off-piste, there
// is nothing else in that dir.
function ensureSandboxRoot(): string {
  if (!fs.existsSync(SANDBOX_ROOT)) fs.mkdirSync(SANDBOX_ROOT, { recursive: true })
  return SANDBOX_ROOT
}

function mimeToExt(mime: string): string {
  switch (mime) {
    case 'image/png':  return 'png'
    case 'image/jpeg': return 'jpg'
    case 'image/webp': return 'webp'
    case 'image/gif':  return 'gif'
    default:           return 'bin'
  }
}

export interface ImageAttachment {
  mimeType: string
  base64: string
}

export interface PreparedImage {
  /** Disposable per-task dir we wrote the image into; caller MUST `rm -rf` it. */
  taskDir: string
  /** Absolute path to the image file. */
  filePath: string
}

/**
 * Decode the image base64 from AiTask.payload.image into a fresh per-task
 * sandbox subdir. Returns the path so the caller can mention it in the
 * prompt and clean up after the run.
 */
export function prepareImageFile(image: ImageAttachment, taskId: string): PreparedImage {
  ensureSandboxRoot()
  // Random suffix on taskId so concurrent runs of the SAME task (retries)
  // don't collide on the dir.
  const taskDir = path.join(SANDBOX_ROOT, `task-${taskId}-${crypto.randomBytes(3).toString('hex')}`)
  fs.mkdirSync(taskDir, { recursive: true })
  const filePath = path.join(taskDir, `image.${mimeToExt(image.mimeType)}`)
  fs.writeFileSync(filePath, Buffer.from(image.base64, 'base64'), { mode: 0o600 })
  return { taskDir, filePath }
}

export function cleanupTaskDir(taskDir: string) {
  try { fs.rmSync(taskDir, { recursive: true, force: true }) } catch { /* best effort */ }
}

// ─── Read-only source mirror ─────────────────────────────────────────────────
//
// In Tier-2 we let the agent Read / Glob / Grep source files so it can verify
// validation rules and field semantics before answering. To bound that
// access surface — and especially to keep .env / credentials / build output
// out of reach — we maintain a separate directory containing only symlinks
// to whitelisted source subtrees. The mirror is what gets passed to
// `--add-dir`; cwd for the spawn is the mirror root.
const MIRROR_TARGETS: Array<{ src: string; dst: string }> = [
  // Server source — most "why does X fail" questions live here.
  { src: 'apps/api/src',                        dst: 'apps/api/src' },
  // Web source — for UI-flow questions.
  { src: 'apps/web/src',                        dst: 'apps/web/src' },
  // Schema is the canonical source of truth for fields / enums.
  { src: 'packages/db/prisma/schema.prisma',    dst: 'packages/db/prisma/schema.prisma' },
  // Shared types / constants the agent might want to reference.
  { src: 'packages/shared/src',                 dst: 'packages/shared/src' },
]

/**
 * Idempotently set up READONLY_MIRROR_DIR with symlinks to whitelisted source
 * subdirs. Re-running is safe — we replace any existing symlinks.
 */
export function ensureReadonlyMirror(): string {
  fs.mkdirSync(READONLY_MIRROR_DIR, { recursive: true })
  for (const { src, dst } of MIRROR_TARGETS) {
    const absSrc = path.resolve(REPO_ROOT, src)
    const absDst = path.join(READONLY_MIRROR_DIR, dst)
    fs.mkdirSync(path.dirname(absDst), { recursive: true })
    try {
      const lst = fs.lstatSync(absDst)
      if (lst.isSymbolicLink() || lst.isFile() || lst.isDirectory()) {
        // Re-resolve to make sure it points where we expect. If not, replace.
        try {
          const cur = fs.readlinkSync(absDst)
          if (path.resolve(path.dirname(absDst), cur) === absSrc) continue
        } catch { /* not a symlink */ }
        fs.rmSync(absDst, { recursive: true, force: true })
      }
    } catch { /* doesn't exist, fall through */ }
    if (fs.existsSync(absSrc)) {
      fs.symlinkSync(absSrc, absDst)
    }
    // If the src doesn't exist (e.g. partial checkout), skip silently. Better
    // to give the agent fewer dirs to look at than to error out at boot.
  }
  return READONLY_MIRROR_DIR
}

export interface ClaudeEnvelope {
  type: string
  subtype?: string
  is_error?: boolean
  result?: string
  duration_ms?: number
  duration_api_ms?: number
  usage?: {
    input_tokens?: number
    output_tokens?: number
    cache_read_input_tokens?: number
    cache_creation_input_tokens?: number
  }
}

export interface RunResult {
  envelope: ClaudeEnvelope
  raw: string
  stderr: string
  exitCode: number | null
  wallMs: number
}

export interface RunOptions {
  /** If set, the Read tool can see this file (added to --add-dir scope). */
  imagePath?: string
  /**
   * 'fast' (default): no tools, fastest path for text-only / refusal cases.
   * 'investigator': Read/Glob/Grep on a curated source-code mirror, plus
   * Bash locked to the RPC scripts in {@link RPC_DIR}. Multi-turn; use when
   * the question requires actually verifying data or code (e.g. when the
   * user attached an image / a screenshot).
   */
  mode?: 'fast' | 'investigator'
  /**
   * Required for investigator mode — RPC scripts read TENANT_ID from env to
   * scope every DB query to the asking user's tenant. The agent has no
   * syntactic way to override this.
   */
  tenantId?: string
  /**
   * Passed through to the spawn env so the RPC scripts can talk to Postgres.
   * In investigator mode this MUST be set; in fast mode it's ignored.
   */
  databaseUrl?: string
}

/**
 * Spawn `claude -p` in headless mode against an EMS-scoped system prompt.
 *
 * - **fast mode**: no tools, just vision + reasoning. ~3-10s. Used for plain
 *   text Q&A and refusals.
 * - **investigator mode**: Read/Glob/Grep on a source-code mirror + a fixed
 *   set of tenant-scoped RPC scripts callable via Bash. ~20-90s, multi-turn.
 *   The agent can verify hypotheses against the user's actual data before
 *   answering, instead of guessing from a screenshot alone.
 *
 * In both modes the dangerous side-effects of normal Claude Code execution
 * are stripped (no session persistence, no slash commands, no project/user
 * settings, no dynamic system prompt sections).
 *
 * Auth: relies on the host's claude.ai subscription via OAuth. The local
 * machine must have ANTHROPIC_API_KEY unset when running this — see the
 * env scrubbing below. (`--bare` cannot be used because it forces API-key
 * auth and ignores OAuth.)
 */
export async function runClaude(systemPrompt: string, userMessage: string, opts: RunOptions = {}): Promise<RunResult> {
  const t0 = Date.now()
  const mode = opts.mode ?? 'fast'
  const isInvestigator = mode === 'investigator'

  // cwd selection:
  // - investigator: source-code mirror dir, so the agent's "home" is the
  //   thing it can read. Image (if any) lives in its own dir, surfaced via
  //   an additional --add-dir.
  // - fast: image's parent dir (so Read can see the image) or the shared
  //   sandbox root for text-only.
  const cwd = isInvestigator
    ? ensureReadonlyMirror()
    : (opts.imagePath ? path.dirname(opts.imagePath) : ensureSandboxRoot())

  // Scrub env aggressively. Pass through only what `claude` reasonably needs
  // for OAuth + macOS keychain + Node IO. Critically, drop ANTHROPIC_API_KEY
  // so a stale dev key with depleted credits can't override the subscription.
  const passThrough = ['HOME', 'PATH', 'LANG', 'LC_ALL', 'USER', 'SHELL', 'TMPDIR']
  const env: Record<string, string> = {}
  for (const k of passThrough) {
    if (process.env[k]) env[k] = process.env[k] as string
  }
  if (isInvestigator) {
    // RPC scripts read TENANT_ID + DATABASE_URL from env. Set here so the
    // agent literally cannot specify a different tenant — it has no syntax
    // for env overrides, and the Bash pattern below disallows any prefix
    // other than `node <rpc>/*.mjs *`.
    if (!opts.tenantId) throw new Error('investigator mode requires tenantId')
    env.TENANT_ID = opts.tenantId
    if (opts.databaseUrl) env.DATABASE_URL = opts.databaseUrl
    else if (process.env.DATABASE_URL) env.DATABASE_URL = process.env.DATABASE_URL
  }

  const args: string[] = [
    '-p', userMessage,
    '--system-prompt', systemPrompt,
    '--output-format', 'json',
    '--no-session-persistence',                        // don't write ~/.claude/sessions
    '--disable-slash-commands',                        // no /skill expansion
    '--setting-sources', '',                           // ignore user/project/local settings
    '--exclude-dynamic-system-prompt-sections',        // strip cwd/env/git from system prompt
    '--model', MODEL,
  ]

  if (isInvestigator) {
    // Read/Glob/Grep over the source mirror, Bash bound to RPC binary path.
    // The Bash pattern's `*` after `.mjs` is the wildcard for arguments —
    // Claude Code's allowedTools matcher tokenizes the command and only
    // matches a single binary + arg pattern, so the agent can't append
    // `; rm -rf /` or pipe to anything else.
    args.push('--tools', 'Read,Glob,Grep,Bash')
    args.push('--allowedTools',
      `Read`,
      `Glob`,
      `Grep`,
      `Bash(node ${path.join(RPC_DIR, '*.mjs')} *)`,
    )
    args.push('--add-dir', cwd)
    if (opts.imagePath) args.push('--add-dir', path.dirname(opts.imagePath))
  } else {
    // Fast mode: no tools, except Read when there's an image. (Read is the
    // only way the model receives the image content in headless mode.)
    args.push('--tools', opts.imagePath ? 'Read' : '')
    if (opts.imagePath) args.push('--add-dir', cwd)
  }

  const timeoutMs = isInvestigator ? INVESTIGATOR_TIMEOUT_MS : TIMEOUT_MS

  return await new Promise<RunResult>((resolve) => {
    const proc = spawn(CLAUDE_BIN, args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] })

    let stdout = ''
    let stderr = ''
    const timer = setTimeout(() => {
      proc.kill('SIGKILL')
    }, timeoutMs)

    proc.stdout.on('data', (c) => { stdout += c.toString('utf8') })
    proc.stderr.on('data', (c) => { stderr += c.toString('utf8') })

    proc.on('close', (code) => {
      clearTimeout(timer)
      let envelope: ClaudeEnvelope
      try {
        envelope = JSON.parse(stdout) as ClaudeEnvelope
      } catch {
        envelope = { type: 'error', is_error: true, result: stdout.slice(0, 500) }
      }
      resolve({
        envelope,
        raw: stdout,
        stderr,
        exitCode: code,
        wallMs: Date.now() - t0,
      })
    })

    proc.on('error', (err) => {
      clearTimeout(timer)
      resolve({
        envelope: { type: 'error', is_error: true, result: err.message },
        raw: '',
        stderr: err.message,
        exitCode: null,
        wallMs: Date.now() - t0,
      })
    })
  })
}

export interface ParsedAnswer {
  inScope: boolean
  suggestBug: boolean
  answer: string
}

/**
 * Parse the three-line tagged-format output we trained the model to produce.
 * Returns null if the response can't be parsed — caller should treat that as
 * a worker failure (we don't want to surface garbled output to users).
 */
export function parseTaggedAnswer(modelText: string): ParsedAnswer | null {
  if (!modelText) return null
  const scopeMatch = modelText.match(/^IN_SCOPE:\s*(yes|no)\s*$/im)
  const bugMatch = modelText.match(/^SUGGEST_BUG:\s*(yes|no)\s*$/im)
  const ansMatch = modelText.match(/^ANSWER:\s*([\s\S]+?)\s*$/im)
  if (!scopeMatch || !bugMatch || !ansMatch) return null

  const inScope = scopeMatch[1].toLowerCase() === 'yes'
  const suggestBug = bugMatch[1].toLowerCase() === 'yes'

  // The DOTALL match for ANSWER is greedy; trim trailing artefacts ("---" or
  // accidental example sections) and clamp length.
  let answer = ansMatch[1]
  const cutoff = answer.search(/\n(---|IN_SCOPE:|用户[:：])/)
  if (cutoff > 0) answer = answer.slice(0, cutoff)
  answer = answer.trim().slice(0, 4000)

  // Server-side scope-mismatch guard: if the model marked off-topic, force
  // the canonical refusal copy regardless of what it generated.
  if (!inScope) {
    return { inScope: false, suggestBug: false, answer: '抱歉，我只能回答 EMS 系统使用相关的问题。' }
  }
  return { inScope, suggestBug, answer }
}
