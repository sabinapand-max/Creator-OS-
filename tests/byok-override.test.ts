/**
 * Tests for the bring-your-own-key override helper.
 *
 * These prove the safety contract in one place: an override only activates with a
 * complete endpoint + model, takes the key exactly as supplied (never the server's
 * own key), and inherits the timeout/hosted flags from the environment config.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildModelConfigFromOverride } from '../lib/pilot/model/index.ts'
import { submitTurn } from '../lib/pilot/core/conversation.ts'
import { startFakeModel, tempStore, makeUser } from './helpers.ts'

// A stand-in server environment. buildModelConfigFromOverride reads the base
// timeout/hosted flags from here, so the values are asserted below.
const env: NodeJS.ProcessEnv = {
  NODE_ENV: 'test',
  AI_MODEL: 'server-model',
  AI_BASE_URL: 'https://server.example/v1',
  AI_API_KEY: 'server-key',
  AI_TIMEOUT_MS: '12345',
}

test('an override needs both an endpoint and a model id to activate', () => {
  assert.equal(buildModelConfigFromOverride({ baseUrl: 'https://x.example/v1' }, env), undefined)
  assert.equal(buildModelConfigFromOverride({ modelId: 'some-model' }, env), undefined)
  assert.equal(buildModelConfigFromOverride({}, env), undefined)
})

test('a valid override uses the supplied endpoint, model and key', () => {
  const c = buildModelConfigFromOverride(
    { baseUrl: 'https://api.openai.com/v1/', modelId: 'gpt-4o-mini', apiKey: 'sk-user' },
    env
  )
  assert.ok(c)
  assert.equal(c.baseUrl, 'https://api.openai.com/v1') // trailing slash stripped
  assert.equal(c.modelId, 'gpt-4o-mini')
  assert.equal(c.apiKey, 'sk-user')
  assert.equal(c.provider, 'openai-compatible')
  assert.equal(c.timeoutMs, 12345) // inherited from the environment, not invented
})

test('a keyless override to a remote endpoint does not borrow the server key', () => {
  const c = buildModelConfigFromOverride(
    { baseUrl: 'https://api.openai.com/v1', modelId: 'gpt-4o-mini' },
    env
  )
  assert.equal(c?.apiKey, null)
})

test('an OpenRouter endpoint is inferred from the URL', () => {
  const c = buildModelConfigFromOverride(
    { baseUrl: 'https://openrouter.ai/api/v1', modelId: 'x', apiKey: 'or-key' },
    env
  )
  assert.equal(c?.provider, 'openrouter')
})

test('a BYOK override reaches the wire and never borrows the server key', async () => {
  const fake = await startFakeModel()
  const store = tempStore()
  try {
    const user = await makeUser(store.db, 'byok@pilot.test')
    // A server environment that HAS a key, to prove the override does not use it.
    const env: NodeJS.ProcessEnv = {
      NODE_ENV: 'test',
      AI_BASE_URL: 'https://server.example/v1',
      AI_MODEL: 'server-model',
      AI_API_KEY: 'SERVER-KEY-must-not-appear',
      PILOT_ALLOW_LOOPBACK_MODEL: 'true',
    }
    const config = buildModelConfigFromOverride(
      { baseUrl: fake.baseUrl, modelId: 'user/chosen-model', apiKey: 'sk-user-byok' },
      env
    )
    assert.ok(config)

    const result = await submitTurn(store.db, {
      userId: user.id,
      text: 'I want to launch a newsletter but my book chapter is stuck.',
      channel: 'web',
      modelConfig: config,
    })

    assert.equal(
      result.ok,
      true,
      `turn should succeed: ${(result as any).failure?.message ?? JSON.stringify(result)}`
    )
    // The user's own key went out on the wire, to the user's chosen endpoint/model.
    assert.equal(fake.calls.length, 1)
    assert.equal(fake.calls[0].authorization, 'Bearer sk-user-byok')
    assert.equal(fake.calls[0].model, 'user/chosen-model')
    // The server's configured key was never used for this BYOK turn.
    assert.ok(!JSON.stringify(fake.calls).includes('SERVER-KEY'))
  } finally {
    await fake.close()
    store.dispose()
  }
})
