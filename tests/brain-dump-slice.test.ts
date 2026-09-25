/**
 * Brain Dump vertical slice.
 *
 *   input -> configured AI endpoint -> concise structured result
 *         -> saved history -> still there after a restart
 *
 * Inference is served by a LABELLED test double (see helpers.ts) because no real
 * provider key is configured for tests. The double stands in for external
 * inference only; nothing in the product path serves mock output as AI output.
 */
import test, { describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { openIsolatedDb } from '../lib/pilot/db/client.ts'
import * as repo from '../lib/pilot/db/repo.ts'
import { submitTurn } from '../lib/pilot/core/conversation.ts'
import { buildReentryCard } from '../lib/pilot/core/directives.ts'
import { TURN_SYSTEM_PROMPT } from '../lib/pilot/core/prompts.ts'
import { describeReadiness, readModelConfig } from '../lib/pilot/model/index.ts'
import {
  deadModelConfig,
  fakeModelConfig,
  makeUser,
  startFakeModel,
  tempStore,
  VALID_TURN_JSON,
  type FakeModel,
  type TempStore,
} from './helpers.ts'

const DUMP =
  'I want to launch the newsletter but I keep getting pulled back into the book chapter and I lose the whole morning.'

describe('Brain Dump vertical slice', () => {
  let fake: FakeModel
  let store: TempStore

  before(async () => {
    fake = await startFakeModel()
    store = tempStore()
  })

  after(async () => {
    await fake.close()
    try {
      store.db.close()
    } catch {
      /* already closed */
    }
    store.dispose()
  })

  test('a brain dump returns a concise structured result from the configured endpoint', async () => {
    const db = store.db
    const user = makeUser(db, 'slice-a@pilot.test')
    const config = fakeModelConfig(fake.baseUrl, 'fake/slice-model')

    const result = await submitTurn(db, {
      userId: user.id,
      text: DUMP,
      channel: 'web',
      idempotencyKey: 'slice-1',
      modelConfig: config,
    })

    assert.equal(result.ok, true, JSON.stringify(result))
    if (!result.ok) return
    assert.equal(result.kind, 'model_turn')
    if (result.kind !== 'model_turn') return

    // The configured model id reached the endpoint; nothing was hardcoded.
    assert.equal(fake.calls.length, 1)
    assert.equal(fake.calls[0].model, 'fake/slice-model')

    // Structured result, and the contract limits are respected.
    assert.ok(result.turn.interpretation.length > 0)
    assert.ok(result.turn.interpretation.length < 600, 'interpretation must stay concise')
    assert.ok(
      result.turn.question === null || typeof result.turn.question === 'string',
      'question is optional'
    )
    assert.ok(result.turn.nextAction, 'exactly one next action')
    assert.ok(!Array.isArray(result.turn.nextAction), 'next action is not a list')

    // Latency is measured, so a local model can be compared with a hosted one.
    assert.ok(typeof result.latencyMs === 'number' && result.latencyMs >= 0)
    assert.equal(result.provider, 'openai-compatible')
  })

  test('the result is saved to durable history and survives a restart', async () => {
    const db = store.db
    const user = repo.getUserByEmail(db, 'slice-a@pilot.test')!
    const conversations = repo.listConversations(db, user.id)
    assert.equal(conversations.length, 1)
    const conversationId = conversations[0].id

    const before = repo.listMessages(db, user.id, conversationId)
    assert.equal(before.length, 2, 'user message + assistant message')
    assert.equal(before[0].role, 'user')
    assert.equal(before[1].role, 'assistant')

    const projects = repo.listProjects(db, user.id)
    assert.equal(projects.length, 1)
    const actions = repo.listOpenActions(db, user.id, projects[0].id)
    assert.equal(actions.length, 1, 'exactly one open next action')

    // Simulated service restart: close the file and open it again.
    const dbPath = store.dbPath
    db.close()
    const reopened = openIsolatedDb(dbPath)
    try {
      const after = repo.listMessages(reopened, user.id, conversationId)
      assert.equal(after.length, 2)
      assert.equal(after[1].content, before[1].content)
      assert.equal(repo.listProjects(reopened, user.id).length, 1)
      assert.equal(repo.listOpenActions(reopened, user.id, projects[0].id).length, 1)
      assert.equal(repo.listFacts(reopened, user.id, projects[0].id).length, 2)
    } finally {
      // Hand the reopened connection back so later tests keep working.
      store.db = reopened
    }
  })

  test('a follow-up continues the same brain dump conversation', async () => {
    const db = store.db
    const user = repo.getUserByEmail(db, 'slice-a@pilot.test')!
    const conversationId = repo.listConversations(db, user.id)[0].id
    const projectCountBefore = repo.listProjects(db, user.id).length
    const callsBefore = fake.calls.length

    const follow = await submitTurn(db, {
      userId: user.id,
      text: 'Thursday. It has to go out Thursday.',
      channel: 'web',
      conversationId,
      idempotencyKey: 'slice-2',
      modelConfig: fakeModelConfig(fake.baseUrl),
    })

    assert.equal(follow.ok, true)
    if (!follow.ok || follow.kind !== 'model_turn') return
    assert.equal(follow.conversationId, conversationId, 'same conversation')
    assert.equal(fake.calls.length, callsBefore + 1, 'one model call for the follow-up')
    assert.equal(
      repo.listProjects(db, user.id).length,
      projectCountBefore,
      'a follow-up must not create a second project'
    )

    // The earlier exchange is part of the prompt context for the follow-up.
    const promptText = JSON.stringify(fake.calls[fake.calls.length - 1].messages)
    assert.ok(promptText.includes('CONVERSATION SO FAR'), 'history is passed to the model')
    assert.ok(promptText.includes('newsletter'), 'earlier brain dump content is in context')

    assert.equal(repo.listMessages(db, user.id, conversationId).length, 4)
  })

  test('Etsy and inventory are excluded from the model contract', () => {
    assert.match(TURN_SYSTEM_PROMPT, /Do not propose Etsy listings, product inventory/i)
    assert.match(TURN_SYSTEM_PROMPT, /out of scope for this pilot/i)
    assert.match(TURN_SYSTEM_PROMPT, /AT MOST ONE question/i)
    assert.match(TURN_SYSTEM_PROMPT, /exactly ONE useful next action/i)
  })

  test('an unconfigured model reports honestly and never fabricates advice', async () => {
    const db = store.db
    const user = makeUser(db, 'slice-unconfigured@pilot.test')
    // An explicitly empty environment, so the test stays true even though the
    // developer's own .env.local may point at a working model.
    const noEnv = {} as NodeJS.ProcessEnv
    const readiness = describeReadiness(readModelConfig(noEnv))
    assert.equal(readiness.ready, false)

    const result = await submitTurn(db, {
      userId: user.id,
      text: DUMP,
      channel: 'web',
      modelConfig: readModelConfig(noEnv),
    })

    assert.equal(result.ok, false)
    if (result.ok) return
    assert.equal(result.kind, 'model_failure')
    if (result.kind !== 'model_failure') return
    assert.equal(result.failure.code, 'model_not_configured')
    assert.equal(result.preservedInput, DUMP, 'input is preserved for retry')
    assert.match(result.failure.message, /AI_MODEL/)

    // The user's words are stored even though no advice could be produced.
    const conversationId = result.conversationId!
    const messages = repo.listMessages(db, user.id, conversationId)
    assert.equal(messages.length, 1, 'only the user message; no invented assistant reply')
    assert.equal(messages[0].role, 'user')
    assert.equal(messages[0].content, DUMP)
    assert.equal(repo.listOpenActions(db, user.id, null).length, 0)
  })

  test('a model outage preserves input, shows an honest error, and retries cleanly', async () => {
    const db = store.db
    const user = makeUser(db, 'slice-outage@pilot.test')
    const dead = deadModelConfig()

    const first = await submitTurn(db, {
      userId: user.id,
      text: DUMP,
      channel: 'web',
      idempotencyKey: 'outage-1',
      modelConfig: dead,
    })
    assert.equal(first.ok, false)
    if (first.ok || first.kind !== 'model_failure') return
    assert.ok(
      first.failure.code === 'model_unreachable' || first.failure.code === 'model_timeout',
      `unexpected code ${first.failure.code}`
    )
    assert.equal(first.failure.retryable, true)
    assert.equal(first.preservedInput, DUMP)
    const conversationId = first.conversationId!
    assert.equal(repo.listMessages(db, user.id, conversationId).length, 1)

    // Retry the SAME request once the endpoint is healthy.
    const retry = await submitTurn(db, {
      userId: user.id,
      text: DUMP,
      channel: 'web',
      conversationId,
      idempotencyKey: 'outage-1',
      modelConfig: fakeModelConfig(fake.baseUrl),
    })
    assert.equal(retry.ok, true, JSON.stringify(retry))
    if (!retry.ok || retry.kind !== 'model_turn') return
    assert.equal(repo.listMessages(db, user.id, conversationId).length, 2, 'no duplicated user message')
    assert.equal(repo.listOpenActions(db, user.id, null).filter((a) => a.conversationId === conversationId).length, 1)
  })

  test('a malformed model reply is reported, not passed off as advice', async () => {
    const malformedFake = await startFakeModel({ malformed: true })
    const db = store.db
    const user = makeUser(db, 'slice-malformed@pilot.test')
    try {
      const result = await submitTurn(db, {
        userId: user.id,
        text: DUMP,
        channel: 'web',
        modelConfig: fakeModelConfig(malformedFake.baseUrl),
      })
      assert.equal(result.ok, false)
      if (result.ok || result.kind !== 'model_failure') return
      assert.equal(result.failure.code, 'model_invalid_response')
      assert.equal(result.preservedInput, DUMP)
    } finally {
      await malformedFake.close()
    }
  })

  test('a slow model times out honestly instead of hanging the pilot user', async () => {
    const hanging = await startFakeModel({ hang: true })
    const db = store.db
    const user = makeUser(db, 'slice-timeout@pilot.test')
    try {
      const result = await submitTurn(db, {
        userId: user.id,
        text: DUMP,
        channel: 'web',
        modelConfig: { ...fakeModelConfig(hanging.baseUrl), timeoutMs: 400 },
      })
      assert.equal(result.ok, false)
      if (result.ok || result.kind !== 'model_failure') return
      assert.equal(result.failure.code, 'model_timeout')
      assert.equal(result.preservedInput, DUMP)
    } finally {
      await hanging.close()
    }
  })

  test('"save for later" and "where was I?" work with no model available', async () => {
    const db = store.db
    const user = repo.getUserByEmail(db, 'slice-a@pilot.test')!
    const conversationId = repo.listConversations(db, user.id)[0].id
    const dead = deadModelConfig()
    const callsBefore = fake.calls.length

    const saved = await submitTurn(db, {
      userId: user.id,
      text: 'save this for later',
      channel: 'web',
      conversationId,
      modelConfig: dead,
    })
    assert.equal(saved.ok, true)
    if (!saved.ok || saved.kind !== 'directive') return
    assert.equal(saved.directive, 'save_for_later')
    assert.equal(repo.getConversation(db, user.id, conversationId)!.status, 'saved_for_later')

    const resumed = await submitTurn(db, {
      userId: user.id,
      text: 'where was I?',
      channel: 'telegram',
      conversationId,
      modelConfig: dead,
    })
    assert.equal(resumed.ok, true)
    if (!resumed.ok || resumed.kind !== 'directive') return
    assert.equal(resumed.directive, 'where_was_i')
    assert.ok(resumed.card, 'a re-entry card is returned')
    assert.match(resumed.text, /Where you were/)
    assert.ok(resumed.card!.nextAction, 'the one next action is on the card')

    assert.equal(fake.calls.length, callsBefore, 'directives never call the model')
  })

  test('a re-entry card names the project and the single next action', async () => {
    const db = store.db
    const user = repo.getUserByEmail(db, 'slice-a@pilot.test')!
    const conversationId = repo.listConversations(db, user.id)[0].id
    const card = buildReentryCard(db, user.id, conversationId)
    assert.ok(card)
    assert.ok(card!.projectName)
    assert.ok(card!.nextAction)
    assert.equal(Array.isArray(card!.nextAction), false)
  })
})

describe('Retried requests do not duplicate work', () => {
  let fake: FakeModel
  let store: TempStore

  before(async () => {
    fake = await startFakeModel()
    store = tempStore()
  })
  after(async () => {
    await fake.close()
    try {
      store.db.close()
    } catch {
      /* already closed */
    }
    store.dispose()
  })

  test('the same idempotency key replays the stored result and calls the model once', async () => {
    const db = store.db
    const user = makeUser(db, 'retry-a@pilot.test')
    const config = fakeModelConfig(fake.baseUrl)
    const callsBefore = fake.calls.length

    const first = await submitTurn(db, {
      userId: user.id,
      text: DUMP,
      channel: 'web',
      idempotencyKey: 'retry-key-1',
      modelConfig: config,
    })
    assert.equal(first.ok, true)
    if (!first.ok || first.kind !== 'model_turn') return
    const conversationId = first.conversationId

    const second = await submitTurn(db, {
      userId: user.id,
      text: DUMP,
      channel: 'web',
      conversationId,
      idempotencyKey: 'retry-key-1',
      modelConfig: config,
    })
    assert.equal(second.ok, true)
    if (!second.ok || second.kind !== 'model_turn') return

    assert.equal(second.deduplicated, true, 'second call is a replay')
    assert.equal(fake.calls.length, callsBefore + 1, 'the model was called exactly once')
    assert.equal(second.turn.interpretation, first.turn.interpretation)
    assert.equal(second.nextAction!.id, first.nextAction!.id, 'same action, not a duplicate')

    assert.equal(repo.listMessages(db, user.id, conversationId).length, 2)
    const actions = repo.listOpenActions(db, user.id, null).filter((a) => a.conversationId === conversationId)
    assert.equal(actions.length, 1, 'exactly one next action after a retry')

    // A third retry stays idempotent too.
    const third = await submitTurn(db, {
      userId: user.id,
      text: DUMP,
      channel: 'web',
      conversationId,
      idempotencyKey: 'retry-key-1',
      modelConfig: config,
    })
    assert.equal(third.ok && third.kind === 'model_turn' ? third.deduplicated : false, true)
    assert.equal(fake.calls.length, callsBefore + 1)
    assert.equal(
      repo.listOpenActions(db, user.id, null).filter((a) => a.conversationId === conversationId).length,
      1
    )
  })

  test('a repeated identical message without a key is treated as a new turn', async () => {
    const db = store.db
    const user = makeUser(db, 'retry-b@pilot.test')
    const config = fakeModelConfig(fake.baseUrl)
    const callsBefore = fake.calls.length

    const a = await submitTurn(db, { userId: user.id, text: 'same words', channel: 'web', modelConfig: config })
    assert.equal(a.ok, true)
    if (!a.ok || a.kind !== 'model_turn') return
    const b = await submitTurn(db, {
      userId: user.id,
      text: 'same words',
      channel: 'web',
      conversationId: a.conversationId,
      modelConfig: config,
    })
    assert.equal(b.ok, true)
    if (!b.ok || b.kind !== 'model_turn') return

    assert.equal(b.deduplicated, false)
    assert.equal(fake.calls.length, callsBefore + 2, 'both were answered')
    assert.equal(repo.listMessages(db, user.id, a.conversationId).length, 4)
  })
})

describe('User isolation', () => {
  let store: TempStore
  let userA: { id: string }
  let userB: { id: string }
  let aProjectId: string
  let aConversationId: string
  let aActionId: string
  let aFactId: string

  before(async () => {
    store = tempStore()
    const fake = await startFakeModel()
    const db = store.db
    userA = makeUser(db, 'user-a@pilot.test')
    userB = makeUser(db, 'user-b@pilot.test')

    const res = await submitTurn(db, {
      userId: userA.id,
      text: DUMP,
      channel: 'web',
      modelConfig: fakeModelConfig(fake.baseUrl),
    })
    await fake.close()
    assert.equal(res.ok, true)
    if (!res.ok || res.kind !== 'model_turn') throw new Error('setup turn failed')
    aProjectId = res.projectId!
    aConversationId = res.conversationId
    aActionId = res.nextAction!.id
    aFactId = repo.listFacts(db, userA.id, aProjectId)[0].id
  })

  after(() => {
    try {
      store.db.close()
    } catch {
      /* already closed */
    }
    store.dispose()
  })

  test('User B cannot read User A project, conversation, action or fact by id', () => {
    const db = store.db
    assert.equal(repo.getProject(db, userB.id, aProjectId), null)
    assert.equal(repo.getConversation(db, userB.id, aConversationId), null)
    assert.equal(repo.getAction(db, userB.id, aActionId), null)
    assert.equal(repo.getFact(db, userB.id, aFactId), null)
    assert.equal(repo.listMessages(db, userB.id, aConversationId).length, 0)
    assert.equal(repo.listFacts(db, userB.id, aProjectId).length, 0)
    assert.equal(repo.listOpenActions(db, userB.id, aProjectId).length, 0)
    assert.equal(buildReentryCard(db, userB.id, aConversationId), null)
  })

  test('User B cannot write into User A records', () => {
    const db = store.db
    assert.throws(
      () =>
        repo.appendMessage(db, {
          userId: userB.id,
          conversationId: aConversationId,
          role: 'user',
          content: 'injected',
        }),
      /conversation_not_found/
    )
    assert.equal(repo.setConversationStatus(db, userB.id, aConversationId, 'closed'), false)
    assert.equal(repo.setActionStatus(db, userB.id, aActionId, 'done'), false)
    assert.equal(repo.correctFact(db, userB.id, aFactId, 'rewritten'), null)
    assert.equal(repo.deleteFact(db, userB.id, aFactId), false)
    assert.equal(repo.updateProjectSummary(db, userB.id, aProjectId, 'hijacked'), false)

    // A's data is untouched.
    assert.equal(repo.listMessages(db, userA.id, aConversationId).length, 2)
    assert.equal(repo.getFact(db, userA.id, aFactId)!.content.includes('rewritten'), false)
  })

  test('User B cannot continue User A conversation through submitTurn', async () => {
    const db = store.db
    const fake = await startFakeModel()
    try {
      const res = await submitTurn(db, {
        userId: userB.id,
        text: 'give me the context',
        channel: 'web',
        conversationId: aConversationId,
        modelConfig: fakeModelConfig(fake.baseUrl),
      })
      assert.equal(res.ok, false)
      if (res.ok) return
      assert.equal(res.kind, 'not_found', 'an owned-by-someone-else id reads as not found')
      assert.equal(fake.calls.length, 0, 'no model call, so no A content in a prompt')
    } finally {
      await fake.close()
    }
    assert.equal(repo.listMessages(db, userA.id, aConversationId).length, 2)
  })

  test('a listing never crosses users', () => {
    const db = store.db
    assert.equal(repo.listProjects(db, userB.id).length, 0)
    assert.equal(repo.listConversations(db, userB.id).length, 0)
    assert.equal(repo.listFacts(db, userB.id).length, 0)
    assert.equal(repo.listProjects(db, userA.id).length, 1)
  })
})

describe('Remembered facts carry source and timestamps and can be corrected or deleted', () => {
  let store: TempStore

  before(() => {
    store = tempStore()
  })
  after(() => {
    try {
      store.db.close()
    } catch {
      /* already closed */
    }
    store.dispose()
  })

  test('facts record where they came from, and the user can fix or remove them', async () => {
    const db = store.db
    const user = makeUser(db, 'facts-a@pilot.test')
    const fake = await startFakeModel()
    let factId: string
    let projectId: string
    try {
      const res = await submitTurn(db, {
        userId: user.id,
        text: DUMP,
        channel: 'web',
        modelConfig: fakeModelConfig(fake.baseUrl),
      })
      assert.equal(res.ok, true)
      if (!res.ok || res.kind !== 'model_turn') return
      projectId = res.projectId!
      const facts = repo.listFacts(db, user.id, projectId)
      assert.equal(facts.length, 2)
      factId = facts[0].id

      assert.match(facts[0].source, /^brain_dump:web$/)
      assert.ok(facts[0].sourceRef, 'provenance points at the originating message')
      assert.ok(facts[0].createdAt)
      assert.ok(facts[0].updatedAt)
      assert.equal(facts[0].confidence, 'stated')
    } finally {
      await fake.close()
    }

    const corrected = repo.correctFact(db, user.id, factId, 'Actually the deadline is Friday')
    assert.ok(corrected)
    assert.equal(corrected!.content, 'Actually the deadline is Friday')
    assert.equal(corrected!.source, 'user_correction')
    assert.ok(corrected!.correctedFrom, 'the previous value stays traceable')

    assert.equal(repo.deleteFact(db, user.id, factId), true)
    assert.equal(repo.getFact(db, user.id, factId), null, 'a deleted fact stops being context')
    assert.equal(repo.listFacts(db, user.id, projectId).length, 1)
    assert.equal(repo.deleteFact(db, user.id, factId), false, 'cannot delete twice')
  })
})
