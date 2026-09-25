/**
 * HTTP smoke test against a running dev server.
 *
 * Proves the vertical slice over the wire, not just in-process:
 *   register -> brain dump -> honest model error -> input still stored
 *   -> readable again from /api/pilot/state (the "survives refresh" step)
 *   -> "where was I?" works with no model at all
 *   -> browser-supplied API keys are refused
 *   -> Social Studio / Marketplace drafts generate, list and delete over HTTP
 *   -> a second pilot user cannot see the first one's records
 *
 * Uses synthetic accounts only. Starts the dev server first:  npm run dev
 *
 *   node scripts/smoke-web.mjs [baseUrl]
 */
const BASE = (process.argv[2] || process.env.PILOT_APP_URL || 'http://localhost:3100').replace(/\/+$/, '')

let failures = 0
let checks = 0

function check(label, condition, detail) {
  checks += 1
  if (condition) {
    console.log(`  ok   ${label}`)
  } else {
    failures += 1
    console.log(`  FAIL ${label}${detail ? `\n       ${detail}` : ''}`)
  }
}

/** Minimal cookie jar, because the session is an httpOnly cookie. */
function jar() {
  let cookie = ''
  return {
    header: () => (cookie ? { cookie } : {}),
    absorb(res) {
      const raw = res.headers.getSetCookie?.() ?? []
      for (const c of raw) {
        const [pair] = c.split(';')
        const [name] = pair.split('=')
        if (name.trim() === 'cop_session') cookie = pair
      }
    },
  }
}

async function call(j, method, path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...j.header() },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  j.absorb(res)
  let json = null
  try {
    json = await res.json()
  } catch {
    json = null
  }
  return { status: res.status, json }
}

const stamp = Date.now()
const A = { email: `smoke-a-${stamp}@pilot.test`, password: 'smoke-password-123' }
const B = { email: `smoke-b-${stamp}@pilot.test`, password: 'smoke-password-123' }
const DUMP =
  'I want to launch the newsletter but the unfinished book chapter keeps eating my mornings and I end the day having done neither.'

