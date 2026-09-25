/**
 * Pilot account sign-in / sign-out.
 *
 * Three-person pilot, so registration is open but rate-limited by nothing more
 * than a password length rule. Sessions are httpOnly cookies; the browser never
 * holds a user id it could tamper with, and never holds a model API key.
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
    if (sessionId) repo.revokeSession(db, sessionId)
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
    const created = registerAccount(db, { email, password, displayName })
    if (!created.ok) {
      return NextResponse.json(
        { ok: false, error: ERROR_TEXT[created.error ?? ''] ?? 'Could not create the account.' },
        { status: 400 }
      )
    }
  }

  const result = signIn(db, { email, password })
  if (!result.ok || !result.sessionId) {
    return NextResponse.json(
      { ok: false, error: ERROR_TEXT[result.error ?? ''] ?? 'Sign-in failed.' },
      { status: result.error === 'invalid_credentials' ? 401 : 400 }
    )
  }

  const user = repo.getUserById(db, result.userId!)
  store.set(sessionCookie(result.sessionId, Math.floor(SESSION_TTL_MS / 1000)))

  return NextResponse.json({
    ok: true,
    user: user ? { id: user.id, email: user.email, displayName: user.displayName } : null,
  })
}
