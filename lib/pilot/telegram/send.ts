/**
 * Outbound Telegram delivery, shared by the webhook reply path and the daily
 * pulse cron.
 *
 * Sending is gated by `PILOT_TELEGRAM_SEND_ENABLED`: with it unset the message
 * is logged as a would-be send instead of hitting Telegram, which is what the
 * offline probe relies on. An undeliverable reply must never throw — Telegram
 * would retry a 500 for hours while the user sees only silence, so failures are
 * logged rather than surfaced.
 */

function logSendFailure(chatId: string, reason: string, description?: string): void {
  console.error(
    JSON.stringify({ telegram: 'send-failed', chatId, reason, description: description || null })
  )
}

export async function sendTelegram(chatId: string, text: string): Promise<void> {
  const token = process.env.PILOT_TELEGRAM_BOT_TOKEN
  if (!token) {
    logSendFailure(chatId, 'telegram_bot_token_missing')
    return
  }

  if (process.env.PILOT_TELEGRAM_SEND_ENABLED !== 'true') {
    console.log(JSON.stringify({ telegram: 'send-disabled', chatId, text }))
    return
  }

  let response: Response
  try {
    response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text }),
    })
  } catch (error) {
    logSendFailure(chatId, error instanceof Error ? error.message : 'network_error')
    return
  }

  if (!response.ok) {
    let description = ''
    try {
      const body = (await response.json()) as { description?: string }
      description = body.description || ''
    } catch {
      description = 'unreadable_response'
    }
    logSendFailure(chatId, `http_${response.status}`, description)
    return
  }
}
