/**
 * The brain-dump conversation engine.
 *
 * This is the one implementation of pilot behaviour. The Next.js route handlers,
 * the five MCP tools and the Telegram handler all call into here, so a turn
 * cannot behave differently depending on which surface produced it.
 *
 * Invariants enforced in this file:
 *  - Every read and write is scoped to `userId`. A record id belonging to
 *    another pilot user resolves to "not found", never to that record.
 *  - A turn yields at most one question and at most one next action, because
 *    that is what the prompt contract asks for and what `TurnSchema` validates.
 *  - "Save for later" and "where was I?" never call the model, so they keep
 *    working during an outage.
 *  - A model failure stores the user's input and returns an honest typed error.
 *    No assistant content is invented and nothing is silently substituted.
 *  - A retried request that carries the same idempotency key replays the stored
 *    result instead of calling the model again or creating a second action.
 */
import { createHash, randomUUID } from 'node:crypto'
import type { Db } from '../db/client.ts'
import * as repo from '../db/repo.ts'
import { callModel, parseTurnResponse, readModelConfig, type ModelConfig } from '../model/index.ts'
import type {
  Conversation,
  ConversationChannel,
  Message,
  ModelFailure,
  NextAction,
  Project,
  ReentryCard,
  TurnResult,
} from '../types.ts'
import { promptContextForConversation } from './context.ts'
import {
  buildReentryCard,
  detectDirective,
  findResumeTarget,
  renderReentryCard,
  type Directive,
} from './directives.ts'
import { recordObservedFacts } from './memory.ts'
import { buildTurnMessages, composeAssistantText } from './prompts.ts'

export const MAX_TURN_CHARS = 20_000

/* ------------------------------------------------------------------ inputs */

export interface SubmitTurnInput {
  userId: string
  text: string
  channel: ConversationChannel
  /** Continue an existing conversation. Ownership-checked. */
  conversationId?: string | null
  /** Continue the active conversation on a project. Ownership-checked. */
  projectId?: string | null
  /** Title for a newly created project. Derived from the text when absent. */
  projectTitle?: string | null
  /**
   * Caller-supplied retry key. The web UI reuses one key while a submit is
   * being retried; Telegram uses the update id. Without a key every call is a
   * new turn, which is what a repeated identical message should do.
   */
  idempotencyKey?: string | null
  /** Injectable for tests. Production reads the server environment. */
  modelConfig?: ModelConfig
}

/* ---------------------------------------------------------------- outcomes */

export interface TurnSuccess {
  ok: true
  kind: 'model_turn'
  conversationId: string
  projectId: string | null
  userMessageId: string | null
  assistantMessage: Message
  turn: TurnResult
  nextAction: NextAction | null
  provider: string
  model: string
  latencyMs: number
  runId: string
  /** True when this was a replay of an already-completed run. */
  deduplicated: boolean
}

export interface DirectiveSuccess {
  ok: true
  kind: 'directive'
  directive: Exclude<Directive, null>
  conversationId: string | null
  projectId: string | null
  /** Ready-to-display reply. Identical text on web and Telegram. */
  text: string
  card: ReentryCard | null
}

export interface ModelTurnFailure {
  ok: false
  kind: 'model_failure'
  conversationId: string | null
  projectId: string | null
  /** The user's message was stored before the call, so nothing is lost. */
  userMessageId: string | null
  failure: ModelFailure
  preservedInput: string
  runId: string | null
}

export interface InvalidTurn {
  ok: false
  kind: 'invalid_input' | 'not_found'
  message: string
}

export type SubmitTurnResult = TurnSuccess | DirectiveSuccess | ModelTurnFailure | InvalidTurn

/* ------------------------------------------------------------- entry point */

