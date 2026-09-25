/**
 * Draft generation for Social Studio and Marketplace.
 *
 * Before this existed those two screens read a browser-local list that nothing
 * wrote to any more, so they could only ever render an empty state. Drafts are
 * generated here instead: one real model call against the user's own stored
 * project context, written to `content_drafts` server-side, per user.
 *
 * Invariants, matching the rest of the pilot:
 *  - Every read and write is scoped to `userId`.
 *  - The model is only given context that is already stored. When there is none
 *    the request is refused with an honest message instead of inventing a
 *    project to write about.
 *  - A model failure is returned as a typed failure and recorded on the run. No
 *    template text is substituted for a real generation.
 *  - Etsy listings and product inventory stay out of scope, and 'etsy' is not a
 *    channel at all, so the marketplace screen cannot ask for one.
 *  - Nothing generated here is ever published or sent anywhere.
 *
 * Unlike a brain-dump turn there is deliberately no idempotency replay: every
 * call gets a fresh run key and produces a new set of drafts. Asking twice for
 * the same thing should give you two attempts to choose from, and a duplicate
 * is visible in the list and deletable, whereas a silently replayed answer
 * would look like the generator had stopped working.
 */
import { randomUUID } from 'node:crypto'
import type { Db } from '../db/client.ts'
import * as repo from '../db/repo.ts'
import {
  callModel,
  extractJsonObject,
  readModelConfig,
  repairJsonSyntax,
  type CallOptions,
  type ModelConfig,
} from '../model/index.ts'
import {
  OFFER_CHANNELS,
  SOCIAL_CHANNELS,
  type ContentDraft,
  type DraftChannel,
  type DraftKind,
  type DraftPayload,
  type ModelFailure,
} from '../types.ts'
import { getProjectContext } from './context.ts'
import { buildContextBlock, type PromptContext } from './prompts.ts'

/** How many channels one call may ask for. Keeps the answer inside the budget. */
export const MAX_CHANNELS_PER_CALL = 4
/** Longest draft body we store, so a runaway completion cannot fill the row. */
export const MAX_DRAFT_BODY_CHARS = 4_000

/**
 * Token budget for one drafts call.
 *
 * An offer draft carries a title, pricing, features, an audience and packages,
 * so it needs roughly twice the room a social post does. Measured, not guessed:
 * a 3B model writing one Gumroad draft was cut off mid-JSON at 1600 tokens, and
 * a truncated answer cannot be parsed as a whole. Both numbers are overridable
 * through AI_DRAFT_MAX_TOKENS because the right value depends on the model.
 */
export function draftTokenBudget(kind: DraftKind): number {
  const fromEnv = Number(process.env.AI_DRAFT_MAX_TOKENS)
  if (Number.isFinite(fromEnv) && fromEnv > 0) return fromEnv
  return kind === 'offer' ? 2600 : 1400
}

export const DRAFT_SYSTEM_PROMPT_HEADER = `You are the content draft writer inside Creator OS, a private pilot for three people.

You write drafts the person will read, edit and copy out by hand. You never publish, post, schedule or send anything, and you never claim to.

Rules:
- Use ONLY the project context below. Do not invent products, prices, audiences, credentials or achievements that are not in it.
- If the context is too thin for a channel, still write the draft but say plainly in "note" what you had to guess around. Do not pad with generic marketing filler.
- Write like a person, not like a campaign. Short sentences. No "In today's fast-paced world", no "Unlock", no "Game-changing", no emoji unless the context shows they use them.
- The reader is likely neurodivergent and easily overwhelmed: one clear idea per draft beats five clever ones.
- Never propose Etsy listings, product inventory or stock counts. They are out of scope for this pilot.`

/** The JSON contract for a social draft. */
const SOCIAL_SHAPE = `Respond with ONLY a JSON object, no prose and no code fence, in exactly this shape:
{
  "drafts": [
    {
      "channel": string,
      "hook": string | null,
      "body": string,
      "hashtags": string[]
    }
  ]
}

Write exactly one draft for each of these channels, using these exact channel names: CHANNELS.

Length rules, and they matter because a small local model runs out of room mid-answer:
- Keep each body under 90 words. One idea per draft, no second thread.
- At most six hashtags.

JSON rules, and these matter more than how good the copy is:
- Every value must be a double-quoted JSON string, except null, numbers, arrays and objects.
- "body" holds the post text. Use \\n inside the string for a line break. Never a raw newline.
- "hashtags" is an array of strings with no leading # symbol, at most eight of them.
- Use null (unquoted) when there is no hook. Never "null" or "".
- No trailing commas. No comments. No text before the opening brace or after the closing brace.

Worked example of a correct answer:
{
  "drafts": [
    {
      "channel": "linkedin",
      "hook": "I spent a year optimising my workflow instead of shipping the thing.",
      "body": "Three unfinished projects, six focused hours a week.\\n\\nI kept building systems to manage the work rather than doing it. The newsletter is the one asset I actually want, so this week it gets the first 45 minutes, not the last.\\n\\nIf you are also running a one-person studio: what is the thing you keep postponing behind a better system?",
      "hashtags": ["solocreator", "neurodivergent", "buildinginpublic"]
    }
  ]
}`

