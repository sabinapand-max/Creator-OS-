/**
 * Data access for the pilot store.
 *
 * ISOLATION CONTRACT
 * ------------------
 * Every function that reads or writes user content takes `userId` and filters on
 * it. Lookups by record id always add `AND user_id = ?`, so supplying someone
 * else's record id returns nothing rather than their data. No function in this
 * file accepts a caller-asserted owner: the owner always comes from a verified
 * credential resolved upstream (web session, MCP bearer token, or a stored
 * Telegram link).
 */
import { randomUUID } from 'node:crypto'
import type { Db } from './client.ts'
import type {
  ContentDraft,
  Conversation,
  ConversationChannel,
  ConversationStatus,
  DraftChannel,
  DraftKind,
  DraftPayload,
  Fact,
  FactConfidence,
  Message,
  MessageRole,
  NextAction,
  NextActionStatus,
  Project,
  TelegramLink,
  User,
} from '../types.ts'

export function nowIso(): string {
  return new Date().toISOString()
}

/* ------------------------------------------------------------------ users */

export interface UserRecord extends User {
  passwordHash: string
}

export function createUser(
  db: Db,
  input: { email: string; displayName: string; passwordHash: string }
): UserRecord {
  const id = randomUUID()
  const createdAt = nowIso()
  db.prepare(
    `INSERT INTO users (id, email, display_name, password_hash, created_at)
     VALUES (?, ?, ?, ?, ?)`
  ).run(id, input.email.toLowerCase(), input.displayName, input.passwordHash, createdAt)
  return {
    id,
    email: input.email.toLowerCase(),
    displayName: input.displayName,
    passwordHash: input.passwordHash,
    createdAt,
  }
}

function mapUser(row: any): UserRecord {
  return {
    id: row.id,
    email: row.email,
    displayName: row.display_name,
    passwordHash: row.password_hash,
    createdAt: row.created_at,
  }
}

export function getUserByEmail(db: Db, email: string): UserRecord | null {
  const row = db
    .prepare('SELECT * FROM users WHERE email = ?')
    .get(email.toLowerCase()) as any
  return row ? mapUser(row) : null
}

export function getUserById(db: Db, userId: string): UserRecord | null {
  const row = db.prepare('SELECT * FROM users WHERE id = ?').get(userId) as any
  return row ? mapUser(row) : null
}

export function toPublicUser(u: UserRecord): User {
  return { id: u.id, email: u.email, displayName: u.displayName, createdAt: u.createdAt }
}

/* --------------------------------------------------------------- sessions */

export function createSession(
  db: Db,
  userId: string,
  ttlMs: number
): { id: string; expiresAt: string } {
  const id = randomUUID()
  const expiresAt = new Date(Date.now() + ttlMs).toISOString()
  db.prepare(
    `INSERT INTO sessions (id, user_id, created_at, expires_at)
     VALUES (?, ?, ?, ?)`
  ).run(id, userId, nowIso(), expiresAt)
  return { id, expiresAt }
}

/** Returns the owning user id only for a session that exists, is unrevoked and unexpired. */
export function resolveSession(db: Db, sessionId: string): string | null {
  const row = db
    .prepare(
      `SELECT user_id, expires_at, revoked_at FROM sessions WHERE id = ?`
    )
    .get(sessionId) as any
  if (!row || row.revoked_at) return null
  if (new Date(row.expires_at).getTime() <= Date.now()) return null
  return row.user_id as string
}

export function revokeSession(db: Db, sessionId: string): void {
  db.prepare('UPDATE sessions SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL').run(
    nowIso(),
    sessionId
  )
}

/* ------------------------------------------------------------ mcp tokens */

