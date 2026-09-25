/**
 * One brain-dump turn.
 *
 * This replaces the old silent-mock generation path. The route does three
 * things and nothing else: resolves the pilot user from the session cookie,
 * hands the text to the shared core engine, and translates the outcome into an
 * honest HTTP response. A model outage returns 503 with the reason and keeps the
 * user's input, so the client can retry with the same idempotency key.
 *
 * The API key is never read from the request. It comes from the server
 * environment inside the model layer.
 */
import { NextResponse } from 'next/server'
import { getDb } from '@/lib/pilot/db/client.ts'
import { submitTurn } from '@/lib/pilot/core/conversation.ts'
import { requireUser } from '@/lib/pilot/web/session.ts'

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

  const text = typeof body?.text === 'string' ? body.text : ''
  const conversationId = typeof body?.conversationId === 'string' ? body.conversationId : null
  const projectId = typeof body?.projectId === 'string' ? body.projectId : null
  const projectTitle = typeof body?.projectTitle === 'string' ? body.projectTitle : null
  const idempotencyKey = typeof body?.idempotencyKey === 'string' ? body.idempotencyKey : null

  const result = await submitTurn(getDb(), {
    userId: auth.userId,
    text,
    channel: 'web',
    conversationId,
    projectId,
    projectTitle,
    idempotencyKey,
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
          conversationId: result.conversationId,
          projectId: result.projectId,
          // Echoed back so the client can show that nothing was lost.
          preservedInput: result.preservedInput,
        },
        { status: result.failure.retryable ? 503 : 500 }
      )
    }
    return NextResponse.json(
      { ok: false, kind: result.kind, error: result.message },
      { status: result.kind === 'not_found' ? 404 : 400 }
    )
  }

  if (result.kind === 'directive') {
    return NextResponse.json({
      ok: true,
      kind: 'directive',
      directive: result.directive,
      conversationId: result.conversationId,
      projectId: result.projectId,
      text: result.text,
      card: result.card,
    })
  }

  return NextResponse.json({
    ok: true,
    kind: 'model_turn',
    conversationId: result.conversationId,
    projectId: result.projectId,
    turn: result.turn,
    nextAction: result.nextAction,
    assistantMessageId: result.assistantMessage.id,
    provider: result.provider,
    model: result.model,
    latencyMs: result.latencyMs,
    deduplicated: result.deduplicated,
  })
}
