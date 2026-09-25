/**
 * Client-side handle on the *server's* durable state.
 *
 * Deliberately not persisted to localStorage. Identity lives in an httpOnly
 * session cookie and history lives in SQLite, so a refresh re-reads the truth
 * from /api/pilot/state instead of replaying a stale local copy. The only thing
 * the browser keeps locally is the draft the user is still typing, which stays
 * in the existing brain-dump store.
 *
 * Nothing here ever holds a model API key. Model readiness is reported as a
 * label plus a boolean, never a value.
 */
import { create } from 'zustand'
import type {
  Conversation,
  Fact,
  Message,
  NextAction,
  Project,
  ReentryCard,
  TurnResult,
} from '@/lib/pilot/types.ts'
import { useBrainDumpStore } from './brain-dump-store'
import { useDraftsStore } from './drafts-store'

export type PilotUser = { id: string; email: string; displayName: string | null }

export type ModelStatus =
  | {
      configured: true
      provider: string
      modelId: string
      baseUrl: string
      local: boolean
      apiKeyPresent: boolean
    }
  | {
      configured: false
      code: string
      message: string
      apiKeyPresent: boolean
    }

export type ModelRunSummary = {
  id: string
  status: string
  provider: string | null
  model: string | null
  errorCode: string | null
  latencyMs: number | null
  createdAt: string
}

/** What one call to /api/pilot/turn produced. The UI renders these verbatim. */
export type TurnOutcome =
  | {
      ok: true
      kind: 'model_turn'
      conversationId: string
      projectId: string | null
      turn: TurnResult
      nextAction: NextAction | null
      provider: string
      model: string
      latencyMs: number
      deduplicated: boolean
    }
  | {
      ok: true
      kind: 'directive'
      conversationId: string | null
      projectId: string | null
      text: string
      card: ReentryCard | null
      directive: string | null
    }
  | {
      ok: false
      kind: 'model_failure'
      code: string
      error: string
      retryable: boolean
      preservedInput: string
      conversationId: string | null
      projectId: string | null
      status: number
    }
  | { ok: false; kind: 'rejected'; error: string; status: number }

export type SessionStatus = 'loading' | 'anonymous' | 'authenticated'

interface PilotStore {
  status: SessionStatus
  /** Set once the first /api/pilot/state call has resolved, successfully or not. */
  hydrated: boolean
  loadError: string | null

  user: PilotUser | null
  model: ModelStatus | null

  projects: Project[]
  conversations: Conversation[]
  activeConversationId: string | null
  messages: Message[]
  latestAction: NextAction | null
  openActions: NextAction[]
  facts: Fact[]
  recentModelRuns: ModelRunSummary[]

  /** True while a turn is in flight, so the UI can disable the button. */
  submitting: boolean

  refresh: (conversationId?: string | null) => Promise<void>
  signIn: (email: string, password: string) => Promise<{ ok: boolean; error?: string }>
  register: (
    email: string,
    password: string,
    displayName?: string
  ) => Promise<{ ok: boolean; error?: string }>
  signOut: () => Promise<void>
  submitTurn: (input: {
    text: string
    conversationId?: string | null
    projectId?: string | null
    projectTitle?: string | null
    idempotencyKey?: string | null
  }) => Promise<TurnOutcome>
  reset: () => void
}

const EMPTY = {
  user: null,
  projects: [] as Project[],
  conversations: [] as Conversation[],
  activeConversationId: null as string | null,
  messages: [] as Message[],
  latestAction: null as NextAction | null,
  openActions: [] as NextAction[],
  facts: [] as Fact[],
  recentModelRuns: [] as ModelRunSummary[],
}

async function postJson(url: string, body: unknown): Promise<{ status: number; data: any }> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  let data: any = null
  try {
    data = await res.json()
  } catch {
    data = null
  }
  return { status: res.status, data }
}