export function insertMcpToken(
  db: Db,
  input: { userId: string; tokenHash: string; label: string; expiresAt: string | null }
): string {
  const id = randomUUID()
  db.prepare(
    `INSERT INTO mcp_tokens (id, user_id, token_hash, label, created_at, expires_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(id, input.userId, input.tokenHash, input.label, nowIso(), input.expiresAt)
  return id
}

/** Resolve an MCP bearer token to the user it belongs to. */
export function resolveMcpToken(
  db: Db,
  tokenHash: string
): { userId: string; tokenId: string } | null {
  const row = db
    .prepare(
      `SELECT id, user_id, expires_at, revoked_at FROM mcp_tokens WHERE token_hash = ?`
    )
    .get(tokenHash) as any
  if (!row || row.revoked_at) return null
  if (row.expires_at && new Date(row.expires_at).getTime() <= Date.now()) return null
  db.prepare('UPDATE mcp_tokens SET last_used_at = ? WHERE id = ?').run(nowIso(), row.id)
  return { userId: row.user_id, tokenId: row.id }
}

export function revokeMcpToken(db: Db, userId: string, tokenId: string): boolean {
  const res = db
    .prepare(
      `UPDATE mcp_tokens SET revoked_at = ? WHERE id = ? AND user_id = ? AND revoked_at IS NULL`
    )
    .run(nowIso(), tokenId, userId)
  return Number(res.changes) > 0
}

export function listMcpTokens(db: Db, userId: string) {
  const rows = db
    .prepare(
      `SELECT id, label, created_at, expires_at, revoked_at, last_used_at
       FROM mcp_tokens WHERE user_id = ? ORDER BY created_at DESC`
    )
    .all(userId) as any[]
  return rows.map((r) => ({
    id: r.id,
    label: r.label,
    createdAt: r.created_at,
    expiresAt: r.expires_at,
    revokedAt: r.revoked_at,
    lastUsedAt: r.last_used_at,
  }))
}

/* --------------------------------------------------------------- projects */

function mapProject(row: any): Project {
  return {
    id: row.id,
    userId: row.user_id,
    title: row.title,
    summary: row.summary,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

export function createProject(
  db: Db,
  input: { userId: string; title: string; summary?: string | null }
): Project {
  const id = randomUUID()
  const ts = nowIso()
  db.prepare(
    `INSERT INTO projects (id, user_id, title, summary, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'active', ?, ?)`
  ).run(id, input.userId, input.title, input.summary ?? null, ts, ts)
  return {
    id,
    userId: input.userId,
    title: input.title,
    summary: input.summary ?? null,
    status: 'active',
    createdAt: ts,
    updatedAt: ts,
  }
}

/** Ownership-checked project lookup. Returns null for another user's id. */
export function getProject(db: Db, userId: string, projectId: string): Project | null {
  const row = db
    .prepare('SELECT * FROM projects WHERE id = ? AND user_id = ?')
    .get(projectId, userId) as any
  return row ? mapProject(row) : null
}

export function listProjects(db: Db, userId: string): Project[] {
  const rows = db
    .prepare('SELECT * FROM projects WHERE user_id = ? ORDER BY updated_at DESC')
    .all(userId) as any[]
  return rows.map(mapProject)
}

export function touchProject(db: Db, userId: string, projectId: string): void {
  db.prepare(
    'UPDATE projects SET updated_at = ? WHERE id = ? AND user_id = ?'
  ).run(nowIso(), projectId, userId)
}

export function updateProjectSummary(
  db: Db,
  userId: string,
  projectId: string,
  summary: string
): boolean {
  const res = db
    .prepare(
      'UPDATE projects SET summary = ?, updated_at = ? WHERE id = ? AND user_id = ?'
    )
    .run(summary, nowIso(), projectId, userId)
  return Number(res.changes) > 0
}

/* ---------------------------------------------------------- conversations */

function mapConversation(row: any): Conversation {
  return {
    id: row.id,
    userId: row.user_id,
    projectId: row.project_id,
    channel: row.channel,
    status: row.status,
    title: row.title,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastMessageAt: row.last_message_at,
  }
}

export function createConversation(
  db: Db,
  input: {
    userId: string
    projectId?: string | null
    channel: ConversationChannel
    title?: string | null
  }
): Conversation {
  const id = randomUUID()
  const ts = nowIso()
  db.prepare(
    `INSERT INTO conversations (id, user_id, project_id, channel, status, title, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'active', ?, ?, ?)`
  ).run(id, input.userId, input.projectId ?? null, input.channel, input.title ?? null, ts, ts)
  return {
    id,
    userId: input.userId,
    projectId: input.projectId ?? null,
    channel: input.channel,
    status: 'active',
    title: input.title ?? null,
    createdAt: ts,
    updatedAt: ts,
    lastMessageAt: null,
  }
}

export function getConversation(
  db: Db,
  userId: string,
  conversationId: string
): Conversation | null {
  const row = db
    .prepare('SELECT * FROM conversations WHERE id = ? AND user_id = ?')
    .get(conversationId, userId) as any
  return row ? mapConversation(row) : null
}

export function listConversations(db: Db, userId: string, limit = 50): Conversation[] {
  const rows = db
    .prepare(
      'SELECT * FROM conversations WHERE user_id = ? ORDER BY updated_at DESC LIMIT ?'
    )
    .all(userId, limit) as any[]
  return rows.map(mapConversation)
}

export function listConversationsForProject(
  db: Db,
  userId: string,
  projectId: string
): Conversation[] {
  const rows = db
    .prepare(
      `SELECT * FROM conversations WHERE user_id = ? AND project_id = ?
       ORDER BY updated_at DESC`
    )
    .all(userId, projectId) as any[]
  return rows.map(mapConversation)
}

export function setConversationStatus(
  db: Db,
  userId: string,
  conversationId: string,
  status: ConversationStatus
): boolean {
  const res = db
    .prepare(
      'UPDATE conversations SET status = ?, updated_at = ? WHERE id = ? AND user_id = ?'
    )
    .run(status, nowIso(), conversationId, userId)
  return Number(res.changes) > 0
}

export function setConversationProject(
  db: Db,
  userId: string,
  conversationId: string,
  projectId: string
): boolean {
  const res = db
    .prepare(
      'UPDATE conversations SET project_id = ?, updated_at = ? WHERE id = ? AND user_id = ?'
    )
    .run(projectId, nowIso(), conversationId, userId)
  return Number(res.changes) > 0
}

export function latestConversation(db: Db, userId: string): Conversation | null {
  const row = db
    .prepare(
      `SELECT * FROM conversations WHERE user_id = ?
       ORDER BY COALESCE(last_message_at, updated_at) DESC LIMIT 1`
    )
    .get(userId) as any
  return row ? mapConversation(row) : null
}

export function activeConversationForProject(
  db: Db,
  userId: string,
  projectId: string
): Conversation | null {
  const row = db
    .prepare(
      `SELECT * FROM conversations
       WHERE user_id = ? AND project_id = ? AND status != 'closed'
       ORDER BY COALESCE(last_message_at, updated_at) DESC LIMIT 1`
    )
    .get(userId, projectId) as any
  return row ? mapConversation(row) : null
}

/* --------------------------------------------------------------- messages */

function mapMessage(row: any): Message {
  return {
    id: row.id,
    conversationId: row.conversation_id,
    userId: row.user_id,
    role: row.role,
    content: row.content,
    source: row.source,
    createdAt: row.created_at,
    idempotencyKey: row.idempotency_key,
  }
}

/**
 * Append a message. When `idempotencyKey` is supplied and a message with that
 * key already exists for this user, the existing row is returned instead of a
 * duplicate being written — this is what makes a retried request safe.
 */
export function appendMessage(
  db: Db,
  input: {
    userId: string
    conversationId: string
    role: MessageRole
    content: string
    source?: string
    idempotencyKey?: string | null
  }
): { message: Message; deduplicated: boolean } {
  if (input.idempotencyKey) {
    const existing = db
      .prepare(
        `SELECT * FROM messages WHERE user_id = ? AND idempotency_key = ?`
      )
      .get(input.userId, input.idempotencyKey) as any
    if (existing) return { message: mapMessage(existing), deduplicated: true }
  }

  // Ownership check on the conversation, so a message can never be appended to
  // someone else's conversation even with a valid-looking conversation id.
  const convo = getConversation(db, input.userId, input.conversationId)
  if (!convo) throw new Error('conversation_not_found')

  const id = randomUUID()
  const ts = nowIso()
  db.prepare(
    `INSERT INTO messages (id, conversation_id, user_id, role, content, source, created_at, idempotency_key)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    input.conversationId,
    input.userId,
    input.role,
    input.content,
    input.source ?? 'web',
    ts,
    input.idempotencyKey ?? null
  )
  db.prepare(
    `UPDATE conversations SET updated_at = ?, last_message_at = ? WHERE id = ? AND user_id = ?`
  ).run(ts, ts, convo.id, input.userId)
  if (convo.projectId) touchProject(db, input.userId, convo.projectId)

  return {
    message: {
      id,
      conversationId: input.conversationId,
      userId: input.userId,
      role: input.role,
      content: input.content,
      source: input.source ?? 'web',
      createdAt: ts,
      idempotencyKey: input.idempotencyKey ?? null,
    },
    deduplicated: false,
  }
}

