/**
 * Authentication primitives for the pilot.
 *
 * Three independent credential types, all resolved server-side:
 *  1. Web session  - proves who is using the Creator OS UI.
 *  2. MCP token    - per-user bearer token; the MCP server derives the acting
 *                    user from this and nothing else.
 *  3. Link code    - short-lived, single-use code that binds an authenticated
 *                    Creator OS account to a Telegram chat.
 *
 * Passwords are hashed with scrypt. Secrets are never logged and never returned
 * to a client after initial issue.
 */
import {
  randomBytes,
  randomUUID,
  scryptSync,
  timingSafeEqual,
  createHash,
} from 'node:crypto'
import type { Db } from '../db/client.ts'
import * as repo from '../db/repo.ts'

const SCRYPT_N = 16384
const SCRYPT_R = 8
const SCRYPT_P = 1
const KEY_LEN = 64

/** 7 days for a private pilot; short enough to expire, long enough to be usable. */
export const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000
/** Link codes are short-lived: 10 minutes. */
export const LINK_CODE_TTL_MS = 10 * 60 * 1000
/** MCP tokens last 90 days unless a different ttl is supplied. */
export const MCP_TOKEN_TTL_MS = 90 * 24 * 60 * 60 * 1000
/** A link code is destroyed after this many failed redemption attempts. */
export const LINK_CODE_MAX_ATTEMPTS = 5

/* -------------------------------------------------------------- passwords */

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString('hex')
  const derived = scryptSync(password, salt, KEY_LEN, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
    maxmem: 128 * SCRYPT_N * SCRYPT_R * 2,
  }).toString('hex')
  return `scrypt$${SCRYPT_N}$${SCRYPT_R}$${SCRYPT_P}$${salt}$${derived}`
}

export function verifyPassword(password: string, stored: string): boolean {
  const parts = stored.split('$')
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false
  const [, n, r, p, salt, expected] = parts
  let derived: Buffer
  try {
    derived = scryptSync(password, salt, KEY_LEN, {
      N: Number(n),
      r: Number(r),
      p: Number(p),
      maxmem: 128 * Number(n) * Number(r) * 2,
    })
  } catch {
    return false
  }
  const expectedBuf = Buffer.from(expected, 'hex')
  if (expectedBuf.length !== derived.length) return false
  return timingSafeEqual(derived, expectedBuf)
}

/* --------------------------------------------------------------- accounts */

export interface AccountResult {
  ok: boolean
  userId?: string
  error?: 'email_taken' | 'invalid_credentials' | 'weak_password' | 'invalid_email'
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export async function registerAccount(
  db: Db,
  input: { email: string; password: string; displayName?: string }
): Promise<AccountResult> {
  const email = input.email.trim().toLowerCase()
  if (!EMAIL_RE.test(email)) return { ok: false, error: 'invalid_email' }
  if (input.password.length < 10) return { ok: false, error: 'weak_password' }
  if (await repo.getUserByEmail(db, email)) return { ok: false, error: 'email_taken' }

  const displayName = (input.displayName?.trim() || email.split('@')[0]).slice(0, 80)
  const user = await repo.createUser(db, {
    email,
    displayName,
    passwordHash: hashPassword(input.password),
  })
  await repo.audit(db, { userId: user.id, action: 'account.registered', detail: email })
  return { ok: true, userId: user.id }
}

export async function signIn(
  db: Db,
  input: { email: string; password: string }
): Promise<AccountResult & { sessionId?: string; sessionExpiresAt?: string }> {
  const email = input.email.trim().toLowerCase()
  const user = await repo.getUserByEmail(db, email)
  // Verify against a dummy hash when the account is missing so response time
  // does not reveal whether an email is registered.
  if (!user) {
    verifyPassword(input.password, hashPassword('timing-equaliser'))
    return { ok: false, error: 'invalid_credentials' }
  }
  if (!verifyPassword(input.password, user.passwordHash)) {
    return { ok: false, error: 'invalid_credentials' }
  }
  const session = await repo.createSession(db, user.id, SESSION_TTL_MS)
  return { ok: true, userId: user.id, sessionId: session.id, sessionExpiresAt: session.expiresAt }
}

export async function signOut(db: Db, sessionId: string): Promise<void> {
  await repo.revokeSession(db, sessionId)
}

/** Resolve a web session cookie to a user id, or null. */
export async function resolveSessionUser(
  db: Db,
  sessionId: string | undefined | null
): Promise<string | null> {
  if (!sessionId) return null
  return repo.resolveSession(db, sessionId)
}

/* ------------------------------------------------------------ mcp tokens */

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

/**
 * Issue a per-user MCP bearer token. The plaintext is returned exactly once and
 * is never stored; only its SHA-256 hash is persisted.
 */
export async function issueMcpToken(
  db: Db,
  userId: string,
  label: string,
  ttlMs: number = MCP_TOKEN_TTL_MS
): Promise<{ tokenId: string; token: string; expiresAt: string | null }> {
  const token = `cop_${randomBytes(30).toString('hex')}`
  const expiresAt = ttlMs > 0 ? new Date(Date.now() + ttlMs).toISOString() : null
  const tokenId = await repo.insertMcpToken(db, {
    userId,
    tokenHash: sha256(token),
    label: label.slice(0, 120),
    expiresAt,
  })
  await repo.audit(db, { userId, action: 'mcp_token.issued', detail: label })
  return { tokenId, token, expiresAt }
}

/**
 * Resolve an MCP bearer token to the user it belongs to.
 * Returns null for unknown, revoked or expired tokens.
 */
export async function resolveMcpBearer(db: Db, bearer: string | undefined | null): Promise<string | null> {
  if (!bearer) return null
  const token = bearer.replace(/^Bearer\s+/i, '').trim()
  if (!token) return null
  const resolved = await repo.resolveMcpToken(db, sha256(token))
  return resolved ? resolved.userId : null
}

export async function revokeMcpToken(db: Db, userId: string, tokenId: string): Promise<boolean> {
  const ok = await repo.revokeMcpToken(db, userId, tokenId)
  if (ok) await repo.audit(db, { userId, action: 'mcp_token.revoked', detail: tokenId })
  return ok
}

/* ---------------------------------------------------- telegram link codes */

/** Alphabet without 0/O/1/I/l so a code read aloud or typed by hand is unambiguous. */
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'
const CODE_LENGTH = 8

function formatCode(raw: string): string {
  return `${raw.slice(0, 4)}-${raw.slice(4)}`
}

export interface LinkCodeIssueResult {
  code: string
  codeId: string
  expiresAt: string
}

/**
 * Create a short-lived, single-use linking code bound to an authenticated user.
 * Only the hash is stored, so a database leak does not reveal usable codes.
 */
export async function issueTelegramLinkCode(
  db: Db,
  userId: string
): Promise<LinkCodeIssueResult> {
  // Any previously issued, unconsumed code for this user is invalidated so at
  // most one code is live at a time.
  await revokePendingLinkCodes(db, userId)

  const bytes = randomBytes(CODE_LENGTH)
  let raw = ''
  for (let i = 0; i < CODE_LENGTH; i += 1) {
    raw += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length]
  }
  const codeId = randomUUID()
  const createdAt = repo.nowIso()
  const expiresAt = new Date(Date.now() + LINK_CODE_TTL_MS).toISOString()
  await db
    .prepare(
      `INSERT INTO telegram_link_codes (id, user_id, code_hash, created_at, expires_at)
     VALUES (?, ?, ?, ?, ?)`
    )
    .run(codeId, userId, sha256(raw), createdAt, expiresAt)
  await repo.audit(db, {
    userId,
    action: 'telegram_link_code.issued',
    detail: `expires ${expiresAt}`,
  })
  return { code: formatCode(raw), codeId, expiresAt }
}

