/**
 * ND cognitive engine slice.
 *
 * Covers the three invariants that matter now that the engine runs inside the live
 * pilot: signal detection is rule-based and conservative (neutral text changes
 * nothing), the state machine records a transition only when the state actually
 * moves, and the persistence layer round-trips one row per user with a bounded,
 * corruption-safe history. All offline, no model — exactly how the engine ships.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  advanceAndPersist,
  advanceState,
  checkInAndPersist,
  dailyCognitiveBriefing,
  describeCurrent,
  describeMap,
  detectSignals,
} from '../lib/pilot/cognitive/index.ts'
import { createInitialState, STATES } from '../lib/pilot/cognitive/stateMachine.ts'
import { detectPatterns, patternLine } from '../lib/pilot/cognitive/patterns.ts'
import * as repo from '../lib/pilot/db/repo.ts'
import type { CognitiveHistoryEntry, CognitiveState } from '../lib/pilot/types.ts'
import { makeUser, tempStore } from './helpers.ts'

/* ---------------------------------------------------------------- detection */

test('detectSignals reads overwhelm + exhaustion as depleted', () => {
  const d = detectSignals("I'm completely overwhelmed lately and totally exhausted")
  assert.equal(d.state, STATES.OVERWHELMED)
  assert.equal(d.energy, 'depleted')
})

test('detectSignals reads hyperfocus as high energy', () => {
  const d = detectSignals('I hyperfocused and lost track of time, up all night working')
  assert.equal(d.state, STATES.HYPERFOCUS)
  assert.equal(d.energy, 'high')
})

test('a neutral brain dump changes no state', () => {
  const d = detectSignals('Here is my plan for launching the newsletter next month')
  assert.equal(d.state, undefined)
  assert.equal(d.energy, undefined)
  assert.equal(d.sensory, undefined)
})

/* ---------------------------------------------------------------- state machine */

test('advanceState records one transition and does not repeat it', () => {
  let s = createInitialState()
  assert.equal(s.current, STATES.DORMANT)

  s = advanceState(s, 'I am overwhelmed and stressed out')
  assert.equal(s.current, STATES.OVERWHELMED)
  assert.equal(s.history.length, 1)

  // Same signal again — state is unchanged, so no second history entry churns.
  s = advanceState(s, 'still feeling overwhelmed and stressed')
  assert.equal(s.current, STATES.OVERWHELMED)
  assert.equal(s.history.length, 1)
})

test('neutral text leaves state and history untouched', () => {
  const before = createInitialState()
  const after = advanceState(before, 'just some project notes about the book chapter')
  assert.equal(after.current, STATES.DORMANT)
  assert.equal(after.history.length, 0)
})

/* ---------------------------------------------------------------- persistence */

test('cognitive state round-trips through the store, one row per user', async () => {
  const { db, dispose } = tempStore()
  try {
    const user = await makeUser(db, 'cog@example.com')

    assert.equal(await repo.getCognitiveState(db, user.id), null)

    await repo.upsertCognitiveState(db, user.id, {
      current: STATES.FLOW,
      energy: 'high',
      sensory: 'calm',
      lastTransition: null,
      history: [{ from: STATES.DORMANT, to: STATES.FLOW, timestamp: 't', energy: 'high', sensory: 'calm' }],
    })

    const got = await repo.getCognitiveState(db, user.id)
    assert.ok(got)
    assert.equal(got!.current, STATES.FLOW)
    assert.equal(got!.energy, 'high')
    assert.equal(got!.history.length, 1)
  } finally {
    dispose()
  }
})

test('a corrupt history blob degrades to empty rather than throwing', async () => {
  const { db, dispose } = tempStore()
  try {
    const user = await makeUser(db, 'cog2@example.com')
    await db
      .prepare(
        'INSERT INTO cognitive_state (user_id, current, energy, sensory, history_json, updated_at) VALUES (?, ?, ?, ?, ?, ?)'
      )
      .run(user.id, 'focused', 'medium', 'calm', 'not-json', '2026-01-01T00:00:00.000Z')

    const got = await repo.getCognitiveState(db, user.id)
    assert.ok(got)
    assert.deepEqual(got!.history, [])
  } finally {
    dispose()
  }
})

test('history is capped to the last 100 entries on write', async () => {
  const { db, dispose } = tempStore()
  try {
    const user = await makeUser(db, 'cog3@example.com')
    const filler = { from: STATES.DORMANT, to: STATES.FOCUSED, timestamp: 't', energy: 'medium' as const, sensory: 'calm' as const }
    const big: CognitiveState = {
      current: STATES.FOCUSED,
      energy: 'medium',
      sensory: 'calm',
      lastTransition: null,
      history: Array.from({ length: 150 }, () => ({ ...filler })),
    }
    await repo.upsertCognitiveState(db, user.id, big)

    const got = await repo.getCognitiveState(db, user.id)
    assert.equal(got!.history.length, 100)
  } finally {
    dispose()
  }
})

test('advanceAndPersist + describeCurrent expose a sized capacity snapshot', async () => {
  const { db, dispose } = tempStore()
  try {
    const user = await makeUser(db, 'cog4@example.com')

    const snap = await advanceAndPersist(db, user.id, 'I am overwhelmed and running on empty')
    assert.equal(snap!.current, STATES.OVERWHELMED)
    assert.equal(snap!.label, 'Overwhelmed')
    assert.ok(snap!.capacityNote.length > 0)
    assert.ok(snap!.microStep.length > 0)

    const again = await describeCurrent(db, user.id)
    assert.equal(again!.current, STATES.OVERWHELMED)
  } finally {
    dispose()
  }
})

