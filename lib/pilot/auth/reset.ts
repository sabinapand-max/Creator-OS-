/**
 * Password recovery.
 *
 * Flow: the visitor asks for a reset with their email; if an account exists,
 * a single-use code is issued and emailed (via AgentMail). The response is the
 * same either way, so the endpoint never confirms which addresses are
 * registered. Redemption mirrors telegram_link_codes: lookup by hash, a capped
 * number of attempts, expiry, and an atomic conditional consume. A successful
 * reset replaces the password hash and expires every live session.
 */
import { createHash, randomBytes, randomUUID } from 'node:crypto'
import type { Db } from '../db/client.ts'
import * as repo from '../db/repo.ts'
import { hashPassword } from './index.ts'

export const RESET_TTL_MS = 24 * 60 * 60 * 1000
/** A new request within this window is ignored (the live code keeps working). */
export const RESET_REISSUE_COOLDOWN_MS = 10 * 60 * 1000
export const RESET_MAX_ATTEMPTS = 6

const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'
const CODE_LENGTH = 8

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

function normaliseCode(input: string): string | null {
  const cleaned = input.trim().toUpperCase().replace(/[\s-]/g, '')
  if (cleaned.length !== CODE_LENGTH) return null
  for (const ch of cleaned) {
    if (!CODE_ALPHABET.includes(ch)) return null
  }
  return cleaned
}

export type ResetIssue =
  | { ok: true; code: string }
  | { ok: false; reason: 'throttled' | 'none' }

/**
 * Issue (or keep) the live reset code for a user. Returns the plaintext code
 * exactly once, for the email; the database stores only its hash.
 */
export async function issuePasswordReset(db: Db, userId: string): Promise<ResetIssue> {
  const live = await db
    .prepare(
      `SELECT created_at, expires_at FROM password_reset_codes
       WHERE user_id = ? AND consumed_at IS NULL
       ORDER BY created_at DESC LIMIT 1`
    )
    .get(userId) as { created_at: string; expires_at: string } | undefined

  if (live && new Date(live.expires_at).getTime() > Date.now()) {
    const fresh = Date.now() - new Date(live.created_at).getTime() < RESET_REISSUE_COOLDOWN_MS
    if (fresh) return { ok: false, reason: 'throttled' }
    // Past the cooldown but still valid: replace the old code with a fresh one
    // so repeated requests always arrive in a new email.
    await db
      .prepare('DELETE FROM password_reset_codes WHERE user_id = ? AND consumed_at IS NULL')
      .run(userId)
  }

  const bytes = randomBytes(CODE_LENGTH)
  let raw = ''
  for (let i = 0; i < CODE_LENGTH; i += 1) {
    raw += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length]
  }
  const id = randomUUID()
  const createdAt = repo.nowIso()
  const expiresAt = new Date(Date.now() + RESET_TTL_MS).toISOString()
  await db
    .prepare(
      `INSERT INTO password_reset_codes (id, user_id, code_hash, created_at, expires_at)
       VALUES (?, ?, ?, ?, ?)`
    )
    .run(id, userId, sha256(raw), createdAt, expiresAt)
  await repo.audit(db, { userId, action: 'password_reset.issued', detail: `expires ${expiresAt}` })
  return { ok: true, code: `${raw.slice(0, 4)}-${raw.slice(4)}` }
}

export type ResetResult =
  | { ok: true }
  | { ok: false; error: 'unknown_code' | 'expired' | 'too_many_attempts' | 'weak_password' }

/**
 * Redeem a reset code and set the new password. On success every session of
 * the account is expired, so "forgot my password" also means "sign me out
 * everywhere".
 */
export async function completePasswordReset(
  db: Db,
  input: { email: string; code: string; password: string }
): Promise<ResetResult> {
  if (input.password.length < 10) return { ok: false, error: 'weak_password' }
  const code = normaliseCode(input.code)
  if (!code) return { ok: false, error: 'unknown_code' }

  const user = await repo.getUserByEmail(db, input.email.trim().toLowerCase())
  if (!user) return { ok: false, error: 'unknown_code' }

  const row = await db
    .prepare('SELECT * FROM password_reset_codes WHERE code_hash = ?')
    .get(sha256(code)) as any

  if (!row || row.user_id !== user.id) return { ok: false, error: 'unknown_code' }
  if (row.attempts >= RESET_MAX_ATTEMPTS) return { ok: false, error: 'too_many_attempts' }
  if (row.consumed_at) return { ok: false, error: 'unknown_code' }
  if (new Date(row.expires_at).getTime() <= Date.now()) {
    await db.prepare('UPDATE password_reset_codes SET attempts = attempts + 1 WHERE id = ?').run(row.id)
    return { ok: false, error: 'expired' }
  }

  const res = await db
    .prepare(
      `UPDATE password_reset_codes
       SET consumed_at = ?, attempts = attempts + 1
       WHERE id = ? AND consumed_at IS NULL`
    )
    .run(repo.nowIso(), row.id)
  if (Number(res.changes) === 0) return { ok: false, error: 'unknown_code' }

  await db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(input.password), user.id)
  const now = repo.nowIso()
  await db
    .prepare('UPDATE sessions SET expires_at = ?, revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL')
    .run(now, now, user.id)
  await repo.audit(db, { userId: user.id, action: 'password_reset.completed', detail: 'password changed, sessions expired' })
  return { ok: true }
}