/** The JSON contract for an offer draft (Gumroad product or Fiverr gig). */
const OFFER_SHAPE = `Respond with ONLY a JSON object, no prose and no code fence, in exactly this shape:
{
  "drafts": [
    {
      "channel": string,
      "title": string,
      "body": string,
      "pricing": string | null,
      "features": string[],
      "audience": string | null,
      "packages": [{ "name": string, "price": string, "features": string[] }]
    }
  ]
}

Write exactly one draft for each of these channels, using these exact channel names: CHANNELS.
For a "gumroad" draft, "body" is the product description and "packages" is an empty array.
For a "fiverr" draft, "body" is the gig description and "packages" holds up to three service tiers.

Length rules, and they matter because a small local model runs out of room mid-answer:
- Keep each body under 90 words. No marketing preamble, no repeated points.
- At most four top-level features.
- At most two packages, each with at most three features.

JSON rules, and these matter more than how good the copy is:
- Every value must be a double-quoted JSON string, except null, numbers, arrays and objects.
- Use \\n inside a string for a line break. Never a raw newline.
- If the context does not justify a price, put a suggested price in "pricing" and say in "body" that it is a suggestion the person must confirm.
- Use null (unquoted) for a field that genuinely does not apply. Never "null" or "".
- No trailing commas. No comments. No text before the opening brace or after the closing brace.

Worked example of a correct answer:
{
  "drafts": [
    {
      "channel": "gumroad",
      "title": "The 45-Minute Focus Kit",
      "body": "A one-page planner for people who have six focused hours a week and more projects than that.\\n\\nYou get the weekly block template and the short guide to picking the one asset that matters.\\n\\nPrice is a suggestion based on what you told me; confirm it before you list anything.",
      "pricing": "£12 (suggested)",
      "features": ["Weekly block template", "One-page picking guide", "PDF, no account needed"],
      "audience": "Solo creators juggling several unfinished projects",
      "packages": []
    }
  ]
}`

/* ------------------------------------------------------------------ inputs */

export interface GenerateDraftsInput {
  userId: string
  kind: DraftKind
  channels: DraftChannel[]
  /** Which project to write from. Defaults to the most recently touched one. */
  projectId?: string | null
  /** Optional steer from the user, e.g. "focus on the newsletter, not the book". */
  brief?: string | null
  /** Provenance, e.g. 'drafts:web'. */
  source?: string
  /** Injectable for tests. Production reads the server environment. */
  modelConfig?: ModelConfig
}

/* ---------------------------------------------------------------- outcomes */

export interface DraftsSuccess {
  ok: true
  kind: 'drafts'
  drafts: ContentDraft[]
  projectId: string | null
  projectTitle: string | null
  provider: string
  model: string
  latencyMs: number
  runId: string
  /**
   * True when the endpoint stopped at the token cap rather than finishing. Some
   * requested channels may be missing, and the UI says so instead of showing a
   * short list as though it were the whole answer.
   */
  truncated: boolean
}

export interface DraftsModelFailure {
  ok: false
  kind: 'model_failure'
  failure: ModelFailure
  runId: string | null
}

export interface DraftsInvalid {
  ok: false
  kind: 'invalid_input' | 'not_found' | 'no_context'
  message: string
}

export type GenerateDraftsResult = DraftsSuccess | DraftsModelFailure | DraftsInvalid

/* ------------------------------------------------------------ prompt build */

export function buildDraftMessages(
  ctx: PromptContext,
  kind: DraftKind,
  channels: DraftChannel[],
  brief: string | null
) {
  const shape = (kind === 'offer' ? OFFER_SHAPE : SOCIAL_SHAPE).replace(
    'CHANNELS',
    channels.join(', ')
  )
  const system = `${DRAFT_SYSTEM_PROMPT_HEADER}\n\n${shape}`

  const parts = [buildContextBlock(ctx)]
  if (brief) parts.push(`WHAT THEY ASKED FOR THIS TIME:\n${brief}`)
  parts.push(`TASK: write one ${kind} draft for each channel listed above.`)

  return [
    { role: 'system' as const, content: system },
    { role: 'user' as const, content: parts.join('\n\n') },
  ]
}

