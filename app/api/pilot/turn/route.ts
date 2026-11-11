/**
 * One brain-dump turn.
 *
 * This replaces the old silent-mock generation path. The route does three
 * things and nothing else: resolves the pilot user from the session cookie,
 * hands the text to the shared core engine, and translates the outcome into an
 * honest HTTP response. A model outage returns 503 with the reason and keeps the
 * user's input, so the client can retry with the same idempotency key.
 *
 * Model configuration comes from the server environment by default. A signed-in
 * user may instead bring their own endpoint and key for this one request (BYOK):
 * it is passed straight to the model layer, used for the single call, and never
 * logged, echoed, or written to the database or browser storage.
 */
import { NextResponse } from 'next/server'
import { getDb } from '@/lib/pilot/db/client.ts'
import { submitTurn } from '@/lib/pilot/core/conversation.ts'
import { requireUser } from '@/lib/pilot/web/session.ts'
import { buildModelConfigFromOverride } from '@/lib/pilot/model/index.ts'

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

  // Optional bring-your-own-key for this one turn. Used transiently by the model
  // layer; never logged, echoed, or written to the database. Falls back to the
  // server configuration when absent or incomplete.
  const byok = body?.byok && typeof body.byok === 'object' ? body.byok : undefined
  const modelConfig = byok ? buildModelConfigFromOverride(byok) : undefined

  const result = await submitTurn(getDb(), {
    userId: auth.userId,
    text,
    channel: 'web',
    conversationId,
    projectId,
    projectTitle,
    idempotencyKey,
    modelConfig,
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
    cognitive: result.cognitive ?? null,
    assistantMessageId: result.assistantMessage.id,
    provider: result.provider,
    model: result.model,
    latencyMs: result.latencyMs,
    deduplicated: result.deduplicated,
  })
}
