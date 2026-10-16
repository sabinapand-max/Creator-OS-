/**
 * Waitlist gate primitive.
 *
 * These tests cover repo.isOnWaitlist, the DB read that backs the registration
 * gate. The two invariants that matter: a missing table (fresh DB, tests, or the
 * landing writing to a different database) must never throw or open the
 * floodgate, and a matching email must be found regardless of casing.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as repo from '../lib/pilot/db/repo.ts'
import { tempStore } from './helpers.ts'

test('isOnWaitlist is graceful when the table does not exist', async () => {
  const { db, dispose } = tempStore()
  try {
    // newsletter_subscribers is not part of the pilot schema; a fresh DB has no
    // such table. This must resolve false rather than reject.
    assert.equal(await repo.isOnWaitlist(db, 'anyone@example.com'), false)
  } finally {
    dispose()
  }
})

test('isOnWaitlist matches a stored email, case-insensitively', async () => {
  const { db, dispose } = tempStore()
  try {
    await db
      .prepare('CREATE TABLE newsletter_subscribers (id INTEGER PRIMARY KEY, email TEXT, created_at TEXT)')
      .run()
    await db.prepare('INSERT INTO newsletter_subscribers (email) VALUES (?)').run('WaitListed@Example.com')

    assert.equal(await repo.isOnWaitlist(db, 'waitlisted@example.com'), true)
    assert.equal(await repo.isOnWaitlist(db, 'nobody@example.com'), false)
  } finally {
    dispose()
  }
})
