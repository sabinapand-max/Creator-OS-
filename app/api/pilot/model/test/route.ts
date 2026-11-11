/**
 * Bring-your-own-key connection test.
 *
 * Runs one minimal completion against a candidate endpoint/key/model so Settings
 * can say "this works" before the user relies on it. The supplied key is used for
 * this single request only: it is never logged, echoed, or written to the database
 * or browser storage. A signed-in pilot user is required so this route cannot be
 * used as an open proxy to arbitrary endpoints.
 */
import { NextResponse } from 'next/server'
import { getDb } from '@/lib/pilot/db/client.ts'
import { requireUser } from '@/lib/pilot/web/session.ts'
import { buildModelConfigFromOverride, callModel } from '@/lib/pilot/model/index.ts'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(request: Request) {
  const auth = await requireUser(getDb())
  if (!auth.ok) return NextResponse.json({ ok: false, error: auth.error }, { status: 401 })

  let body: any
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ ok: false, error: 'Send JSON.' }, { status: 400 })
  }

  const config = buildModelConfigFromOverride(body?.byok ?? {})
  if (!config) {
    return NextResponse.json(
      { ok: false, code: 'incomplete', message: 'An endpoint URL and a model id are both required.' },
      { status: 400 }
    )
  }

  // Ask for a tiny, grammar-constrained reply so the check proves the exact path a
  // real turn uses (auth, endpoint, model, JSON mode) without spending meaningful tokens.
  const outcome = await callModel(
    [{ role: 'user', content: 'Return exactly this JSON object: {"status":"ok"}' }],
    config,
    { maxTokens: 24, temperature: 0 }
  )

  if (outcome.ok) {
    return NextResponse.json({
      ok: true,
      provider: config.provider,
      modelId: config.modelId,
      latencyMs: outcome.latencyMs,
    })
  }

  // ModelFailure.message never contains the key (see model/index.ts); relay it as-is.
  return NextResponse.json(
    {
      ok: false,
      code: outcome.code,
      message: outcome.message,
      status: outcome.status ?? null,
      provider: config.provider,
      modelId: config.modelId,
    },
    { status: 502 }
  )
}
