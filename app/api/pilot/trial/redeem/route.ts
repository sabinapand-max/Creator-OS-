/**
 * Redeem a free-trial code onto the signed-in account.
 *
 * The owner hands a code to someone they chose; that person pastes it here once.
 * A successful redeem is what lets a `plan='free'` account reach the hosted model,
 * so this route is deliberately small: it needs a session, it takes one string, it
 * never reveals whether a code exists when the caller is not the one claiming it,
 * and the plaintext code is not echoed back.
 */
import { NextResponse } from 'next/server'
import { redeemTrialCode, trialFailureMessage } from '@/lib/pilot/auth/trial.ts'
import { requireUser } from '@/lib/pilot/web/session.ts'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(request: Request) {
  const auth = await requireUser()
  if (!auth.ok) return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status })

  let body: { code?: unknown }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ ok: false, error: 'Send JSON with a "code".' }, { status: 400 })
  }

  const raw = typeof body?.code === 'string' ? body.code : ''
  if (!raw.trim()) {
    return NextResponse.json({ ok: false, error: trialFailureMessage('malformed_code') }, { status: 400 })
  }

  const result = await redeemTrialCode(auth.db, auth.userId, raw)
  if (!result.ok) {
    // 400 for a typo or a spent code, 410 for one that expired: both are honest,
    // and neither tells a stranger anything about codes they were not given.
    return NextResponse.json(
      { ok: false, error: trialFailureMessage(result.reason) },
      { status: result.reason === 'expired' ? 410 : 400 }
    )
  }

  return NextResponse.json({ ok: true, turns: result.turns, expiresAt: result.expiresAt })
}