export async function submitTurn(db: Db, input: SubmitTurnInput): Promise<SubmitTurnResult> {
  const text = (input.text ?? '').trim()
  if (!text) {
    return { ok: false, kind: 'invalid_input', message: 'Nothing to send yet.' }
  }
  if (text.length > MAX_TURN_CHARS) {
    return {
      ok: false,
      kind: 'invalid_input',
      message: `That is ${text.length} characters. The limit for one message is ${MAX_TURN_CHARS}. Split it and send the first part.`,
    }
  }

  // Directives are resolved before any project is created, so typing
  // "where was I?" as a first message cannot spawn an empty project.
  const directive = detectDirective(text)
  if (directive) return handleDirective(db, input, text, directive)

  const resolved = resolveTarget(db, input)
  // Truthiness, not `'error' in resolved`: the success branch declares
  // `error?: undefined`, so an `in` check narrows to `SubmitTurnResult | undefined`.
  if (resolved.error) return resolved.error

  const { conversation, project } = resolved
  const userId = input.userId
  const channel = input.channel
  const config = input.modelConfig ?? readModelConfig()
  const runKey = buildRunKey(userId, text, input.idempotencyKey, conversation.id)

  // A previously succeeded run is replayed, never re-executed.
  const prior = repo.getModelRunByKey(db, userId, runKey)
  if (prior && prior.status === 'succeeded' && prior.responseText) {
    return replayTurn(db, userId, runKey, prior, conversation, project, channel)
  }

  const { message: userMessage } = repo.appendMessage(db, {
    userId,
    conversationId: conversation.id,
    role: 'user',
    content: text,
    source: channel,
    idempotencyKey: `${runKey}:user`,
  })

  // Context is built with the new message excluded, because buildTurnMessages
  // appends it separately and a retry must not duplicate it in the prompt.
  const ctx = promptContextForConversation(db, userId, conversation.id)
  ctx.history = ctx.history.filter((m) => m.id !== userMessage.id)
  const messages = buildTurnMessages(ctx, text)

  const run = prior
    ? (repo.resetModelRun(db, prior.id), prior)
    : repo.createModelRun(db, {
        userId,
        conversationId: conversation.id,
        idempotencyKey: runKey,
        purpose: 'brain_dump_turn',
        provider: config.provider,
        model: config.modelId || null,
        endpoint: config.baseUrl || null,
      })

  const outcome = await callModel(messages, config)

  if (!outcome.ok) {
    repo.failModelRun(db, run.id, { errorCode: outcome.code, errorMessage: outcome.message })
    repo.audit(db, {
      userId,
      action: 'model_failure',
      detail: JSON.stringify({ runId: run.id, code: outcome.code, status: outcome.status ?? null }),
    })
    return {
      ok: false,
      kind: 'model_failure',
      conversationId: conversation.id,
      projectId: project?.id ?? null,
      userMessageId: userMessage.id,
      failure: outcome,
      preservedInput: text,
      runId: run.id,
    }
  }

  const turn = parseTurnResponse(outcome.text)
  if (!turn) {
    const failure: ModelFailure = {
      ok: false,
      code: 'model_invalid_response',
      message: `The model answered but not in the required format, so no advice was stored. Start of its reply: ${outcome.text.slice(0, 160)}`,
      provider: outcome.provider,
      model: outcome.modelId,
      retryable: true,
    }
    repo.failModelRun(db, run.id, {
      errorCode: failure.code,
      errorMessage: failure.message,
      latencyMs: outcome.latencyMs,
    })
    return {
      ok: false,
      kind: 'model_failure',
      conversationId: conversation.id,
      projectId: project?.id ?? null,
      userMessageId: userMessage.id,
      failure,
      preservedInput: text,
      runId: run.id,
    }
  }

  // Record the successful completion before writing derived rows, so a crash
  // mid-write leaves a replayable run rather than a lost model answer.
  repo.completeModelRun(db, run.id, {
    responseText: outcome.text,
    latencyMs: outcome.latencyMs,
    provider: outcome.provider,
    model: outcome.modelId,
  })

  const persisted = persistTurn(db, {
    userId,
    runKey,
    conversation,
    project,
    turn,
    channel,
    userMessageId: userMessage.id,
    provider: outcome.provider,
    model: outcome.modelId,
    latencyMs: outcome.latencyMs,
    runId: run.id,
    deduplicated: false,
  })
  return persisted
}

