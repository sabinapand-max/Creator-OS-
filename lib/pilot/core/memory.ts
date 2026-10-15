/**
 * Remembered facts.
 *
 * Requirement 2 asks for source and timestamps on remembered information and
 * for users to be able to correct and delete it. Corrections keep the original
 * value reachable through `correctedFrom` so a pilot user can see what changed;
 * deletion is a soft delete, so the record cannot silently reappear in a prompt.
 *
 * Nothing here is ever read from the user's personal Hermes memory. The pilot
 * store is the Neon/SQLite `Db` and only that store.
 */
import type { Db } from '../db/client.ts'
import * as repo from '../db/repo.ts'
import type { Fact } from '../types.ts'

export interface FactChange {
  ok: boolean
  fact: Fact | null
  reason?: 'not_found' | 'not_owner' | 'empty'
}

/**
 * Record facts observed during a turn. Duplicates by content are skipped, so a
 * retried turn cannot inflate the memory with the same statement twice.
 */
export async function recordObservedFacts(
  db: Db,
  input: {
    userId: string
    projectId?: string | null
    contents: string[]
    source: string
    sourceRef?: string | null
  }
): Promise<{ created: Fact[]; skippedDuplicates: number }> {
  const existing = new Set(
    (await repo.listFacts(db, input.userId, input.projectId ?? undefined, 500)).map((f) =>
      normalise(f.content)
    )
  )
  const created: Fact[] = []
  let skippedDuplicates = 0

  for (const raw of input.contents) {
    const content = raw.trim()
    if (content.length < 3) continue
    const key = normalise(content)
    if (existing.has(key)) {
      skippedDuplicates += 1
      continue
    }
    existing.add(key)
    created.push(
      await repo.createFact(db, {
        userId: input.userId,
        projectId: input.projectId ?? null,
        content,
        source: input.source,
        sourceRef: input.sourceRef ?? null,
        confidence: 'stated',
      })
    )
  }

  return { created, skippedDuplicates }
}

export async function listFacts(
  db: Db,
  userId: string,
  projectId?: string | null
): Promise<Fact[]> {
  return repo.listFacts(db, userId, projectId ?? undefined, 500)
}

/** Correct a remembered fact. The previous value stays traceable. */
export async function correctFact(
  db: Db,
  userId: string,
  factId: string,
  newContent: string
): Promise<FactChange> {
  const trimmed = newContent.trim()
  if (!trimmed) return { ok: false, fact: null, reason: 'empty' }

  const before = await repo.getFact(db, userId, factId)
  if (!before) return { ok: false, fact: null, reason: 'not_found' }

  const updated = await repo.correctFact(db, userId, factId, trimmed)
  if (!updated) return { ok: false, fact: null, reason: 'not_found' }

  await repo.audit(db, {
    userId,
    action: 'fact_corrected',
    detail: JSON.stringify({ factId, previousContent: before.content }),
  })
  return { ok: true, fact: updated }
}

/** Delete a remembered fact so it stops being used as context. */
export async function deleteFact(
  db: Db,
  userId: string,
  factId: string
): Promise<FactChange> {
  const before = await repo.getFact(db, userId, factId)
  if (!before) return { ok: false, fact: null, reason: 'not_found' }

  const removed = await repo.deleteFact(db, userId, factId)
  if (!removed) return { ok: false, fact: null, reason: 'not_found' }

  await repo.audit(db, {
    userId,
    action: 'fact_deleted',
    detail: JSON.stringify({ factId, previousContent: before.content }),
  })
  return { ok: true, fact: null }
}

function normalise(content: string): string {
  return content.toLowerCase().replace(/\s+/g, ' ').trim()
}
