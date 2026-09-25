/**
 * Client handle on the server's generated drafts.
 *
 * Not persisted to localStorage, for the same reason as the pilot store: the
 * drafts live in SQLite, scoped to the signed-in user, so a refresh re-reads
 * them instead of replaying a browser-local copy that could belong to another
 * pilot account. This replaces the old `ai-generations` store that Social Studio
 * and Marketplace used to read — nothing ever wrote to it, which is why both
 * screens only showed empty states.
 *
 * No model key is held or sent here. Generation happens server-side.
 */
import { create } from 'zustand'
import type { ContentDraft, DraftChannel, DraftKind } from '@/lib/pilot/types.ts'

/** What one call to /api/pilot/drafts produced. The UI renders these verbatim. */
export type DraftsOutcome =
  | {
      ok: true
      drafts: ContentDraft[]
      projectId: string | null
      projectTitle: string | null
      model: string
      latencyMs: number
      /** True when the model hit its token cap, so some channels are missing. */
      truncated: boolean
    }
  | {
      ok: false
      code: string
      error: string
      retryable: boolean
      status: number
    }

/** Provenance for the last successful generation, so a draft is never mistaken
 * for a template: which model wrote it, how long it took, from which project. */
export interface LastGeneration {
  model: string
  latencyMs: number
  projectTitle: string | null
  kind: DraftKind
  at: string
  truncated: boolean
  /** Channels asked for against channels delivered, so a short answer is visible
   * rather than looking like a complete one. */
  requested: number
  delivered: number
}

interface DraftsStore {
  drafts: ContentDraft[]
  loading: boolean
  generating: boolean
  /** True once the first load has resolved, so an empty list can be shown as
   * "no drafts yet" rather than as a blank screen mid-fetch. */
  hydrated: boolean
  error: string | null
  lastGeneration: LastGeneration | null
  /** Which account this in-memory list belongs to. See clearIfOwnedByAnother. */
  owner: string | null

  load: () => Promise<void>
  generate: (input: {
    kind: DraftKind
    channels: DraftChannel[]
    projectId?: string | null
    brief?: string | null
  }) => Promise<DraftsOutcome>
  remove: (draftId: string) => Promise<void>
  /** Drop the list if it belongs to a different account than the one signed in. */
  clearIfOwnedByAnother: (userId: string) => void
  reset: () => void
}

async function readJson(res: Response): Promise<any> {
  try {
    return await res.json()
  } catch {
    return null
  }
}

const EMPTY = {
  drafts: [] as ContentDraft[],
  loading: false,
  generating: false,
  hydrated: false,
  error: null as string | null,
  lastGeneration: null as LastGeneration | null,
}

export const useDraftsStore = create<DraftsStore>()((set, get) => ({
  ...EMPTY,
  owner: null,

  load: async () => {
    set({ loading: true, error: null })
    try {
      const res = await fetch('/api/pilot/drafts', { cache: 'no-store' })
      const data = await readJson(res)
      if (!res.ok || !data?.ok) {
        set({
          hydrated: true,
          error: String(data?.error ?? `Could not load drafts (HTTP ${res.status}).`),
        })
        return
      }
      set({ drafts: Array.isArray(data.drafts) ? data.drafts : [], hydrated: true, error: null })
    } catch (err) {
      set({
        hydrated: true,
        error: err instanceof Error ? err.message : 'Could not reach the pilot server.',
      })
    } finally {
      set({ loading: false })
    }
  },

  generate: async (input) => {
    if (get().generating) {
      return {
        ok: false,
        code: 'already_generating',
        error: 'A generation is already running. Wait for it to finish.',
        retryable: false,
        status: 0,
      }
    }

    set({ generating: true, error: null })
    try {
      const res = await fetch('/api/pilot/drafts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      })
      const data = await readJson(res)

      if (!data || typeof data !== 'object') {
        const error = `Unexpected response (HTTP ${res.status}).`
        set({ error })
        return { ok: false, code: 'rejected', error, retryable: false, status: res.status }
      }

      if (!data.ok) {
        const error = String(data.error ?? 'The model could not produce drafts.')
        set({ error })
        return {
          ok: false,
          code: String(data.code ?? data.kind ?? 'rejected'),
          error,
          retryable: Boolean(data.retryable),
          status: res.status,
        }
      }

      const drafts: ContentDraft[] = Array.isArray(data.drafts) ? data.drafts : []
      // Prepend rather than replace: earlier drafts are still on the server and
      // still listed, so dropping them from view would hide real records.
      const existing = get().drafts.filter((d) => !drafts.some((n) => n.id === d.id))
      set({
        drafts: [...drafts, ...existing],
        error: null,
        lastGeneration: {
          model: String(data.model ?? ''),
          latencyMs: Number(data.latencyMs ?? 0),
          projectTitle: data.projectTitle ?? null,
          kind: input.kind,
          at: new Date().toISOString(),
          truncated: Boolean(data.truncated),
          requested: input.channels.length,
          delivered: drafts.length,
        },
      })

      return {
        ok: true,
        drafts,
        projectId: data.projectId ?? null,
        projectTitle: data.projectTitle ?? null,
        model: String(data.model ?? ''),
        latencyMs: Number(data.latencyMs ?? 0),
        truncated: Boolean(data.truncated),
      }
    } catch (err) {
      const error = err instanceof Error ? err.message : 'Network error while calling the model.'
      set({ error })
      return { ok: false, code: 'network', error, retryable: true, status: 0 }
    } finally {
      set({ generating: false })
    }
  },

  remove: async (draftId) => {
    // Remove it locally first so the card disappears immediately, then confirm
    // with the server and reload if the server disagrees.
    const before = get().drafts
    set({ drafts: before.filter((d) => d.id !== draftId), error: null })
    try {
      const res = await fetch(`/api/pilot/drafts/${encodeURIComponent(draftId)}`, {
        method: 'DELETE',
      })
      const data = await readJson(res)
      if (!res.ok || !data?.ok) {
        set({
          drafts: before,
          error: String(data?.error ?? `Could not delete that draft (HTTP ${res.status}).`),
        })
      }
    } catch (err) {
      set({
        drafts: before,
        error: err instanceof Error ? err.message : 'Could not reach the pilot server.',
      })
    }
  },

  /**
   * The server list is per-user, but this store lives in the tab. When a
   * different pilot account signs in, the previous user's drafts would still be
   * rendered for the moment between mount and the first fetch, so drop them the
   * instant the session resolves to somebody else. An entry written before
   * `owner` existed hydrates as null, which never matches a real user id.
   */
  clearIfOwnedByAnother: (userId) => {
    if (get().owner === userId) return
    set({ ...EMPTY, owner: userId })
  },

  reset: () => set({ ...EMPTY, owner: null }),
}))
