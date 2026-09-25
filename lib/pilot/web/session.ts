/**
 * Session plumbing for the Next.js route handlers.
 *
 * The pilot user id is derived only from an httpOnly session cookie that this
 * module issued. No route ever accepts a userId in a request body or query
 * string, because a caller-supplied id is not authorisation.
 */
import { cookies } from 'next/headers'
import type { Db } from '../db/client.ts'
import { getDb } from '../db/client.ts'
import { resolveSessionUser } from '../auth/index.ts'

export const SESSION_COOKIE = 'cop_session'

export interface Authed {
  ok: true
  userId: string
  db: Db
}

export interface Unauthed {
  ok: false
  status: 401
  error: string
}

export type AuthResult = Authed | Unauthed

/** Resolve the signed-in pilot user from the session cookie. */
export async function requireUser(db: Db = getDb()): Promise<AuthResult> {
  const store = await cookies()
  const sessionId = store.get(SESSION_COOKIE)?.value
  if (!sessionId) {
    return { ok: false, status: 401, error: 'Not signed in.' }
  }
  const userId = resolveSessionUser(db, sessionId)
  if (!userId) {
    return { ok: false, status: 401, error: 'Session expired. Sign in again.' }
  }
  return { ok: true, userId, db }
}

/** Optional variant: returns null instead of an error when not signed in. */
export async function optionalUser(db: Db = getDb()): Promise<{ userId: string | null; db: Db }> {
  const store = await cookies()
  const sessionId = store.get(SESSION_COOKIE)?.value
  if (!sessionId) return { userId: null, db }
  return { userId: resolveSessionUser(db, sessionId), db }
}

export function sessionCookie(sessionId: string, maxAgeSeconds: number) {
  return {
    name: SESSION_COOKIE,
    value: sessionId,
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: maxAgeSeconds,
  }
}

export function clearedSessionCookie() {
  return {
    name: SESSION_COOKIE,
    value: '',
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 0,
  }
}
