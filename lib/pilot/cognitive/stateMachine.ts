/**
 * stateMachine.ts
 *
 * TypeScript port of the ND cognitive engine's state machine (src/logic/stateMachine.js),
 * brought into the live Indigos pilot so the "one next action" can finally be sized
 * to today's capacity. Rule-based and local, exactly like the original: NO network, NO AI,
 * so it costs nothing and can run on every brain-dump turn and every daily pulse.
 *
 * Tracks: current cognitive state, transitions (history), energy level, sensory load.
 * The persisted shape (CognitiveState) lives in ../types.ts so the client store and this
 * server module share one contract.
 */
import type {
  CognitiveEnergy,
  CognitiveHistoryEntry,
  CognitiveSensory,
  CognitiveState,
  CognitiveStateName,
} from '../types.ts'

export const STATES = {
  FLOW: 'flow',
  FOCUSED: 'focused',
  SCATTERED: 'scattered',
  OVERWHELMED: 'overwhelmed',
  RECOVERING: 'recovering',
  DORMANT: 'dormant',
  HYPERFOCUS: 'hyperfocus',
  DISSOCIATED: 'dissociated',
} as const satisfies Record<string, CognitiveStateName>

export const ENERGY_LEVELS = {
  HIGH: 'high',
  MEDIUM: 'medium',
  LOW: 'low',
  DEPLETED: 'depleted',
} as const satisfies Record<string, CognitiveEnergy>

export const SENSORY_LEVELS = {
  CALM: 'calm',
  MODERATE: 'moderate',
  ELEVATED: 'elevated',
  OVERLOAD: 'overload',
} as const satisfies Record<string, CognitiveSensory>

/** Valid transitions — not all states can go to all other states. */
export const VALID_TRANSITIONS: Record<CognitiveStateName, CognitiveStateName[]> = {
  [STATES.FLOW]: [STATES.FOCUSED, STATES.SCATTERED, STATES.RECOVERING, STATES.HYPERFOCUS],
  [STATES.FOCUSED]: [STATES.FLOW, STATES.SCATTERED, STATES.OVERWHELMED, STATES.HYPERFOCUS],
  [STATES.SCATTERED]: [STATES.FOCUSED, STATES.OVERWHELMED, STATES.RECOVERING, STATES.DISSOCIATED],
  [STATES.OVERWHELMED]: [STATES.RECOVERING, STATES.SCATTERED, STATES.DISSOCIATED],
  [STATES.RECOVERING]: [STATES.FOCUSED, STATES.DORMANT, STATES.SCATTERED],
  [STATES.DORMANT]: [STATES.FOCUSED, STATES.RECOVERING],
  [STATES.HYPERFOCUS]: [STATES.FLOW, STATES.FOCUSED, STATES.OVERWHELMED, STATES.RECOVERING],
  [STATES.DISSOCIATED]: [STATES.RECOVERING, STATES.DORMANT, STATES.SCATTERED],
}

export function canTransition(from: CognitiveStateName, to: CognitiveStateName): boolean {
  const valid = VALID_TRANSITIONS[from]
  if (!valid) return false
  return valid.includes(to)
}

export function createInitialState(): CognitiveState {
  return {
    current: STATES.DORMANT,
    energy: ENERGY_LEVELS.MEDIUM,
    sensory: SENSORY_LEVELS.CALM,
    lastTransition: null,
    history: [],
  }
}

/**
 * Move to a new state, appending to history (kept to the last 100 entries, as in the
 * original engine). Validity is advisory — we record what we detect rather than silently
 * dropping a jump, so the pattern engine can still see the cycle.
 */
export function transition(
  state: CognitiveState,
  newState: CognitiveStateName,
  context: Partial<CognitiveHistoryEntry> = {}
): CognitiveState {
  const timestamp = new Date().toISOString()
  const entry: CognitiveHistoryEntry = {
    from: state.current,
    to: newState,
    timestamp,
    energy: state.energy,
    sensory: state.sensory,
    ...context,
  }
  return {
    ...state,
    current: newState,
    lastTransition: timestamp,
    history: [...state.history.slice(-99), entry],
  }
}

export function setEnergy(state: CognitiveState, level: CognitiveEnergy): CognitiveState {
  return { ...state, energy: level }
}

export function setSensory(state: CognitiveState, level: CognitiveSensory): CognitiveState {
  return { ...state, sensory: level }
}
