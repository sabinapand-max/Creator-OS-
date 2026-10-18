/**
 * SPARK assessment submission.
 *
 * One-time, rule-based scoring ported from the nd-cognitive-os engine: forty
 * Likert answers are validated, scored and translated entirely in this request —
 * no model, no cost — and only the computed profile is persisted. Raw responses
 * never outlive the request. The strengths-first translation then informs the
 * Spark screen and, through the state route, the brain-dump prompt context.
 */
import { NextResponse } from 'next/server'
import { getDb } from '@/lib/pilot/db/client.ts'
import * as repo from '@/lib/pilot/db/repo.ts'
import { optionalUser } from '@/lib/pilot/web/session.ts'
import {
  isValidSparkResponses,
  scoreSparkResponses,
  translateSparkProfile,
} from '@/lib/pilot/cognitive/spark.ts'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(request: Request) {
  const db = getDb()
  const { userId } = await optionalUser(db)
  if (!userId) {
    return NextResponse.json({ signedIn: false, error: 'Not signed in.' }, { status: 401 })
  }

  let body: { responses?: unknown }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ signedIn: true, error: 'Invalid request body.' }, { status: 400 })
  }

  // Exactly forty whole numbers on the 0-4 scale; anything else is rejected rather
  // than scored, so a malformed client cannot write a bogus profile.
  if (!isValidSparkResponses(body.responses)) {
    return NextResponse.json(
      { signedIn: true, error: 'Expected forty answers between 0 and 4.' },
      { status: 400 }
    )
  }

  const result = scoreSparkResponses(body.responses)
  await repo.saveSparkResult(db, userId, result)
  return NextResponse.json({ signedIn: true, spark: translateSparkProfile(result) })
}
