/**
 * SPARK assessment slice — the nd-cognitive-os engine port.
 *
 * The invariants that matter: the question set is the original 40 (8 per
 * dimension), scoring matches the original's bands and profile thresholds, the
 * translation stays strengths-first (low dimensions are never named as
 * deficits), and persistence round-trips one row per user with corruption-safe
 * reads. All rule-based and offline, exactly how it ships.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  SPARK_DIMENSIONS,
  SPARK_QUESTIONS,
  getSparkGuidance,
  isValidSparkResponses,
  scoreSparkResponses,
  translateSparkProfile,
} from '../lib/pilot/cognitive/spark.ts'
import * as repo from '../lib/pilot/db/repo.ts'
import type { SparkResult } from '../lib/pilot/types.ts'
import { makeUser, tempStore } from './helpers.ts'

/* ---------------------------------------------------------------- question set */

test('the assessment is the original forty questions, eight per dimension', () => {
  assert.equal(SPARK_QUESTIONS.length, 40)
  for (const dim of SPARK_DIMENSIONS) {
    assert.equal(SPARK_QUESTIONS.filter((q) => q.dim === dim).length, 8, `${dim} has 8 questions`)
  }
})

test('response validation only accepts forty integers on the 0-4 scale', () => {
  assert.equal(isValidSparkResponses(Array(40).fill(2)), true)
  assert.equal(isValidSparkResponses(Array(39).fill(2)), false)
  assert.equal(isValidSparkResponses([...Array(39).fill(2), 5]), false)
  assert.equal(isValidSparkResponses([...Array(39).fill(2), 1.5]), false)
  assert.equal(isValidSparkResponses('not-an-array'), false)
})

/* ---------------------------------------------------------------------- scoring */

test('maximum answers score the Wildfire at the top of the index', () => {
  const r = scoreSparkResponses(Array(40).fill(4))
  assert.equal(r.sparkIndex, 20)
  assert.equal(r.profileType, 'The Wildfire')
  for (const dim of SPARK_DIMENSIONS) assert.equal(r.results[dim], 4)
})

test('zero answers are The Quiet Spark, not a deficit statement', () => {
  const r = scoreSparkResponses(Array(40).fill(0))
  assert.equal(r.sparkIndex, 0)
  assert.equal(r.profileType, 'The Quiet Spark')
})

test('profile thresholds follow the original engine exactly', () => {
  // Every dimension answers alike, so the index is 5 x the answer: 5, 10, 15, 20.
  assert.equal(scoreSparkResponses(Array(40).fill(1)).profileType, 'The Quiet Spark') // 5
  assert.equal(scoreSparkResponses(Array(40).fill(2)).profileType, 'The Flickering Spark') // 10
  assert.equal(scoreSparkResponses(Array(40).fill(3)).profileType, 'The Burning Spark') // 15
  assert.equal(scoreSparkResponses(Array(40).fill(4)).profileType, 'The Wildfire') // 20
})

/* ------------------------------------------------------------------ translation */

test('translation is strengths-first: only active dimensions surface, strongest first', () => {
  const responses = SPARK_QUESTIONS.map((q) => (q.dim === 'CI' ? 4 : q.dim === 'CD' ? 3 : 0))
  const profile = translateSparkProfile(scoreSparkResponses(responses))
  assert.ok(profile)
  assert.deepEqual(
    profile!.active.map((d) => d.key),
    ['CI', 'CD']
  )
  assert.equal(profile!.topStrengths.length, 2)
  assert.ok(/deeply/i.test(profile!.topStrengths[0]))
  // Quiet dimensions exist in the full reading but never in active guidance.
  assert.equal(getSparkGuidance(scoreSparkResponses(responses)).length, 2)
})

test('all-quiet profiles translate to an empty active set, never an error', () => {
  const profile = translateSparkProfile(scoreSparkResponses(Array(40).fill(0)))
  assert.ok(profile)
  assert.equal(profile!.active.length, 0)
  assert.deepEqual(profile!.topStrengths, [])
  assert.equal(profile!.summary, profile!.profileType)
})

test('summary names the profile type and the two loudest dimensions', () => {
  const responses = SPARK_QUESTIONS.map((q) => (q.dim === 'CI' ? 4 : q.dim === 'SA' ? 3 : 1))
  const profile = translateSparkProfile(scoreSparkResponses(responses))
  assert.ok(profile!.summary.includes('strongest in Cognitive Intensity and Sensory Amplification'))
})

test('translateSparkProfile is null without a stored result', () => {
  assert.equal(translateSparkProfile(null), null)
  assert.equal(translateSparkProfile(undefined), null)
})

/* ------------------------------------------------------------------- persistence */

test('spark result round-trips one row per user, and retaking overwrites', async () => {
  const { db, dispose } = tempStore()
  try {
    const user = await makeUser(db, 'spark@example.com')
    assert.equal(await repo.getSparkResult(db, user.id), null)

    const first: SparkResult = scoreSparkResponses(Array(40).fill(3))
    await repo.saveSparkResult(db, user.id, first)
    const got = await repo.getSparkResult(db, user.id)
    assert.deepEqual(got, first)

    // A retake replaces rather than duplicates: still one readable row.
    const second = scoreSparkResponses(Array(40).fill(1))
    await repo.saveSparkResult(db, user.id, second)
    assert.deepEqual(await repo.getSparkResult(db, user.id), second)
  } finally {
    dispose()
  }
})

test('a corrupt or structurally wrong blob degrades to null rather than throwing', async () => {
  const { db, dispose } = tempStore()
  try {
    const user = await makeUser(db, 'spark2@example.com')
    await db
      .prepare('INSERT INTO spark_results (user_id, result_json, updated_at) VALUES (?, ?, ?)')
      .run(user.id, 'not-json', '2026-01-01T00:00:00.000Z')
    assert.equal(await repo.getSparkResult(db, user.id), null)

    await db
      .prepare(
        `INSERT INTO spark_results (user_id, result_json, updated_at) VALUES (?, ?, ?)
         ON CONFLICT(user_id) DO UPDATE SET result_json = excluded.result_json`
      )
      .run(user.id, JSON.stringify({ nonsense: true }), '2026-01-01T00:00:00.000Z')
    assert.equal(await repo.getSparkResult(db, user.id), null)
  } finally {
    dispose()
  }
})