/* ------------------------------------------------------------ persistence */

interface PersistArgs {
  userId: string
  runKey: string
  conversation: Conversation
  project: Project | null
  turn: TurnResult
  channel: ConversationChannel
  userMessageId: string | null
  provider: string
  model: string
  latencyMs: number
  runId: string
  deduplicated: boolean
}

/**
 * Write the derived rows for a validated turn. Every write is idempotent under
 * `runKey`, so calling this twice for the same run produces one assistant
 * message, one next action and no duplicated facts.
 */
function persistTurn(db: Db, args: PersistArgs): TurnSuccess {
  const { userId, runKey, conversation, project, turn, channel } = args
  const projectId = project?.id ?? conversation.projectId

  const assistantText = composeAssistantText(turn)
  const { message: assistantMessage } = repo.appendMessage(db, {
    userId,
    conversationId: conversation.id,
    role: 'assistant',
    content: assistantText,
    source: channel === 'telegram' ? 'telegram' : 'core',
    idempotencyKey: `${runKey}:assistant`,
  })

  let nextAction: NextAction | null = null
  if (turn.nextAction) {
    nextAction = repo.proposeNextAction(db, {
      userId,
      projectId,
      conversationId: conversation.id,
      title: turn.nextAction.title,
      detail: turn.nextAction.detail,
      idempotencyKey: `${runKey}:action`,
    }).action
  }

  if (turn.observedFacts.length > 0) {
    recordObservedFacts(db, {
      userId,
      projectId,
      contents: turn.observedFacts,
      source: `brain_dump:${channel}`,
      sourceRef: args.userMessageId ?? assistantMessage.id,
    })
  }

  if (projectId) {
    if (project && !project.summary) {
      repo.updateProjectSummary(db, userId, projectId, turn.interpretation.slice(0, 400))
    }
    repo.touchProject(db, userId, projectId)
  }

  return {
    ok: true,
    kind: 'model_turn',
    conversationId: conversation.id,
    projectId,
    userMessageId: args.userMessageId,
    assistantMessage,
    turn,
    nextAction,
    provider: args.provider,
    model: args.model,
    latencyMs: args.latencyMs,
    runId: args.runId,
    deduplicated: args.deduplicated,
  }
}

/** Re-apply a stored, already-successful run without calling the model. */
function replayTurn(
  db: Db,
  userId: string,
  runKey: string,
  run: { id: string; responseText: string | null; provider: string | null; model: string | null; latencyMs: number | null },
  conversation: Conversation,
  project: Project | null,
  channel: ConversationChannel
): SubmitTurnResult {
  const turn = parseTurnResponse(run.responseText ?? '')
  if (!turn) {
    return {
      ok: false,
      kind: 'model_failure',
      conversationId: conversation.id,
      projectId: project?.id ?? null,
      userMessageId: null,
      failure: {
        ok: false,
        code: 'model_invalid_response',
        message: 'A stored response for this request could not be parsed. Send the message again to get a fresh answer.',
        provider: run.provider ?? undefined,
        model: run.model ?? undefined,
        retryable: true,
      },
      preservedInput: '',
      runId: run.id,
    }
  }
  const userMessage = repo.getMessageByKey(db, userId, `${runKey}:user`)
  return persistTurn(db, {
    userId,
    runKey,
    conversation,
    project,
    turn,
    channel,
    userMessageId: userMessage?.id ?? null,
    provider: run.provider ?? 'unknown',
    model: run.model ?? 'unknown',
    latencyMs: run.latencyMs ?? 0,
    runId: run.id,
    deduplicated: true,
  })
}

/* -------------------------------------------------------------- targeting */

type ResolvedTarget =
  | { conversation: Conversation; project: Project | null; error?: undefined }
  | { error: SubmitTurnResult; conversation?: undefined; project?: undefined }

/**
 * Decide which conversation this turn belongs to, creating a project and
 * conversation only for a genuine new brain dump.
 */
