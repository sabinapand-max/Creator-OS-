/**
 * Pilot account sign-in / sign-out.
 *
 * Sessions are httpOnly cookies; the browser never holds a user id it could
 * tamper with, and never holds a model API key.
 *
 * Registration is gated by PILOT_REGISTRATION_MODE. When it is set to
 * "waitlist", an email may only create an account if it is on the public
 * waitlist (newsletter_subscribers) or in the PILOT_ALLOWED_EMAILS allowlist.
 * This is what keeps a link posted on LinkedIn from turning into open sign-ups
 * that burn inference credits. Sign-in is never gated, so the existing pilot
 * members are unaffected. With the mode unset, registration stays open (dev /
 * test default).
 */
import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { getDb } from '@/lib/pilot/db/client.ts'
import * as repo from '@/lib/pilot/db/repo.ts'
import { registerAccount, signIn, SESSION_TTL_MS } from '@/lib/pilot/auth/index.ts'
import { clearedSessionCookie, sessionCookie } from '@/lib/pilot/web/session.ts'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const ERROR_TEXT: Record<string, string> = {
  invalid_email: 'That does not look like an email address.',
  weak_password: 'Use at least 10 characters for your password.',
  email_taken: 'That email already has a pilot account. Sign in instead.',
  invalid_credentials: 'Email and password do not match.',
}

const WAITLIST_HINT =
  'Creator OS is invite-only right now. Join the waitlist at creatoros.indigos.uk and we\u2019ll email you a link the moment a spot opens.'

/**
 * True when this email may create an account. Only enforced while
 * PILOT_REGISTRATION_MODE === 'waitlist'. A public-figure link must not open a
 * floodgate of paid model runs, so: explicit allowlist first (owner fast-track),
 * then the waitlist table. If neither matches, the caller gets WAITLIST_HINT.
 */
async function registrationAllowed(db: ReturnType<typeof getDb>, email: string): Promise<boolean> {
  if (process.env.PILOT_REGISTRATION_MODE !== 'waitlist') return true
  const norm = email.trim().toLowerCase()
  if (!norm) return false
  const allowlist = (process.env.PILOT_ALLOWED_EMAILS || '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean)
  if (allowlist.includes(norm)) return true
  return repo.isOnWaitlist(db, norm)
}

export async function POST(request: Request) {
  let body: any
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ ok: false, error: 'Send JSON.' }, { status: 400 })
  }

  const action = String(body?.action || 'signin')
  const db = getDb()
  const store = await cookies()

  if (action === 'signout') {
    const sessionId = store.get('cop_session')?.value
    if (sessionId) await repo.revokeSession(db, sessionId)
    store.set(clearedSessionCookie())
    return NextResponse.json({ ok: true })
  }

  if (action !== 'signin' && action !== 'register') {
    return NextResponse.json({ ok: false, error: 'Unknown action.' }, { status: 400 })
  }

  const email = String(body?.email || '')
  const password = String(body?.password || '')
  const displayName = body?.displayName ? String(body.displayName) : undefined

  if (action === 'register') {
    if (!(await registrationAllowed(db, email))) {
      return NextResponse.json({ ok: false, error: WAITLIST_HINT }, { status: 403 })
    }
    const created = await registerAccount(db, { email, password, displayName })
    if (!created.ok) {
      return NextResponse.json(
        { ok: false, error: ERROR_TEXT[created.error ?? ''] ?? 'Could not create the account.' },
        { status: 400 }
      )
    }
  }

  const result = await signIn(db, { email, password })
  if (!result.ok || !result.sessionId) {
    return NextResponse.json(
      { ok: false, error: ERROR_TEXT[result.error ?? ''] ?? 'Sign-in failed.' },
      { status: result.error === 'invalid_credentials' ? 401 : 400 }
    )
  }

  const user = await repo.getUserById(db, result.userId!)
  store.set(sessionCookie(result.sessionId, Math.floor(SESSION_TTL_MS / 1000)))

  return NextResponse.json({
    ok: true,
    user: user ? { id: user.id, email: user.email, displayName: user.displayName } : null,
  })
}
