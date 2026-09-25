/**
 * Legacy generation endpoint, kept so nothing in the wider app breaks, but its
 * behaviour is now honest.
 *
 * What changed and why:
 *  - It used to return HTTP 200 with `generateMockResponse(input)` and
 *    `provider: 'mock'` both when no key was configured AND when the upstream
 *    API failed. Template text was therefore indistinguishable from model
 *    output. That is gone. Failures now return 503 with the real reason.
 *  - It used to accept `clientKey` in the request body, i.e. a secret held in
 *    browser localStorage and sent over the wire. That is refused. The key comes
 *    from the server environment only.
 *  - It used to hardcode `openai/gpt-3.5-turbo` and the OpenRouter endpoint.
 *    Both are now configurable via AI_MODEL / AI_BASE_URL.
 *
 * New code should call /api/pilot/turn, which returns the structured result.
 */
import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/pilot/db/client.ts'
import { submitTurn } from '@/lib/pilot/core/conversation.ts'
import { composeAssistantText } from '@/lib/pilot/core/prompts.ts'
import { requireUser } from '@/lib/pilot/web/session.ts'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

interface GenerateRequest {
  input: string
  /** Accepted and ignored. Kept in the type so the refusal is explicit. */
  clientKey?: string
  conversationId?: string
  idempotencyKey?: string
}

export async function POST(request: NextRequest) {
  const auth = await requireUser(getDb())
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: 401 })

  let body: GenerateRequest
  try {
    body = (await request.json()) as GenerateRequest
  } catch {
    return NextResponse.json({ error: 'Send JSON.' }, { status: 400 })
  }

  if (!body?.input?.trim()) {
    return NextResponse.json({ error: 'Input is required' }, { status: 400 })
  }

  if (body.clientKey) {
    return NextResponse.json(
      {
        error:
          'clientKey is no longer accepted. API keys must live in the server environment (AI_API_KEY), never in the browser. Remove the key from your settings screen and configure it server-side.',
      },
      { status: 400 }
    )
  }

  const result = await submitTurn(getDb(), {
    userId: auth.userId,
    text: body.input,
    channel: 'web',
    conversationId: body.conversationId ?? null,
    idempotencyKey: body.idempotencyKey ?? null,
  })

  if (!result.ok) {
    if (result.kind === 'model_failure') {
      return NextResponse.json(
        {
          error: result.failure.message,
          code: result.failure.code,
          retryable: result.failure.retryable,
          // Explicitly not mock content, so a caller cannot mistake this for a
          // successful generation.
          content: null,
          provider: null,
          preservedInput: result.preservedInput,
        },
        { status: result.failure.retryable ? 503 : 500 }
      )
    }
    return NextResponse.json({ error: result.message }, { status: 400 })
  }

  const content =
    result.kind === 'directive' ? result.text : composeAssistantText(result.turn)

  return NextResponse.json({
    content,
    provider: result.kind === 'directive' ? 'directive' : result.provider,
    model: result.kind === 'directive' ? null : result.model,
    structured: result.kind === 'directive' ? null : result.turn,
    conversationId: result.conversationId,
    latencyMs: result.kind === 'directive' ? 0 : result.latencyMs,
  })
}
