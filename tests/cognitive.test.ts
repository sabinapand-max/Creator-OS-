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
  describeCurrent,
  detectSignals,
} from '../lib/pilot/cognitive/index.ts'
import { createInitialState, STATES } from '../lib/pilot/cognitive/stateMachine.ts'
import * as repo from '../lib/pilot/db/repo.ts'
import type { CognitiveState } from '../lib/pilot/types.ts'
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
