/**
 * Model configuration and invocation for the pilot.
 *
 * Rules this module enforces, all derived from the pilot brief:
 *  - One configured provider. There is NO fallback chain, so a failure can never
 *    silently degrade into a different (possibly paid) provider or into template
 *    text. Failures are returned as typed, honest errors.
 *  - Provider, model id and endpoint are all configurable by environment.
 *  - LM Studio stays optional and is just another OpenAI-compatible endpoint.
 *    Latency is measured on every call so a local model can be compared.
 *  - A hosted runtime is refused if it is pointed at a loopback endpoint, because
 *    its own localhost is not the user's laptop.
 *  - The API key is read from the server environment only. It is never accepted
 *    from a request body and never included in an error message or log line.
 */
import { z } from 'zod'
import type { ModelFailure, ModelOutcome, TurnResult } from '../types.ts'

export type ProviderKind = 'openrouter' | 'lmstudio' | 'openai-compatible'

export interface ModelConfig {
  provider: ProviderKind
  modelId: string
  baseUrl: string
  apiKey: string | null
  timeoutMs: number
  /** True when running on a host that is not the user's laptop. */
  hosted: boolean
  /** Explicit override permitting a loopback endpoint. Off by default. */
  allowLoopbackModel: boolean
}

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '0.0.0.0', '::1', '[::1]'])

export function isLoopbackUrl(rawUrl: string): boolean {
  try {
    const u = new URL(rawUrl)
    return LOOPBACK_HOSTS.has(u.hostname.toLowerCase())
  } catch {
    return false
  }
}

function detectHosted(): boolean {
  if (process.env.PILOT_HOSTED === 'true') return true
  // Vercel, Render, Fly and friends all set at least one of these.
  return Boolean(process.env.VERCEL || process.env.RENDER || process.env.FLY_APP_NAME)
}

/**
 * Read model configuration from the server environment only.
 *
 * Primary names are AI_BASE_URL / AI_MODEL / AI_API_KEY. The PILOT_MODEL_*
 * names are accepted as aliases so both spellings work. There is no default
 * model id and no default provider key: an unconfigured pilot reports itself as
 * unconfigured rather than quietly dialling a paid endpoint.
 */
export function readModelConfig(env: NodeJS.ProcessEnv = process.env): ModelConfig {
  const pick = (...names: string[]): string => {
    for (const n of names) {
      const v = env[n]
      if (v && v.trim()) return v.trim()
    }
    return ''
  }

  const rawProvider = pick('AI_PROVIDER', 'PILOT_MODEL_PROVIDER').toLowerCase()
  const baseUrl = pick('AI_BASE_URL', 'PILOT_MODEL_BASE_URL').replace(/\/+$/, '')

  // Provider is inferred from the endpoint when not stated, so pointing
  // AI_BASE_URL at LM Studio needs no other configuration.
  const provider: ProviderKind =
    rawProvider === 'lmstudio' || rawProvider === 'openai-compatible' || rawProvider === 'openrouter'
      ? rawProvider
      : isLoopbackUrl(baseUrl) && /:1234\/?$|:1234\/v1$/.test(baseUrl)
        ? 'lmstudio'
        : /openrouter\.ai/.test(baseUrl)
          ? 'openrouter'
          : 'openai-compatible'

  const apiKey = pick('AI_API_KEY', 'PILOT_MODEL_API_KEY') || null

  return {
    provider,
    modelId: pick('AI_MODEL', 'PILOT_MODEL_ID'),
    baseUrl,
    apiKey,
    timeoutMs: Number(pick('AI_TIMEOUT_MS', 'PILOT_MODEL_TIMEOUT_MS') || 60000),
    hosted: detectHosted(),
    allowLoopbackModel: pick('PILOT_ALLOW_LOOPBACK_MODEL') === 'true',
  }
}

export type ModelReadiness =
  | { ready: true; provider: string; modelId: string; baseUrl: string; local: boolean }
  | { ready: false; code: ModelFailure['code']; message: string }

/**
 * Describe whether a real model call is possible right now. The UI uses this to
 * label an unavailable-model/offline state honestly instead of pretending.
 * Never exposes the key, only whether one is present.
 */
