# Creator OS — pilot handoff

Snapshot date: 2026-09-07
Source: extracted from `v0-creator-os-build.zip` (the real Creator OS — it contains
`BrainDumpWorkspace`, `creator-store`, `brain-dump-store` and `app/api/generate/route.ts`).

> **`SETUP.md` in this folder is inherited from the original build and is not
> accurate.** It claims the app is "production-ready" with "real AI integration"
> and "secure key storage (browser only)". The code did not do that: the generate
> route returned HTTP 200 with hardcoded template text both when no key was set
> and when the provider errored, and API keys were held in browser localStorage
> and posted to the server. Read this file instead.

---

## 1. What changed

### Removed from the active path (files kept, nothing deleted)
| File | What it did | Status |
|---|---|---|
| `app/api/generate/route.ts` | Returned `generateMockResponse()` with HTTP 200 when no key **and** on API error; hardcoded `openai/gpt-3.5-turbo`; accepted `clientKey` from the request body | **Rewritten.** Delegates to the shared core, refuses `clientKey` with HTTP 400, returns 503 + real reason on failure |
| `lib/providers/ai-provider.ts` | Hardcoded `openai/gpt-3.5-turbo`, `claude-3-sonnet-20240229`, Groq endpoint | Not imported by the pilot path |
| `lib/providers/provider-manager.ts` | Silent fallback chain ending in `MockProvider` whose `isAvailable()` always returns true | Not imported by the pilot path |
| `lib/mock-ai-service.ts` | Emits hardcoded Etsy / Gumroad / Fiverr / SEO templates regardless of model output | **Still imported by the UI — see §7** |
| `components/screens/settings.tsx` | Collects Groq / OpenRouter / Claude keys into browser localStorage | **Still present — see §7** |

### Added
```
lib/pilot/
  db/schema.ts        SQLite schema, 15 tables, per-user isolation indexes
  db/client.ts        node:sqlite connection, WAL, busy_timeout, schema-version guard
  db/repo.ts          every read/write takes userId and filters on it
  types.ts            the shared contract between UI, MCP and Telegram
  auth/index.ts       scrypt passwords, sessions, MCP bearer tokens,
                      short-lived single-use Telegram link codes
  model/index.ts      configurable provider/model/endpoint, NO fallback chain,
                      latency measured, hosted-loopback guard
  core/prompts.ts     the behavioural contract (1 interpretation, ≤1 question,
                      exactly 1 next action, Etsy/inventory excluded)
  core/directives.ts  "save for later" / "where was I?" answered with no model call
  core/context.ts     project context assembly
  core/memory.ts      facts with source + timestamps, correctable and deletable
  core/conversation.ts  THE engine. UI, MCP tools and Telegram all call this
  web/session.ts      httpOnly cookie session; userId never comes from a request body

app/api/pilot/auth/route.ts    register / signin / signout
app/api/pilot/turn/route.ts    one brain-dump turn
app/api/pilot/state/route.ts   durable state, read back after refresh
tests/helpers.ts               labelled test double for external inference
tests/brain-dump-slice.test.ts 17 tests
scripts/smoke-web.mjs          28 HTTP checks against a running server
.env.example                   every variable name, no secret values
```

Also: `.gitignore` now excludes `data/` and `*.sqlite*`; `next.config.mjs` pins
`turbopack.root` (Next.js was inferring `C:\Users\danap` because of stray lockfiles).

---

## 2. Startup — Windows / PowerShell

```powershell
cd c:\Users\danap\ND-cognitive-OS\creator-os-pilot

# once
npm install

# configure (copy the template, then edit)
Copy-Item .env.example .env.local

# run
npm run dev          # http://localhost:3100
```

PowerShell here does not accept `&&`; use `;` to chain commands.

Other commands:

| Command | Purpose |
|---|---|
| `npm test` | 17 unit tests (no server needed) |
| `node scripts/smoke-web.mjs` | 28 HTTP checks (needs `npm run dev` running) |
| `npm run typecheck` | `tsc --noEmit`. **Needed** — `next.config.mjs` inherits `ignoreBuildErrors: true`, so `next build` will NOT fail on type errors |
| `npm run build` | production build |

