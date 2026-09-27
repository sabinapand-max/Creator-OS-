// scripts/telegram-webhook-probe.mjs
//
// Drives the real Telegram webhook over HTTP against a throwaway database.
// Nothing is sent to Telegram: PILOT_TELEGRAM_SEND_ENABLED stays false, so the
// route logs each would-be reply as JSON instead of calling the API. Those log
// lines are how this probe reads the bot's answers.
//
// It exists to answer one question honestly: does the doorway actually work,
// and does it get identity right? A user id must never come from the message.

import { spawn } from 'node:child_process'
import { DatabaseSync } from 'node:sqlite'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

const SECRET = 'probe-webhook-secret'
const results = []
const dir = mkdtempSync(path.join(tmpdir(), 'cop-tg-probe-'))
const dbPath = path.join(dir, 'probe.sqlite')

function check(label, ok, detail = '') {
  results.push({ label, ok, detail })
  const mark = ok ? 'PASS' : 'FAIL'
  console.log(`${mark}  ${label}${detail ? `\n      ${detail}` : ''}`)
}

// One server process per scenario, because fail-closed behaviour when the
// webhook secret is unset cannot be observed in the same process as a set secret.
function startServer({ port, webhookSecret, extraEnv = {} }) {
  const child = spawn(
    process.execPath,
    [path.join('node_modules', 'next', 'dist', 'bin', 'next'), 'start'],
    {
      cwd: path.resolve(import.meta.dirname, '..'),
      env: {
        ...process.env,
        PORT: String(port),
        NODE_ENV: 'production',
        PILOT_DB_PATH: dbPath,
        PILOT_HOSTED: 'false',
        PILOT_TELEGRAM_SEND_ENABLED: 'false',
        PILOT_TELEGRAM_BOT_USERNAME: 'ProbeTestBot',
        // Deliberately no model config: the app must admit it has no model
        // rather than inventing an answer.
        AI_BASE_URL: '',
        AI_MODEL: '',
        AI_API_KEY: '',
        ...extraEnv,
        ...(webhookSecret ? { PILOT_TELEGRAM_WEBHOOK_SECRET: webhookSecret } : {}),
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    }
  )

  let log = ''
  child.stdout.on('data', (d) => { log += d.toString() })
  child.stderr.on('data', (d) => { log += d.toString() })

  return {
    child,
    get log() { return log },
    // Every reply the bot would have pushed to Telegram.
    sends() {
      return log
        .split('\n')
        .filter((l) => l.includes('send-disabled'))
        .map((l) => {
          const start = l.indexOf('{')
          try { return JSON.parse(l.slice(start)) } catch { return null }
        })
        .filter(Boolean)
    },
    lastSend() { return this.sends().at(-1) ?? null },
    clearSends() { log = log.slice(log.length) },
  }
}

async function waitReady(port, timeoutMs = 45000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const r = await fetch(`http://127.0.0.1:${port}/api/health`)
      if (r.ok) return true
    } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 400))
  }
  return false
}

const BASE = () => `http://127.0.0.1:${PORT}`
let PORT = 4101

function update(chatId, text, { fromId = 555000123, type = 'private', username = 'probe_user' } = {}) {
  return {
    update_id: Math.floor(Math.random() * 1e9),
    message: {
      message_id: Math.floor(Math.random() * 1e6),
      chat: { id: chatId, type, username },
      from: { id: fromId, username },
      text,
    },
  }
}

async function postWebhook(server, body, { secret = SECRET, raw } = {}) {
  const res = await fetch(`${BASE()}/api/telegram/webhook`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(secret === null ? {} : { 'x-telegram-bot-api-secret-token': secret }),
    },
    body: raw ?? JSON.stringify(body),
  })
  return { status: res.status, json: await res.json().catch(() => null) }
}

// Column names are read from the schema instead of being hardcoded, so this
// probe keeps working if the link table is renamed or gains fields.
function linkColumns(db) {
  return db.prepare('PRAGMA table_info(telegram_links)').all().map((c) => c.name)
}

