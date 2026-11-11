import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { submitTurn } from '../lib/pilot/core/conversation.ts'
import * as repo from '../lib/pilot/db/repo.ts'
import { signIn, LOGIN_MAX_ATTEMPTS } from '../lib/pilot/auth/index.ts'
import {
  describeTrial,
  issueTrialCodes,
  normaliseTrialCode,
  redeemTrialCode,
} from '../lib/pilot/auth/trial.ts'
import { tempStore, makeUser, startFakeModel, fakeModelConfig } from './helpers.ts'

/**
 * Free-trial tests.
 *
 * The rule the product depends on: a free account reaches the hosted model only with
 * a code the owner handed out, only for the turns that code bought, and never further.
 * The strongest assertion in each test is `fake.calls.length` — it proves the paid
 * endpoint was not dialled once more than the grant allowed.
 */

function withHostedDefault(baseUrl: string, run: () => Promise<void>) {
  const keys = ['AI_PROVIDER', 'AI_BASE_URL', 'AI_MODEL', 'AI_API_KEY', 'PILOT_ALLOW_LOOPBACK_MODEL', 'PILOT_TRIAL_ENABLED'] as const
  const saved: Record<string, string | undefined> = {}
  for (const k of keys) saved[k] = process.env[k]
  process.env.AI_PROVIDER = 'openai-compatible'
  process.env.AI_BASE_URL = baseUrl
  process.env.AI_MODEL = 'hosted/default-model'
  process.env.AI_API_KEY = 'hosted-secret-key'
  process.env.PILOT_ALLOW_LOOPBACK_MODEL = 'true'
  delete process.env.PILOT_TRIAL_ENABLED // the trial path must be on, whatever the shell says
  return run().finally(() => {
    for (const k of keys) {
      if (saved[k] === undefined) delete process.env[k]
      else process.env[k] = saved[k]!
    }
  })
}

const turn = (db: any, userId: string, text: string, modelConfig?: any) =>
  submitTurn(db, { userId, text, channel: 'web', modelConfig })

test('a trial code buys exactly its turns: the next hosted call is gated, not dialled', async () => {
  const fake = await startFakeModel()
  const store = tempStore()
  try {
    const user = await makeUser(store.db, 'trial@indigos.test')
    const issued = await issueTrialCodes(store.db, { turns: 2, count: 1, note: 'test grant' })
    assert.equal(issued.length, 1)

    const redeem = await redeemTrialCode(store.db, user.id, issued[0].code)
    assert.equal(redeem.ok, true)

    await withHostedDefault(fake.baseUrl, async () => {
      for (const text of ['First trial ask.', 'Second trial ask.']) {
        const res: any = await turn(store.db, user.id, text)
        assert.equal(res.ok, true, text)
      }
      // Third ask: the grant is spent, so the honest gate fires instead of a paid call.
      const res: any = await turn(store.db, user.id, 'Third ask after the trial ran out.')
      assert.equal(res.ok, false)
      assert.equal(res.failure.code, 'byok_required')
      assert.match(res.failure.message, /trial/i)
    })

    assert.equal(fake.calls.length, 2)
    const trial = await describeTrial(store.db, user.id, fake.baseUrl)
    assert.equal(trial.hasTrial, true)
    assert.equal(trial.turnsTotal, 2)
    assert.equal(trial.turnsUsed, 2)
    assert.equal(trial.turnsRemaining, 0)
  } finally {
    await fake.close()
    store.dispose()
  }
})

test('a code is single-use: the first account to claim it keeps it', async () => {
  const store = tempStore()
  try {
    const a = await makeUser(store.db, 'first@indigos.test')
    const b = await makeUser(store.db, 'second@indigos.test')
    const [code] = await issueTrialCodes(store.db, { turns: 5, count: 1 })

    assert.equal((await redeemTrialCode(store.db, a.id, code.code)).ok, true)
    const again = await redeemTrialCode(store.db, b.id, code.code)
    assert.equal(again.ok, false)
    assert.equal((again as any).reason, 'already_used')

    const forB = await describeTrial(store.db, b.id, 'https://hosted.invalid/v1')
    assert.equal(forB.hasTrial, false)
    const forA = await describeTrial(store.db, a.id, 'https://hosted.invalid/v1')
    assert.equal(forA.turnsRemaining, 5)
  } finally {
    store.dispose()
  }
})

test('BYOK generations never eat a trial balance, even on the same host', async () => {
  const hosted = await startFakeModel()
  const own = await startFakeModel() // a second loopback port = a different endpoint
  const store = tempStore()
  try {
    const user = await makeUser(store.db, 'byok@indigos.test')
    const [code] = await issueTrialCodes(store.db, { turns: 2, count: 1 })
    await redeemTrialCode(store.db, user.id, code.code)

    await withHostedDefault(hosted.baseUrl, async () => {
      for (let i = 0; i < 3; i += 1) {
        const res: any = await turn(store.db, user.id, `Own-key ask ${i}.`, fakeModelConfig(own.baseUrl, 'user/own-model'))
        assert.equal(res.ok, true)
      }
    })

    assert.equal(own.calls.length, 3)
    assert.equal(hosted.calls.length, 0)
    const trial = await describeTrial(store.db, user.id, hosted.baseUrl)
    assert.equal(trial.turnsRemaining, 2, 'their own key must not spend the grant')
  } finally {
    await hosted.close()
    await own.close()
    store.dispose()
  }
})