export function listMessages(
  db: Db,
  userId: string,
  conversationId: string,
  limit = 200
): Message[] {
  const rows = db
    .prepare(
      `SELECT * FROM messages WHERE conversation_id = ? AND user_id = ?
       ORDER BY created_at ASC, rowid ASC LIMIT ?`
    )
    .all(conversationId, userId, limit) as any[]
  return rows.map(mapMessage)
}

export function lastMessageByRole(
  db: Db,
  userId: string,
  conversationId: string,
  role: MessageRole
): Message | null {
  const row = db
    .prepare(
      `SELECT * FROM messages WHERE conversation_id = ? AND user_id = ? AND role = ?
       ORDER BY created_at DESC, rowid DESC LIMIT 1`
    )
    .get(conversationId, userId, role) as any
  return row ? mapMessage(row) : null
}

/* ------------------------------------------------------------ next actions */

function mapAction(row: any): NextAction {
  return {
    id: row.id,
    userId: row.user_id,
    projectId: row.project_id,
    conversationId: row.conversation_id,
    title: row.title,
    detail: row.detail,
    status: row.status,
    createdAt: row.created_at,
    completedAt: row.completed_at,
  }
}

/**
 * Propose a next action. Idempotent on `(userId, idempotencyKey)`: a retried
 * request returns the existing action rather than creating a second one.
 */