/* ------------------------------------------------------- Slice 2: patterns & pulse */

function entry(to: CognitiveState['current'], energy: CognitiveState['energy'] = 'medium'): CognitiveHistoryEntry {
  return { from: STATES.DORMANT, to, timestamp: '2026-01-01T00:00:00.000Z', energy, sensory: 'calm' }
}

test('detectPatterns flags high burnout risk on a depleted-heavy history', () => {
  const history = Array.from({ length: 10 }, () => entry(STATES.OVERWHELMED, 'depleted'))
  assert.equal(detectPatterns(history).burnoutRisk, 'high')
})

test('patternLine gives permission (not analysis) when overwhelmed', () => {
  const line = patternLine([entry(STATES.OVERWHELMED)], STATES.OVERWHELMED, 'medium')
  assert.ok(line && /gentle/i.test(line))
})

test('patternLine stays silent for a benign, low-signal history', () => {
  // One focused entry, no loop, no scatter dominance, no flow-chain, low burnout → null.
  assert.equal(patternLine([entry(STATES.FOCUSED)], STATES.FOCUSED, 'medium'), null)
})

test('patternLine names a overwhelm→scatter cycle when it recurs', () => {
  const history = [
    entry(STATES.OVERWHELMED),
    entry(STATES.SCATTERED),
    entry(STATES.OVERWHELMED), // 3-window triggers the loop detector
  ]
  const line = patternLine(history, STATES.SCATTERED, 'medium')
  assert.ok(line && /loop|scatter/i.test(line))
})

test('dailyCognitiveBriefing is null for a user with no recorded state', async () => {
  const { db, dispose } = tempStore()
  try {
    const user = await makeUser(db, 'nopulse@example.com')
    assert.equal(await dailyCognitiveBriefing(db, user.id), null)
  } finally {
    dispose()
  }
})

test('dailyCognitiveBriefing pairs today\'s capacity with a gentle pattern note', async () => {
  const { db, dispose } = tempStore()
  try {
    const user = await makeUser(db, 'pulse@example.com')
    const snap = await advanceAndPersist(db, user.id, 'I am overwhelmed and running on empty')
    assert.equal(snap!.current, STATES.OVERWHELMED)

    const brief = await dailyCognitiveBriefing(db, user.id)
    assert.ok(brief)
    assert.equal(brief!.label, 'Overwhelmed')
    assert.ok(brief!.capacityNote.length > 0)
    assert.ok(brief!.microStep.length > 0)
    // A single depleted+overwhelm entry already crosses the care-first threshold.
    assert.ok(brief!.patternNote && /gentle/i.test(brief!.patternNote))
  } finally {
    dispose()
  }
})

/* ------------------------------------------------------------- Slice 3: the Mind map */

test('describeMap is null for a user with nothing recorded (open-door empty state)', async () => {
  const { db, dispose } = tempStore()
  try {
    const user = await makeUser(db, 'nomind@example.com')
    assert.equal(await describeMap(db, user.id), null)
  } finally {
    dispose()
  }
})

test('describeMap returns a superset of the snapshot plus history, pattern note and risk', async () => {
  const { db, dispose } = tempStore()
  try {
    const user = await makeUser(db, 'mind@example.com')
    await advanceAndPersist(db, user.id, 'I am overwhelmed and running on empty')

    const map = await describeMap(db, user.id)
    assert.ok(map)
    // Snapshot fields are all present, so the dashboard could read it unchanged.
    assert.equal(map!.current, STATES.OVERWHELMED)
    assert.equal(map!.label, 'Overwhelmed')
    assert.ok(map!.capacityNote.length > 0)
    assert.ok(map!.microStep.length > 0)
    // The Mind-only additions.
    assert.ok(Array.isArray(map!.history))
    assert.equal(map!.history.length, 1)
    assert.ok(map!.patternNote && /gentle/i.test(map!.patternNote))
    assert.ok(['low', 'medium', 'high'].includes(map!.burnoutRisk))
  } finally {
    dispose()
  }
})

/* ------------------------------------------------------ Slice 3b: manual Mind check-in */

test('checkInAndPersist applies a manual energy tap and records a movement', async () => {
  const { db, dispose } = tempStore()
  try {
    const user = await makeUser(db, 'checkin@example.com')

    // A brand-new user has no state; a check-in still works from the initial state.
    const map = await checkInAndPersist(db, user.id, { energy: 'low' })
    assert.ok(map)
    assert.equal(map!.energy, 'low')
    assert.equal(map!.current, STATES.DORMANT)
    // The tap appends a dated history entry so the map visibly responds.
    assert.equal(map!.history.length, 1)

    // A second, different tap persists alongside the first and adds another movement.
    const again = await checkInAndPersist(db, user.id, { sensory: 'overload' })
    assert.equal(again!.energy, 'low')
    assert.equal(again!.sensory, 'overload')
    assert.equal(again!.history.length, 2)
  } finally {
    dispose()
  }
})

test('checkInAndPersist returns the current map even when the patch changes nothing', async () => {
  const { db, dispose } = tempStore()
  try {
    const user = await makeUser(db, 'checkin2@example.com')
    await advanceAndPersist(db, user.id, 'I am overwhelmed and running on empty')

    const map = await checkInAndPersist(db, user.id, {})
    assert.ok(map)
    assert.equal(map!.current, STATES.OVERWHELMED)
  } finally {
    dispose()
  }
})
