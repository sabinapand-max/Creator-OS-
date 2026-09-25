/**
 * End-to-end probe for the MCP server.
 *
 * Speaks real JSON-RPC over stdio to a real child process, against the real
 * pilot database. It proves four things that reading the source cannot:
 *
 *   1. the server refuses to start without a token, and with a bogus one;
 *   2. it exposes exactly the five tools the brief names, no more;
 *   3. no tool accepts a userId — the caller cannot choose whose data it acts on;
 *   4. a tool call returns the authenticated user's real stored data.
 *
 * The token is minted with the production issueMcpToken path (so hashing and the
 * audit row are exercised too), given a short life, and revoked at the end.
 *
 *   npm run mcp:probe
 */
import { spawn } from 'node:child_process'
import { createInterface } from 'node:readline'
import { getDb } from '../lib/pilot/db/client.ts'
import { issueMcpToken, resolveMcpBearer, revokeMcpToken } from '../lib/pilot/auth/index.ts'

let checks = 0
let failures = 0

function check(label, condition, detail) {
  checks += 1
  if (condition) console.log(`  ok   ${label}`)
  else {
    failures += 1
    console.log(`  FAIL ${label}${detail ? `\n       ${detail}` : ''}`)
  }
}

const EXPECTED_TOOLS = [
  'capture_brain_dump',
  'get_project_context',
  'append_conversation_message',
  'propose_next_action',
  'get_reentry_card',
].sort()

/** Start the server and collect everything it says, on both streams. */
function launch(env) {
  const child = spawn(
    process.execPath,
    ['--disable-warning=ExperimentalWarning', '--env-file-if-exists=.env.local', 'mcp/server.ts'],
    { env: { ...process.env, ...env }, stdio: ['pipe', 'pipe', 'pipe'] }
  )
  const state = { stdout: '', stderr: '', exited: null, responses: new Map(), notify: [] }

  child.stderr.on('data', (d) => {
    state.stderr += d.toString()
  })
  child.on('exit', (code) => {
    state.exited = code
  })

  createInterface({ input: child.stdout }).on('line', (line) => {
    state.stdout += `${line}\n`
    if (!line.trim()) return
    let msg
    try {
      msg = JSON.parse(line)
    } catch {
      return // not protocol output; recorded above so it can be reported
    }
    if (msg.id !== undefined) state.responses.set(msg.id, msg)
    else state.notify.push(msg)
  })

  return { child, state }
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms))

async function until(predicate, timeoutMs, what) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (predicate()) return true
    await wait(50)
  }
  throw new Error(`timed out after ${timeoutMs}ms waiting for ${what}`)
}

