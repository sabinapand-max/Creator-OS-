import { NextResponse } from 'next/server'
import { timingSafeEqual } from 'node:crypto'
import { getDb } from '@/lib/pilot/db/client.ts'
import * as repo from '@/lib/pilot/db/repo.ts'
import {
  consumeTelegramLinkCode,
  registerAccount,
} from '@/lib/pilot/auth/index.ts'
import { submitTurn } from '@/lib/pilot/core/conversation.ts'
import type { SubmitTurnResult } from '@/lib/pilot/core/conversation.ts'
import { sendTelegram } from '@/lib/pilot/telegram/send.ts'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type TelegramMessage = {
  message_id: number
  chat: { id: number | string; type?: string; username?: string }
  from?: { id?: number | string; username?: string }
  text?: string
}

type TelegramUpdate = {
  update_id: number
  message?: TelegramMessage
}

function validSecret(request: Request): boolean {
  const expected = process.env.PILOT_TELEGRAM_WEBHOOK_SECRET
  if (!expected) return false

  const supplied = request.headers.get('x-telegram-bot-api-secret-token') || ''
  const a = Buffer.from(supplied)
  const b = Buffer.from(expected)
  return a.length === b.length && timingSafeEqual(a, b)
}

// sendTelegram lives in lib/pilot/telegram/send.ts, shared with the daily
// pulse cron so outbound delivery behaves identically on both paths.

function renderedResult(result: SubmitTurnResult): string {
  if (!result.ok) {
    return result.kind === 'model_failure'
      ? `I saved what you sent, but the model could not answer yet. Error: ${result.failure.message}`
      : result.message
  }

  if (result.kind === 'directive') return result.text

  return result.assistantMessage.content
}

async function getOrCreateTelegramUser(
  db: ReturnType<typeof getDb>,
  chatId: string
): Promise<string> {
  const existingLink = await repo.getActiveLinkByChatId(db, chatId)
  if (existingLink) return existingLink.userId

  if (process.env.PILOT_TELEGRAM_AUTO_REGISTER !== 'true') {
    throw new Error('telegram_not_linked')
  }

  // Private-pilot bootstrap mode: each Telegram chat gets its own isolated
  // Creator OS account. The generated password is never returned or logged.
  const email = `telegram-${chatId.replace(/[^0-9-]/g, '')}@telegram.local`
  const created = await registerAccount(db, {
    email,
    password: `${crypto.randomUUID()}-${crypto.randomUUID()}`,
    displayName: 'Telegram pilot',
  })

  if (!created.ok || !created.userId) {
    const existing = await repo.getUserByEmail(db, email)
    if (!existing) throw new Error(`telegram_user_create_failed_${created.error || 'unknown'}`)
    await repo.insertTelegramLink(db, {
      userId: existing.id,
      telegramChatId: chatId,
    })
    return existing.id
  }

  await repo.insertTelegramLink(db, {
    userId: created.userId,
    telegramChatId: chatId,
  })
  return created.userId
}

async function handleUpdate(update: TelegramUpdate): Promise<void> {
  const message = update.message
  if (!message?.text) return

  const text = message.text.trim()
  const chatId = String(message.chat.id)
  const username = message.chat.username ?? message.from?.username ?? null
  const db = getDb()

  if (text.startsWith('/start')) {
    const arg = text.slice('/start'.length).trim()

    if (arg) {
      const consumed = await consumeTelegramLinkCode(db, arg, chatId)
      if (consumed.ok) {
        await repo.unlinkTelegramChat(db, chatId)
        await repo.insertTelegramLink(db, {
          userId: consumed.userId,
          telegramChatId: chatId,
          telegramUserId: message.from?.id ? String(message.from.id) : null,
          telegramUsername: username,
        })
        await sendTelegram(
          chatId,
          'Connected. 🦊 Your Creator OS doorway is live here now. Paste a brain dump whenever you are ready.'
        )
        return
      }
      // A used, expired or mistyped code is a permanent outcome. Previously the
      // handler fell through to the auto-register path, which threw, so Telegram
      // saw a 500 and retried the same update indefinitely while the user got no
      // reply at all. Acknowledge it and say what to do instead. A chat that is
      // already linked still falls through, so an old deep link merely re-welcomes.
      if (!(await repo.getActiveLinkByChatId(db, chatId))) {
        await sendTelegram(
          chatId,
          'That link code is no longer valid — it was used, has expired, or was mistyped. Ask Creator OS for a fresh code, then send /start followed by the new one.'
        )
        return
      }
    }

    // An unlinked chat with auto-registration off used to throw, so /start —
    // literally the first thing any new user sends — answered 500 and the bot
    // appeared dead. Reply with what to do instead; the update is acknowledged
    // so Telegram does not retry it forever.
    let userId: string
    try {
      userId = await getOrCreateTelegramUser(db, chatId)
    } catch (error) {
      if (error instanceof Error && error.message === 'telegram_not_linked') {
        await sendTelegram(
          chatId,
          'Creator OS is invite-only right now. Open your Creator OS dashboard, ask for a Telegram link code, then send /start followed by that code.'
        )
        return
      }
      throw error
    }
    const link = await repo.getActiveLinkByChatId(db, chatId)
    if (link) {
      await repo.unlinkTelegramChat(db, chatId)
      await repo.insertTelegramLink(db, {
        userId,
        telegramChatId: chatId,
        telegramUserId: message.from?.id ? String(message.from.id) : null,
        telegramUsername: username,
      })
    }

    await sendTelegram(
      chatId,
      'Creator OS is connected. 🦊\n\nPaste what is on your mind. I will turn it into a short interpretation and one next action.\n\nTry “where was I?” or “save for later” at any point.'
    )
    return
  }

  const link = await repo.getActiveLinkByChatId(db, chatId)
  if (!link) {
    await sendTelegram(
      chatId,
      'This Telegram chat is not connected to Creator OS yet. Send /start first.'
    )
    return
  }

  if (message.chat.type && message.chat.type !== 'private') {
    await sendTelegram(chatId, 'For the private pilot, Creator OS only responds in a one-to-one Telegram chat.')
    return
  }

  const result = await submitTurn(db, {
    userId: link.userId,
    text,
    channel: 'telegram',
    projectId: link.activeProjectId,
    idempotencyKey: `telegram:${update.update_id}`,
  })

  if (result.ok && result.kind === 'model_turn' && result.projectId) {
    await repo.setLinkActiveProject(db, link.userId, chatId, result.projectId)
  }

  if (
    result.ok &&
    result.kind === 'directive' &&
    result.directive === 'unlink_telegram'
  ) {
    await repo.unlinkTelegramChat(db, chatId)
  }

  await sendTelegram(chatId, renderedResult(result))
}

export async function POST(request: Request) {
  if (!validSecret(request)) {
    return NextResponse.json({ ok: false }, { status: 401 })
  }

  let update: TelegramUpdate
  try {
    update = (await request.json()) as TelegramUpdate
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid_json' }, { status: 400 })
  }

  try {
    await handleUpdate(update)
    // Telegram only needs the webhook acknowledged. The work above is kept
    // synchronous intentionally for this small private pilot.
    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error('telegram webhook failed', error)
    return NextResponse.json({ ok: false, error: 'telegram_handler_failed' }, { status: 500 })
  }
}