export function describeReadiness(config: ModelConfig = readModelConfig()): ModelReadiness {
  if (!config.modelId) {
    return {
      ready: false,
      code: 'model_not_configured',
      message:
        'No model is configured. Set AI_MODEL and AI_BASE_URL to enable real brain-dump responses. For a local LM Studio server use AI_BASE_URL=http://127.0.0.1:1234/v1.',
    }
  }
  if (!config.baseUrl) {
    return {
      ready: false,
      code: 'model_not_configured',
      message: 'No model endpoint is configured. Set AI_BASE_URL.',
    }
  }
  if (config.hosted && isLoopbackUrl(config.baseUrl) && !config.allowLoopbackModel) {
    return {
      ready: false,
      code: 'model_endpoint_unsafe',
      message:
        'This runtime is hosted, but AI_BASE_URL points at localhost. On a hosted server localhost is the server itself, not your laptop, so a local LM Studio instance is unreachable. Set AI_BASE_URL to a routable endpoint, or run the pilot service on the same machine as LM Studio.',
    }
  }
  // A loopback endpoint (LM Studio and most local OpenAI-compatible servers)
  // needs no key. Anything remote does, and without one we refuse rather than
  // sending an unauthenticated request that would fail opaquely.
  const needsKey = !isLoopbackUrl(config.baseUrl)
  if (needsKey && !config.apiKey) {
    return {
      ready: false,
      code: 'model_not_configured',
      message: `Endpoint ${config.baseUrl} needs a key but AI_API_KEY is not set. No request will be made and no placeholder content will be shown.`,
    }
  }
  return {
    ready: true,
    provider: config.provider,
    modelId: config.modelId,
    baseUrl: config.baseUrl,
    local: isLoopbackUrl(config.baseUrl),
  }
}

/* ------------------------------------------------------- response contract */

const NextActionSchema = z.object({
  title: z.string().min(1).max(200),
  detail: z.string().max(1200).nullish(),
})

export const TurnSchema = z.object({
  interpretation: z.string().min(1).max(2000),
  question: z.string().max(600).nullish(),
  nextAction: NextActionSchema.nullish(),
  observedFacts: z.array(z.string().min(3).max(400)).max(8).optional(),
})

/**
 * Extract the first JSON object from a model response. Models occasionally wrap
 * JSON in prose or a code fence; this tolerates that without inventing content.
 */
export function extractJsonObject(text: string): unknown | null {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)
  const candidate = fenced ? fenced[1] : text
  const start = candidate.indexOf('{')
  const end = candidate.lastIndexOf('}')
  if (start === -1 || end === -1 || end <= start) return null
  const slice = candidate.slice(start, end + 1)

  const direct = tryParse(slice)
  if (direct !== undefined) return direct

  // Small local models frequently produce *almost* JSON: a bare unquoted
  // sentence as a value, a trailing comma, a smart quote. Repairing the syntax
  // recovers what the model actually said; it never adds content of our own. If
  // the repair does not parse we still return null and report an honest failure.
  const repaired = tryParse(repairJsonSyntax(slice))
  if (repaired !== undefined) return repaired

  return salvageKnownFields(slice) ?? null
}

function tryParse(text: string): unknown | undefined {
  try {
    return JSON.parse(text)
  } catch {
    return undefined
  }
}

const KNOWN_KEYS = ['interpretation', 'question', 'nextAction', 'observedFacts'] as const

/**
 * Fix the syntax mistakes a small model makes, conservatively and in order:
 * smart quotes, trailing commas, raw newlines inside strings, and bare
 * (unquoted) values on a `"key": value` line.
 */
export function repairJsonSyntax(raw: string): string {
  let text = raw.replace(/[\u201c\u201d]/g, '"').replace(/[\u2018\u2019]/g, "'")

  // A value that is not a quoted string, number, literal, array or object gets
  // quoted. Applied line by line, which covers the common single-line case.
  text = text
    .split('\n')
    .map((line) => {
      const m = line.match(/^(\s*"[^"]+"\s*:\s*)([^"]*?)(\s*,?\s*)$/)
      if (!m) return line
      const [, head, value, tail] = m
      const trimmed = value.trim()
      if (trimmed === '') return line
      if (/^(true|false|null)$/.test(trimmed)) return line
      if (/^-?\d+(\.\d+)?$/.test(trimmed)) return line
      if (/^[\[{]/.test(trimmed)) return line
      const comma = tail.includes(',') ? ',' : ''
      return `${head}${JSON.stringify(trimmed)}${comma}`
    })
    .join('\n')

  // Trailing commas before a closing brace or bracket.
  text = text.replace(/,(\s*[}\]])/g, '$1')
  return text
}

/**
 * Last resort: read the known fields straight out of the text the model wrote.
 * Bounded to our own schema keys, so it can only recover existing content.
 */
