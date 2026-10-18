/**
 * cognitive/index.ts
 *
 * The ND cognitive layer wired into the live pilot. It reads the signals already in a
 * brain-dump (no extra questions, no AI, no network — free on every turn), advances the
 * ported state machine, persists the result, and returns a strengths-first "capacity"
 * snapshot that sizes today's one next action to how the person is actually running.
 *
 * Meaning before productivity (see VISION_DIRECTIVES.md / sparkTranslation): we name the
 * state as information, never as a deficit, and the micro-step is sized to capacity.
 */
import type { Db } from '../db/client.ts'
import * as repo from '../db/repo.ts'
import type {
  CognitiveEnergy,
  CognitiveMap,
  CognitiveSensory,
  CognitiveSnapshot,
  CognitiveState,
  CognitiveStateName,
} from '../types.ts'
import {
  createInitialState,
  ENERGY_LEVELS,
  SENSORY_LEVELS,
  setEnergy,
  setSensory,
  STATES,
  transition,
} from './stateMachine.ts'
import { detectPatterns, patternLine } from './patterns.ts'

/* --------------------------------------------------------------- detection */

/**
 * Substring signals, matched on lowercased text. Deliberately conservative: absence of a
 * signal leaves the state unchanged, so a neutral brain dump never gets mislabelled.
 */
const OVERWHELM = ['overwhelm', 'too much', 'drowning', 'swamped', "can't cope", 'cant cope', 'panic', 'anxious', 'stressed', 'at my limit', 'breaking point', 'too many', 'everything is']
const EXHAUST = ['exhaust', 'drained', 'running on empty', 'no energy', 'depleted', 'burnt out', 'burned out', 'burnout', 'burn out', 'worn out']
const LOW = ['tired', 'low energy', 'foggy', 'sluggish', 'so tired', 'hard to start', 'can’t start', "can't start"]
const HIGH = ['energetic', 'wired', 'excited', 'motivated', 'fired up', 'pumped', 'great energy', 'raring']
const SCATTERED = ['scattered', 'all over the place', "can't focus", 'cant focus', 'distracted', 'jumping between', 'too many tabs', 'too many ideas', 'unfocused', 'chaotic', 'chaos', 'spinning']
const HYPERFOCUS = ['hyperfocus', 'hyper-focus', 'obsessed with', "can't stop working", 'cant stop working', 'lost track of time', 'up all night', 'all night', 'for hours', "haven't stopped", 'havent stopped']
const FLOW = ['in the zone', 'flow state', 'in flow', 'making progress', 'momentum', 'productive', 'getting things done', 'on a roll']
const RECOVERING = ['need a break', 'taking a break', 'going to rest', 'need rest', 'sick', 'recover', 'pause', 'laying down', 'lying down', 'in bed']
const SENSORY = ['overstimulat', 'too loud', 'sensory', 'the noise', 'lights are', 'too much noise', 'too bright', 'crowd']

function has(text: string, words: string[]): boolean {
  return words.some((w) => text.includes(w))
}

/** Derive state / energy / sensory signals from one brain-dump. Any field may be absent. */
export function detectSignals(rawText: string): {
  state?: CognitiveStateName
  energy?: CognitiveEnergy
  sensory?: CognitiveSensory
} {
  const text = (rawText || '').toLowerCase()
  const out: { state?: CognitiveStateName; energy?: CognitiveEnergy; sensory?: CognitiveSensory } = {}

  // State by priority — the most specific / highest-signal wins.
  if (has(text, HYPERFOCUS)) out.state = STATES.HYPERFOCUS
  else if (has(text, FLOW)) out.state = STATES.FLOW
  else if (has(text, OVERWHELM) || has(text, EXHAUST)) out.state = STATES.OVERWHELMED
  else if (has(text, RECOVERING)) out.state = STATES.RECOVERING
  else if (has(text, SCATTERED)) out.state = STATES.SCATTERED

  // Energy — only explicit signals change it.
  if (has(text, EXHAUST)) out.energy = ENERGY_LEVELS.DEPLETED
  else if (has(text, LOW)) out.energy = ENERGY_LEVELS.LOW
  else if (has(text, HIGH) || out.state === STATES.HYPERFOCUS) out.energy = ENERGY_LEVELS.HIGH

  if (has(text, SENSORY)) out.sensory = SENSORY_LEVELS.OVERLOAD

  return out
}

/**
 * Advance a state from one brain-dump. Only records a transition when a new state is
 * detected and it differs from the current one, so neutral turns don't churn history.
 */
export function advanceState(prev: CognitiveState, rawText: string): CognitiveState {
  const d = detectSignals(rawText)
  let next = prev
  if (d.energy) next = setEnergy(next, d.energy)
  if (d.sensory) next = setSensory(next, d.sensory)
  if (d.state && d.state !== prev.current) {
    next = transition(next, d.state, { energy: next.energy, sensory: next.sensory })
  }
  return next
}

/* ------------------------------------------------------------- description */

const LABEL: Record<CognitiveStateName, string> = {
  [STATES.FLOW]: 'In flow',
  [STATES.FOCUSED]: 'Focused',
  [STATES.SCATTERED]: 'Scattered',
  [STATES.OVERWHELMED]: 'Overwhelmed',
  [STATES.RECOVERING]: 'Recovering',
  [STATES.DORMANT]: 'Quiet',
  [STATES.HYPERFOCUS]: 'Hyperfocused',
  [STATES.DISSOCIATED]: 'Checked out',
}