export async function revokePendingLinkCodes(db: Db, userId: string): Promise<number> {
  const res = await db
    .prepare(
      `UPDATE telegram_link_codes SET consumed_at = ?, consumed_by_chat_id = 'revoked'
       WHERE user_id = ? AND consumed_at IS NULL`
    )
    .run(repo.nowIso(), userId)
  return Number(res.changes)
}

export type LinkCodeFailure =
  | 'unknown_code'
  | 'already_used'
  | 'expired'
  | 'too_many_attempts'
  | 'malformed_code'

export type LinkCodeResult =
  | { ok: true; userId: string; codeId: string }
  | { ok: false; reason: LinkCodeFailure }

function normaliseCode(input: string): string | null {
  const cleaned = input.trim().toUpperCase().replace(/[\s-]/g, '')
  if (cleaned.length !== CODE_LENGTH) return null
  for (const ch of cleaned) {
    if (!CODE_ALPHABET.includes(ch)) return null
  }
  return cleaned
}

/**
 * Redeem a linking code. Single-use and time-bounded.
 *
 * The consume is a single conditional UPDATE (`... WHERE id = ? AND consumed_at
 * IS NULL`), whose row-lock and change-count are atomic on both SQLite and
 * Postgres. Two concurrent redemptions of the same code cannot both succeed:
 * only one reports a change, the loser sees `changes = 0` and returns
 * `already_used`. This deliberately avoids an explicit BEGIN/COMMIT transaction,
 * which does not survive Neon's pooled, per-query connection switching.
 */
export async function consumeTelegramLinkCode(
  db: Db,
  rawCode: string,
  telegramChatId: string
): Promise<LinkCodeResult> {
  const code = normaliseCode(rawCode)
  if (!code) return { ok: false, reason: 'malformed_code' }

  const hash = sha256(code)
  const row = await db
    .prepare('SELECT * FROM telegram_link_codes WHERE code_hash = ?')
    .get(hash) as any

  if (!row) return { ok: false, reason: 'unknown_code' }

  if (row.attempts >= LINK_CODE_MAX_ATTEMPTS) {
    return { ok: false, reason: 'too_many_attempts' }
  }

  if (row.consumed_at) {
    await db
      .prepare('UPDATE telegram_link_codes SET attempts = attempts + 1 WHERE id = ?')
      .run(row.id)
    return { ok: false, reason: 'already_used' }
  }

  if (new Date(row.expires_at).getTime() <= Date.now()) {
    await db
      .prepare('UPDATE telegram_link_codes SET attempts = attempts + 1 WHERE id = ?')
      .run(row.id)
    return { ok: false, reason: 'expired' }
  }

  const res = await db
    .prepare(
      `UPDATE telegram_link_codes
       SET consumed_at = ?, consumed_by_chat_id = ?, attempts = attempts + 1
       WHERE id = ? AND consumed_at IS NULL`
    )
    .run(repo.nowIso(), telegramChatId, row.id)

  // Someone else won the race for this code between the read and the write.
  if (Number(res.changes) === 0) return { ok: false, reason: 'already_used' }

  await repo.audit(db, {
    userId: row.user_id,
    action: 'telegram_link_code.consumed',
    detail: `chat ${telegramChatId}`,
  })
  return { ok: true, userId: row.user_id, codeId: row.id }
}