function resolveTarget(db: Db, input: SubmitTurnInput): ResolvedTarget {
  const userId = input.userId

  if (input.conversationId) {
    const conversation = repo.getConversation(db, userId, input.conversationId)
    if (!conversation) {
      return { error: notFound('conversation') }
    }
    let project = conversation.projectId ? repo.getProject(db, userId, conversation.projectId) : null
    // Attaching a project to a project-less conversation is allowed, but only
    // to one the caller owns.
    if (!conversation.projectId && input.projectId) {
      const target = repo.getProject(db, userId, input.projectId)
      if (!target) return { error: notFound('project') }
      repo.setConversationProject(db, userId, conversation.id, target.id)
      project = target
    }
    return { conversation, project }
  }

  if (input.projectId) {
    const project = repo.getProject(db, userId, input.projectId)
    if (!project) return { error: notFound('project') }
    const conversation =
      repo.activeConversationForProject(db, userId, project.id) ??
      repo.createConversation(db, {
        userId,
        projectId: project.id,
        channel: input.channel,
        title: project.title,
      })
    return { conversation, project }
  }

  // No ids: this is a new brain dump. Create the project and its conversation.
  const title = (input.projectTitle ?? '').trim() || deriveProjectTitle(input.text)
  const project = repo.createProject(db, { userId, title })
  const conversation = repo.createConversation(db, {
    userId,
    projectId: project.id,
    channel: input.channel,
    title,
  })
  repo.audit(db, { userId, action: 'brain_dump_started', detail: JSON.stringify({ projectId: project.id }) })
  return { conversation, project }
}

function notFound(what: string): InvalidTurn {
  return {
    ok: false,
    kind: 'not_found',
    message: `That ${what} does not exist on your account.`,
  }
}

function buildRunKey(
  userId: string,
  text: string,
  supplied: string | null | undefined,
  conversationId: string
): string {
  const base = supplied?.trim()
  if (base) return `turn:${userId}:${base}`.slice(0, 190)
  const digest = createHash('sha256').update(`${conversationId}\n${text}`).digest('hex').slice(0, 16)
  return `turn:${userId}:${conversationId}:${digest}:${randomUUID()}`
}