/* --------------------------------------------------------------- normalise */

/** One draft as the model should have written it, before validation. */
export interface NormalizedDraft {
  channel: DraftChannel
  title: string | null
  body: string
  payload: DraftPayload
}

function asStringArray(value: unknown, max: number): string[] {
  if (Array.isArray(value)) {
    return value
      .map((v) => (typeof v === 'string' ? v.trim() : ''))
      .filter((v) => v.length > 0)
      .slice(0, max)
  }
  // A small model often writes a hashtag list as one comma-separated string.
  if (typeof value === 'string' && value.trim()) {
    return value
      .split(/[,\n]/)
      .map((v) => v.trim())
      .filter((v) => v.length > 0)
      .slice(0, max)
  }
  return []
}

function cleanText(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null
  const text = value.replace(/\\n/g, '\n').trim()
  if (!text || /^(null|none|n\/a)$/i.test(text)) return null
  return text.length > max ? text.slice(0, max) : text
}

function pick(obj: Record<string, unknown>, keys: string[]): unknown {
  for (const key of keys) {
    const value = obj[key]
    if (value !== undefined && value !== null && value !== '') return value
  }
  return undefined
}

/**
 * Turn whatever the model returned into drafts we are willing to store.
 *
 * Bounded on purpose: a channel that is not on the allowed list is dropped
 * rather than coerced, so 'etsy' can never sneak in from a completion, and a
 * draft with no body is dropped rather than stored as an empty card. Returns an
 * empty array when nothing usable came back, which the caller reports as an
 * honest `model_invalid_response` instead of substituting template content.
 */
export function normalizeDrafts(
  parsed: unknown,
  kind: DraftKind,
  allowed: DraftChannel[]
): NormalizedDraft[] {
  const raw = Array.isArray(parsed)
    ? parsed
    : (parsed as any)?.drafts ?? (parsed as any)?.posts ?? (parsed as any)?.items
  if (!Array.isArray(raw)) return []

  const out: NormalizedDraft[] = []
  const seen = new Set<DraftChannel>()

  for (const item of raw) {
    if (!item || typeof item !== 'object') continue
    const obj = item as Record<string, unknown>

    const wanted = String(pick(obj, ['channel', 'platform', 'network']) ?? '').trim().toLowerCase()
    const channel = allowed.find((c) => c === wanted)
    if (!channel || seen.has(channel)) continue

    const body = cleanText(pick(obj, ['body', 'content', 'text', 'post', 'description']), MAX_DRAFT_BODY_CHARS)
    if (!body) continue
    // Marked seen only now that the draft is being kept: an item with a blank
    // body must not swallow a usable one for the same channel further down.
    seen.add(channel)

    const title = cleanText(pick(obj, ['title', 'headline', 'name']), 200)
    const payload: DraftPayload = {}

    if (kind === 'social') {
      const hook = cleanText(pick(obj, ['hook', 'openingLine']), 300)
      if (hook) payload.hook = hook
      const hashtags = asStringArray(pick(obj, ['hashtags', 'tags']), 8).map((t) =>
        t.replace(/^#/, '')
      )
      if (hashtags.length > 0) payload.hashtags = hashtags
    } else {
      const pricing = cleanText(pick(obj, ['pricing', 'price']), 120)
      if (pricing) payload.pricing = pricing
      const features = asStringArray(pick(obj, ['features', 'includes', 'bullets']), 12)
      if (features.length > 0) payload.features = features
      const audience = cleanText(pick(obj, ['audience', 'targetAudience', 'who']), 300)
      if (audience) payload.audience = audience

      const rawPackages = Array.isArray(obj.packages) ? obj.packages : []
      const packages = rawPackages
        .filter((p) => p && typeof p === 'object')
        .slice(0, 3)
        .map((p) => {
          const pkg = p as Record<string, unknown>
          return {
            name: cleanText(pick(pkg, ['name', 'tier']), 80) ?? 'Untitled tier',
            price: cleanText(pick(pkg, ['price', 'pricing']), 60) ?? 'price to confirm',
            features: asStringArray(pick(pkg, ['features', 'includes']), 8),
          }
        })
        // A tier with no name and no features is noise, not a package.
        .filter((p) => p.name !== 'Untitled tier' || p.features.length > 0)
      if (packages.length > 0) payload.packages = packages
    }

    const note = cleanText(pick(obj, ['note', 'caveat', 'warning']), 400)
    if (note) payload.note = note

    out.push({ channel, title, body, payload })
  }

  return out
}

/* ------------------------------------------------------------- entry point */

function channelsFor(kind: DraftKind): DraftChannel[] {
  return kind === 'offer' ? OFFER_CHANNELS : SOCIAL_CHANNELS
}

function tryParseDraft(text: string): unknown | undefined {
  try {
    return JSON.parse(text)
  } catch {
    return undefined
  }
}

/**
 * Read the balanced JSON objects out of a completion that was cut off before it
 * closed.
 *
 * A truncated answer is no longer one parseable object, but every draft the
 * model actually finished is still a complete `{...}` in the text. Recovering
 * those is reading what it wrote, not inventing anything; the unfinished last
 * one has no closing brace and is simply not there to read. Objects that are not
 * drafts — the wrapper, for instance — are dropped later by `normalizeDrafts`,
 * which only accepts a channel it knows.
 */
export function salvageCompleteObjects(text: string): unknown[] {
  const found: unknown[] = []
  const starts: number[] = []
  let inString = false
  let escaped = false

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i]
    if (inString) {
      // Braces inside a string are text, not structure.
      if (escaped) escaped = false
      else if (ch === '\\') escaped = true
      else if (ch === '"') inString = false
      continue
    }
    if (ch === '"') {
      inString = true
    } else if (ch === '{') {
      starts.push(i)
    } else if (ch === '}') {
      const start = starts.pop()
      if (start === undefined) continue
      const slice = text.slice(start, i + 1)
      const parsed = tryParseDraft(slice) ?? tryParseDraft(repairJsonSyntax(slice))
      if (parsed && typeof parsed === 'object') found.push(parsed)
    }
  }

  return found
}