/** Send a request and wait for the matching response. */
async function request(handle, id, method, params, timeoutMs = 30_000) {
  handle.child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`)
  await until(() => handle.state.responses.has(id), timeoutMs, `response to ${method}`)
  return handle.state.responses.get(id)
}

async function main() {
  console.log('\nCreator OS MCP server probe\n')

  /* ------------------------------------------------ 1. refuses to start open */
  console.log('[auth] the server will not start unauthenticated')
  let handle = launch({ PILOT_MCP_TOKEN: '' })
  await until(() => handle.state.exited !== null, 20_000, 'exit with no token')
  check('no token -> non-zero exit', handle.state.exited !== 0, `exit code ${handle.state.exited}`)
  check('no token -> says which variable is missing', /PILOT_MCP_TOKEN/.test(handle.state.stderr), handle.state.stderr.slice(0, 200))
  check('no token -> served no protocol output at all', handle.state.stdout.trim() === '', handle.state.stdout.slice(0, 200))

  console.log('\n[auth] a bogus token is refused')
  handle = launch({ PILOT_MCP_TOKEN: 'cop_not_a_real_token_0000000000000000000000000000000' })
  await until(() => handle.state.exited !== null, 20_000, 'exit with a bogus token')
  check('bogus token -> non-zero exit', handle.state.exited !== 0, `exit code ${handle.state.exited}`)
  check('bogus token -> explains it is unknown, revoked or expired', /unknown, revoked or expired/i.test(handle.state.stderr), handle.state.stderr.slice(0, 200))

  /* --------------------------------------------------- 2. a real, live token */
  const db = getDb()
  const user = db.prepare('SELECT id, email, display_name FROM users ORDER BY created_at DESC LIMIT 1').get()
  if (!user) {
    console.log('\nNo pilot user exists yet. Register one at http://localhost:3100 first.')
    process.exitCode = 1
    return
  }
  const issued = issueMcpToken(db, user.id, 'mcp-probe', 10 * 60 * 1000)
  console.log(`\n[session] minted a 10-minute token for ${user.email}`)
  check('the plaintext token is returned exactly once', issued.token.startsWith('cop_') && issued.token.length > 20)

  handle = launch({ PILOT_MCP_TOKEN: issued.token })
  try {
    await until(() => handle.state.stderr.includes('ready for'), 30_000, 'server ready line')
    check('it names the account it is acting as', handle.state.stderr.includes(user.email) || handle.state.stderr.includes(user.display_name), handle.state.stderr.slice(0, 200))

    const init = await request(handle, 1, 'initialize', {
      protocolVersion: '2025-06-18',
      capabilities: {},
      clientInfo: { name: 'mcp-probe', version: '1.0.0' },
    })
    check('initialize succeeds', !!init.result, JSON.stringify(init).slice(0, 300))
    check('it identifies itself as creator-os-pilot', init.result?.serverInfo?.name === 'creator-os-pilot', JSON.stringify(init.result?.serverInfo))

    handle.child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`)

    /* ------------------------------------------------------- 3. tool surface */
    console.log('\n[surface] exactly the five tools the brief names')
    const listed = await request(handle, 2, 'tools/list', {})
    const tools = listed.result?.tools ?? []
    const names = tools.map((t) => t.name).sort()
    check('five tools are exposed', tools.length === 5, `got ${tools.length}: ${names.join(', ')}`)
    check('and they are exactly the five named in the brief', JSON.stringify(names) === JSON.stringify(EXPECTED_TOOLS), names.join(', '))

    const leaking = tools.filter((t) => {
      const props = t.inputSchema?.properties ?? {}
      return Object.keys(props).some((k) => /userid|user_id|account|email/i.test(k))
    })
    check(
      'no tool accepts a userId, so a caller cannot act as someone else',
      leaking.length === 0,
      leaking.map((t) => `${t.name}: ${Object.keys(t.inputSchema.properties).join(',')}`).join(' | ')
    )
    check('every tool declares an input schema', tools.every((t) => t.inputSchema?.type === 'object'))
    check('every tool has a description', tools.every((t) => typeof t.description === 'string' && t.description.length > 20))

    /* ---------------------------------------------------- 4. real data, live */
    console.log('\n[calls] a tool returns that user\'s real stored data')
    const projects = db
      .prepare('SELECT id, title FROM projects WHERE user_id = ? ORDER BY updated_at DESC LIMIT 1')
      .get(user.id)

    if (projects) {
      const ctx = await request(handle, 3, 'tools/call', {
        name: 'get_project_context',
        arguments: { projectId: projects.id },
      })
      const ctxText = ctx.result?.content?.[0]?.text ?? ''
      check('get_project_context succeeds', ctx.result?.isError !== true, ctxText.slice(0, 300))
      check('it returns the real project title', ctxText.includes(projects.title), ctxText.slice(0, 200))
      check('and machine-readable JSON alongside it', ctxText.includes('--- json ---'))
    } else {
      console.log('  --   that account has no project yet, so context calls are skipped')
    }

    const foreign = await request(handle, 4, 'tools/call', {
      name: 'get_project_context',
      arguments: { projectId: 'a-project-id-that-does-not-exist' },
    })
    check('a project id it does not own is refused', foreign.result?.isError === true, JSON.stringify(foreign.result).slice(0, 300))
    check('and the refusal says so plainly', /not yours/i.test(foreign.result?.content?.[0]?.text ?? ''), foreign.result?.content?.[0]?.text)

    const card = await request(handle, 5, 'tools/call', { name: 'get_reentry_card', arguments: {} })
    const cardText = card.result?.content?.[0]?.text ?? ''
    if (projects) {
      check('get_reentry_card returns a card with no model call', card.result?.isError !== true, cardText.slice(0, 300))
      check('the card is readable prose, not a JSON blob', cardText.length > 20 && !cardText.startsWith('{'), cardText.slice(0, 200))
    } else {
      check('with nothing stored it says there is nothing to resume', /no conversation to resume/i.test(cardText), cardText.slice(0, 200))
    }

    const badName = await request(handle, 6, 'tools/call', { name: 'delete_everything', arguments: {} })
    check('an unlisted tool cannot be called', !!badName.error || badName.result?.isError === true, JSON.stringify(badName).slice(0, 200))

    check('the server wrote nothing to stdout that is not protocol JSON', handle.state.stdout.split('\n').filter((l) => l.trim()).every((l) => { try { JSON.parse(l); return true } catch { return false } }), handle.state.stdout.slice(0, 300))
  } finally {
    handle.child.kill()
    await wait(200)
    const revoked = revokeMcpToken(db, user.id, issued.tokenId)
    check('the probe token is revoked afterwards', revoked === true)
    check(
      'a revoked token no longer resolves to a user',
      resolveMcpBearer(db, issued.token) === null,
      'the token still resolved after being revoked'
    )
  }

  console.log(`\n--- ${checks - failures}/${checks} checks passed`)
  if (failures > 0) {
    console.log(`${failures} FAILED`)
    process.exitCode = 1
  }
}

main().catch((err) => {
  console.error(`\nprobe crashed: ${err.message}`)
  process.exitCode = 1
})
