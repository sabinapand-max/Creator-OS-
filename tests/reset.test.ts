import { test } from 'node:test'
import assert from 'node:assert/strict'
import { registerAccount, signIn } from '../lib/pilot/auth/index.ts'
import {
  completePasswordReset,
  issuePasswordReset,
} from '../lib/pilot/auth/reset.ts'
import * as repo from '../lib/pilot/db/repo.ts'
import { tempStore } from './helpers.ts'

/**
 * Password-recovery tests. The product promise: a forgotten password can be
 * replaced with only the mailbox as proof of identity, an issued code is
 * single-use and time-boxed, and the flow never tells an outsider whether an
 * address is registered.
 */

const OLD_PW = 'first-password-123'
const NEW_PW = 'second-password-456'

async function accountWithPassword() {
  const store = tempStore()
  const email = `reset-${Math.random().toString(36).slice(2, 10)}@indigos.test`
  const reg = await registerAccount(store.db, { email, password: OLD_PW })
  assert.ok(reg.ok && reg.userId)
  return { store, email, userId: reg.userId }
}

test('recovery happy path: new password works, old one and live sessions do not', async () => {
  const { store, email, userId } = await accountWithPassword()
  const session = await signIn(store.db, { email, password: OLD_PW })
  assert.ok(session.ok && session.sessionId)

  const issued = await issuePasswordReset(store.db, userId)
  assert.ok(issued.ok)

  const done = await completePasswordReset(store.db, { email, code: issued.code!, password: NEW_PW })
  assert.deepEqual(done, { ok: true })

  assert.equal((await signIn(store.db, { email, password: OLD_PW })).ok, false)
  assert.ok((await signIn(store.db, { email, password: NEW_PW })).ok)
  assert.equal(await repo.resolveSession(store.db, session.sessionId!), null)
})

test('a code is single-use: the second redemption of the same code fails', async () => {
  const { store, email, userId } = await accountWithPassword()
  const issued = await issuePasswordReset(store.db, userId)
  assert.ok(issued.ok)
  assert.ok((await completePasswordReset(store.db, { email, code: issued.code!, password: NEW_PW })).ok)
  const again = await completePasswordReset(store.db, { email, code: issued.code!, password: 'third-password-789' })
  assert.equal(again.ok, false)
})

test('expired codes are rejected, and the password stays put', async () => {
  const { store, email, userId } = await accountWithPassword()
  const issued = await issuePasswordReset(store.db, userId)
  assert.ok(issued.ok)
  await store.db.prepare('UPDATE password_reset_codes SET expires_at = ?').run('2020-01-01T00:00:00.000Z')
  const done = await completePasswordReset(store.db, { email, code: issued.code!, password: NEW_PW })
  assert.deepEqual(done, { ok: false, error: 'expired' })
  assert.ok((await signIn(store.db, { email, password: OLD_PW })).ok)
})

test('a code issued for one account cannot reset another', async () => {
  const a = await accountWithPassword()
  const b = await accountWithPassword()
  const issued = await issuePasswordReset(a.store.db, a.userId)
  assert.ok(issued.ok)
  const cross = await completePasswordReset(a.store.db, { email: b.email, code: issued.code!, password: NEW_PW })
  assert.deepEqual(cross, { ok: false, error: 'unknown_code' })
})

test('re-requesting within the cooldown does not mint a second live code', async () => {
  const { store, userId } = await accountWithPassword()
  const first = await issuePasswordReset(store.db, userId)
  assert.ok(first.ok)
  const second = await issuePasswordReset(store.db, userId)
  assert.deepEqual(second, { ok: false, reason: 'throttled' })
})

test('weak replacement passwords are refused', async () => {
  const { store, email, userId } = await accountWithPassword()
  const issued = await issuePasswordReset(store.db, userId)
  assert.ok(issued.ok)
  const done = await completePasswordReset(store.db, { email, code: issued.code!, password: 'short' })
  assert.deepEqual(done, { ok: false, error: 'weak_password' })
  assert.ok((await signIn(store.db, { email, password: OLD_PW })).ok)
})