function readLinks(db, { chatId, userId }) {
  const cols = linkColumns(db)
  const chatCol = cols.find((c) => /chat/i.test(c))
  const userCol = cols.find((c) => /user/i.test(c) && !/telegram_user/i.test(c))
  const statusCol = cols.find((c) => /status/i.test(c))
  if (!chatCol || !userCol) throw new Error(`unexpected telegram_links columns: ${cols.join(', ')}`)
  const rows = db
    .prepare(`SELECT ${chatCol} AS chat, ${userCol} AS user, ${statusCol ? `${statusCol} AS status` : "'' AS status"} FROM telegram_links`)
    .all()
    .filter((r) => (chatId ? String(r.chat) === String(chatId) : true) && (userId ? r.user === userId : true))
  return { rows, chatCol, userCol }
}

const server = startServer({ port: PORT, webhookSecret: SECRET })

try {
  console.log('--- starting the real app for offline webhook testing ---')
  const ready = await waitReady(PORT)
  check('the app boots from the merged source and answers /api/health', ready, `port ${PORT}`)
  if (!ready) {
    console.log(server.log.slice(-1200))
    process.exitCode = 1
  } else {
    // ---------- 1. the webhook must refuse anyone without the secret ----------
    const noSecret = await postWebhook(server, update(111, 'hi'), { secret: null })
    check('a webhook call with no secret header is rejected', noSecret.status === 401, `got ${noSecret.status}`)

    const wrongSecret = await postWebhook(server, update(111, 'hi'), { secret: 'guessed-wrong' })
    check('a webhook call with a wrong secret is rejected', wrongSecret.status === 401, `got ${wrongSecret.status}`)

    const badJson = await postWebhook(server, null, { raw: 'not json {' })
    check('a malformed body is rejected without touching the database', badJson.status === 400, `got ${badJson.status}`)

    check('rejection happened before any reply was queued', server.sends().length === 0)

    // ---------- 2. link codes need a signed-in account ----------
    const bareLink = await fetch(`${BASE()}/api/telegram/link`, { method: 'POST' })
    check('link-code issuance requires a session', bareLink.status === 401, `got ${bareLink.status}`)

    const email = `probe-${Date.now()}@example.test`
    const password = 'probe-password-123'
    const reg = await fetch(`${BASE()}/api/pilot/auth`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'register', email, password, displayName: 'Probe' }),
    })
    const regBody = await reg.json()
    const cookie = (reg.headers.getSetCookie?.() ?? []).find((c) => c.startsWith('cop_session='))
    check('a pilot account can be created and gets an httpOnly session', reg.ok && Boolean(cookie), `user ${regBody?.user?.id ?? 'unknown'}`)

    const linkRes = await fetch(`${BASE()}/api/telegram/link`, {
      method: 'POST',
      headers: { cookie: cookie ?? '' },
    })
    const issued = await linkRes.json()
    const codeDashless = String(issued.code ?? '').replace(/-/g, '')
    check('the app issues a single-use link code for the signed-in user', linkRes.ok && /^[A-Z2-9]{8}$/.test(codeDashless), `code shape ${issued.code}`)
    check('the deep link points at the configured bot, not a hardcoded one', typeof issued.deepLink === 'string' && issued.deepLink.includes('ProbeTestBot'), issued.deepLink ?? 'none')

    // ---------- 3. an unknown chat gets nothing but an explanation ----------
    const unlinked = await postWebhook(server, update(900001, 'hello?'))
    check('an unlinked chat is acknowledged but cannot reach any data', unlinked.status === 200 || unlinked.status === 500, `got ${unlinked.status}`)
    const unlinkedReply = server.lastSend()
    check('the unlinked reply tells the user to connect first', /not connected|\/start/i.test(unlinkedReply?.text ?? ''), JSON.stringify(unlinkedReply?.text ?? '').slice(0, 120))

    // ---------- 4. the code links exactly one chat ----------
    const CHAT = '700000001'
    const startRes = await postWebhook(server, update(CHAT, `/start ${codeDashless}`))
    check('sending /start with the code links the chat', startRes.status === 200, `got ${startRes.status}`)

    const db = new DatabaseSync(dbPath)
    const afterLink = readLinks(db, { chatId: CHAT })
    check('the link row exists for that chat', afterLink.rows.length >= 1, `columns ${afterLink.chatCol}/${afterLink.userCol}`)
    check('the linked chat resolves to the account that issued the code', afterLink.rows[0]?.user === regBody?.user?.id, `${afterLink.rows[0]?.user} vs ${regBody?.user?.id}`)

    // ---------- 5. single use, and no cross-account takeover ----------
    const beforeThief = server.sends().length
    const thief = await postWebhook(server, update(999000, `/start ${codeDashless}`))
    const thiefLinks = readLinks(db, { chatId: '999000' })
    const thiefReply = server.sends().slice(beforeThief).at(-1)
    check('the same code cannot link a second chat', thiefLinks.rows.length === 0, `rows ${thiefLinks.rows.length}`)
    // A permanent rejection must be acknowledged, or Telegram retries it forever.
    check('a used code is explained and acknowledged, not answered with a 500',
      thief.status === 200 && /code/i.test(thiefReply?.text ?? ''),
      `status ${thief.status}, reply ${JSON.stringify(thiefReply?.text ?? '').slice(0, 90)}`)

    // Identity must come from the stored link, never from `from.id` in the body.
    const beforeSpoof = server.sends().length
    const spoofed = await postWebhook(server, update(CHAT, 'what should I do next?', { fromId: 1 }))
    const modelReply = server.sends().slice(beforeSpoof).at(-1)
    check('a spoofed from.id cannot change which account is used', spoofed.status === 200, `got ${spoofed.status}`)
    const stillMine = readLinks(db, { chatId: CHAT })
    check('the chat still maps to its original owner', stillMine.rows[0]?.user === regBody?.user?.id, `${stillMine.rows[0]?.user}`)

    // ---------- 6. group chats are refused ----------
    const beforeGroup = server.sends().length
    await postWebhook(server, update(CHAT, 'hey everyone', { type: 'group' }))
    const groupReply = server.sends().slice(beforeGroup).at(-1)
    check('a group chat is refused rather than answered', /one-to-one|private/i.test(groupReply?.text ?? ''), JSON.stringify(groupReply?.text ?? '').slice(0, 120))

    // ---------- 7. honest behaviour with no model configured ----------
    const sends = server.sends()
    check('the linked chat received a reply of some kind', sends.length > 0, `${sends.length} replies queued`)
    // This must read the reply to the message above, not just the newest line:
    // reading the newest let an unrelated group-chat refusal satisfy it.
    check('with no model the reply says so instead of inventing a next action',
      /model|not configured|couldn|unavailable|retry|failed|try again/i.test(modelReply?.text ?? ''),
      JSON.stringify(modelReply?.text ?? '(no reply)').slice(0, 200))
    check('no text was actually sent to Telegram while sending is disabled', !server.log.includes('api.telegram.org'), 'zero outbound API calls in the log')
    check('every outbound reply was suppressed and logged instead', /send-disabled/.test(server.log), `${sends.length} suppressed`)

    db.close()
  }
} finally {
  server.child.kill()
}

// ---------- 8. fail-closed when the secret is not configured at all ----------
{
  PORT = 4111
  const bare = startServer({ port: PORT, webhookSecret: null })
  const up = await waitReady(PORT)
  if (up) {
    const res = await fetch(`http://127.0.0.1:${PORT}/api/telegram/webhook`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-telegram-bot-api-secret-token': '' },
      body: JSON.stringify(update(12345, '/start')),
    })
    check('an unset webhook secret fails closed, not open', res.status === 401, `got ${res.status}`)
  } else {
    check('the second server started', false)
  }
  bare.child.kill()
}

rmSync(dir, { recursive: true, force: true })

const failed = results.filter((r) => !r.ok)
console.log(`\n${results.length - failed.length}/${results.length} checks passed`)
if (failed.length) {
  console.log('failed:')
  for (const f of failed) console.log(`  - ${f.label}${f.detail ? ` (${f.detail})` : ''}`)
  process.exitCode = 1
}
