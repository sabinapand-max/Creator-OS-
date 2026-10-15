/**
 * Live Neon connection + schema smoke test. Writes a throwaway user/project/fact,
 * reads it back, then deletes exactly those rows. Not part of the app runtime.
 *   node --env-file=.env.local scripts/neon-smoke.ts
 */
import { getDb, closeDb, activeDbPath } from '../lib/pilot/db/client.ts'
import * as repo from '../lib/pilot/db/repo.ts'

async function main() {
  const db = getDb()
  console.log('active backend:', activeDbPath())

  const email = `smoke-${Date.now()}@neon.test`
  const user = await repo.createUser(db, { email, displayName: 'Neon Smoke', passwordHash: 'not-a-real-hash' })
  const project = await repo.createProject(db, { userId: user.id, title: 'Smoke project' })
  await repo.createFact(db, {
    userId: user.id,
    projectId: project.id,
    content: 'Neon persistence works',
    source: 'smoke',
  })

  const readBack = await repo.listFacts(db, user.id, project.id, 10)
  console.log('wrote + read back facts:', readBack.length, '->', readBack[0]?.content)
  if (readBack.length !== 1) throw new Error('expected exactly one fact')

  // Clean up only the rows we created.
  await db.prepare('DELETE FROM facts WHERE user_id = ?').run(user.id)
  await db.prepare('DELETE FROM projects WHERE user_id = ?').run(user.id)
  await db.prepare('DELETE FROM users WHERE id = ?').run(user.id)

  const gone = await repo.getUserByEmail(db, email)
  console.log('cleanup confirmed, user now absent:', gone === null)
  await closeDb()
  console.log('NEON SMOKE: PASS')
}

main().catch((err) => {
  console.error('NEON SMOKE: FAIL', err)
  process.exitCode = 1
})
