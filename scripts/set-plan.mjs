#!/usr/bin/env node
/**
 * Manual entitlement flip for the paywall.
 *
 * Promotes or demotes a pilot account's hosted-model plan. Free users must bring
 * their own key; only 'paid' users consume the server's hosted default model.
 * There is no self-serve checkout yet, so this is the intended way to grant the
 * hosted model during the pilot.
 *
 *   node scripts/set-plan.mjs <email> [free|paid]
 *
 * Targets the SQLite store at PILOT_DB_PATH (default ./data/pilot.sqlite).
 */
import { DatabaseSync } from 'node:sqlite'
import path from 'node:path'

const [email, planArg] = process.argv.slice(2)
const plan = planArg === undefined ? 'paid' : planArg

if (!email || (plan !== 'free' && plan !== 'paid')) {
  console.error('usage: node scripts/set-plan.mjs <email> [free|paid]   (default paid)')
  process.exit(1)
}

const dbPath = process.env.PILOT_DB_PATH || path.join(process.cwd(), 'data', 'pilot.sqlite')
const db = new DatabaseSync(dbPath)

const before = db.prepare('SELECT id, email, plan FROM users WHERE lower(email) = lower(?)').get(email)
if (!before) {
  console.error(`No such user: ${email}`)
  db.close()
  process.exit(2)
}

db.prepare('UPDATE users SET plan = ? WHERE id = ?').run(plan, before.id)
const after = db.prepare('SELECT plan FROM users WHERE id = ?').get(before.id)
console.log(`${email}: ${before.plan ?? 'free'} -> ${after.plan}`)
db.close()