export function proposeNextAction(
  db: Db,
  input: {
    userId: string
    projectId?: string | null
    conversationId?: string | null
    title: string
    detail?: string | null
    idempotencyKey?: string | null
  }
): { action: NextAction; deduplicated: boolean } {
  if (input.idempotencyKey) {
    const existing = db
      .prepare('SELECT * FROM next_actions WHERE user_id = ? AND idempotency_key = ?')
      .get(input.userId, input.idempotencyKey) as any
    if (existing) return { action: mapAction(existing), deduplicated: true }
  }

  const id = randomUUID()
  const ts = nowIso()
  db.prepare(
    `INSERT INTO next_actions (id, user_id, project_id, conversation_id, title, detail, status, created_at, idempotency_key)
     VALUES (?, ?, ?, ?, ?, ?, 'proposed', ?, ?)`
  ).run(
    id,
    input.userId,
    input.projectId ?? null,
    input.conversationId ?? null,
    input.title,
    input.detail ?? null,
    ts,
    input.idempotencyKey ?? null
  )
  return {
    action: {
      id,
      userId: input.userId,
      projectId: input.projectId ?? null,
      conversationId: input.conversationId ?? null,
      title: input.title,
      detail: input.detail ?? null,
      status: 'proposed',
      createdAt: ts,
      completedAt: null,
    },
    deduplicated: false,
  }
}

export function getAction(db: Db, userId: string, actionId: string): NextAction | null {
  const row = db
    .prepare('SELECT * FROM next_actions WHERE id = ? AND user_id = ?')
    .get(actionId, userId) as any
  return row ? mapAction(row) : null
}

export function listOpenActions(
  db: Db,
  userId: string,
  projectId?: string | null,
  limit = 20
): NextAction[] {
  const rows = projectId
    ? (db
        .prepare(
          `SELECT * FROM next_actions
           WHERE user_id = ? AND project_id = ? AND status IN ('proposed','accepted')
           ORDER BY created_at DESC LIMIT ?`
        )
        .all(userId, projectId, limit) as any[])
    : (db
        .prepare(
          `SELECT * FROM next_actions
           WHERE user_id = ? AND status IN ('proposed','accepted')
           ORDER BY created_at DESC LIMIT ?`
        )
        .all(userId, limit) as any[])
  return rows.map(mapAction)
}

export function latestActionForConversation(
  db: Db,
  userId: string,
  conversationId: string
): NextAction | null {
  const row = db
    .prepare(
      `SELECT * FROM next_actions WHERE user_id = ? AND conversation_id = ?
       ORDER BY created_at DESC, rowid DESC LIMIT 1`
    )
    .get(userId, conversationId) as any
  return row ? mapAction(row) : null
}

