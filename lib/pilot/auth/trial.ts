/**
 * Free-trial codes — how the owner lets chosen people try the hosted model.
 *
 * Registration is public, but the hosted default model is not: a `plan='free'`
 * account is gated to bring-your-own-key unless it holds a trial grant. A grant can
 * only come from a code issued here, and issuing one needs the admin secret, so the
 * blast radius of a paid feature is "however many codes you chose to hand out".
 *
 * Codes are stored as SHA-256 hashes and shown in plaintext exactly once, at
 * issue time. Redemption is a single conditional UPDATE, which is atomic on both
 * SQLite and Neon's pooled connections, so one code cannot be spent twice.
 */
import { createHash, randomBytes, randomUUID } from 'node:crypto'
import type { Db } from '../db/client.ts'
import * as repo from '../db/repo.ts'

/** Same alphabet as the Telegram link codes: no 0/O/1/I/l, so a code typed from a chat window is safe. */
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'
const CODE_GROUPS = 3
const GROUP_LENGTH = 4
const CODE_PREFIX = 'IND'

/** Defaults for a trial grant, overridable by the issuer. */
export const TRIAL_DEFAULT_TURNS = 5
export const TRIAL_DEFAULT_DAYS = 30
/** Ceiling per issue call, so a typo in a request cannot mint an unbounded trial. */
export const TRIAL_MAX_CODES_PER_CALL = 50
export const TRIAL_MAX_TURNS_PER_CODE = 50

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

function randomGroup(): string {
  const bytes = randomBytes(GROUP_LENGTH)
  let out = ''
  for (let i = 0; i < GROUP_LENGTH; i += 1) out += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length]
  return out
}

/** e.g. IND-A7KQ-3MRE-XZP4 */
function newCode(): string {
  const groups = Array.from({ length: CODE_GROUPS }, randomGroup)
  return `${CODE_PREFIX}-${groups.join('-')}`
}

/**
 * Reduce anything a person pastes (spaces, dashes, lowercase, a missing prefix) to
 * the canonical 12-character form, or null when it is not a trial code at all.
 */
export function normaliseTrialCode(input: string): string | null {
  const cleaned = input.trim().toUpperCase().replace(/[^A-Z0-9]/g, '')
  const body = cleaned.startsWith(CODE_PREFIX) ? cleaned.slice(CODE_PREFIX.length) : cleaned
  if (body.length !== CODE_GROUPS * GROUP_LENGTH) return null
  for (const ch of body) {
    if (!CODE_ALPHABET.includes(ch)) return null
  }
  return body
}

export interface IssuedTrialCode {
  code: string
  id: string
}

export async function issueTrialCodes(
  db: Db,
  opts: { turns?: number; count?: number; note?: string; days?: number } = {}
): Promise<IssuedTrialCode[]> {
  const turns = Math.max(1, Math.min(TRIAL_MAX_TURNS_PER_CODE, Math.floor(opts.turns ?? TRIAL_DEFAULT_TURNS)))
  const count = Math.max(1, Math.min(TRIAL_MAX_CODES_PER_CALL, Math.floor(opts.count ?? 1)))
  const days = Math.max(1, Math.min(365, Math.floor(opts.days ?? TRIAL_DEFAULT_DAYS)))
  const createdAt = repo.nowIso()
  const expiresAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString()

  const issued: IssuedTrialCode[] = []
  for (let i = 0; i < count; i += 1) {
    // A collision on the unique hash is astronomically unlikely, but a retry is
    // cheaper than letting one failed insert abort the batch.
    let code = newCode()
    let id = randomUUID()
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const canonical = normaliseTrialCode(code)
      if (!canonical) throw new Error('generated trial code failed its own normaliser')
      try {
        await repo.insertTrialCode(db, {
          id,
          // Hash the canonical body, not the pretty printing: a redeem can only ever
          // see the normalised form (prefix and dashes are the caller's choice).
          codeHash: sha256(canonical),
          turns,
          note: opts.note?.slice(0, 120),
          createdAt,
          expiresAt,
        })
        break
      } catch (err) {
        if (attempt === 2) throw err
        code = newCode()
        id = randomUUID()
      }
    }
    issued.push({ code, id })
  }

  await repo.audit(db, {
    userId: null,
    action: 'trial_codes.issued',
    detail: `${issued.length} x ${turns} turns, ${days}d${opts.note ? `, note: ${opts.note}` : ''}`,
  })
  return issued
}

export type TrialFailure = 'malformed_code' | 'unknown_code' | 'already_used' | 'expired'

export type TrialRedeemResult =
  | { ok: true; turns: number; expiresAt: string | null }
  | { ok: false; reason: TrialFailure }

const FAILURE_TEXT: Record<TrialFailure, string> = {
  malformed_code: 'That does not look like a trial code. They read IND-XXXX-XXXX-XXXX.',
  unknown_code: 'We have no record of that code.',
  already_used: 'That code has already been claimed by an account.',
  expired: 'That code has expired.',
}

export function trialFailureMessage(reason: TrialFailure): string {
  return FAILURE_TEXT[reason]
}

/**
 * Attach a code to the signed-in account. Single-use and time-bounded; the winner
 * of a race is whoever's UPDATE found the row unclaimed.
 */
export async function redeemTrialCode(
  db: Db,
  userId: string,
  rawCode: string
): Promise<TrialRedeemResult> {
  const code = normaliseTrialCode(rawCode)
  if (!code) return { ok: false, reason: 'malformed_code' }

  const row = await repo.findTrialCodeByHash(db, sha256(code))
  if (!row) return { ok: false, reason: 'unknown_code' }
  if (row.redeemedBy) return { ok: false, reason: 'already_used' }
  if (row.expiresAt && new Date(row.expiresAt).getTime() <= Date.now()) {
    return { ok: false, reason: 'expired' }
  }

  const claimed = await repo.claimTrialCode(db, row.id, userId)
  if (!claimed) return { ok: false, reason: 'already_used' }

  await repo.audit(db, {
    userId,
    action: 'trial_code.redeemed',
    detail: `${row.turns} hosted turns`,
  })
  return { ok: true, turns: row.turns, expiresAt: row.expiresAt }
}

/**
 * Trial balance for an account, in the one place that knows both halves: the grant
 * (summed codes) and the spend (succeeded hosted model_runs since the first code).
 */
export async function describeTrial(db: Db, userId: string, hostedBaseUrl: string) {
  const grant = await repo.getTrialGrant(db, userId)
  if (!grant) {
    // No ACTIVE grant. If one existed and merely expired, report it as an ended
    // trial (the gate then says "trial ended, ask for a code") rather than
    // "never offered", which would wrongly read as "this is a paid product".
    const ever = await repo.hasRedeemedTrial(db, userId)
    return { hasTrial: ever, turnsTotal: 0, turnsUsed: 0, turnsRemaining: 0 }
  }
  const used = await repo.countHostedTurns(db, userId, grant.since, hostedBaseUrl)
  return {
    hasTrial: true,
    turnsTotal: grant.turns,
    turnsUsed: used,
    turnsRemaining: Math.max(0, grant.turns - used),
  }
}