async function main() {
  console.log(`\nCreator OS pilot smoke test -> ${BASE}\n`)

  let res = await fetch(`${BASE}/api/pilot/state`)
  check('dev server is up', res.ok, `GET /api/pilot/state returned ${res.status}`)
  if (!res.ok) {
    console.log('\nStart the server first:  npm run dev')
    process.exit(1)
  }
  const anon = await res.json()
  check('anonymous request reports signed-out', anon.signedIn === false)
  check(
    'model status is honest about configuration and leaks no key',
    typeof anon.model?.configured === 'boolean' && anon.model.apiKey === undefined,
    JSON.stringify(anon.model)
  )

  /* ---------------------------------------------------------- User A flow */
  const ja = jar()
  console.log('\n[User A] register + brain dump')
  res = await call(ja, 'POST', '/api/pilot/auth', { action: 'register', ...A, displayName: 'Smoke A' })
  check('registration succeeds', res.status === 200 && res.json?.ok === true, JSON.stringify(res.json))
  check('session cookie issued', ja.header().cookie !== '', 'no cop_session cookie returned')

  res = await call(ja, 'POST', '/api/pilot/turn', { text: DUMP, idempotencyKey: `smoke-${stamp}-1` })
  const modelConfigured = res.json?.ok === true
  if (modelConfigured) {
    check('brain dump returns a structured turn', res.json.kind === 'model_turn')
    check('turn has an interpretation', typeof res.json.turn?.interpretation === 'string')
    check(
      'turn has at most one question',
      res.json.turn?.question === null || typeof res.json.turn.question === 'string'
    )
    check('turn has exactly one next action', !!res.json.turn?.nextAction && !Array.isArray(res.json.turn.nextAction))
    check('latency was measured', typeof res.json.latencyMs === 'number')
  } else {
    check(
      'an unconfigured/unavailable model returns a retryable 503, not fake advice',
      res.status === 503 && res.json?.kind === 'model_failure',
      `status ${res.status} body ${JSON.stringify(res.json)}`
    )
    check('the failure names a real reason', typeof res.json?.code === 'string' && res.json.code.startsWith('model_'))
    check('the failure echoes the preserved input', res.json?.preservedInput === DUMP)
    check('no mock content is returned', res.json?.turn === undefined && res.json?.content === undefined)
  }

  console.log('\n[User A] state after refresh (read back from SQLite)')
  res = await call(ja, 'GET', '/api/pilot/state')
  check('signed in on a fresh request', res.json?.signedIn === true)
  check('exactly one project was created', res.json?.projects?.length === 1, JSON.stringify(res.json?.projects))
  check(
    'the brain dump text is stored even though the model failed',
    (res.json?.messages ?? []).some((m) => m.role === 'user' && m.content === DUMP),
    JSON.stringify(res.json?.messages?.map((m) => m.role))
  )
  check(
    'no invented assistant reply was stored',
    modelConfigured
      ? (res.json?.messages ?? []).filter((m) => m.role === 'assistant').length === 1
      : (res.json?.messages ?? []).filter((m) => m.role === 'assistant').length === 0
  )
  check('a model run was recorded with its status', (res.json?.recentModelRuns ?? []).length >= 1)
  const conversationId = res.json?.activeConversationId
  check('an active conversation exists', typeof conversationId === 'string' && conversationId.length > 0)

  console.log('\n[User A] "where was I?" with no model available')
  res = await call(ja, 'POST', '/api/pilot/turn', { text: 'where was I?', conversationId })
  check('the re-entry request succeeds without a model', res.json?.ok === true, JSON.stringify(res.json))
  check('it is handled as a directive', res.json?.kind === 'directive' && res.json?.directive === 'where_was_i')
  check('it returns readable text', typeof res.json?.text === 'string' && res.json.text.length > 10)

  console.log('\n[User A] "save for later"')
  res = await call(ja, 'POST', '/api/pilot/turn', { text: 'save this for later', conversationId })
  check('save for later succeeds without a model', res.json?.ok === true && res.json?.directive === 'save_for_later')

  console.log('\n[User A] browser-supplied API keys are refused')
  // Deliberately not key-shaped, so no secret scanner flags this test file.
  // The route must refuse the field itself, whatever value it carries.
  const BROWSER_SUPPLIED_SECRET = 'a-value-a-browser-should-never-hold'
  res = await call(ja, 'POST', '/api/generate', { input: DUMP, clientKey: BROWSER_SUPPLIED_SECRET })
  check('clientKey is rejected with 400', res.status === 400, `status ${res.status} body ${JSON.stringify(res.json)}`)
  check('the refusal explains where the key belongs', /server environment/i.test(res.json?.error ?? ''))

  /* ------------------------------------------------------- User A drafts */
  console.log('\n[User A] content drafts (Social Studio + Marketplace)')
  res = await call(ja, 'GET', '/api/pilot/drafts')
  check('the drafts list is reachable', res.status === 200 && res.json?.ok === true, JSON.stringify(res.json))
  check('it starts empty for a fresh account', Array.isArray(res.json?.drafts) && res.json.drafts.length === 0)
  check(
    'it reports the real channel lists',
    Array.isArray(res.json?.channels?.social) && res.json.channels.social.includes('linkedin'),
    JSON.stringify(res.json?.channels)
  )
  check(
    'etsy is not a channel anywhere',
    !(res.json?.channels?.social ?? []).includes('etsy') && !(res.json?.channels?.offer ?? []).includes('etsy')
  )

  res = await call(ja, 'POST', '/api/pilot/drafts', { kind: 'offer', channels: ['etsy'] })
  check('asking for etsy is refused with 400', res.status === 400, `status ${res.status} body ${JSON.stringify(res.json)}`)
  check('the refusal names the channels that do exist', /gumroad, fiverr/.test(res.json?.error ?? ''), res.json?.error)

  res = await call(ja, 'POST', '/api/pilot/drafts', {
    kind: 'social',
    channels: ['linkedin', 'instagram', 'tiktok', 'pinterest', 'twitter'],
  })
  check('too many channels at once is refused before any call', res.status === 400 && /up to 4/i.test(res.json?.error ?? ''), JSON.stringify(res.json))

  let aDraftId = null
  if (modelConfigured) {
    res = await call(ja, 'POST', '/api/pilot/drafts', {
      kind: 'social',
      channels: ['linkedin'],
      brief: 'Keep it plain, no launch hype.',
    })
    check('a real social draft is generated', res.status === 200 && res.json?.ok === true, `status ${res.status} body ${JSON.stringify(res.json)?.slice(0, 400)}`)
    check('exactly one draft came back for one channel', res.json?.drafts?.length === 1)
    check('it is for the channel that was asked for', res.json?.drafts?.[0]?.channel === 'linkedin')
    check('it has real body text', typeof res.json?.drafts?.[0]?.body === 'string' && res.json.drafts[0].body.trim().length > 20)
    check('the draft records which model wrote it', typeof res.json?.drafts?.[0]?.model === 'string' && res.json.drafts[0].model.length > 0)
    check('draft generation latency was measured', typeof res.json?.latencyMs === 'number' && res.json.latencyMs > 0)
    aDraftId = res.json?.drafts?.[0]?.id ?? null

    res = await call(ja, 'GET', '/api/pilot/drafts?kind=social')
    check('the generated draft is listed on a fresh request', (res.json?.drafts ?? []).some((d) => d.id === aDraftId))
    check('listing by kind filters', (res.json?.drafts ?? []).every((d) => d.kind === 'social'))

    res = await call(ja, 'POST', '/api/pilot/drafts', { kind: 'offer', channels: ['gumroad'] })
    check('a real offer draft is generated', res.status === 200 && res.json?.ok === true, `status ${res.status} body ${JSON.stringify(res.json)?.slice(0, 400)}`)
    check('the offer draft is kind offer', res.json?.drafts?.[0]?.kind === 'offer' && res.json?.drafts?.[0]?.channel === 'gumroad')

    res = await call(ja, 'GET', '/api/pilot/drafts?kind=offer')
    check('social and offer drafts are kept apart', (res.json?.drafts ?? []).every((d) => d.kind === 'offer'))

    if (aDraftId) {
      res = await call(ja, 'DELETE', `/api/pilot/drafts/${aDraftId}`)
      check('the user can delete their own draft', res.status === 200 && res.json?.ok === true, JSON.stringify(res.json))
      res = await call(ja, 'GET', '/api/pilot/drafts')
      check('a deleted draft stops being listed', !(res.json?.drafts ?? []).some((d) => d.id === aDraftId))
      res = await call(ja, 'DELETE', `/api/pilot/drafts/${aDraftId}`)
      check('deleting it twice reports 404', res.status === 404, `status ${res.status}`)
    }
  } else {
    console.log('  --   skipped real generation: no model is configured on this server')
  }

  /* ---------------------------------------------------------- User B flow */
  console.log('\n[User B] isolation')
  const jb = jar()
  res = await call(jb, 'POST', '/api/pilot/auth', { action: 'register', ...B, displayName: 'Smoke B' })
  check('second pilot user can register', res.status === 200 && res.json?.ok === true)

  res = await call(jb, 'GET', '/api/pilot/state')
  check('User B sees none of User A projects', res.json?.projects?.length === 0, JSON.stringify(res.json?.projects))
  check('User B sees none of User A conversations', res.json?.conversations?.length === 0)
  check('User B sees none of User A messages', res.json?.messages?.length === 0)

  res = await call(jb, 'POST', '/api/pilot/turn', {
    text: 'show me my context',
    conversationId,
    idempotencyKey: `smoke-${stamp}-b`,
  })
  check(
    "User A's conversation id reads as 404 for User B",
    res.status === 404 && res.json?.kind === 'not_found',
    `status ${res.status} body ${JSON.stringify(res.json)}`
  )

  res = await call(jb, 'GET', '/api/pilot/drafts')
  check('User B sees none of User A drafts', Array.isArray(res.json?.drafts) && res.json.drafts.length === 0, JSON.stringify(res.json?.drafts))

  if (aDraftId) {
    res = await call(jb, 'DELETE', `/api/pilot/drafts/${aDraftId}`)
    check("User A's draft id reads as 404 for User B", res.status === 404, `status ${res.status}`)
  }

  res = await call(jb, 'POST', '/api/pilot/drafts', { kind: 'social', channels: ['linkedin'] })
  check(
    'User B, with nothing stored, gets an honest 409 and no invented drafts',
    res.status === 409 && res.json?.kind === 'no_context' && /brain dump/i.test(res.json?.error ?? ''),
    `status ${res.status} body ${JSON.stringify(res.json)}`
  )

  console.log('\n[unauthenticated] no session, no data')
  const jn = jar()
  res = await call(jn, 'POST', '/api/pilot/turn', { text: DUMP })
  check('turn requires a session', res.status === 401, `status ${res.status}`)
  res = await call(jn, 'GET', '/api/pilot/drafts')
  check('listing drafts requires a session', res.status === 401, `status ${res.status}`)
  res = await call(jn, 'POST', '/api/pilot/drafts', { kind: 'social', channels: ['linkedin'] })
  check('generating drafts requires a session', res.status === 401, `status ${res.status}`)
  res = await call(jn, 'DELETE', '/api/pilot/drafts/any-id-at-all')
  check('deleting a draft requires a session', res.status === 401, `status ${res.status}`)
  res = await call(jn, 'POST', '/api/pilot/auth', { action: 'signin', email: A.email, password: 'wrong-password' })
  check('a wrong password is rejected', res.status === 401, `status ${res.status}`)

  /* -------------------------------------------------------------- verdict */
  console.log(`\n--- ${checks - failures}/${checks} checks passed`)
  if (failures > 0) {
    console.log(`--- ${failures} FAILED`)
    process.exit(1)
  }
  console.log('--- smoke test clean')
  process.exit(0)
}

main().catch((err) => {
  console.error('\nsmoke test crashed:', err?.message ?? err)
  process.exit(1)
})