export function setActionStatus(
  db: Db,
  userId: string,
  actionId: string,
  status: NextActionStatus
): boolean {
  const completedAt = status === 'done' ? nowIso() : null
  const res = db
    .prepare(
      `UPDATE next_actions SET status = ?, completed_at = ? WHERE id = ? AND user_id = ?`
    )
    .run(status, completedAt, actionId, userId)
  return Number(res.changes) > 0
}

/* ------------------------------------------------------------------ facts */

function mapFact(row: any): Fact {
  return {
    id: row.id,
    userId: row.user_id,
    projectId: row.project_id,
    content: row.content,
    source: row.source,
    sourceRef: row.source_ref,
    confidence: row.confidence,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    correctedFrom: row.corrected_from,
  }
}

export function createFact(
  db: Db,
  input: {
    userId: string
    projectId?: string | null
    content: string
    source: string
    sourceRef?: string | null
    confidence?: FactConfidence
  }
): Fact {
  const id = randomUUID()
  const ts = nowIso()
  db.prepare(
    `INSERT INTO facts (id, user_id, project_id, content, source, source_ref, confidence, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    input.userId,
    input.projectId ?? null,
    input.content,
    input.source,
    input.sourceRef ?? null,
    input.confidence ?? 'stated',
    ts,
    ts
  )
  return {
    id,
    userId: input.userId,
    projectId: input.projectId ?? null,
    content: input.content,
    source: input.source,
    sourceRef: input.sourceRef ?? null,
    confidence: input.confidence ?? 'stated',
    createdAt: ts,
    updatedAt: ts,
    correctedFrom: null,
  }
}

export function listFacts(db: Db, userId: string, projectId?: string | null, limit = 100): Fact[] {
  const rows = projectId
    ? (db
        .prepare(
          `SELECT * FROM facts WHERE user_id = ? AND project_id = ? AND deleted_at IS NULL
           ORDER BY updated_at DESC LIMIT ?`
        )
        .all(userId, projectId, limit) as any[])
    : (db
        .prepare(
          `SELECT * FROM facts WHERE user_id = ? AND deleted_at IS NULL
           ORDER BY updated_at DESC LIMIT ?`
        )
        .all(userId, limit) as any[])
  return rows.map(mapFact)
}

export function getFact(db: Db, userId: string, factId: string): Fact | null {
  const row = db
    .prepare('SELECT * FROM facts WHERE id = ? AND user_id = ? AND deleted_at IS NULL')
    .get(factId, userId) as any
  return row ? mapFact(row) : null
}

/**
 * Correct a fact in place. The previous text is retained on the row so the user
 * can see what changed, and the edit is written to the audit log by the caller.
 */
export function correctFact(
  db: Db,
  userId: string,
  factId: string,
  newContent: string
): Fact | null {
  const existing = getFact(db, userId, factId)
  if (!existing) return null
  const ts = nowIso()
  db.prepare(
    `UPDATE facts SET content = ?, updated_at = ?, corrected_from = ?, source = 'user_correction'
     WHERE id = ? AND user_id = ?`
  ).run(newContent, ts, existing.content, factId, userId)
  return { ...existing, content: newContent, updatedAt: ts, correctedFrom: existing.content, source: 'user_correction' }
}

/** Soft delete so the user's correction history stays auditable. */
export function deleteFact(db: Db, userId: string, factId: string): boolean {
  const res = db
    .prepare('UPDATE facts SET deleted_at = ?, updated_at = ? WHERE id = ? AND user_id = ? AND deleted_at IS NULL')
    .run(nowIso(), nowIso(), factId, userId)
  return Number(res.changes) > 0
}

/* -------------------------------------------------------- telegram linking */

function mapLink(row: any): TelegramLink {
  return {
    id: row.id,
    userId: row.user_id,
    telegramChatId: row.telegram_chat_id,
    telegramUserId: row.telegram_user_id,
    telegramUsername: row.telegram_username,
    linkedAt: row.linked_at,
    unlinkedAt: row.unlinked_at,
    activeProjectId: row.active_project_id,
  }
}

export function insertTelegramLink(
  db: Db,
  input: {
    userId: string
    telegramChatId: string
    telegramUserId?: string | null
    telegramUsername?: string | null
  }
): TelegramLink {
  const id = randomUUID()
  const ts = nowIso()
  db.prepare(
    `INSERT INTO telegram_links (id, user_id, telegram_chat_id, telegram_user_id, telegram_username, linked_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    input.userId,
    input.telegramChatId,
    input.telegramUserId ?? null,
    input.telegramUsername ?? null,
    ts
  )
  return {
    id,
    userId: input.userId,
    telegramChatId: input.telegramChatId,
    telegramUserId: input.telegramUserId ?? null,
    telegramUsername: input.telegramUsername ?? null,
    linkedAt: ts,
    unlinkedAt: null,
    activeProjectId: null,
  }
}

/**
 * Resolve a Telegram chat to the pilot user it is linked to.
 * This is the only supported way to authorize a Telegram message.
 */
export function getActiveLinkByChatId(db: Db, telegramChatId: string): TelegramLink | null {
  const row = db
    .prepare(
      'SELECT * FROM telegram_links WHERE telegram_chat_id = ? AND unlinked_at IS NULL'
    )
    .get(telegramChatId) as any
  return row ? mapLink(row) : null
}

export function listLinksForUser(db: Db, userId: string): TelegramLink[] {
  const rows = db
    .prepare(
      'SELECT * FROM telegram_links WHERE user_id = ? ORDER BY linked_at DESC'
    )
    .all(userId) as any[]
  return rows.map(mapLink)
}

export function unlinkTelegramChat(db: Db, telegramChatId: string): boolean {
  const res = db
    .prepare(
      'UPDATE telegram_links SET unlinked_at = ? WHERE telegram_chat_id = ? AND unlinked_at IS NULL'
    )
    .run(nowIso(), telegramChatId)
  return Number(res.changes) > 0
}

export function unlinkAllForUser(db: Db, userId: string): number {
  const res = db
    .prepare(
      'UPDATE telegram_links SET unlinked_at = ? WHERE user_id = ? AND unlinked_at IS NULL'
    )
    .run(nowIso(), userId)
  return Number(res.changes)
}

export function setLinkActiveProject(
  db: Db,
  userId: string,
  telegramChatId: string,
  projectId: string | null
): boolean {
  const res = db
    .prepare(
      `UPDATE telegram_links SET active_project_id = ?
       WHERE telegram_chat_id = ? AND user_id = ? AND unlinked_at IS NULL`
    )
    .run(projectId, telegramChatId, userId)
  return Number(res.changes) > 0
}

/* ------------------------------------------------------------- model runs */

export interface ModelRunRow {
  id: string
  userId: string
  conversationId: string | null
  idempotencyKey: string
  purpose: string
  status: string
  provider: string | null
  model: string | null
  endpoint: string | null
  responseText: string | null
  errorCode: string | null
  errorMessage: string | null
  latencyMs: number | null
  createdAt: string
  completedAt: string | null
}

function mapRun(row: any): ModelRunRow {
  return {
    id: row.id,
    userId: row.user_id,
    conversationId: row.conversation_id,
    idempotencyKey: row.idempotency_key,
    purpose: row.purpose,
    status: row.status,
    provider: row.provider,
    model: row.model,
    endpoint: row.endpoint,
    responseText: row.response_text,
    errorCode: row.error_code,
    errorMessage: row.error_message,
    latencyMs: row.latency_ms,
    createdAt: row.created_at,
    completedAt: row.completed_at,
  }
}

export function createModelRun(
  db: Db,
  input: {
    userId: string
    conversationId?: string | null
    idempotencyKey: string
    purpose: string
    provider?: string | null
    model?: string | null
    endpoint?: string | null
  }
): ModelRunRow {
  const id = randomUUID()
  const ts = nowIso()
  db.prepare(
    `INSERT INTO model_runs (id, user_id, conversation_id, idempotency_key, purpose, status, provider, model, endpoint, created_at)
     VALUES (?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?)`
  ).run(
    id,
    input.userId,
    input.conversationId ?? null,
    input.idempotencyKey,
    input.purpose,
    input.provider ?? null,
    input.model ?? null,
    input.endpoint ?? null,
    ts
  )
  return {
    id,
    userId: input.userId,
    conversationId: input.conversationId ?? null,
    idempotencyKey: input.idempotencyKey,
    purpose: input.purpose,
    status: 'pending',
    provider: input.provider ?? null,
    model: input.model ?? null,
    endpoint: input.endpoint ?? null,
    responseText: null,
    errorCode: null,
    errorMessage: null,
    latencyMs: null,
    createdAt: ts,
    completedAt: null,
  }
}

export function getModelRunByKey(
  db: Db,
  userId: string,
  idempotencyKey: string
): ModelRunRow | null {
  const row = db
    .prepare('SELECT * FROM model_runs WHERE user_id = ? AND idempotency_key = ?')
    .get(userId, idempotencyKey) as any
  return row ? mapRun(row) : null
}

export function completeModelRun(
  db: Db,
  runId: string,
  input: { responseText: string; latencyMs: number; provider: string; model: string }
): void {
  db.prepare(
    `UPDATE model_runs SET status = 'succeeded', response_text = ?, latency_ms = ?,
       provider = ?, model = ?, completed_at = ?, error_code = NULL, error_message = NULL
     WHERE id = ?`
  ).run(input.responseText, input.latencyMs, input.provider, input.model, nowIso(), runId)
}

export function failModelRun(
  db: Db,
  runId: string,
  input: { errorCode: string; errorMessage: string; latencyMs?: number | null }
): void {
  db.prepare(
    `UPDATE model_runs SET status = 'failed', error_code = ?, error_message = ?,
       latency_ms = ?, completed_at = ?
     WHERE id = ?`
  ).run(input.errorCode, input.errorMessage, input.latencyMs ?? null, nowIso(), runId)
}

export function recentModelRuns(db: Db, userId: string, limit = 20): ModelRunRow[] {
  const rows = db
    .prepare(
      'SELECT * FROM model_runs WHERE user_id = ? ORDER BY created_at DESC LIMIT ?'
    )
    .all(userId, limit) as any[]
  return rows.map(mapRun)
}

/**
 * Move a previously failed run back to pending so the same idempotency key can
 * be retried. One row per (user, key) is what the unique index enforces, so a
 * retry reuses the row instead of inserting a second attempt.
 */
export function resetModelRun(db: Db, runId: string): void {
  db.prepare(
    `UPDATE model_runs SET status = 'pending', error_code = NULL, error_message = NULL,
       completed_at = NULL
     WHERE id = ?`
  ).run(runId)
}

/** Fetch a stored message by its idempotency key, used when replaying a turn. */
export function getMessageByKey(
  db: Db,
  userId: string,
  idempotencyKey: string
): Message | null {
  const row = db
    .prepare('SELECT * FROM messages WHERE user_id = ? AND idempotency_key = ?')
    .get(userId, idempotencyKey) as any
  return row ? mapMessage(row) : null
}

/* ---------------------------------------------------------------- outbox */

export function enqueueOutbox(
  db: Db,
  input: {
    userId?: string | null
    chatId: string
    body: string
    purpose: string
    gateway: string
    status?: string
  }
): string {
  const id = randomUUID()
  db.prepare(
    `INSERT INTO telegram_outbox (id, user_id, chat_id, body, purpose, gateway, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    input.userId ?? null,
    input.chatId,
    input.body,
    input.purpose,
    input.gateway,
    input.status ?? 'queued',
    nowIso()
  )
  return id
}

export function markOutbox(
  db: Db,
  id: string,
  input: { status: string; sentAt?: string | null; error?: string | null; externalId?: string | null }
): void {
  db.prepare(
    `UPDATE telegram_outbox SET status = ?, sent_at = ?, error = ?, external_id = ? WHERE id = ?`
  ).run(
    input.status,
    input.sentAt ?? null,
    input.error ?? null,
    input.externalId ?? null,
    id
  )
}

export function listOutbox(db: Db, limit = 50) {
  const rows = db
    .prepare('SELECT * FROM telegram_outbox ORDER BY created_at DESC LIMIT ?')
    .all(limit) as any[]
  return rows.map((r) => ({
    id: r.id,
    userId: r.user_id,
    chatId: r.chat_id,
    body: r.body,
    purpose: r.purpose,
    gateway: r.gateway,
    status: r.status,
    createdAt: r.created_at,
    sentAt: r.sent_at,
    error: r.error,
    externalId: r.external_id,
  }))
}

/* --------------------------------------------------------- content drafts */

function mapDraft(row: any): ContentDraft {
  let payload: DraftPayload = {}
  try {
    const parsed = JSON.parse(row.payload_json || '{}')
    if (parsed && typeof parsed === 'object') payload = parsed as DraftPayload
  } catch {
    // The text is still worth showing even if the stored extras cannot be read
    // back, so say that instead of dropping the row or inventing details.
    payload = { note: 'Stored details could not be read back.' }
  }
  return {
    id: row.id,
    userId: row.user_id,
    projectId: row.project_id,
    kind: row.kind as DraftKind,
    channel: row.channel as DraftChannel,
    title: row.title,
    body: row.body,
    payload,
    source: row.source,
    model: row.model,
    status: row.status,
    createdAt: row.created_at,
    deletedAt: row.deleted_at,
  }
}

export function createContentDraft(
  db: Db,
  input: {
    userId: string
    projectId?: string | null
    kind: DraftKind
    channel: DraftChannel
    title?: string | null
    body: string
    payload?: DraftPayload
    source: string
    model?: string | null
  }
): ContentDraft {
  const id = randomUUID()
  const ts = nowIso()
  const payloadJson = JSON.stringify(input.payload ?? {})
  db.prepare(
    `INSERT INTO content_drafts
       (id, user_id, project_id, kind, channel, title, body, payload_json, source, model, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft', ?)`
  ).run(
    id,
    input.userId,
    input.projectId ?? null,
    input.kind,
    input.channel,
    input.title ?? null,
    input.body,
    payloadJson,
    input.source,
    input.model ?? null,
    ts
  )
  return {
    id,
    userId: input.userId,
    projectId: input.projectId ?? null,
    kind: input.kind,
    channel: input.channel,
    title: input.title ?? null,
    body: input.body,
    payload: input.payload ?? {},
    source: input.source,
    model: input.model ?? null,
    status: 'draft',
    createdAt: ts,
    deletedAt: null,
  }
}

export function listContentDrafts(
  db: Db,
  userId: string,
  opts: { kind?: DraftKind | null; projectId?: string | null; limit?: number } = {}
): ContentDraft[] {
  const limit = opts.limit ?? 60
  const where = ['user_id = ?', 'deleted_at IS NULL']
  // `any[]` because the params are appended conditionally and node:sqlite types
  // its bind values as a union we would otherwise have to narrow by hand.
  const params: any[] = [userId]
  if (opts.kind) {
    where.push('kind = ?')
    params.push(opts.kind)
  }
  if (opts.projectId) {
    where.push('project_id = ?')
    params.push(opts.projectId)
  }
  const rows = db
    .prepare(
      `SELECT * FROM content_drafts WHERE ${where.join(' AND ')}
       ORDER BY created_at DESC LIMIT ?`
    )
    .all(...params, limit) as any[]
  return rows.map(mapDraft)
}

export function getContentDraft(db: Db, userId: string, draftId: string): ContentDraft | null {
  const row = db
    .prepare('SELECT * FROM content_drafts WHERE id = ? AND user_id = ? AND deleted_at IS NULL')
    .get(draftId, userId) as any
  return row ? mapDraft(row) : null
}

/**
 * Soft delete, so a draft the user removed stays out of every listing but the
 * row is still there for an audit trail. Ownership is part of the WHERE clause:
 * another user's draft id changes nothing and reports false.
 */
export function deleteContentDraft(db: Db, userId: string, draftId: string): boolean {
  const res = db
    .prepare(
      'UPDATE content_drafts SET deleted_at = ? WHERE id = ? AND user_id = ? AND deleted_at IS NULL'
    )
    .run(nowIso(), draftId, userId)
  return Number(res.changes) > 0
}

/* ----------------------------------------------------------------- audit */

export function audit(
  db: Db,
  input: { userId?: string | null; action: string; detail?: string | null }
): void {
  db.prepare(
    'INSERT INTO audit_log (id, user_id, action, detail, created_at) VALUES (?, ?, ?, ?, ?)'
  ).run(randomUUID(), input.userId ?? null, input.action, input.detail ?? null, nowIso())
}
