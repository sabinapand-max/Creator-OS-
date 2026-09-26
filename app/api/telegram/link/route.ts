import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { getDb } from '@/lib/pilot/db/client.ts'
import { resolveSessionUser, issueTelegramLinkCode } from '@/lib/pilot/auth/index.ts'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST() {
  const store = await cookies()
  const sessionId = store.get('cop_session')?.value
  const db = getDb()
  const userId = resolveSessionUser(db, sessionId)

  if (!userId) {
    return NextResponse.json({ ok: false, error: 'sign_in_required' }, { status: 401 })
  }

  const issued = issueTelegramLinkCode(db, userId)
  const username = process.env.PILOT_TELEGRAM_BOT_USERNAME || ''

  return NextResponse.json({
    ok: true,
    code: issued.code,
    expiresAt: issued.expiresAt,
    botUsername: username,
    deepLink: username
      ? `https://t.me/${username.replace(/^@/, '')}?start=${issued.code.replace(/-/g, '')}`
      : null,
  })
}