Ports: 3100 (app), 3101 (reserved for the MCP server). Chosen to avoid
ND-cognitive-OS on 3001 and Hermes on 3000.

Requires **Node 22.5+** (built on Node 24.2.0) for `node:sqlite` and native
TypeScript type-stripping. No build step is needed to run the tests or scripts.

---

## 3. Environment variables (names only — no values)

**Inference**
- `AI_BASE_URL` — any OpenAI-compatible endpoint. LM Studio: `http://127.0.0.1:1234/v1`
- `AI_MODEL` — model id. Nothing is hardcoded and there is no default
- `AI_API_KEY` — optional; not required for a loopback endpoint
- `AI_PROVIDER` — optional, inferred from `AI_BASE_URL` (`lmstudio` | `openai-compatible` | `openrouter`)
- `AI_TIMEOUT_MS` — optional, default 60000

Older aliases still read if the `AI_*` names are absent:
`PILOT_MODEL_BASE_URL`, `PILOT_MODEL_ID`, `PILOT_MODEL_API_KEY`, `PILOT_MODEL_PROVIDER`, `PILOT_MODEL_TIMEOUT_MS`

**Storage / app**
- `PILOT_DB_PATH` — default `./data/pilot.sqlite`, relative paths resolve to the app root
- `PILOT_APP_URL` — default `http://localhost:3100`
- `PILOT_MCP_PORT` — default 3101
- `PILOT_HOSTED` — set `true` when NOT running on your laptop; this makes the app **refuse** a loopback `AI_BASE_URL`, because on a hosted server localhost is the server, not your machine
- `PILOT_ALLOW_LOOPBACK_MODEL` — escape hatch for the above, off by default

**Telegram (delivery gated OFF by default)**
- `PILOT_TELEGRAM_SEND_ENABLED`
- `PILOT_TELEGRAM_BOT_TOKEN`
- `PILOT_TELEGRAM_WEBHOOK_SECRET`

All keys are read server-side only. No route accepts a key from a request body,
and no key is written to localStorage, a client bundle, a log line or an error
message. `/api/pilot/state` reports `apiKeyPresent: true|false` and never the key.

---

## 4. Test results

`npm test` — **17/17 pass**

- structured result from the configured endpoint; model id reached the endpoint unhardcoded; latency measured
- result saved to SQLite and **survives a real close-and-reopen of the database file**
- follow-up continues the same conversation, creates no second project, earlier content is in the prompt
- Etsy/inventory exclusion and the ≤1 question / exactly 1 action limits asserted against the prompt contract
- unconfigured model → honest `model_not_configured`, input preserved, **no invented assistant reply**
- outage → retryable error → clean retry, no duplicated user message
- malformed reply → `model_invalid_response`; slow reply → `model_timeout`
- "save for later" / "where was I?" succeed with a dead endpoint (no model call)
- re-entry card names the project and the single next action
- retried idempotency key → model called once, same action id, one next action
- identical text without a key → treated as a new turn (both answered)
- User B gets `not_found` on User A's project / conversation / action / fact ids
- User B cannot write into User A's records; A's data verified unchanged afterwards
- User B cannot continue User A's conversation — and **no model call happens**, so none of A's content can reach a prompt
- facts carry `source` + timestamps, are correctable (previous value traceable) and deletable

`node scripts/smoke-web.mjs` — **28/28 pass** over HTTP against the running dev
server, covering registration, session cookies, the honest 503, state read-back
after refresh, directives, `clientKey` refusal, cross-user isolation and
unauthenticated rejection.

Test data is synthetic. Inference in tests is served by a **labelled test double**
(`tests/helpers.ts`) — a local HTTP server that identifies itself as
`FAKE MODEL test double`. It stands in for external inference only; it is never
used to make mock output look like AI output in the product.

---

## 5. Data

Everything lives in one SQLite file: `data/pilot.sqlite` (+ `-wal`, `-shm`).
Users, projects, conversations, messages, next actions, facts, Telegram links,
link codes, model runs, outbox and an audit log.

- Git-ignored. Verify with `git check-ignore -v data/pilot.sqlite`.
- Back up by copying the file while the server is stopped.
- Two processes can open it concurrently (web + MCP): WAL mode and
  `busy_timeout=5000` are set on every connection.
