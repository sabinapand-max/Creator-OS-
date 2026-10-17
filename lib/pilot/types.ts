/**
 * Shared domain types for the Indigos pilot.
 *
 * These types are the contract between the three surfaces that must behave
 * identically: the web UI (Next.js route handlers), the MCP tools consumed by
 * the agent, and the Telegram handler. Nothing surface-specific belongs here.
 */

export type ConversationChannel = 'web' | 'telegram' | 'mcp'
export type ConversationStatus = 'active' | 'saved_for_later' | 'closed'
export type MessageRole = 'user' | 'assistant' | 'system' | 'tool'
export type NextActionStatus = 'proposed' | 'accepted' | 'done' | 'discarded'
export type FactConfidence = 'stated' | 'inferred'

export interface User {
  id: string
  email: string
  displayName: string
  createdAt: string
}

export interface Project {
  id: string
  userId: string
  title: string
  summary: string | null
  status: string
  createdAt: string
  updatedAt: string
}

export interface Conversation {
  id: string
  userId: string
  projectId: string | null
  channel: ConversationChannel
  status: ConversationStatus
  title: string | null
  createdAt: string
  updatedAt: string
  lastMessageAt: string | null
}

export interface Message {
  id: string
  conversationId: string
  userId: string
  role: MessageRole
  content: string
  source: string
  createdAt: string
  idempotencyKey: string | null
}

export interface NextAction {
  id: string
  userId: string
  projectId: string | null
  conversationId: string | null
  title: string
  detail: string | null
  status: NextActionStatus
  createdAt: string
  completedAt: string | null
}

export interface Fact {
  id: string
  userId: string
  projectId: string | null
  content: string
  /** Where this fact came from, e.g. 'brain_dump', 'telegram', 'user_correction'. */
  source: string
  /** Id of the originating record, so provenance is traceable. */
  sourceRef: string | null
  confidence: FactConfidence
  createdAt: string
  updatedAt: string
  correctedFrom: string | null
}

export interface TelegramLink {
  id: string
  userId: string
  telegramChatId: string
  telegramUserId: string | null
  telegramUsername: string | null
  linkedAt: string
  unlinkedAt: string | null
  activeProjectId: string | null
}

/**
 * The shape the configured model must return for a brain-dump turn.
 * Validated before anything is persisted; an invalid response is reported as an
 * error rather than quietly replaced with template content.
 */
export interface TurnResult {
  /** Concise reading of what the user actually said. A few sentences at most. */
  interpretation: string
  /** At most one question, and only when the answer genuinely changes the next step. */
  question: string | null
  /** One useful next action. Not a list. */
  nextAction: { title: string; detail: string | null } | null
  /** Durable statements worth remembering, each traceable to this turn. */
  observedFacts: string[]
}

/** Why a model call could not produce a result. Surfaced verbatim to the user. */
export type ModelFailureCode =
  | 'model_not_configured'
  | 'model_unreachable'
  | 'model_timeout'
  | 'model_http_error'
  | 'model_invalid_response'
  | 'model_endpoint_unsafe'

export interface ModelFailure {
  ok: false
  code: ModelFailureCode
  message: string
  /** Provider/model that was attempted, when known. Never includes credentials. */
  provider?: string
  model?: string
  status?: number
  retryable: boolean
}

export interface ModelSuccess {
  ok: true
  turn: TurnResult
  provider: string
  model: string
  latencyMs: number
  runId: string
}

export type ModelOutcome = ModelSuccess | ModelFailure

/**
 * A "where was I?" re-entry card: the minimum needed to resume without
 * re-reading the whole conversation.
 */
export interface ReentryCard {
  projectName: string | null
  conversationId: string
  lastActivityAt: string | null
  lastUserMessage: string | null
  lastAssistantMessage: string | null
  openQuestion: string | null
  nextAction: NextAction | null
  savedForLater: boolean
  recentFacts: Fact[]
}

