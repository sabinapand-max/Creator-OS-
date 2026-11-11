/**
 * Adaption model adapter — an OpenAI-compatible /chat/completions endpoint
 * in front of AdaptionLabs's /responses API, so the pilot can point its
 * hosted default at the owner's fine-tuned Gemma stack without touching
 * lib/pilot/model.
 *
 * The route is the seam. Everything the pilot already knows how to do
 * against an OpenAI-shaped backend (BYOK, trial counting via model_runs,
 * the endpoint-matching logic in countHostedTurns) keeps working unchanged.
 *
 * Auth contract: the pilot's model layer sends `Authorization: Bearer ${AI_API_KEY}`
 * to `${AI_BASE_URL}/chat/completions`. This route is that URL. It accepts a
 * request only when the bearer equals the same env var, so the shared secret
 * is AI_API_KEY on both sides and the real Adaption credential (ADAPTION_API_KEY)
 * never crosses to the caller.
 *
 * Response is the trimmed chat-completion shape. `usage` is preserved because
 * the model_runs table records token counts and the trial system reads them.
 */
import { NextResponse } from 'next/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const ADAPTION_URL = 'https://api.prod.adaptionlabs.ai/api/v1/responses'
const DEFAULT_STACK = 'stack:gemma-4-31b-it-1'

function flattenInput(messages: unknown): string {
  if (!Array.isArray(messages)) return ''
  return messages
    .map((m) => {
      const role = typeof (m as any)?.role === 'string' ? (m as any).role : 'user'
      const content = typeof (m as any)?.content === 'string' ? (m as any).content : ''
      return `${role}: ${content}`
    })
    .join('\n')
}

function extractText(response: any): string {
  const out = Array.isArray(response?.output) ? response.output : []
  const parts: string[] = []
  for (const item of out) {
    const content = Array.isArray(item?.content) ? item.content : []
    for (const block of content) {
      if (block && typeof block === 'object' && typeof block.text === 'string') {
        parts.push(block.text)
      }
    }
  }
  return parts.join('\n')
}

export async function POST(request: Request) {
  const shared = process.env.AI_API_KEY
  const bearer = (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '').trim()
  if (!shared || bearer !== shared) {
    return NextResponse.json({ error: { message: 'unauthorized' } }, { status: 401 })
  }

  const adaptionKey = process.env.ADAPTION_API_KEY
  if (!adaptionKey) {
    return NextResponse.json(
      { error: { message: 'ADAPTION_API_KEY is not configured on this server' } },
      { status: 500 }
    )
  }

  let payload: any
  try {
    payload = await request.json()
  } catch {
    return NextResponse.json({ error: { message: 'invalid JSON body' } }, { status: 400 })
  }

  const model = String(payload?.model || process.env.AI_MODEL || DEFAULT_STACK)
  const input = flattenInput(payload?.messages)
  if (!input.trim()) {
    return NextResponse.json({ error: { message: 'empty input' } }, { status: 400 })
  }

  const upstream = await fetch(ADAPTION_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${adaptionKey}`,
    },
    body: JSON.stringify({ model, input }),
  })
  const text = await upstream.text()
  if (!upstream.ok) {
    return NextResponse.json(
      {
        error: {
          message: `adaption upstream returned ${upstream.status}`,
          detail: text.slice(0, 500),
        },
      },
      { status: upstream.status }
    )
  }

  let data: any
  try {
    data = JSON.parse(text)
  } catch {
    return NextResponse.json(
      { error: { message: 'adaption upstream returned non-JSON' } },
      { status: 502 }
    )
  }

  const outText = extractText(data)
  const usage = data.usage || {}
  const promptTokens = Number(usage.input_tokens || 0)
  const completionTokens = Number(usage.output_tokens || 0)

  return NextResponse.json({
    id: data.id || `chatcmpl-${Date.now()}`,
    object: 'chat.completion',
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [
      {
        index: 0,
        message: { role: 'assistant', content: outText },
        finish_reason: 'stop',
      },
    ],
    usage: {
      prompt_tokens: promptTokens,
      completion_tokens: completionTokens,
      total_tokens: promptTokens + completionTokens,
    },
  })
}