export async function generateDrafts(
  db: Db,
  input: GenerateDraftsInput
): Promise<GenerateDraftsResult> {
  const kind = input.kind
  if (kind !== 'social' && kind !== 'offer') {
    return { ok: false, kind: 'invalid_input', message: 'Draft kind must be "social" or "offer".' }
  }

  const allowed = channelsFor(kind)
  const requested = Array.isArray(input.channels) ? input.channels : []
  const channels: DraftChannel[] = []
  for (const raw of requested) {
    const wanted = String(raw ?? '').trim().toLowerCase() as DraftChannel
    if (!allowed.includes(wanted)) continue
    if (!channels.includes(wanted)) channels.push(wanted)
  }

  if (channels.length === 0) {
    return {
      ok: false,
      kind: 'invalid_input',
      message: `Pick at least one channel. ${kind === 'offer' ? 'Offers' : 'Social posts'} can be written for: ${allowed.join(', ')}.`,
    }
  }
  if (channels.length > MAX_CHANNELS_PER_CALL) {
    return {
      ok: false,
      kind: 'invalid_input',
      message: `That is ${channels.length} channels at once. Pick up to ${MAX_CHANNELS_PER_CALL}, so the model has room to write each one properly.`,
    }
  }

  // Drafts are written from stored context. Without a project there is nothing
  // honest to write about, and inventing one would put words in their mouth.
  const projects = repo.listProjects(db, input.userId)
  if (projects.length === 0) {
    return {
      ok: false,
      kind: 'no_context',
      message:
        'Nothing is stored about your work yet, so there is nothing real to write drafts from. Do one brain dump first — these drafts are built from what you told it, never invented.',
    }
  }

  const projectId = input.projectId ?? projects[0].id
  const ctxRecord = getProjectContext(db, input.userId, projectId)
  if (!ctxRecord) {
    return { ok: false, kind: 'not_found', message: 'That project is not yours or does not exist.' }
  }

  const ctx: PromptContext = {
    project: ctxRecord.project,
    facts: ctxRecord.facts,
    openActions: ctxRecord.openNextActions,
    history: ctxRecord.recentMessages,
  }

  const brief = (input.brief ?? '').trim()
  if (brief.length > 1_000) {
    return {
      ok: false,
      kind: 'invalid_input',
      message: `That note is ${brief.length} characters. Keep the steer under 1,000.`,
    }
  }

  const config = input.modelConfig ?? readModelConfig()
  const source = input.source ?? 'drafts:web'
  // A fresh key every call: see the note at the top of this file about why
  // drafts are not deduplicated the way turns are.
  const runKey = `${source}:${kind}:${randomUUID()}`
  const messages = buildDraftMessages(ctx, kind, channels, brief || null)
  const callOptions: CallOptions = { maxTokens: draftTokenBudget(kind) }

  const run = repo.createModelRun(db, {
    userId: input.userId,
    conversationId: ctxRecord.activeConversation?.id ?? null,
    idempotencyKey: runKey,
    purpose: kind === 'offer' ? 'offer_drafts' : 'social_drafts',
    provider: config.provider,
    model: config.modelId || null,
    endpoint: config.baseUrl || null,
  })

  const outcome = await callModel(messages, config, callOptions)

  if (!outcome.ok) {
    repo.failModelRun(db, run.id, { errorCode: outcome.code, errorMessage: outcome.message })
    repo.audit(db, {
      userId: input.userId,
      action: 'model_failure',
      detail: JSON.stringify({
        runId: run.id,
        purpose: kind === 'offer' ? 'offer_drafts' : 'social_drafts',
        code: outcome.code,
        status: outcome.status ?? null,
      }),
    })
    return { ok: false, kind: 'model_failure', failure: outcome, runId: run.id }
  }

  const truncated = outcome.finishReason === 'length'
  let normalized = normalizeDrafts(extractJsonObject(outcome.text), kind, channels)
  if (normalized.length === 0) {
    // A completion cut off at the token cap is no longer one JSON object, but
    // the drafts it did finish are still readable. Better to keep those and say
    // the answer was short than to throw the whole thing away.
    normalized = normalizeDrafts(salvageCompleteObjects(outcome.text), kind, channels)
  }

  if (normalized.length === 0) {
    const failure: ModelFailure = {
      ok: false,
      code: 'model_invalid_response',
      message: truncated
        ? `The model ran out of room after ${callOptions.maxTokens} tokens and stopped mid-answer, so nothing was stored. Ask for fewer channels at once, or raise AI_DRAFT_MAX_TOKENS on the server. Start of its reply: ${outcome.text.slice(0, 160)}`
        : `The model answered but nothing in its reply was a usable ${kind} draft, so nothing was stored. Start of its reply: ${outcome.text.slice(0, 160)}`,
      provider: outcome.provider,
      model: outcome.modelId,
      retryable: true,
    }
    repo.failModelRun(db, run.id, {
      errorCode: failure.code,
      errorMessage: failure.message,
      latencyMs: outcome.latencyMs,
    })
    repo.audit(db, {
      userId: input.userId,
      action: 'model_failure',
      detail: JSON.stringify({
        runId: run.id,
        purpose: 'drafts_invalid_response',
        code: failure.code,
        truncated,
      }),
    })
    return { ok: false, kind: 'model_failure', failure, runId: run.id }
  }

  // Record the successful completion before writing the draft rows, so a crash
  // mid-write leaves a run that shows what the model actually returned.
  repo.completeModelRun(db, run.id, {
    responseText: outcome.text,
    latencyMs: outcome.latencyMs,
    provider: outcome.provider,
    model: outcome.modelId,
  })

  const drafts = normalized.map((draft) =>
    repo.createContentDraft(db, {
      userId: input.userId,
      projectId: ctxRecord.project.id,
      kind,
      channel: draft.channel,
      title: draft.title,
      body: draft.body,
      payload: draft.payload,
      source,
      model: outcome.modelId,
    })
  )

  repo.audit(db, {
    userId: input.userId,
    action: 'drafts_generated',
    detail: JSON.stringify({
      runId: run.id,
      kind,
      channels: drafts.map((d) => d.channel),
      requested: channels,
      truncated,
      projectId: ctxRecord.project.id,
    }),
  })

  return {
    ok: true,
    kind: 'drafts',
    drafts,
    projectId: ctxRecord.project.id,
    projectTitle: ctxRecord.project.title,
    provider: outcome.provider,
    model: outcome.modelId,
    latencyMs: outcome.latencyMs,
    runId: run.id,
    truncated,
  }
}

/* ------------------------------------------------------------------ listing */

export function listDrafts(
  db: Db,
  userId: string,
  opts: { kind?: DraftKind | null; projectId?: string | null; limit?: number } = {}
): ContentDraft[] {
  return repo.listContentDrafts(db, userId, opts)
}

export function deleteDraft(db: Db, userId: string, draftId: string): boolean {
  const existed = repo.deleteContentDraft(db, userId, draftId)
  if (existed) {
    repo.audit(db, {
      userId,
      action: 'draft_deleted',
      detail: JSON.stringify({ draftId }),
    })
  }
  return existed
}