export const usePilotStore = create<PilotStore>()((set, get) => ({
  status: 'loading',
  hydrated: false,
  loadError: null,
  model: null,
  submitting: false,
  ...EMPTY,

  refresh: async (conversationId) => {
    const query = conversationId ? `?conversationId=${encodeURIComponent(conversationId)}` : ''
    try {
      const res = await fetch(`/api/pilot/state${query}`, { cache: 'no-store' })
      const data = await res.json()

      if (!data?.signedIn) {
        set({ ...EMPTY, status: 'anonymous', model: data?.model ?? null, hydrated: true, loadError: null })
        // Generated drafts belong to an account, so the in-memory list goes with
        // the session rather than outliving it in this tab.
        useDraftsStore.getState().reset()
        return
      }

      // The local draft is the one piece of state the browser keeps, and
      // localStorage is scoped to the origin rather than to an account. Claim it
      // for whoever is actually signed in *before* the authenticated tree
      // renders, so another pilot user's half-typed brain dump can never appear
      // in this user's textarea (or be submitted on their behalf).
      const user: PilotUser | null = data.user ?? null
      if (user?.id) {
        useBrainDumpStore.getState().clearDraftIfOwnedByAnother(user.id)
        // Same rule for generated drafts: they are server-side and per-user, so
        // the copy this tab holds must never belong to the previous account.
        useDraftsStore.getState().clearIfOwnedByAnother(user.id)
      }

      set({
        status: 'authenticated',
        hydrated: true,
        loadError: null,
        user,
        model: data.model ?? null,
        projects: data.projects ?? [],
        conversations: data.conversations ?? [],
        activeConversationId: data.activeConversationId ?? null,
        messages: data.messages ?? [],
        latestAction: data.latestAction ?? null,
        openActions: data.openActions ?? [],
        facts: data.facts ?? [],
        recentModelRuns: data.recentModelRuns ?? [],
      })
    } catch (err) {
      // The server is unreachable. Say so instead of showing an empty app that
      // looks like the user has no history.
      set({
        hydrated: true,
        loadError: err instanceof Error ? err.message : 'Could not reach the pilot server.',
      })
    }
  },

  signIn: async (email, password) => {
    const { status, data } = await postJson('/api/pilot/auth', { action: 'signin', email, password })
    if (!data?.ok) return { ok: false, error: data?.error ?? `Sign-in failed (HTTP ${status}).` }
    await get().refresh()
    return { ok: true }
  },

  register: async (email, password, displayName) => {
    const { status, data } = await postJson('/api/pilot/auth', {
      action: 'register',
      email,
      password,
      displayName,
    })
    if (!data?.ok) return { ok: false, error: data?.error ?? `Could not create the account (HTTP ${status}).` }
    await get().refresh()
    return { ok: true }
  },

  signOut: async () => {
    await postJson('/api/pilot/auth', { action: 'signout' }).catch(() => null)
    // The local draft keeps its owner id, so signing back in as the same account
    // restores it while a different account starts from an empty textarea.
    // Generated drafts are dropped instead: they are another account's records
    // and the server will hand back the right ones on the next sign-in.
    useDraftsStore.getState().reset()
    set({ ...EMPTY, status: 'anonymous', hydrated: true, loadError: null })
  },

  submitTurn: async (input) => {
    set({ submitting: true })
    try {
      const { status, data } = await postJson('/api/pilot/turn', input)

      if (!data || typeof data !== 'object') {
        return { ok: false, kind: 'rejected', error: `Unexpected response (HTTP ${status}).`, status }
      }

      if (!data.ok) {
        if (data.kind === 'model_failure') {
          const failure: TurnOutcome = {
            ok: false,
            kind: 'model_failure',
            code: String(data.code ?? 'model_error'),
            error: String(data.error ?? 'The model could not produce a result.'),
            retryable: Boolean(data.retryable),
            // The server echoes the input back so we can prove nothing was lost.
            // Fall back to what the caller sent if the echo is missing.
            preservedInput: typeof data.preservedInput === 'string' ? data.preservedInput : input.text,
            conversationId: data.conversationId ?? null,
            projectId: data.projectId ?? null,
            status,
          }
          // A failed turn still created a project/conversation and stored the
          // user's message. Re-read so the UI shows that state honestly.
          await get().refresh(failure.conversationId)
          return failure
        }
        return {
          ok: false,
          kind: 'rejected',
          error: String(data.error ?? 'Request rejected.'),
          status,
        }
      }

      if (data.kind === 'directive') {
        const outcome: TurnOutcome = {
          ok: true,
          kind: 'directive',
          conversationId: data.conversationId ?? null,
          projectId: data.projectId ?? null,
          text: String(data.text ?? ''),
          card: data.card ?? null,
          directive: data.directive ?? null,
        }
        await get().refresh(outcome.conversationId)
        return outcome
      }

      const outcome: TurnOutcome = {
        ok: true,
        kind: 'model_turn',
        conversationId: data.conversationId,
        projectId: data.projectId ?? null,
        turn: data.turn as TurnResult,
        nextAction: data.nextAction ?? null,
        provider: String(data.provider ?? ''),
        model: String(data.model ?? ''),
        latencyMs: Number(data.latencyMs ?? 0),
        deduplicated: Boolean(data.deduplicated),
      }
      await get().refresh(outcome.conversationId)
      return outcome
    } catch (err) {
      return {
        ok: false,
        kind: 'rejected',
        error: err instanceof Error ? err.message : 'Network error while calling the model.',
        status: 0,
      }
    } finally {
      set({ submitting: false })
    }
  },

  reset: () => set({ ...EMPTY, status: 'loading', hydrated: false, loadError: null }),
}))
