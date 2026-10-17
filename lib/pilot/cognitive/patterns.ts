/**
 * cognitive/patterns.ts
 *
 * TypeScript port of the ND pattern engine (src/logic/patternEngine.js), now running
 * inside the pilot. Rule-based and local — it reads the transition history the state
 * machine already persists and surfaces cycles (overwhelm↔scatter), flow precursors and
 * burnout risk. Used by the daily pulse to offer ONE strengths-first observation, never
 * a productivity nag.
 */
import type { CognitiveEnergy, CognitiveHistoryEntry, CognitiveStateName } from '../types.ts'
import { STATES } from './stateMachine.ts'

export interface Pattern {
  type: string
  description: string
  suggestion?: string
  frequency?: number
  triggers?: CognitiveStateName[]
  missing?: CognitiveStateName[]
}

export interface PatternReport {
  patterns: Pattern[]
  warnings: string[]
  burnoutRisk: 'low' | 'medium' | 'high'
  isEmpty: boolean
}

export function detectPatterns(history: CognitiveHistoryEntry[] = []): PatternReport {
  if (!history.length) return { patterns: [], warnings: [], burnoutRisk: 'low', isEmpty: true }

  const patterns: Pattern[] = []
  const warnings: string[] = []

  const overwhelmLoop = detectOverwhelmLoop(history)
  if (overwhelmLoop.detected) {
    patterns.push({
      type: 'overwhelm_loop',
      description: 'Overwhelm → scatter cycle detected',
      frequency: overwhelmLoop.count,
      suggestion: 'A short grounding beat before switching tasks usually helps.',
    })
    warnings.push('recurring overwhelm')
  }

  const flowChains = detectFlowChains(history)
  if (flowChains.detected) {
    patterns.push({
      type: 'flow_trigger',
      description: 'Flow state pattern identified',
      triggers: flowChains.commonPreceding,
      suggestion: 'Worth recreating those conditions on purpose.',
    })
  }

  const burnout = detectBurnoutPrecursors(history)
  if (burnout.risk !== 'low') warnings.push(`burnout risk ${burnout.risk}`)

  const scattered = detectChronicState(history, STATES.SCATTERED)
  if (scattered.detected) {
    patterns.push({
      type: 'chronic_scatter',
      description: 'Extended scattered / diffuse attention',
      suggestion: 'Not a discipline problem — a regulation one. Smaller inputs help.',
    })
  }

  const missing = invertedSearch(history)
  if (missing.length > 0) {
    patterns.push({
      type: 'missing_states',
      description: 'States not appearing that might be needed',
      missing,
      suggestion: 'These are absent from your map lately.',
    })
  }

  return { patterns, warnings, burnoutRisk: burnout.risk, isEmpty: false }
}

function detectOverwhelmLoop(history: CognitiveHistoryEntry[]) {
  let count = 0
  for (let i = 2; i < history.length; i++) {
    const chain = `${history[i - 2].to}->${history[i - 1].to}->${history[i].to}`
    if (chain.includes('overwhelmed') && chain.includes('scattered')) count++
  }
  return { detected: count > 0, count }
}

function detectFlowChains(history: CognitiveHistoryEntry[]) {
  const preceding: Record<string, number> = {}
  history.forEach((entry, i) => {
    if (entry.to === STATES.FLOW && i > 0) {
      const prev = history[i - 1].to
      preceding[prev] = (preceding[prev] || 0) + 1
    }
  })
  const common = Object.entries(preceding)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([state]) => state as CognitiveStateName)
  return { detected: common.length > 0, commonPreceding: common }
}

function detectBurnoutPrecursors(history: CognitiveHistoryEntry[]): {
  risk: 'low' | 'medium' | 'high'
  reason: string
} {
  const recent = history.slice(-20)
  const depleted = recent.filter((e) => e.energy === 'depleted').length
  const overwhelm = recent.filter((e) => e.to === STATES.OVERWHELMED).length
  const recovery = recent.filter((e) => e.to === STATES.RECOVERING).length

  if (depleted > recent.length * 0.5) return { risk: 'high', reason: 'frequent depleted energy' }
  if (overwhelm > 3 && recovery === 0) return { risk: 'medium', reason: 'overwhelm without recovery' }
  if (depleted > recent.length * 0.3) return { risk: 'medium', reason: 'trending low energy' }
  return { risk: 'low', reason: '' }
}

function detectChronicState(history: CognitiveHistoryEntry[], state: CognitiveStateName) {
  const recent = history.slice(-15)
  const count = recent.filter((e) => e.to === state).length
  return { detected: recent.length > 0 && count > recent.length * 0.6 }
}

function invertedSearch(history: CognitiveHistoryEntry[]): CognitiveStateName[] {
  const seen = new Set(history.map((e) => e.to))
  const all = Object.values(STATES) as CognitiveStateName[]
  // Only flag meaningful absences — dormant/dissociated are fine to miss.
  return all.filter((s) => !seen.has(s) && s !== STATES.DORMANT && s !== STATES.DISSOCIATED)
}

/* ------------------------------------------------------------ pulse line */

/**
 * Turn a pattern report into at most ONE gentle, strengths-first sentence for the daily
 * pulse. Returns null when there is nothing worth saying, so a quiet person just gets the
 * open-door check-in rather than an analysis. Priority: care-first signals over insight.
 */
export function patternLine(
  history: CognitiveHistoryEntry[],
  current: CognitiveStateName,
  energy: CognitiveEnergy
): string | null {
  if (!history.length) return null
  const report = detectPatterns(history)

  // Burnout risk or a still-low battery today → permission, not insight.
  if (report.burnoutRisk === 'high' || current === STATES.OVERWHELMED || energy === 'depleted') {
    return 'I have noticed overwhelm showing up lately with little recovery in between — be gentle today, rest counts as progress.'
  }
  const loop = report.patterns.find((p) => p.type === 'overwhelm_loop')
  if (loop) return 'The overwhelm→scatter loop has been circling. A short grounding beat before you switch tasks usually breaks it.'
  const chronic = report.patterns.find((p) => p.type === 'chronic_scatter')
  if (chronic) return 'Attention has been scattered a lot recently. That is regulation, not discipline — try smaller inputs.'
  const flow = report.patterns.find((p) => p.type === 'flow_trigger')
  if (flow?.triggers?.length) {
    const pretty = flow.triggers.map((t) => t.replace(/_/g, ' ')).join(', ')
    return `You have slipped into flow after ${pretty} before — worth recreating if today allows.`
  }
  return null
}
