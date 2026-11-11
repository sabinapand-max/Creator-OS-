/**
 * Owner-only trial-code desk.
 *
 * This is the control that makes "anyone I choose" true: codes are minted here and
 * nowhere else, so the paid model can only be reached by people the owner handed a
 * code to. Auth is a single shared secret in `PILOT_ADMIN_SECRET`, presented as a
 * bearer token. If the secret is not set, the route refuses to do anything — an
 * unset secret must never mean "open".
 *
 *   POST {"turns":5,"count":3,"note":"for Ana","days":30}  -> mints codes, prints plaintext once
 *   GET                                                  -> lists codes and who spent them
 *
 * There is no session cookie here and no browser calls it; use it from curl or a
 * script, and treat the printed codes like the cash they represent.
 */
import { createHash, timingSafeEqual } from 'node:crypto'
import { NextResponse } from 'next/server'
import { getDb } from '@/lib/pilot/db/client.ts'
import * as repo from '@/lib/pilot/db/repo.ts'
import {
  issueTrialCodes,
  TRIAL_DEFAULT_DAYS,
  TRIAL_DEFAULT_TURNS,
  TRIAL_MAX_CODES_PER_CALL,
  TRIAL_MAX_TURNS_PER_CODE,
} from '@/lib/pilot/auth/trial.ts'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** Compare digests so a length difference cannot be read off the clock. */
function secretOk(provided: string): boolean {
  const expected = process.env.PILOT_ADMIN_SECRET
  if (!expected) return false
  const a = createHash('sha256').update(provided).digest()
  const b = createHash('sha256').update(expected).digest()
  return timingSafeEqual(a, b)
}

function unauthorized(request: Request): NextResponse | null {
  if (!process.env.PILOT_ADMIN_SECRET) {
    return NextResponse.json(
      { ok: false, error: 'PILOT_ADMIN_SECRET is not set, so code issuing is disabled.' },
      { status: 503 }
    )
  }
  const header = request.headers.get('authorization') || ''
  const bearer = header.replace(/^Bearer\s+/i, '').trim()
  if (bearer && secretOk(bearer)) return null
  return NextResponse.json({ ok: false, error: 'Admin token required.' }, { status: 401 })
}

export async function GET(request: Request) {
  const denied = unauthorized(request)
  if (denied) return denied

  const db = getDb()
  const codes = await repo.listTrialCodes(db, 200)
  const rows = []
  for (const c of codes) {
    const redeemer = c.redeemedBy ? await repo.getUserById(db, c.redeemedBy) : null
    rows.push({
      id: c.id,
      turns: c.turns,
      note: c.note,
      createdAt: c.createdAt,
      expiresAt: c.expiresAt,
      status: c.redeemedBy ? (c.expiresAt && new Date(c.expiresAt).getTime() <= Date.now() ? 'expired' : 'redeemed') : 'available',
      redeemedAt: c.redeemedAt,
      redeemedByEmail: redeemer?.email ?? null,
    })
  }
  return NextResponse.json({
    ok: true,
    defaults: { turns: TRIAL_DEFAULT_TURNS, days: TRIAL_DEFAULT_DAYS },
    limits: { maxCodesPerCall: TRIAL_MAX_CODES_PER_CALL, maxTurnsPerCode: TRIAL_MAX_TURNS_PER_CODE },
    codes: rows,
  })
}

export async function POST(request: Request) {
  const denied = unauthorized(request)
  if (denied) return denied

  let body: { turns?: unknown; count?: unknown; note?: unknown; days?: unknown } = {}
  try {
    body = await request.json()
  } catch {
    body = {}
  }

  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : undefined)
  const db = getDb()
  const issued = await issueTrialCodes(db, {
    turns: num(body.turns),
    count: num(body.count),
    days: num(body.days),
    note: typeof body.note === 'string' ? body.note : undefined,
  })

  return NextResponse.json({
    ok: true,
    // Shown once. Only hashes are stored, so this list cannot be recovered later.
    codes: issued.map((c) => c.code),
    ids: issued.map((c) => c.id),
  })
}