export function deriveProjectTitle(text: string): string {
  const firstLine =
    text
      .split(/\r?\n/)
      .map((l) => l.trim())
      .find((l) => l.length > 0) ?? ''
  const cleaned = firstLine.replace(/^[-*#\s]+/, '').replace(/^\d+[.)]\s*/, '').trim()
  const base = (cleaned || text.replace(/\s+/g, ' ').trim()).replace(/\s+/g, ' ').trim()
  if (!base) return 'Untitled brain dump'
  return base.length <= 60 ? base : `${base.slice(0, 57).trimEnd()}…`
}

/* -------------------------------------------------------------- directives */

const UNLINK_REPLY =
  'Telegram linking is managed from your Creator OS account. Open Settings → Telegram there to connect or disconnect.'

function handleDirective(
  db: Db,
  input: SubmitTurnInput,
  text: string,
  directive: Exclude<Directive, null>
): SubmitTurnResult {
  const userId = input.userId

  if (directive === 'unlink_telegram') {
    return {
      ok: true,
      kind: 'directive',
      directive,
      conversationId: null,
      projectId: null,
      text: UNLINK_REPLY,
      card: null,
    }
  }

  // Find the conversation this directive refers to without creating anything.
  let conversation: Conversation | null = null
  if (input.conversationId) {
    conversation = repo.getConversation(db, userId, input.conversationId)
    if (!conversation) return notFound('conversation')
  } else if (input.projectId) {
    const project = repo.getProject(db, userId, input.projectId)
    if (!project) return notFound('project')
    conversation = repo.activeConversationForProject(db, userId, project.id)
  } else {
    const resumeId = findResumeTarget(db, userId)
    conversation = resumeId ? repo.getConversation(db, userId, resumeId) : null
  }

  if (!conversation) {
    return {
      ok: true,
      kind: 'directive',
      directive,
      conversationId: null,
      projectId: null,
      text:
        directive === 'where_was_i'
          ? 'You have not started a brain dump yet, so there is nothing to resume. Paste what is on your mind and I will pick it apart with you.'
          : 'Nothing is open to save yet. Start a brain dump first.',
      card: null,
    }
  }

  const project = conversation.projectId ? repo.getProject(db, userId, conversation.projectId) : null
  const runKey = buildRunKey(userId, text, input.idempotencyKey, conversation.id)

  let reply: string
  let card: ReentryCard | null = null

  switch (directive) {
    case 'save_for_later': {
      repo.setConversationStatus(db, userId, conversation.id, 'saved_for_later')
      repo.audit(db, {
        userId,
        action: 'saved_for_later',
        detail: JSON.stringify({ conversationId: conversation.id }),
      })
      reply =
        'Saved for later. Your brain dump, the interpretation and your one next action are all stored.\n\nWhen you are ready, say "where was I?" here or in Telegram and you will land back on exactly this point.'
      break
    }
    case 'where_was_i': {
      card = buildReentryCard(db, userId, conversation.id)
      reply = card ? renderReentryCard(card) : 'This conversation has nothing recorded yet.'
      break
    }
    case 'list_projects': {
      const projects = repo.listProjects(db, userId)
      reply =
        projects.length === 0
          ? 'No projects yet. Start a brain dump and one will be created.'
          : ['Your projects:', ...projects.slice(0, 8).map((p, i) => `${i + 1}. ${p.title}`)].join('\n')
      break
    }
    case 'help': {
      reply = [
        'Creator OS pilot — what you can do here:',
        '• Paste a brain dump. You get a short interpretation, at most one question, and one next action.',
        '• Reply to keep the same conversation going.',
        '• "save for later" parks this conversation.',
        '• "where was I?" brings you back to the exact point you left.',
        '• Etsy listings and inventory are out of scope for this pilot.',
        '• Social publishing is a later milestone — nothing gets posted from here.',
      ].join('\n')
      break
    }
    default:
      reply = 'Not sure what to do with that.'
  }

  repo.appendMessage(db, {
    userId,
    conversationId: conversation.id,
    role: 'user',
    content: text,
    source: input.channel,
    idempotencyKey: `${runKey}:user`,
  })
  repo.appendMessage(db, {
    userId,
    conversationId: conversation.id,
    role: 'assistant',
    content: reply,
    source: 'directive',
    idempotencyKey: `${runKey}:assistant`,
  })

  return {
    ok: true,
    kind: 'directive',
    directive,
    conversationId: conversation.id,
    projectId: project?.id ?? null,
    text: reply,
    card,
  }
}

/* ------------------------------------------------------- surface wrappers */

/**
 * MCP tool `capture_brain_dump` and the web "Generate" button both land here.
 * Always starts a new project unless one is explicitly named.
 */
export function captureBrainDump(
  db: Db,
  input: {
    userId: string
    text: string
    projectTitle?: string | null
    projectId?: string | null
    channel?: ConversationChannel
    idempotencyKey?: string | null
    modelConfig?: ModelConfig
  }
): Promise<SubmitTurnResult> {
  return submitTurn(db, {
    userId: input.userId,
    text: input.text,
    channel: input.channel ?? 'mcp',
    projectId: input.projectId ?? null,
    conversationId: null,
    projectTitle: input.projectTitle ?? null,
    idempotencyKey: input.idempotencyKey ?? null,
    modelConfig: input.modelConfig,
  })
}

/** MCP tool `append_conversation_message` and the web follow-up box. */
export function appendConversationMessage(
  db: Db,
  input: {
    userId: string
    conversationId: string
    text: string
    channel?: ConversationChannel
    idempotencyKey?: string | null
    modelConfig?: ModelConfig
  }
): Promise<SubmitTurnResult> {
  return submitTurn(db, {
    userId: input.userId,
    text: input.text,
    channel: input.channel ?? 'mcp',
    conversationId: input.conversationId,
    idempotencyKey: input.idempotencyKey ?? null,
    modelConfig: input.modelConfig,
  })
}

/**
 * MCP tool `propose_next_action`. Ownership-checked, and idempotent under the
 * caller's key so a retried request cannot produce two actions.
 */
export function proposeNextActionTool(
  db: Db,
  input: {
    userId: string
    title: string
    detail?: string | null
    conversationId?: string | null
    projectId?: string | null
    idempotencyKey?: string | null
  }
): { ok: true; action: NextAction; deduplicated: boolean } | InvalidTurn {
  const title = (input.title ?? '').trim()
  if (!title) return { ok: false, kind: 'invalid_input', message: 'A next action needs a title.' }

  let conversationId = input.conversationId ?? null
  let projectId = input.projectId ?? null

  if (conversationId) {
    const conversation = repo.getConversation(db, input.userId, conversationId)
    if (!conversation) return notFound('conversation')
    projectId = projectId ?? conversation.projectId
  }
  if (projectId) {
    const project = repo.getProject(db, input.userId, projectId)
    if (!project) return notFound('project')
    projectId = project.id
    if (!conversationId) {
      conversationId = repo.activeConversationForProject(db, input.userId, projectId)?.id ?? null
    }
  }
  if (!conversationId && !projectId) {
    return {
      ok: false,
      kind: 'invalid_input',
      message: 'Give a conversationId or a projectId so the action is attached to something you own.',
    }
  }

  const { action, deduplicated } = repo.proposeNextAction(db, {
    userId: input.userId,
    projectId,
    conversationId,
    title,
    detail: input.detail?.trim() ? input.detail.trim() : null,
    idempotencyKey: input.idempotencyKey ?? null,
  })
  if (projectId) repo.touchProject(db, input.userId, projectId)
  return { ok: true, action, deduplicated }
}

/** MCP tool `get_reentry_card`. */
export function getReentryCardTool(
  db: Db,
  input: { userId: string; conversationId?: string | null }
): { ok: true; card: ReentryCard; rendered: string } | InvalidTurn {
  const conversationId = input.conversationId?.trim() || findResumeTarget(db, input.userId)
  if (!conversationId) {
    return { ok: false, kind: 'not_found', message: 'No conversation to resume yet.' }
  }
  const card = buildReentryCard(db, input.userId, conversationId)
  if (!card) return notFound('conversation')
  return { ok: true, card, rendered: renderReentryCard(card) }
}

/** Park a conversation. Reversible through `reopenConversation`. */
export function saveForLater(
  db: Db,
  input: { userId: string; conversationId: string }
): { ok: boolean } | InvalidTurn {
  const done = repo.setConversationStatus(db, input.userId, input.conversationId, 'saved_for_later')
  if (!done) return notFound('conversation')
  repo.audit(db, {
    userId: input.userId,
    action: 'saved_for_later',
    detail: JSON.stringify({ conversationId: input.conversationId }),
  })
  return { ok: true }
}

export function reopenConversation(
  db: Db,
  input: { userId: string; conversationId: string }
): { ok: boolean } | InvalidTurn {
  const done = repo.setConversationStatus(db, input.userId, input.conversationId, 'active')
  if (!done) return notFound('conversation')
  return { ok: true }
}

/** Attach a conversation to one of the user's projects (Telegram disambiguation). */
export function attachProject(
  db: Db,
  input: { userId: string; conversationId: string; projectId: string }
): { ok: boolean } | InvalidTurn {
  const conversation = repo.getConversation(db, input.userId, input.conversationId)
  if (!conversation) return notFound('conversation')
  const project = repo.getProject(db, input.userId, input.projectId)
  if (!project) return notFound('project')
  const done = repo.setConversationProject(db, input.userId, conversation.id, project.id)
  if (!done) return notFound('conversation')
  return { ok: true }
}

export function markActionStatus(
  db: Db,
  input: { userId: string; actionId: string; status: 'accepted' | 'done' | 'discarded' }
): { ok: boolean } | InvalidTurn {
  const done = repo.setActionStatus(db, input.userId, input.actionId, input.status)
  if (!done) return notFound('next action')
  return { ok: true }
}

export { detectDirective, buildReentryCard, renderReentryCard }