export interface ProjectContext {
  project: Project
  activeConversation: Conversation | null
  openNextActions: NextAction[]
  facts: Fact[]
  recentMessages: Message[]
}

/* ------------------------------------------------------- content drafts */

/**
 * Drafts are generated output the user asked for and can delete. They are never
 * published by the pilot and never sent anywhere: `channel` records where the
 * text is meant to go, nothing more.
 */
export type DraftKind = 'social' | 'offer'

/**
 * Where a draft is aimed. 'etsy' is deliberately absent: Etsy listings and
 * product inventory are out of scope for this pilot, and the marketplace screen
 * says so instead of generating them.
 */
export type DraftChannel =
  | 'linkedin'
  | 'instagram'
  | 'tiktok'
  | 'pinterest'
  | 'twitter'
  | 'gumroad'
  | 'fiverr'

export const SOCIAL_CHANNELS: DraftChannel[] = [
  'linkedin',
  'instagram',
  'tiktok',
  'pinterest',
  'twitter',
]
export const OFFER_CHANNELS: DraftChannel[] = ['gumroad', 'fiverr']

/** Channel-shaped extras. Only the fields relevant to `channel` are filled in. */
export interface DraftPayload {
  hook?: string | null
  hashtags?: string[]
  pricing?: string | null
  features?: string[]
  audience?: string | null
  packages?: { name: string; price: string; features: string[] }[]
  /** Anything the model wanted to flag, e.g. that it lacked a detail. */
  note?: string | null
}

export interface ContentDraft {
  id: string
  userId: string
  projectId: string | null
  kind: DraftKind
  channel: DraftChannel
  title: string | null
  body: string
  payload: DraftPayload
  /** Provenance, e.g. 'drafts:web'. */
  source: string
  /** The model that produced it, so a draft is never mistaken for a template. */
  model: string | null
  status: string
  createdAt: string
  deletedAt: string | null
}

/* ------------------------------------------------------- cognitive state */

/**
 * The ND cognitive engine, shared between the server module (lib/pilot/cognitive) and the
 * client store. Pure types only, so nothing server-side leaks into the browser bundle.
 * Rule-based and local — it never calls the model.
 */
export type CognitiveStateName =
  | 'flow'
  | 'focused'
  | 'scattered'
  | 'overwhelmed'
  | 'recovering'
  | 'dormant'
  | 'hyperfocus'
  | 'dissociated'

export type CognitiveEnergy = 'high' | 'medium' | 'low' | 'depleted'
export type CognitiveSensory = 'calm' | 'moderate' | 'elevated' | 'overload'

export interface CognitiveHistoryEntry {
  from: CognitiveStateName
  to: CognitiveStateName
  timestamp: string
  energy: CognitiveEnergy
  sensory: CognitiveSensory
}

/** The persisted, full engine state (what lives in the cognitive_state table). */
export interface CognitiveState {
  current: CognitiveStateName
  energy: CognitiveEnergy
  sensory: CognitiveSensory
  lastTransition: string | null
  history: CognitiveHistoryEntry[]
}

/** A ready-to-display, strengths-first capacity summary derived from the state. */
export interface CognitiveSnapshot {
  current: CognitiveStateName
  energy: CognitiveEnergy
  sensory: CognitiveSensory
  /** Human label, e.g. "Overwhelmed". */
  label: string
  /** Information-not-failure framing of today's capacity. */
  capacityNote: string
  /** The one next step, sized to that capacity. */
  microStep: string
}

/**
 * The full read for the Mind screen: today's snapshot plus the movement that produced it.
 * `history` is the bounded transition list the state machine persists; `patternNote` is at
 * most one gentle, strengths-first observation; `burnoutRisk` lets the UI soften its tone
 * when someone has been running on empty. All still rule-based and local.
 */
export interface CognitiveMap extends CognitiveSnapshot {
  history: CognitiveHistoryEntry[]
  patternNote: string | null
  burnoutRisk: 'low' | 'medium' | 'high'
}