function salvageKnownFields(text: string): unknown | null {
  const grab = (key: string): string | null => {
    const re = new RegExp(`"${key}"\\s*:\\s*([\\s\\S]*?)(?=\\n\\s*"(?:${KNOWN_KEYS.join('|')})"\\s*:|$)`)
    const m = text.match(re)
    if (!m) return null
    return cleanScalar(m[1])
  }

  const interpretation = grab('interpretation')
  if (!interpretation) return null

  const question = grab('question')
  const actionBlock = text.match(/"nextAction"\s*:\s*\{([\s\S]*?)\}/)
  let nextAction: { title: string; detail: string | null } | null = null
  if (actionBlock) {
    const title = cleanScalar(actionBlock[1].match(/"title"\s*:\s*([\s\S]*?)$/)?.[1] ?? '')
    const detail = cleanScalar(actionBlock[1].match(/"detail"\s*:\s*([\s\S]*?)$/)?.[1] ?? '')
    if (title) nextAction = { title, detail: detail || null }
  }

  const factsBlock = text.match(/"observedFacts"\s*:\s*\[([\s\S]*?)\]/)
  const observedFacts = factsBlock
    ? (factsBlock[1].match(/"([^"]{3,})"/g) ?? []).map((s) => s.slice(1, -1).trim()).filter(Boolean)
    : []

  return {
    interpretation,
    question: question && question.toLowerCase() !== 'null' ? question : null,
    nextAction,
    observedFacts,
  }
}

function cleanScalar(raw: string): string | null {
  let v = raw.trim()
  if (!v) return null
  // Drop a trailing comma left over from the object structure.
  v = v.replace(/,\s*$/, '').trim()
  if (/^(null|none|n\/a)$/i.test(v)) return null
  if (v.startsWith('"') && v.endsWith('"') && v.length >= 2) v = v.slice(1, -1)
  v = v.trim()
  return v.length > 0 ? v : null
}

export function parseTurnResponse(text: string): TurnResult | null {
  const parsed = extractJsonObject(text)
  if (!parsed) return null
  const result = TurnSchema.safeParse(parsed)
  if (!result.success) return null
  const d = result.data
  return {
    interpretation: d.interpretation.trim(),
    question: d.question?.trim() ? d.question.trim() : null,
    nextAction: d.nextAction
      ? {
          title: d.nextAction.title.trim(),
          detail: d.nextAction.detail?.trim() ? d.nextAction.detail.trim() : null,
        }
      : null,
    observedFacts: (d.observedFacts ?? []).map((f) => f.trim()).filter((f) => f.length > 0),
  }
}

/* ----------------------------------------------------------------- calling */

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export interface RawModelResult {
  ok: true
  text: string
  latencyMs: number
  provider: string
  modelId: string
  /**
   * Why the endpoint stopped: 'stop' for a finished answer, 'length' when it hit
   * the token cap mid-sentence. A truncated answer is a different problem from a
   * malformed one — it is fixable by asking for less — so the caller can tell
   * the user which happened instead of guessing.
   */
  finishReason: string | null
}

/** Env switch for grammar-constrained JSON: 'auto' (default), 'on' or 'off'. */
function jsonModePreference(): 'auto' | 'on' | 'off' {
  const v = (process.env.AI_JSON_MODE || '').trim().toLowerCase()
  return v === 'on' || v === 'off' ? v : 'auto'
}

/**
 * Per-call overrides for sampling. Only used where a call genuinely needs a
 * different budget than a brain-dump turn: generating several drafts at once is
 * a longer answer than one interpretation plus one next action, so it asks for
 * more tokens. Nothing here changes the endpoint, the model or the provider.
 */
export interface CallOptions {
  maxTokens?: number
  temperature?: number
}

interface PostOutcome {
  result: RawModelResult | ModelFailure
  /** True when the endpoint rejected the request because of response_format. */
  unsupportedJsonMode: boolean
}