- A schema-version mismatch throws on open rather than silently reading a schema
  the code does not understand.
- Nothing is ever read from or written to a personal Hermes memory. This file is
  the only pilot store.

---

## 6. Design decisions worth knowing

- **No fallback chain.** One configured provider. A failure returns a typed error
  (`model_not_configured`, `model_unreachable`, `model_timeout`,
  `model_http_error`, `model_invalid_response`, `model_endpoint_unsafe`) instead
  of degrading into another provider or into template text.
- **Identity never comes from input.** The pilot user id is derived only from an
  httpOnly session cookie, or from a bearer token hash, or from a verified
  Telegram chat id looked up in `telegram_links`. Every `repo` function takes
  `userId` and filters on it; a lookup by record id always adds `AND user_id = ?`.
  A record id belonging to someone else reads as "not found".
- **Idempotency.** Partial unique indexes on `(user_id, idempotency_key)` for
  messages, next actions and model runs. The web UI supplies a key per submit and
  reuses it on retry; Telegram's `update_id` is the natural key. A retried request
  replays the stored result instead of calling the model again.
- **Directives bypass the model** so "save for later" and "where was I?" keep
  working during an outage and cannot be paraphrased differently by a different
  provider.
- **SQLite, not Postgres.** Chosen after inspecting the stack: the Creator OS zip
  ships with no database, and a three-person local pilot does not justify
  provisioning a hosted Postgres. Hermes' Neon database was deliberately *not*
  reused — it holds personal and production data.

---

## 7. Known gaps — read before trying it in a browser

1. **The visible UI still renders fake output.** `components/screens/brain-dump-workspace.tsx`
   still imports `generateFromBrainDump` from `lib/mock-ai-service.ts`, which
   emits hardcoded Etsy / Gumroad / Fiverr templates regardless of what the API
   returns. Clicking *Generate* in the browser will show plausible-looking mock
   advice, not a real result. **The proven-working path is the API**, not the UI.
2. **No sign-in screen.** `/api/pilot/auth` works (proven by the smoke test), but
   there is no page that calls it, so a browser session has no cookie and every
   pilot route returns 401.
3. **`settings.tsx` still collects browser-side keys** into localStorage. Those
   keys are now refused by the API, but the screen should be replaced with a
   read-only server-side model status.
4. **MCP server not written.** `mcp/` is empty. The five tools
   (`capture_brain_dump`, `get_project_context`, `append_conversation_message`,
   `propose_next_action`, `get_reentry_card`) are designed and the core functions
   behind them exist and are tested, but the SDK server process is not there yet.
5. **Telegram handler not written.** `lib/pilot/telegram/` is empty. Link codes
   are implemented and tested at the auth layer; the inbound update handler and
   the send-gated outbound gateway are not.
6. **`scripts/dev-all.mjs`, `seed-pilot.ts`, `telegram-poll.ts`, `db-reset.ts`**
   are referenced by `package.json` but not written yet.
7. `next.config.mjs` inherits `typescript.ignoreBuildErrors: true` from the
   original build, so `next build` will not catch type errors. Run
   `npm run typecheck`.

---

## 8. Where this folder should live

The code is path-independent: the DB path resolves against the app root, no
import reaches outside this folder, and no absolute paths are embedded. All
three arrangements work without code changes.

1. **Standalone at `c:\Users\danap\creator-os`** — move the folder, `git init`, open
   it as the IDE workspace. Cleanest history, keeps Creator OS separate from the
   Cognitive ND repo.
2. **Nested in ND-cognitive-OS** — as it is now. Give it its own git repo and add
   `creator-os-pilot/` to the ND `.gitignore`. Ports already avoid collisions.
3. **Integrated as a view** — the `AGENTS.md` precedent for the Mind view. Larger
   job, not this milestone.

Currently it sits inside `c:\Users\danap\ND-cognitive-OS` only because the
editing tools available for this work are sandboxed to the open workspace. That
is a tooling constraint, not an architectural decision. Creator OS is standalone.

---

## 9. Excluded from this zip

`node_modules/` (run `npm install`), `.next/` (build artefacts),
`data/` (the SQLite file with smoke-test accounts), `.env.local`
(local config — recreate with `Copy-Item .env.example .env.local`).