test('codes survive messy pasting and reject what is not one', async () => {
  const store = tempStore()
  try {
    const user = await makeUser(store.db, 'paste@indigos.test')
    const [issued] = await issueTrialCodes(store.db, { turns: 3, count: 1 })
    const messy = '  ' + issued.code.toLowerCase().replace(/-/g, ' ') + ' '
    const stripped = messy.trim().toUpperCase().replace(/ /g, '').slice(3)
    assert.equal(normaliseTrialCode(messy), stripped)

    // Paste it with spaces and lowercase and it still redeems.
    assert.equal((await redeemTrialCode(store.db, user.id, messy)).ok, true)

    for (const junk of ['', 'not a code', 'IND-ZZZZ-ZZZZ-ZZZZ', 'IND-0OO1-1II0-0OO1']) {
      const res = await redeemTrialCode(store.db, user.id, junk)
      assert.equal(res.ok, false, junk)
      assert.notEqual((res as any).reason, undefined)
    }
    const unknown = await redeemTrialCode(store.db, user.id, 'IND-QQWRTYUKMPAS')
    assert.equal((unknown as any).reason, 'unknown_code')
  } finally {
    store.dispose()
  }
})

test('an expired code is refused', async () => {
  const store = tempStore()
  try {
    const user = await makeUser(store.db, 'expired@indigos.test')
    const [issued] = await issueTrialCodes(store.db, { turns: 4, count: 1 })
    await store.db
      .prepare('UPDATE trial_codes SET expires_at = ? WHERE id = ?')
      .run('2020-01-01T00:00:00.000Z', issued.id)

    const res = await redeemTrialCode(store.db, user.id, issued.code)
    assert.equal(res.ok, false)
    assert.equal((res as any).reason, 'expired')
    const trial = await describeTrial(store.db, user.id, 'https://hosted.invalid/v1')
    assert.equal(trial.hasTrial, false)
  } finally {
    store.dispose()
  }
})

test('stacked codes add up and the oldest redemption starts the meter', async () => {
  const store = tempStore()
  try {
    const user = await makeUser(store.db, 'stack@indigos.test')
    const two = await issueTrialCodes(store.db, { turns: 2, count: 2 })
    await redeemTrialCode(store.db, user.id, two[0].code)
    await redeemTrialCode(store.db, user.id, two[1].code)
    const grant = await repo.getTrialGrant(store.db, user.id)
    assert.equal(grant?.turns, 4)
    const trial = await describeTrial(store.db, user.id, 'https://hosted.invalid/v1')
    assert.equal(trial.turnsTotal, 4)
    assert.equal(trial.turnsRemaining, 4)
  } finally {
    store.dispose()
  }
})

test('an expired grant stops unlocking the hosted model, even with turns left', async () => {
  const fake = await startFakeModel()
  const store = tempStore()
  try {
    const user = await makeUser(store.db, 'window@indigos.test')
    const [issued] = await issueTrialCodes(store.db, { turns: 3, count: 1 })
    const redeem = await redeemTrialCode(store.db, user.id, issued.code)
    assert.equal(redeem.ok, true)

    await withHostedDefault(fake.baseUrl, async () => {
      const first: any = await turn(store.db, user.id, 'First ask inside the window.')
      assert.equal(first.ok, true)
      // Time-travel the grant, the same way a 14-day beta window lapses.
      await store.db
        .prepare('UPDATE trial_codes SET expires_at = ? WHERE redeemed_by = ?')
        .run('2020-01-01T00:00:00.000Z', user.id)
      const gated: any = await turn(store.db, user.id, 'Ask after the window closed.')
      assert.equal(gated.ok, false)
      assert.equal(gated.failure.code, 'byok_required')
      assert.match(gated.failure.message, /trial/i, 'expired reads as an ended trial, not a paid-only product')
      assert.equal(fake.calls.length, 1, 'an expired grant must never dial the paid endpoint again')

      // The extended-trial path: a fresh code re-opens the door.
      const [extend] = await issueTrialCodes(store.db, { turns: 2, count: 1 })
      assert.equal((await redeemTrialCode(store.db, user.id, extend.code)).ok, true)
      const after: any = await turn(store.db, user.id, 'Ask after extending with a new code.')
      assert.equal(after.ok, true)
    })
    assert.equal(fake.calls.length, 2)
  } finally {
    await fake.close()
    store.dispose()
  }
})

test('sign-in is throttled after repeated failures', async () => {
  const store = tempStore()
  try {
    await makeUser(store.db, 'throttle@indigos.test')
    let last: any = null
    for (let i = 0; i < LOGIN_MAX_ATTEMPTS; i += 1) {
      last = await signIn(store.db, { email: 'throttle@indigos.test', password: 'wrong-password-999' })
      assert.equal(last.ok, false)
      assert.equal(last.error, 'invalid_credentials')
    }
    const blocked = await signIn(store.db, { email: 'throttle@indigos.test', password: 'wrong-password-999' })
    assert.equal(blocked.ok, false)
    assert.equal(blocked.error, 'too_many_attempts')
    // Even the right password waits out the window: the brake is on attempts, not on luck.
    const rightButBlocked = await signIn(store.db, { email: 'throttle@indigos.test', password: 'test-password-123' })
    assert.equal(rightButBlocked.ok, false)
  } finally {
    store.dispose()
  }
})

test('a successful sign-in clears the attempt counter', async () => {
  const store = tempStore()
  try {
    await makeUser(store.db, 'clear@indigos.test')
    await signIn(store.db, { email: 'clear@indigos.test', password: 'nope-nope-nope' })
    const ok = await signIn(store.db, { email: 'clear@indigos.test', password: 'test-password-123' })
    assert.equal(ok.ok, true)
    const hash = createHash('sha256').update('clear@indigos.test').digest('hex')
    const since = new Date(Date.now() - 15 * 60 * 1000).toISOString()
    assert.equal(await repo.countRecentAuthAttempts(store.db, hash, since), 0)
  } finally {
    store.dispose()
  }
})
