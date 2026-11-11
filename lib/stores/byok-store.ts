/**
 * Bring-your-own-key (BYOK) — held in memory only.
 *
 * A signed-in user can point the assistant at their own model endpoint and key.
 * This store keeps that connection in the tab's memory for the current session:
 * it is deliberately NOT persisted to localStorage or any store middleware, and
 * it is cleared on sign-out. The key travels only inside the body of a single
 * model request (the turn or the connection test), where the server uses it for
 * that one call and never writes or logs it. Close the tab and it is gone.
 *
 * This replaces the old, insecure pattern of saving provider keys to
 * localStorage. Nothing here is readable by other scripts after a reload.
 */
import { create } from 'zustand'

export interface ByokConnection {
  /** Optional; when blank the server infers the provider from the endpoint. */
  provider: string
  baseUrl: string
  modelId: string
  apiKey: string
}

interface ByokTestResult {
  ok: boolean
  message: string
  latencyMs?: number
}

interface ByokStore {
  connection: ByokConnection | null
  testing: boolean
  lastTest: ByokTestResult | null
  setConnection: (c: ByokConnection | null) => void
  clear: () => void
  test: () => Promise<ByokTestResult>
}

export const useByokStore = create<ByokStore>()((set, get) => ({
  connection: null,
  testing: false,
  lastTest: null,

  setConnection: (c) => set({ connection: c, lastTest: null }),
  clear: () => set({ connection: null, lastTest: null, testing: false }),

  test: async () => {
    const c = get().connection
    if (!c || !c.baseUrl.trim() || !c.modelId.trim()) {
      const message = 'Add an endpoint URL and a model id before testing.'
      set({ lastTest: { ok: false, message } })
      return { ok: false, message }
    }
    set({ testing: true })
    try {
      const res = await fetch('/api/pilot/model/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          byok: { provider: c.provider, baseUrl: c.baseUrl, modelId: c.modelId, apiKey: c.apiKey },
        }),
      })
      const data = await res.json().catch(() => null)
      const ok = Boolean(data?.ok)
      const message = ok
        ? `Connected — ${data.provider} · ${data.modelId}${data.latencyMs ? ` (${data.latencyMs}ms)` : ''}`
        : String(data?.message ?? data?.error ?? 'The connection test failed.')
      const result: ByokTestResult = { ok, message, latencyMs: data?.latencyMs }
      set({ testing: false, lastTest: result })
      return result
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Could not reach the test endpoint.'
      const result: ByokTestResult = { ok: false, message }
      set({ testing: false, lastTest: result })
      return result
    }
  },
}))

/**
 * The current connection as a plain object for a request body, or undefined when
 * none is set. Non-reactive on purpose: call sites use it imperatively so a
 * missing BYOK serialises to nothing and the server uses its own configuration.
 */
export function currentByok(): ByokConnection | undefined {
  const c = useByokStore.getState().connection
  if (!c || !c.baseUrl.trim() || !c.modelId.trim()) return undefined
  return { provider: c.provider, baseUrl: c.baseUrl, modelId: c.modelId, apiKey: c.apiKey }
}
