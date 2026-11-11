import { test } from 'node:test'
import assert from 'node:assert/strict'
import { submitTurn } from '../lib/pilot/core/conversation.ts'
import * as repo from '../lib/pilot/db/repo.ts'
import { tempStore, makeUser, startFakeModel, fakeModelConfig } from './helpers.ts'

/**
 * Paywall tests.
 *
 * The rule: the server's hosted default model is a paid entitlement. A free user
 * with no key must get an honest "bring your own key" failure and the paid
 * endpoint must NEVER be dialled. A paid user uses the hosted default. BYOK works
 * for anyone regardless of plan, because it is billed to them.
 */

function withHostedDefault(baseUrl: string, run: () => Promise<void>) {
  const keys = ['AI_PROVIDER', 'AI_BASE_URL', 'AI_MODEL', 'AI_API_KEY', 'PILOT_ALLOW_LOOPBACK_MODEL'] as const
  const saved: Record<string, string | undefined> = {}
  for (const k of keys) saved[k] = process.env[k]
  process.env.AI_PROVIDER = 'openai-compatible'
  process.env.AI_BASE_URL = baseUrl
  process.env.AI_MODEL = 'hosted/default-model'
  process.env.AI_API_KEY = 'hosted-secret-key'
  process.env.PILOT_ALLOW_LOOPBACK_MODEL = 'true'
  return run().finally(() => {
    for (const k of keys) {
      if (saved[k] === undefined) delete process.env[k]
      else process.env[k] = saved[k]!
    }
  })
}

test('free user with a configured hosted default is gated to BYOK; paid endpoint never dialled', async () => {
  const fake = await startFakeModel()
  const store = tempStore()
  try {
    const user = await makeUser(store.db, 'free@paywall.test')
    await withHostedDefault(fake.baseUrl, async () => {
      const res: any = await submitTurn(store.db, {
        userId: user.id,
        text: 'I want to launch the newsletter but the unfinished book chapter is blocking me.',
        channel: 'web',
      })
      assert.equal(res.ok, false)
      assert.equal(res.kind, 'model_failure')
      assert.equal(res.failure.code, 'byok_required')
    })
    // The whole point: not a single request reached the hosted endpoint.
    assert.equal(fake.calls.length, 0)
  } finally {
    await fake.close()
    store.dispose()
  }
})

test('paid user consumes the hosted default with the server key', async () => {
  const fake = await startFakeModel()
  const store = tempStore()
  try {
    const user = await makeUser(store.db, 'paid@paywall.test')
    assert.equal(await repo.setUserPlan(store.db, user.id, 'paid'), true)
    await withHostedDefault(fake.baseUrl, async () => {
      const res: any = await submitTurn(store.db, {
        userId: user.id,
        text: 'Draft the welcome email for the newsletter launch.',
        channel: 'web',
      })
      assert.equal(res.ok, true)
    })
    assert.equal(fake.calls.length, 1)
    assert.equal(fake.calls[0].model, 'hosted/default-model')
    assert.equal(fake.calls[0].authorization, 'Bearer hosted-secret-key')
  } finally {
    await fake.close()
    store.dispose()
  }
})

test('BYOK bypasses the paywall for a free user', async () => {
  const fake = await startFakeModel()
  const store = tempStore()
  try {
    const user = await makeUser(store.db, 'byok@paywall.test')
    // Even with a hosted default configured, supplying your own key always works.
    await withHostedDefault(fake.baseUrl, async () => {
      const res: any = await submitTurn(store.db, {
        userId: user.id,
        text: 'Summarise where I left off on the newsletter.',
        channel: 'web',
        modelConfig: fakeModelConfig(fake.baseUrl, 'user/chosen-model'),
      })
      assert.equal(res.ok, true)
    })
    assert.equal(fake.calls.length, 1)
    assert.equal(fake.calls[0].model, 'user/chosen-model')
  } finally {
    await fake.close()
    store.dispose()
  }
})
