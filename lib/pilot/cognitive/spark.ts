/**
 * SPARK assessment + cognitive translation layer — TS port of the nd-cognitive-os
 * engine's sparkTranslation.js and SPARKAssessment scoring.
 *
 * Purely rule-based and local: no network, no AI, no cost. Forty Likert (0-4)
 * responses across five dimensions become a score, and the score is translated
 * into strengths-first language — meaning before productivity
 * (VISION_DIRECTIVES.md, "Cognitive Translation"). Strengths-first means exactly
 * what it says: surface what is present and strong, stay quiet about low
 * dimensions rather than naming them as deficits.
 *
 * The original ran entirely in browser localStorage. Here it persists through
 * repo.getSparkResult/saveSparkResult so the profile also informs brain-dump
 * replies — the one product, not two apps.
 */
import type { SparkDimension, SparkProfile, SparkResult } from '../types.ts'

export const SPARK_DIMENSIONS: SparkDimension[] = ['CI', 'ER', 'SA', 'CD', 'ED']

export interface SparkQuestion {
  dim: SparkDimension
  text: string
}

/** Eight questions per dimension, in the original's order. */
export const SPARK_QUESTIONS: SparkQuestion[] = [
  // Cognitive Intensity
  { dim: 'CI', text: 'I can spend hours absorbed in a single topic without noticing time passing.' },
  { dim: 'CI', text: 'I often see connections between things that seem unrelated to others.' },
  { dim: 'CI', text: 'My mind races with ideas faster than I can express them.' },
  { dim: 'CI', text: 'I prefer deep, complex topics over simple, straightforward ones.' },
  { dim: 'CI', text: 'I find myself questioning things that others accept without thought.' },
  { dim: 'CI', text: 'I can engage in intense intellectual debates that last for hours.' },
  { dim: 'CI', text: 'I often have multiple layers of thought happening simultaneously.' },
  { dim: 'CI', text: 'I become frustrated when I cannot fully understand something.' },

  // Emotional Resonance
  { dim: 'ER', text: "I feel others' emotions as if they were my own." },
  { dim: 'ER', text: 'I have experienced grief so intense it felt physical.' },
  { dim: 'ER', text: 'I can be moved to tears by music, art, or stories.' },
  { dim: 'ER', text: 'I sometimes feel overwhelmed by the suffering in the world.' },
  { dim: 'ER', text: 'My emotional responses are often stronger than others expect.' },
  { dim: 'ER', text: 'I form deep attachments to people, places, and even objects.' },
  { dim: 'ER', text: 'I experience joy and beauty very intensely.' },
  { dim: 'ER', text: "I am deeply affected by injustice, even when it doesn't directly impact me." },

  // Sensory Amplification
  { dim: 'SA', text: 'Certain textures, sounds, or smells can overwhelm me.' },
  { dim: 'SA', text: 'I am deeply affected by my physical environment.' },
  { dim: 'SA', text: 'I notice sensory details that others seem to miss.' },
  { dim: 'SA', text: 'I have strong preferences about food, clothing, or aesthetics.' },
  { dim: 'SA', text: 'Bright lights, loud noises, or strong smells can be painful.' },
  { dim: 'SA', text: 'I need time to adjust when my environment changes significantly.' },
  { dim: 'SA', text: 'I am sensitive to how things taste, feel, or sound.' },
  { dim: 'SA', text: 'I can become distressed by sensory chaos like crowds or markets.' },

  // Creative Divergence
  { dim: 'CD', text: 'I often think in metaphors and images rather than words.' },
  { dim: 'CD', text: 'I come up with ideas that others find strange or unusual.' },
  { dim: 'CD', text: 'I see multiple possible solutions to every problem.' },
  { dim: 'CD', text: 'I sometimes struggle to explain my thinking process to others.' },
  { dim: 'CD', text: 'I prefer to find my own way rather than follow instructions.' },
  { dim: 'CD', text: 'My creativity often leads me in unexpected directions.' },
  { dim: 'CD', text: 'I enjoy experimenting and taking unconventional approaches.' },
  { dim: 'CD', text: 'I blend different ideas or fields in ways that surprise people.' },

  // Existential Drive
  { dim: 'ED', text: 'I often think about the meaning and purpose of life.' },
  { dim: 'ED', text: 'I feel a strong need to understand myself at a deep level.' },
  { dim: 'ED', text: "I sometimes feel like I don't fit into the world around me." },
  { dim: 'ED', text: 'I have experienced periods of intense inner transformation.' },
  { dim: 'ED', text: 'I feel things deeply.' },
  { dim: 'ED', text: 'I am driven by a search for authenticity and truth.' },
  { dim: 'ED', text: 'I question who I am and who I want to become.' },
  { dim: 'ED', text: 'I believe my life should have a larger purpose or meaning.' },
]

export const SPARK_DIMENSION_NAMES: Record<SparkDimension, string> = {
  CI: 'Cognitive Intensity',
  ER: 'Emotional Resonance',
  SA: 'Sensory Amplification',
  CD: 'Creative Divergence',
  ED: 'Existential Drive',
}

