import { spawn } from 'node:child_process'
import path from 'node:path'
import fs from 'node:fs'
import crypto from 'node:crypto'

const CLAUDE_BIN = process.env.CLAUDE_BIN ?? 'claude'
const MODEL = process.env.AGENT_MODEL ?? 'sonnet'
const TIMEOUT_MS = Number(process.env.AGENT_TIMEOUT_MS ?? 90_000)
const SANDBOX_ROOT = process.env.AGENT_SANDBOX_DIR ?? path.join(process.cwd(), '.agent-sandbox')

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
  /** If set, Read tool is enabled and --add-dir is bounded to this directory. */
  imagePath?: string
}

/**
 * Spawn `claude -p` in headless mode against an EMS-scoped system prompt,
 * with all tools disabled and the dangerous side-effects of normal Claude
 * Code execution stripped (no session persistence, no slash commands, no
 * project/user settings, no dynamic system prompt sections).
 *
 * When `opts.imagePath` is provided, the Read tool is enabled and the cwd
 * + --add-dir are scoped to that file's parent directory only. The model
 * can therefore see the image but cannot read anything else on the host.
 *
 * Auth: relies on the host's claude.ai subscription via OAuth. The local
 * machine must have ANTHROPIC_API_KEY unset when running this — see the
 * env scrubbing below. (We verified during design that `--bare` cannot be
 * used because it forces ANTHROPIC_API_KEY auth and ignores OAuth.)
 */
export async function runClaude(systemPrompt: string, userMessage: string, opts: RunOptions = {}): Promise<RunResult> {
  const t0 = Date.now()
  const sandbox = opts.imagePath ? path.dirname(opts.imagePath) : ensureSandboxRoot()

  // Scrub env aggressively. Pass through only what `claude` reasonably needs
  // for OAuth + macOS keychain + Node IO. Critically, drop ANTHROPIC_API_KEY
  // so a stale dev key with depleted credits can't override the subscription.
  const passThrough = ['HOME', 'PATH', 'LANG', 'LC_ALL', 'USER', 'SHELL', 'TMPDIR']
  const env: Record<string, string> = {}
  for (const k of passThrough) {
    if (process.env[k]) env[k] = process.env[k] as string
  }
  // macOS keychain unlock prompts can hang headless processes; the keychain
  // is normally already unlocked when the agent runs interactively (your
  // terminal session), so leave it alone.

  const args = [
    '-p', userMessage,
    '--system-prompt', systemPrompt,
    '--output-format', 'json',
    // When an image is attached we MUST enable Read so the model can view it.
    // The image lives alone in a per-task sandbox dir, and --add-dir bounds
    // the file access surface to that one directory. Without an image we
    // disable all tools.
    '--tools', opts.imagePath ? 'Read' : '',
    '--no-session-persistence',                        // don't write ~/.claude/sessions
    '--disable-slash-commands',                        // no /skill expansion
    '--setting-sources', '',                           // ignore user/project/local settings
    '--exclude-dynamic-system-prompt-sections',        // strip cwd/env/git from system prompt
    '--model', MODEL,
  ]
  if (opts.imagePath) {
    args.push('--add-dir', sandbox)
  }

  return await new Promise<RunResult>((resolve) => {
    const proc = spawn(CLAUDE_BIN, args, { cwd: sandbox, env, stdio: ['ignore', 'pipe', 'pipe'] })

    let stdout = ''
    let stderr = ''
    const timer = setTimeout(() => {
      proc.kill('SIGKILL')
    }, TIMEOUT_MS)

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
