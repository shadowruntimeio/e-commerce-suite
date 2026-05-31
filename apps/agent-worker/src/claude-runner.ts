import { spawn } from 'node:child_process'
import path from 'node:path'
import fs from 'node:fs'

const CLAUDE_BIN = process.env.CLAUDE_BIN ?? 'claude'
const MODEL = process.env.AGENT_MODEL ?? 'sonnet'
const TIMEOUT_MS = Number(process.env.AGENT_TIMEOUT_MS ?? 90_000)

// Empty sandbox cwd: ensures no project CLAUDE.md / settings leak into the
// prompt and no tool (if one ever slipped through --tools "") could write to a
// real project directory. Created lazily and re-used between runs.
function ensureSandbox(): string {
  const dir = process.env.AGENT_SANDBOX_DIR ?? path.join(process.cwd(), '.agent-sandbox')
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
  return dir
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

/**
 * Spawn `claude -p` in headless mode against an EMS-scoped system prompt,
 * with all tools disabled and the dangerous side-effects of normal Claude
 * Code execution stripped (no session persistence, no slash commands, no
 * project/user settings, no dynamic system prompt sections).
 *
 * Auth: relies on the host's claude.ai subscription via OAuth. The local
 * machine must have ANTHROPIC_API_KEY unset when running this — see the
 * env scrubbing below. (We verified during design that `--bare` cannot be
 * used because it forces ANTHROPIC_API_KEY auth and ignores OAuth.)
 */
export async function runClaude(systemPrompt: string, userMessage: string): Promise<RunResult> {
  const t0 = Date.now()
  const sandbox = ensureSandbox()

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
    '--tools', '',                                     // disable ALL tools
    '--no-session-persistence',                        // don't write ~/.claude/sessions
    '--disable-slash-commands',                        // no /skill expansion
    '--setting-sources', '',                           // ignore user/project/local settings
    '--exclude-dynamic-system-prompt-sections',        // strip cwd/env/git from system prompt
    '--model', MODEL,
  ]

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
