/**
 * Content drafts: list them, or ask the model to write a new set.
 *
 * This is the endpoint Social Studio and Marketplace actually use. Both screens
 * previously read a browser-local list nothing wrote to, which is why they
 * rendered an empty state forever.
 *
 * Identity comes only from the session cookie; a `userId` in the body or query
 * is never read. The model key comes from the server environment inside the
 * model layer, never from the request.
 *
 * Nothing here publishes or sends anything. Generating a draft stores text the
 * user reads, edits and copies out by hand.
 */
import { NextResponse } from 'next/server'
import { getDb } from '@/lib/pilot/db/client.ts'
import { generateDrafts, listDrafts } from '@/lib/pilot/core/drafts.ts'
import { requireUser } from '@/lib/pilot/web/session.ts'
import { OFFER_CHANNELS, SOCIAL_CHANNELS, type DraftKind } from '@/lib/pilot/types.ts'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const auth = await requireUser(getDb())
  if (!auth.ok) return NextResponse.json({ ok: false, error: auth.error }, { status: 401 })

  const url = new URL(request.url)
  const kindParam = url.searchParams.get('kind')
  const kind: DraftKind | null =
    kindParam === 'social' || kindParam === 'offer' ? kindParam : null
  const projectId = url.searchParams.get('projectId')

  return NextResponse.json({
    ok: true,
    drafts: listDrafts(getDb(), auth.userId, { kind, projectId }),
    channels: { social: SOCIAL_CHANNELS, offer: OFFER_CHANNELS },
  })
}

export async function POST(request: Request) {
  const auth = await requireUser(getDb())
  if (!auth.ok) return NextResponse.json({ ok: false, error: auth.error }, { status: 401 })

  let body: any
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ ok: false, error: 'Send JSON.' }, { status: 400 })
  }

  const kind = body?.kind === 'offer' ? 'offer' : 'social'
  const channels = Array.isArray(body?.channels) ? body.channels : []
  const projectId = typeof body?.projectId === 'string' ? body.projectId : null
  const brief = typeof body?.brief === 'string' ? body.brief : null

  const result = await generateDrafts(getDb(), {
    userId: auth.userId,
    kind,
    channels,
    projectId,
    brief,
    source: 'drafts:web',
  })

  if (!result.ok) {
    if (result.kind === 'model_failure') {
      return NextResponse.json(
        {
          ok: false,
          kind: 'model_failure',
          code: result.failure.code,
          error: result.failure.message,
          retryable: result.failure.retryable,
          provider: result.failure.provider ?? null,
          model: result.failure.model ?? null,
          runId: result.runId,
        },
        { status: result.failure.retryable ? 503 : 500 }
      )
    }
    // `no_context` is a 409: the request was well formed, but the pilot has
    // nothing stored to write from yet, and the message says what to do.
    const status = result.kind === 'not_found' ? 404 : result.kind === 'no_context' ? 409 : 400
    return NextResponse.json({ ok: false, kind: result.kind, error: result.message }, { status })
  }

  return NextResponse.json({
    ok: true,
    kind: 'drafts',
    drafts: result.drafts,
    projectId: result.projectId,
    projectTitle: result.projectTitle,
    provider: result.provider,
    model: result.model,
    latencyMs: result.latencyMs,
    runId: result.runId,
    // Passed through so the UI can say the answer was cut short rather than
    // showing a partial set of channels as though it were the whole reply.
    truncated: result.truncated,
  })
}
