/**
 * Per-request model access decision — the one place that enforces the paywall.
 *
 * There is exactly one OpenAI-compatible default configured on the server (the
 * hosted model the platform pays for). A signed-in user reaches it in two cases
 * only: they are entitled (plan 'paid'), or they hold a free-trial code the owner
 * issued and still have hosted turns left on it. Anyone may always use their own
 * key (BYOK): that call is billed to them, so it is never gated. Everyone else
 * gets an honest 'byok_required' failure that never touches the network, so a link
 * on social media cannot turn into open, paid model runs.
 *
 * Trial spend is not tracked in a counter we have to trust: it is counted back from
 * `model_runs`, the same table that proves a hosted call actually happened, matched
 * on the hosted endpoint so BYOK generations never eat someone's trial.
 *
 * The returned ModelConfig either has no `gate` (safe to dial) or a `gate`
 * (describeReadiness fails it before any request is made).
 */
import type { Db } from '../db/client.ts'
import * as repo from '../db/repo.ts'
import { readModelConfig, type ModelConfig } from '../model/index.ts'
import { describeTrial } from '../auth/trial.ts'

/** Surfaced verbatim in the UI when a free user tries to use the hosted default. */
export const BYOK_GATE_MESSAGE =
  'The hosted model runs on free trials and £3 credit packs. Buy a credit pack in Settings ' +
  '(30 generations, the activation code arrives by email), ask contact@indigos.uk for a trial extension, ' +
  'or add your own key in Settings — “Bring your own key” — and generate as much as you like, free, on your own account.'

/** Same, for an account whose trial ran out of turns or whose window lapsed. */
export const TRIAL_EXHAUSTED_GATE_MESSAGE =
  'Your free trial is used up — every account starts with 20 hosted generations, no card asked. ' +
  'To carry on: buy a credit pack in Settings (30 generations for £3, activation code by email), ' +
  'or ask contact@indigos.uk for a trial extension code if you want more time before paying, ' +
  'or add your own key in Settings — “Bring your own key” — to keep going free on your own account.'

export async function resolveModelConfigForUser(
  db: Db,
  userId: string,
  byok?: ModelConfig
): Promise<ModelConfig> {
  // A user-supplied key always wins and is never gated — they pay their provider.
  if (byok) return byok

  const hosted = readModelConfig()
  // No hosted default is configured at all. Fall through unchanged so the honest
  // “model_not_configured” admin/setup message surfaces: this is a deployment gap,
  // not a paywall decision, and must not be dressed up as “upgrade”.
  if (!hosted.modelId || !hosted.baseUrl) return hosted

  // A default IS configured, so only entitled users may consume it.
  const plan = await repo.getUserPlan(db, userId)
  if (plan === 'paid') return { ...hosted, entitlement: 'paid' }

  // The one thing that can unlock the hosted default for a free account: a trial
  // code the owner chose to hand out, with turns left on it.
  if (process.env.PILOT_TRIAL_ENABLED !== 'false') {
    const trial = await describeTrial(db, userId, hosted.baseUrl)
    if (trial.hasTrial && trial.turnsRemaining > 0) {
      return { ...hosted, entitlement: 'trial', trialTurnsRemaining: trial.turnsRemaining }
    }
    if (trial.hasTrial) {
      return { ...hosted, trialTurnsRemaining: 0, gate: { code: 'byok_required', message: TRIAL_EXHAUSTED_GATE_MESSAGE } }
    }
  }

  return { ...hosted, gate: { code: 'byok_required', message: BYOK_GATE_MESSAGE } }
}
