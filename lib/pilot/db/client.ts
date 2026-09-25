/**
 * SQLite connection management for the pilot store.
 *
 * Uses Node's built-in `node:sqlite` (Node >= 22.5, verified on Node 24.2.0).
 * Chosen after inspecting the stack as the smallest suitable durable backend:
 * the Creator OS zip ships with no database at all, and a three-person local
 * pilot does not justify provisioning a hosted Postgres. It is a real file on
 * disk, so state survives a service restart, and it is one file to back up.
 *
 * Two processes open this file concurrently (the Next.js web app and the MCP
 * server), so WAL mode and a busy timeout are required.
 */
import { DatabaseSync } from 'node:sqlite'
import fs from 'node:fs'
import path from 'node:path'
import { SCHEMA_SQL, SCHEMA_VERSION } from './schema.ts'

export type Db = DatabaseSync

let activeDb: Db | null = null
let activePath: string | null = null

export function defaultDbPath(): string {
  const fromEnv = process.env.PILOT_DB_PATH
  if (fromEnv && fromEnv.trim().length > 0) {
    // Resolve a relative path against the app root, so the same .env.local
    // works whether the process was started from the app dir or a parent.
    return path.isAbsolute(fromEnv) ? fromEnv : path.resolve(process.cwd(), fromEnv.trim())
  }
  return path.join(process.cwd(), 'data', 'pilot.sqlite')
}

function migrate(db: Db): void {
  db.exec('PRAGMA journal_mode = WAL')
  db.exec('PRAGMA foreign_keys = ON')
  db.exec('PRAGMA busy_timeout = 5000')
  db.exec(SCHEMA_SQL)

  const row = db
    .prepare('SELECT value FROM schema_meta WHERE key = ?')
    .get('schema_version') as { value: string } | undefined

  if (!row) {
    db.prepare('INSERT INTO schema_meta (key, value) VALUES (?, ?)').run(
      'schema_version',
      String(SCHEMA_VERSION)
    )
  } else if (row.value !== String(SCHEMA_VERSION)) {
    // Fail loudly rather than silently reading a schema we do not understand.
    throw new Error(
      `Pilot database schema mismatch: file is version ${row.value}, code expects ${SCHEMA_VERSION}.`
    )
  }
}

/** Open (or reuse) the pilot database. Creates the parent directory if needed. */
export function getDb(dbPath: string = defaultDbPath()): Db {
  if (activeDb && activePath === dbPath) return activeDb

  if (dbPath !== ':memory:') {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true })
  }

  const db = new DatabaseSync(dbPath)
  migrate(db)
  activeDb = db
  activePath = dbPath
  return db
}

/**
 * Open an isolated database, bypassing the singleton.
 * Used by tests so each case gets a clean store, and by scripts that must not
 * disturb a running pilot.
 */
export function openIsolatedDb(dbPath: string): Db {
  if (dbPath !== ':memory:') {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true })
  }
  const db = new DatabaseSync(dbPath)
  migrate(db)
  return db
}

export function closeDb(): void {
  if (activeDb) {
    try {
      activeDb.close()
    } catch {
      // Already closed; nothing useful to do.
    }
  }
  activeDb = null
  activePath = null
}

/** Point the singleton at a specific database. Test and script helper. */
export function useDb(db: Db, dbPath: string): void {
  activeDb = db
  activePath = dbPath
}

export function activeDbPath(): string | null {
  return activePath
}
