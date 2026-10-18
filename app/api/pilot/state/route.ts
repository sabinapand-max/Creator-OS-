/**
 * Durable state for the signed-in pilot user.
 *
 * The Brain Dump result survives a page refresh because it is read back from
 * SQLite here, not from localStorage. localStorage may still cache the draft
 * the user is typing, but the authoritative history is this response.
 */
import { NextResponse } from 'next/server'
import { getDb } from '@/lib/pilot/db/client.ts'
import * as repo from '@/lib/pilot/db/repo.ts'
import { describeReadiness, readModelConfig } from '@/lib/pilot/model/index.ts'
import { optionalUser } from '@/lib/pilot/web/session.ts'
import { checkInAndPersist, describeMap } from '@/lib/pilot/cognitive/index.ts'
import { ENERGY_LEVELS, SENSORY_LEVELS } from '@/lib/pilot/cognitive/stateMachine.ts'
import type { CognitiveEnergy, CognitiveMap, CognitiveSensory } from '@/lib/pilot/types.ts'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const db = getDb()
  const { userId } = await optionalUser(db)
  const config = readModelConfig()
  const readiness = describeReadiness(config)

  if (!userId) {
    return NextResponse.json({ signedIn: false, model: publicModelStatus(readiness) })
  }

  const url = new URL(request.url)
  const conversationId = url.searchParams.get('conversationId')

  const projects = await repo.listProjects(db, userId)
  const conversations = await repo.listConversations(db, userId, 25)
  const activeConversationId =
    conversationId ?? conversations.find((c) => c.status === 'active')?.id ?? conversations[0]?.id ?? null

  const user = await repo.getUserById(db, userId)
  const messages = activeConversationId ? await repo.listMessages(db, userId, activeConversationId, 100) : []
  const latestAction = activeConversationId
    ? await repo.latestActionForConversation(db, userId, activeConversationId)
    : null
  const openActions = await repo.listOpenActions(db, userId, null, 10)
  const facts = await repo.listFacts(db, userId, undefined, 60)
  const recentModelRuns = (await repo.recentModelRuns(db, userId, 5)).map((r) => ({
    id: r.id,
    status: r.status,
    provider: r.provider,
    model: r.model,
    errorCode: r.errorCode,
    latencyMs: r.latencyMs,
    createdAt: r.createdAt,
  }))

  // Today's capacity + the map that produced it, from the ND cognitive engine.
  // One rule-based read (null until the first turn). `cognitive` is the dashboard's
  // lightweight snapshot; `cognitiveMap` is the full read the Mind screen renders.
  const cognitiveMap = await describeMap(db, userId).catch(() => null)
  const cognitive = cognitiveMap ? snapshotSubset(cognitiveMap) : null

  return NextResponse.json({
    signedIn: true,
    user: user ? { id: user.id, email: user.email, displayName: user.displayName } : null,
    model: publicModelStatus(readiness),
    projects,
    conversations,
    activeConversationId,
    messages,
    latestAction,
    openActions,
    facts,
    recentModelRuns,
    cognitive,
    cognitiveMap,
  })
}

/** The lightweight dashboard read derived from the full map. Shared by GET and POST. */
function snapshotSubset(map: CognitiveMap) {
  return {
    current: map.current,
    energy: map.energy,
    sensory: map.sensory,
    label: map.label,
    capacityNote: map.capacityNote,
    microStep: map.microStep,
  }
}

/**
 * Manual Mind check-in: the person taps today's energy and/or sensory level. Rule-based
 * (no model, no cost); persists and returns the refreshed map so the screen updates
 * without a page reload. Unknown or absent values are ignored rather than trusted.
 */
export async function POST(request: Request) {
  const db = getDb()
  const { userId } = await optionalUser(db)
  if (!userId) {
    return NextResponse.json({ signedIn: false, error: 'Not signed in.' }, { status: 401 })
  }

  let body: { energy?: unknown; sensory?: unknown }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ signedIn: true, error: 'Invalid request body.' }, { status: 400 })
  }

  const energyValues = Object.values(ENERGY_LEVELS) as string[]
  const sensoryValues = Object.values(SENSORY_LEVELS) as string[]
  const patch: { energy?: CognitiveEnergy; sensory?: CognitiveSensory } = {}
  if (typeof body?.energy === 'string' && energyValues.includes(body.energy)) {
    patch.energy = body.energy as CognitiveEnergy
  }
  if (typeof body?.sensory === 'string' && sensoryValues.includes(body.sensory)) {
    patch.sensory = body.sensory as CognitiveSensory
  }
  if (!patch.energy && !patch.sensory) {
    return NextResponse.json({ signedIn: true, error: 'No valid energy or sensory value.' }, { status: 400 })
  }

  const cognitiveMap = await checkInAndPersist(db, userId, patch).catch(() => null)
  const cognitive = cognitiveMap ? snapshotSubset(cognitiveMap) : null
  return NextResponse.json({ signedIn: true, cognitive, cognitiveMap })
}

/** Never leaks the key: only whether one is present and what is configured. */
function publicModelStatus(readiness: ReturnType<typeof describeReadiness>) {
  const config = readModelConfig()
  if (readiness.ready) {
    return {
      configured: true,
      provider: readiness.provider,
      modelId: readiness.modelId,
      baseUrl: readiness.baseUrl,
      local: readiness.local,
      // Reported accurately: a loopback endpoint is ready without a key, so
      // claiming one is present would be a lie the UI would repeat.
      apiKeyPresent: Boolean(config.apiKey),
    }
  }
  return {
    configured: false,
    code: readiness.code,
    message: readiness.message,
    apiKeyPresent: Boolean(config.apiKey),
  }
}
