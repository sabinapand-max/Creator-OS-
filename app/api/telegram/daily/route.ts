/**
 * Daily pulse cron — the one scheduled job the Creator OS design always
 * imagined (`PILOT_TELEGRAM_DAILY_*`) but never shipped.
 *
 * Vercel Cron makes an authenticated GET to this path once per day. For each
 * linked pilot participant we send a single gentle, low-pressure check-in. This
 * is deliberately NOT a productivity nag: it opens the loop for a brain dump or
 * a "where was I?" continuation, and asks nothing if they don't reply.
 *
 * Guards, in order:
 *  - Cron secret     — Vercel sends `Authorization: Bearer $CRON_SECRET` when
 *    that env var exists. We verify it so the endpoint can't be spammed.
 *  - Feature flag    — `PILOT_DAILY_PULSE_ENABLED=true` or we no-op. Reversible
 *    switch for a three-person pilot without touching code.
 *  - Once-per-day    — a user is skipped if we already logged a pulse for them
 *    in the last 20 hours, so a cron retry never double-sends. Uses audit_log,
 *    so no schema change and SCHEMA_VERSION stays at 1.
 */
import { NextResponse } from 'next/server'
import { timingSafeEqual } from 'node:crypto'
import { getDb } from '@/lib/pilot/db/client.ts'
import * as repo from '@/lib/pilot/db/repo.ts'
import { sendTelegram } from '@/lib/pilot/telegram/send.ts'
import { dailyCognitiveBriefing } from '@/lib/pilot/cognitive/index.ts'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const PULSE_ACTION = 'telegram_daily_pulse.sent'
// 20h window: longer than a day so a same-UTC-day retry is deduped, short
// enough that tomorrow's scheduled run is always allowed through.
const DEDUP_WINDOW_MS = 20 * 60 * 60 * 1000

function validCronSecret(request: Request): boolean {
  const expected = process.env.CRON_SECRET
  if (!expected) return false
  const header = request.headers.get('authorization') || ''
  const supplied = header.replace(/^Bearer\s+/i, '')
  const a = Buffer.from(supplied)
  const b = Buffer.from(expected)
  return a.length === b.length && timingSafeEqual(a, b)
}

function pulseText(): string {
  return [
    'Morning. No agenda, no streak to keep.',
    '',
    'If something is swirling today, you can brain-dump it here and I\'ll hold it.',
    'Or say "where was I?" and I\'ll pick up our last thread.',
    'And if today is just a blank, that\'s fine too — this is a door, not a task.',
  ].join('\n')
}

/**
 * The pulse body, made per-user by the ND cognitive engine (Slice 2). A person with
 * recorded state gets ONE gentle line — today's capacity or a trend worth naming — plus
 * a micro-step sized to them. A new or quiet person gets the plain open-door check-in.
 * Fully rule-based and local; it never calls the model, and a cognitive hiccup just
 * falls back to the generic text rather than dropping the message.
 */
async function buildPulse(db: ReturnType<typeof getDb>, userId: string): Promise<string> {
  const cog = await dailyCognitiveBriefing(db, userId).catch(() => null)
  if (!cog) return pulseText()

  const lines: string[] = ['Morning. No agenda, no streak to keep.']
  lines.push('', cog.patternNote ?? cog.capacityNote)
  lines.push('', `One small step, only if you want it: ${cog.microStep}`)
  lines.push('', 'Brain-dump here and I will hold it, or say "where was I?" to pick up the thread.')
  lines.push('And if today is just a blank, that is fine too — this is a door, not a task.')
  return lines.join('\n')
}

async function alreadyPulsedRecently(
  db: ReturnType<typeof getDb>,
  userId: string
): Promise<boolean> {
  const since = new Date(Date.now() - DEDUP_WINDOW_MS).toISOString()
  const row = (await db
    .prepare(
      'SELECT 1 AS hit FROM audit_log WHERE user_id = ? AND action = ? AND created_at > ? LIMIT 1'
    )
    .get(userId, PULSE_ACTION, since)) as { hit?: number } | undefined
  return !!row
}

export async function GET(request: Request) {
  if (!validCronSecret(request)) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 })
  }

  if (process.env.PILOT_DAILY_PULSE_ENABLED !== 'true') {
    return NextResponse.json({ ok: true, skipped: 'disabled' })
  }

  const db = getDb()
  const links = await repo.listActiveTelegramLinks(db)

  let sent = 0
  let skipped = 0
  for (const link of links) {
    if (await alreadyPulsedRecently(db, link.userId)) {
      skipped++
      continue
    }
    // sendTelegram never throws; undeliverable chats are logged, not fatal.
    await sendTelegram(link.telegramChatId, await buildPulse(db, link.userId))
    await repo.audit(db, { userId: link.userId, action: PULSE_ACTION, detail: link.telegramChatId })
    sent++
  }

  console.log(JSON.stringify({ telegram: 'daily-pulse', links: links.length, sent, skipped }))
  return NextResponse.json({ ok: true, links: links.length, sent, skipped })
}
