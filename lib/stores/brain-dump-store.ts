import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export interface BrainDump {
  id: string
  content: string
  createdAt: Date
  processedAt?: Date
}

/**
 * Local-only drafting state.
 *
 * This store persists to localStorage, which is scoped to the browser origin and
 * not to a pilot account. Two people testing on the same machine would otherwise
 * inherit each other's half-typed brain dump: a draft written by one account was
 * observed reappearing for another after sign-out. `draftOwner` records which
 * user id the current draft belongs to so it can be dropped when someone else
 * signs in, while still surviving a page refresh for the same account.
 *
 * Nothing here is durable project state. Projects, conversations, messages and
 * facts live in SQLite and are read from /api/pilot/state.
 */
interface BrainDumpStore {
  currentInput: string
  history: BrainDump[]
  draftOwner: string | null
  setCurrentInput: (input: string) => void
  addBrainDump: (content: string) => string
  clearCurrentInput: () => void
  deleteBrainDump: (id: string) => void
  clearHistory: () => void
  /**
   * Claim the local draft for the signed-in account, dropping it first if it
   * belongs to somebody else. An entry written before `draftOwner` existed
   * hydrates as `null`, which never matches a real user id, so a pre-upgrade
   * stale draft is cleared once.
   */
  clearDraftIfOwnedByAnother: (userId: string) => void
}

export const useBrainDumpStore = create<BrainDumpStore>()(
  persist(
    (set, get) => ({
      currentInput: '',
      history: [],
      draftOwner: null,
      setCurrentInput: (input) => set({ currentInput: input }),
      addBrainDump: (content) => {
        const id = crypto.randomUUID()
        const newDump: BrainDump = {
          id,
          content,
          createdAt: new Date(),
        }
        set((state) => ({
          history: [newDump, ...state.history],
          currentInput: '',
        }))
        return id
      },
      clearCurrentInput: () => set({ currentInput: '' }),
      deleteBrainDump: (id) =>
        set((state) => ({
          history: state.history.filter((dump) => dump.id !== id),
        })),
      clearHistory: () => set({ history: [] }),
      clearDraftIfOwnedByAnother: (userId) => {
        if (get().draftOwner === userId) return
        // Someone else's words. Clearing is the only honest option: they are not
        // this user's draft and must never be submitted on their behalf.
        set({ currentInput: '', history: [], draftOwner: userId })
      },
    }),
    {
      name: 'brain-dump-history',
    }
  )
)
