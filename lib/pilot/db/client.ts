/**
 * Database connection management for the pilot store.
 *
 * Two interchangeable async backends sit behind one small interface (`Db`),
 * chosen by environment:
 *
 *  - Neon Postgres  — used when `DATABASE_URL` (or `POSTGRES_URL`) is set. This
 *    is the durable production store. Render/Vercel filesystems are ephemeral,
 *    so the old SQLite file was wiped on every spin-down; a hosted Postgres is
 *    the only way state survives there. Uses the pooled endpoint, which is the
 *    serverless-safe connection.
 *  - node:sqlite     — used with no `DATABASE_URL` (local dev) and always for
 *    tests via `openIsolatedDb(':memory:')`, so the suite stays fast, offline
 *    and hermetic while exercising the exact same `repo.ts` code.
 *
 * The interface keeps the SQLite method names (`prepare().get/all/run`, `exec`)
 * but every method is async, so callers `await` them. `?` placeholders are
 * translated to `$n` automatically for Postgres, so `repo.ts` SQL is portable.
 */
import { DatabaseSync } from 'node:sqlite'
import fs from 'node:fs'
import path from 'node:path'
import { Pool } from '@neondatabase/serverless'
import { SCHEMA_SQL, SCHEMA_VERSION } from './schema.ts'

/* --------------------------------------------------------------- interface */

export interface Stmt {
  get(...params: any[]): Promise<any | undefined>
  all(...params: any[]): Promise<any[]>
  run(...params: any[]): Promise<{ changes: number }>
}

export interface Db {
  prepare(sql: string): Stmt
  exec(sql: string): Promise<void>
  close(): Promise<void>
}

/* ------------------------------------------------------------- path/env */

export function defaultDbPath(): string {
  const fromEnv = process.env.PILOT_DB_PATH
  if (fromEnv && fromEnv.trim().length > 0) {
    return path.isAbsolute(fromEnv) ? fromEnv : path.resolve(process.cwd(), fromEnv.trim())
  }
  return path.join(process.cwd(), 'data', 'pilot.sqlite')
}

function neonConnectionString(): string | null {
  const url = process.env.DATABASE_URL || process.env.POSTGRES_URL
  return url && url.trim().length > 0 ? url.trim() : null
}

/** Translate SQLite `?` placeholders to Postgres `$1, $2, …` in order. */
function toPgPlaceholders(sql: string): string {
  let i = 0
  return sql.replace(/\?/g, () => `$${++i}`)
}

/* --------------------------------------------------------- sqlite backend */

function sqliteMigrate(sdb: DatabaseSync): void {
  sdb.exec('PRAGMA journal_mode = WAL')
  sdb.exec('PRAGMA foreign_keys = ON')
  sdb.exec('PRAGMA busy_timeout = 5000')
  sdb.exec(SCHEMA_SQL)

  const row = sdb
    .prepare('SELECT value FROM schema_meta WHERE key = ?')
    .get('schema_version') as { value: string } | undefined

  if (!row) {
    sdb
      .prepare('INSERT INTO schema_meta (key, value) VALUES (?, ?)')
      .run('schema_version', String(SCHEMA_VERSION))
  } else if (row.value !== String(SCHEMA_VERSION)) {
    throw new Error(
      `Pilot database schema mismatch: store is version ${row.value}, code expects ${SCHEMA_VERSION}.`
    )
  }
}

function openSqlite(dbPath: string): Db {
  if (dbPath !== ':memory:') {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true })
  }
  const sdb = new DatabaseSync(dbPath)
  sqliteMigrate(sdb)
  return {
    prepare(sql: string): Stmt {
      return {
        async get(...p: any[]) {
          return sdb.prepare(sql).get(...p)
        },
        async all(...p: any[]) {
          return sdb.prepare(sql).all(...p)
        },
        async run(...p: any[]) {
          const r = sdb.prepare(sql).run(...p)
          return { changes: Number(r.changes) }
        },
      }
    },
    async exec(sql: string) {
      sdb.exec(sql)
    },
    async close() {
      sdb.close()
    },
  }
}

/* ------------------------------------------------------------ neon backend */

function neonMigrate(pool: Pool): Promise<void> {
  return (async () => {
    // SCHEMA_SQL is idempotent (IF NOT EXISTS) and has no bound params, so the
    // whole multi-statement script runs as a single simple query.
    await pool.query(SCHEMA_SQL)
    const r = await pool.query('SELECT value FROM schema_meta WHERE key = $1', [
      'schema_version',
    ])
    const row = r.rows?.[0] as { value: string } | undefined
    if (!row) {
      await pool.query('INSERT INTO schema_meta (key, value) VALUES ($1, $2)', [
        'schema_version',
        String(SCHEMA_VERSION),
      ])
    } else if (row.value !== String(SCHEMA_VERSION)) {
      throw new Error(
        `Pilot database schema mismatch: Neon is version ${row.value}, code expects ${SCHEMA_VERSION}.`
      )
    }
  })()
}

function makeNeonDb(pool: Pool, ready: Promise<void>): Db {
  return {
    prepare(sql: string): Stmt {
      const psql = toPgPlaceholders(sql)
      return {
        async get(...p: any[]) {
          await ready
          const r = await pool.query(psql, p)
          return r.rows?.[0] ?? undefined
        },
        async all(...p: any[]) {
          await ready
          const r = await pool.query(psql, p)
          return r.rows ?? []
        },
        async run(...p: any[]) {
          await ready
          const r = await pool.query(psql, p)
          return { changes: r.rowCount ?? 0 }
        },
      }
    },
    async exec(sql: string) {
      await ready
      await pool.query(sql)
    },
    async close() {
      await pool.end().catch(() => {})
    },
  }
}

/* --------------------------------------------------------------- singleton */

let active: Db | null = null
let activePath: string | null = null
let neonPool: Pool | null = null
let neonReady: Promise<void> | null = null

/** Open (or reuse) the pilot database, selecting the backend from the env. */
export function getDb(dbPath?: string): Db {
  if (active) return active

  const conn = neonConnectionString()
  if (conn) {
    if (!neonPool) {
      neonPool = new Pool({ connectionString: conn })
      neonReady = neonMigrate(neonPool).catch((err) => {
        // Allow a later call to retry migration after a transient failure.
        neonReady = null
        throw err
      })
    }
    active = makeNeonDb(neonPool, neonReady!)
    activePath = 'neon'
    return active
  }

  const p = dbPath ?? defaultDbPath()
  active = openSqlite(p)
  activePath = p
  return active
}

/**
 * Open an isolated SQLite database, bypassing the singleton and the Neon
 * backend. Used by tests (each case gets a clean, hermetic store) and by
 * scripts that must not disturb a running pilot.
 */
export function openIsolatedDb(dbPath: string): Db {
  return openSqlite(dbPath)
}

export async function closeDb(): Promise<void> {
  active = null
  activePath = null
  if (neonPool) {
    try {
      await neonPool.end()
    } catch {
      // Already ended; nothing useful to do.
    }
    neonPool = null
    neonReady = null
  }
}

/** Point the singleton at a specific database. Test and script helper. */
export function useDb(db: Db, dbPath: string): void {
  active = db
  activePath = dbPath
}

export function activeDbPath(): string | null {
  return activePath
}