/**
 * Strengths-first reading of each dimension when it is active. Each entry frames
 * the dimension as signal, not deficit, and points at how to work *with* it.
 * Wording preserved from sparkTranslation.js — this is the product's voice.
 */
const DIMENSION_TRANSLATION: Record<SparkDimension, { strength: string; guidance: string }> = {
  CI: {
    strength:
      'You process deeply and spot patterns others miss — you go further into ideas than most people can follow.',
    guidance:
      'Protect your hyperfocus windows. Capture tangents instead of fighting them — they are usually the work, not a distraction.',
  },
  ER: {
    strength:
      'You feel and read emotion at high resolution. This is a source of empathy, depth, and meaning.',
    guidance:
      'Name states early rather than suppressing them — strong feeling needs early naming. The energy and sensory gauges on your Mind map are built for this.',
  },
  SA: {
    strength:
      'You perceive sensory detail and beauty at a level others walk past. Your environment is information.',
    guidance:
      'Treat your environment as load-bearing. Use the sensory gauge on your Mind map to manage input before it tips into overload.',
  },
  CD: {
    strength:
      'You think nonlinearly and generatively, connecting across fields into original directions.',
    guidance:
      'Work in constellations, not lists. Brain-dump ideas as they branch instead of forcing them into linear order.',
  },
  ED: {
    strength:
      'You are pulled toward meaning, authenticity, and self-understanding — depth over surface.',
    guidance:
      'Anchor tasks to why they matter. Meaning before productivity is how you actually sustain effort.',
  },
}

/* --------------------------------------------------------------- assessment */

/** Exactly forty whole numbers on the 0-4 Likert scale. Anything else is rejected. */
export function isValidSparkResponses(value: unknown): value is number[] {
  return (
    Array.isArray(value) &&
    value.length === SPARK_QUESTIONS.length &&
    value.every((v) => Number.isInteger(v) && v >= 0 && v <= 4)
  )
}

/**
 * Score forty responses: per-dimension averages on the 0-4 scale, a sparkIndex of
 * 0-20, and a profile type at the original's thresholds. Called only with
 * responses already passed through isValidSparkResponses.
 */
export function scoreSparkResponses(responses: number[]): SparkResult {
  const byDim = new Map<SparkDimension, number[]>(SPARK_DIMENSIONS.map((d) => [d, []]))
  SPARK_QUESTIONS.forEach((q, i) => byDim.get(q.dim)!.push(responses[i] ?? 0))

  const results = {} as Record<SparkDimension, number>
  let sparkIndex = 0
  for (const dim of SPARK_DIMENSIONS) {
    const scores = byDim.get(dim)!
    const avg = scores.reduce((a, b) => a + b, 0) / scores.length
    results[dim] = Math.round(avg * 100) / 100
    sparkIndex += avg
  }
  sparkIndex = Math.round(sparkIndex * 100) / 100

  let profileType = 'The Quiet Spark'
  if (sparkIndex >= 17) profileType = 'The Wildfire'
  else if (sparkIndex >= 13) profileType = 'The Burning Spark'
  else if (sparkIndex >= 7) profileType = 'The Flickering Spark'

  return { results, sparkIndex, profileType }
}

/* --------------------------------------------------------------- translation */

// Score bands (0-4 scale). Strengths-first: we surface what is present and
// strong, and stay quiet about low dimensions rather than naming deficits.
function bandFor(score: number): 'high' | 'present' | 'quiet' {
  if (score >= 3) return 'high'
  if (score >= 1.5) return 'present'
  return 'quiet'
}

/** Translate a stored SPARK result into a structured, strengths-first profile. */
export function translateSparkProfile(spark: SparkResult | null | undefined): SparkProfile | null {
  if (!spark || !spark.results) return null

  const dimensions: SparkProfile['dimensions'] = SPARK_DIMENSIONS.map((key) => {
    const score = spark.results[key] ?? 0
    const t = DIMENSION_TRANSLATION[key]
    return { key, name: SPARK_DIMENSION_NAMES[key], score, band: bandFor(score), strength: t.strength, guidance: t.guidance }
  })

  // Active dimensions, strongest first — these drive guidance and framing.
  const active = dimensions.filter((d) => d.band !== 'quiet').sort((a, b) => b.score - a.score)
  const topStrengths = active.slice(0, 3).map((d) => d.strength)

  // One line the turn prompt can carry: type plus the two loudest dimensions.
  const strongest = active.slice(0, 2).map((d) => d.name)
  const summary =
    strongest.length > 0 ? `${spark.profileType} — strongest in ${strongest.join(' and ')}` : spark.profileType

  return { profileType: spark.profileType, sparkIndex: spark.sparkIndex, dimensions, active, topStrengths, summary }
}

/** Adaptive, strengths-framed guidance lines from the profile, strongest first. */
export function getSparkGuidance(spark: SparkResult | null | undefined): string[] {
  const profile = translateSparkProfile(spark)
  if (!profile) return []
  return profile.active.map((d) => d.guidance)
}