function capacityFor(state: CognitiveState): { capacityNote: string; microStep: string } {
  const lowBattery = state.energy === ENERGY_LEVELS.DEPLETED || state.energy === ENERGY_LEVELS.LOW

  // Depleted/overwhelmed/recovering take priority: the body, not the to-do list, decides.
  if (state.current === STATES.OVERWHELMED || state.energy === ENERGY_LEVELS.DEPLETED) {
    return {
      capacityNote: 'Running low today — that is information, not failure. One tiny step is enough.',
      microStep: 'Do the smallest possible version of one thing for two minutes. Then stop if you need to.',
    }
  }
  if (state.current === STATES.RECOVERING) {
    return {
      capacityNote: 'You are recovering. This is a regulation moment, not a productivity problem.',
      microStep: 'Note what is already done, then rest. No new inputs.',
    }
  }
  if (state.current === STATES.SCATTERED) {
    return {
      capacityNote: lowBattery ? 'Scattered and low — let us shrink this to one thread.' : 'Lots of threads today. We will pick one and park the rest.',
      microStep: 'Pick the thread with the most feeling on it. Ignore the others for today.',
    }
  }
  if (state.current === STATES.HYPERFOCUS || state.current === STATES.FLOW) {
    return {
      capacityNote: 'Strong momentum right now — this is the window to protect.',
      microStep: 'Ride it. Take the next real step on your main project now, before the window closes.',
    }
  }
  if (state.current === STATES.DISSOCIATED) {
    return {
      capacityNote: 'You have stepped away. Gentle re-entry, no pressure.',
      microStep: 'Read your last note and do nothing else unless one thing pulls you.',
    }
  }
  if (lowBattery) {
    return {
      capacityNote: 'Energy is a little low — keep it light and single-tracked.',
      microStep: 'Choose the easiest useful step, not the most impressive one.',
    }
  }
  if (state.current === STATES.DORMANT) {
    return {
      capacityNote: 'Quiet start. One small spark is plenty.',
      microStep: 'Say the one thing you have been meaning to do. That becomes the step.',
    }
  }
  // focused / default steady state
  return {
    capacityNote: 'Steady and focused. A solid next step fits today.',
    microStep: 'Take the next concrete step on your current project.',
  }
}

function toSnapshot(state: CognitiveState): CognitiveSnapshot {
  const { capacityNote, microStep } = capacityFor(state)
  return {
    current: state.current,
    energy: state.energy,
    sensory: state.sensory,
    label: LABEL[state.current] ?? 'Focused',
    capacityNote,
    microStep,
  }
}

/* --------------------------------------------------------------- persistence */

/**
 * Load the user's cognitive state, advance it with this turn's text, persist, and return
 * the snapshot. Never throws into the caller's turn: if the store is unavailable the
 * caller simply proceeds without a capacity line.
 */
export async function advanceAndPersist(
  db: Db,
  userId: string,
  rawText: string
): Promise<CognitiveSnapshot | null> {
  const prior = (await repo.getCognitiveState(db, userId)) ?? createInitialState()
  const next = advanceState(prior, rawText)
  await repo.upsertCognitiveState(db, userId, next)
  return toSnapshot(next)
}

/** Current snapshot for the dashboard, or null if nothing is recorded yet. */
export async function describeCurrent(db: Db, userId: string): Promise<CognitiveSnapshot | null> {
  const state = await repo.getCognitiveState(db, userId)
  return state ? toSnapshot(state) : null
}

/**
 * The full read for the Mind screen: today's snapshot plus the transitions that produced
 * it, one gentle pattern observation, and a burnout-risk hint for tone. One database read;
 * null when nothing is recorded yet, so the screen shows its open-door empty state instead
 * of an analysis of nobody.
 */
export async function describeMap(db: Db, userId: string): Promise<CognitiveMap | null> {
  const state = await repo.getCognitiveState(db, userId)
  if (!state) return null
  const snap = toSnapshot(state)
  const report = detectPatterns(state.history)
  return {
    ...snap,
    history: state.history,
    patternNote: patternLine(state.history, state.current, state.energy),
    burnoutRisk: report.burnoutRisk,
  }
}

/**
 * Record a manual Mind check-in: the person taps today's energy and/or sensory level
 * directly, instead of waiting for a brain dump to imply it. Appends a dated history
 * entry even when the state name is unchanged, so the map visibly responds and the
 * pattern engine can see the new reading. Rule-based and free — no model, no network.
 * Returns the refreshed map, or null if nothing could be persisted.
 */
export async function checkInAndPersist(
  db: Db,
  userId: string,
  patch: { energy?: CognitiveEnergy; sensory?: CognitiveSensory }
): Promise<CognitiveMap | null> {
  const prior = (await repo.getCognitiveState(db, userId)) ?? createInitialState()
  let next = prior
  if (patch.energy) next = setEnergy(next, patch.energy)
  if (patch.sensory) next = setSensory(next, patch.sensory)
  next = transition(next, next.current, { energy: next.energy, sensory: next.sensory })
  await repo.upsertCognitiveState(db, userId, next)
  return describeMap(db, userId)
}

/**
 * What the daily pulse needs about a person: today's capacity, one sized micro-step, and
 * at most one gentle pattern observation. Null when the person has no recorded state yet,
 * so a brand-new user just gets the plain open-door check-in rather than an analysis.
 * Rule-based and local — it never calls the model.
 */
export interface DailyBriefing {
  label: string
  capacityNote: string
  microStep: string
  patternNote: string | null
}

export async function dailyCognitiveBriefing(
  db: Db,
  userId: string
): Promise<DailyBriefing | null> {
  const state = await repo.getCognitiveState(db, userId)
  if (!state) return null
  const snap = toSnapshot(state)
  return {
    label: snap.label,
    capacityNote: snap.capacityNote,
    microStep: snap.microStep,
    patternNote: patternLine(state.history, state.current, state.energy),
  }
}