async function postChatCompletion(
  messages: ChatMessage[],
  config: ModelConfig,
  jsonMode: boolean,
  opts: CallOptions = {}
): Promise<PostOutcome> {
  const url = `${config.baseUrl}/chat/completions`
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), config.timeoutMs)
  const startedAt = Date.now()

  try {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    if (config.apiKey) headers.Authorization = `Bearer ${config.apiKey}`
    if (config.provider === 'openrouter') {
      headers['HTTP-Referer'] = process.env.PILOT_APP_URL || 'http://localhost:3100'
      headers['X-Title'] = 'Creator OS Pilot'
    }

    const body: Record<string, unknown> = {
      model: config.modelId,
      messages,
      // Lower than a chat default: we need reliable structure, not variety.
      temperature: opts.temperature ?? Number(process.env.AI_TEMPERATURE || 0.2),
      max_tokens: opts.maxTokens ?? Number(process.env.AI_MAX_TOKENS || 900),
    }
    if (jsonMode) body.response_format = { type: 'json_object' }

    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: controller.signal,
    })

    const latencyMs = Date.now() - startedAt

    if (!response.ok) {
      // Read the body for diagnosis but never echo credentials back.
      let detail = ''
      try {
        detail = (await response.text()).slice(0, 400)
      } catch {
        detail = ''
      }
      const rejectedParam =
        jsonMode &&
        (response.status === 400 || response.status === 422) &&
        /response_format|json_object|json mode/i.test(detail)
      return {
        unsupportedJsonMode: rejectedParam,
        result: {
          ok: false,
          code: 'model_http_error',
          message: `Model endpoint returned HTTP ${response.status}${detail ? `: ${detail}` : ''}`,
          provider: config.provider,
          model: config.modelId,
          status: response.status,
          retryable: response.status >= 500 || response.status === 429,
        },
      }
    }

    const data = (await response.json()) as any
    const choice = data?.choices?.[0]
    const text: string = choice?.message?.content ?? ''
    if (!text || typeof text !== 'string') {
      return {
        unsupportedJsonMode: false,
        result: {
          ok: false,
          code: 'model_invalid_response',
          message: 'The model returned an empty or malformed completion.',
          provider: config.provider,
          model: data?.model || config.modelId,
          retryable: true,
        },
      }
    }

    return {
      unsupportedJsonMode: false,
      result: {
        ok: true,
        text,
        latencyMs,
        provider: config.provider,
        modelId: String(data?.model || config.modelId),
        finishReason: typeof choice?.finish_reason === 'string' ? choice.finish_reason : null,
      },
    }
  } catch (err: any) {
    const aborted = err?.name === 'AbortError'
    return {
      unsupportedJsonMode: false,
      result: {
        ok: false,
        code: aborted ? 'model_timeout' : 'model_unreachable',
        message: aborted
          ? `Model call timed out after ${config.timeoutMs}ms.`
          : `Could not reach the model endpoint at ${config.baseUrl}. ${
              err?.cause?.code ? `(${err.cause.code})` : ''
            }`.trim(),
        provider: config.provider,
        model: config.modelId,
        retryable: true,
      },
    }
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Perform one chat completion against the configured endpoint.
 * Returns a typed failure instead of throwing, and never substitutes content.
 *
 * `response_format: json_object` is requested by default, because a small local
 * model will otherwise hand back an almost-JSON reply with unquoted values that
 * we would have to reject. If the endpoint refuses that parameter the request
 * is retried once against the SAME model and endpoint without it. That is
 * parameter compatibility, not a fallback chain: no other model, endpoint or
 * account is ever contacted, and nothing is substituted for a real failure.
 */
export async function callModel(
  messages: ChatMessage[],
  config: ModelConfig = readModelConfig(),
  opts: CallOptions = {}
): Promise<RawModelResult | ModelFailure> {
  const readiness = describeReadiness(config)
  if (!readiness.ready) {
    return {
      ok: false,
      code: readiness.code,
      message: readiness.message,
      provider: config.provider,
      model: config.modelId || undefined,
      retryable: readiness.code !== 'model_endpoint_unsafe',
    }
  }

  const pref = jsonModePreference()
  const first = await postChatCompletion(messages, config, pref !== 'off', opts)
  if (first.unsupportedJsonMode && pref === 'auto') {
    const second = await postChatCompletion(messages, config, false, opts)
    return second.result
  }
  return first.result
}

/**
 * Public status snapshot for the UI. Reports configuration state and whether a
 * key is present, without ever revealing the key.
 */
export function modelStatus(config: ModelConfig = readModelConfig()) {
  const readiness = describeReadiness(config)
  return {
    configured: readiness.ready,
    provider: config.provider,
    modelId: config.modelId || null,
    baseUrl: config.baseUrl || null,
    endpointIsLoopback: config.baseUrl ? isLoopbackUrl(config.baseUrl) : false,
    runtimeIsHosted: config.hosted,
    apiKeyPresent: Boolean(config.apiKey),
    timeoutMs: config.timeoutMs,
    readiness,
  }
}
