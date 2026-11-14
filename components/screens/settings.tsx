'use client'

/**
 * Settings — the server's model configuration, plus an optional bring-your-own-key.
 *
 * The server is configured through environment variables (AI_BASE_URL, AI_MODEL,
 * AI_API_KEY) and reports its readiness here as a label, never a key value.
 *
 * A signed-in user may instead bring their own endpoint and key. That connection
 * is held in memory only (lib/stores/byok-store) for the current session — never
 * in localStorage, never written to the database, cleared on sign-out — and is
 * sent inside a single model request, where the server uses it for that one call
 * only. This is the safe successor to the old build that stored keys in
 * localStorage and posted them to /api/generate, which that route still refuses.
 *
 * `lib/providers/provider-manager.ts` is leftover from that old build and is not
 * reachable from this UI.
 */

import { useEffect, useState } from 'react'
import { AlertCircle, CheckCircle2, KeyRound, Loader2, Plug, Server, Ticket, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useBufferStore, useByokStore, usePilotStore, useUIStore } from '@/lib/stores'

export function SettingsScreen() {
  const model = usePilotStore((s) => s.model)
  const recentModelRuns = usePilotStore((s) => s.recentModelRuns)
  const user = usePilotStore((s) => s.user)
  const { providerSettings, updateProviderSettings } = useUIStore()
  const bufferKey = useBufferStore((s) => s.apiKey)

  const storedKeys = [
    providerSettings.groqKey && 'groqKey',
    providerSettings.openRouterKey && 'openRouterKey',
    providerSettings.claudeKey && 'claudeKey',
    bufferKey && 'bufferApiKey',
  ].filter(Boolean) as string[]

  function purgeBrowserKeys() {
    updateProviderSettings({ groqKey: '', openRouterKey: '', claudeKey: '' })
    // A publishing key is the worst one to leave behind: the old scheduling
    // dialog could turn it into a real post. Clear the connection flag too, so
    // the dialog shows the disabled notice rather than a stale "connected" form.
    useBufferStore.getState().setApiKey('')
    useBufferStore.getState().setConnected(false)
  }

  // 2026-11-14: the "Keys stored in this browser" card was removed — pilot-era
  // housekeeping nobody recognised, and it alarmed users who had never seen it.
  // The purge now runs silently on mount; the values were never used by any
  // code path anyway.
  useEffect(() => {
    if (storedKeys.length > 0) purgeBrowserKeys()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div className="space-y-6 p-6 lg:p-8 animate-in fade-in duration-500">
      <div>
        <h1 className="mb-2 text-3xl font-bold text-balance">Model &amp; account</h1>
        <p className="text-muted-foreground">
          The server model is configured by the environment and shown read-only. Optionally,
          bring your own key below to run generations on your own account.
        </p>
      </div>

      {/* Model configuration */}
      <Card className="bg-card border-border">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Server className="h-5 w-5 text-primary" />
            Configured model
          </CardTitle>
          <CardDescription>
            Reported by the server. The API key value is never sent to the browser.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {!model ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : model.configured ? (
            <>
              <div className="flex items-center gap-2 text-sm font-medium text-chart-3">
                <CheckCircle2 className="h-4 w-4" />
                Ready — real generations enabled
              </div>
              <dl className="grid gap-2 text-sm sm:grid-cols-[140px_1fr]">
                <dt className="text-muted-foreground">Provider</dt>
                <dd className="font-mono">{model.provider}</dd>
                <dt className="text-muted-foreground">Model</dt>
                <dd className="font-mono">{model.modelId}</dd>
                <dt className="text-muted-foreground">Endpoint</dt>
                <dd className="font-mono break-all">{model.baseUrl}</dd>
                <dt className="text-muted-foreground">Location</dt>
                <dd>
                  {model.local
                    ? 'Local (loopback) — nothing leaves this machine'
                    : 'Hosted by Indigos — the server\u2019s fine-tuned model. Your own key below overrides it.'}
                </dd>
                <dt className="text-muted-foreground">API key</dt>
                <dd>
                  {model.local
                    ? 'Not required for a loopback endpoint'
                    : model.apiKeyPresent
                      ? 'Present in the server environment'
                      : 'MISSING — calls will be refused'}
                </dd>
              </dl>
            </>
          ) : (
            <>
              <div className="flex items-center gap-2 text-sm font-medium text-destructive">
                <AlertCircle className="h-4 w-4" />
                Not configured — nothing will be generated
              </div>
              <p className="text-sm text-muted-foreground">{model.message}</p>
              <p className="text-xs text-muted-foreground">
                Code: <span className="font-mono">{model.code}</span>
              </p>
            </>
          )}

          <div className="rounded-md bg-secondary/50 p-3 text-xs text-muted-foreground">
            <p className="mb-1 font-medium text-foreground">To change it, edit the server env:</p>
            <pre className="overflow-x-auto font-mono leading-relaxed">
{`AI_BASE_URL=http://127.0.0.1:1234/v1
AI_MODEL=<loaded-model-id>
AI_API_KEY=<only for remote providers>`}
            </pre>
            <p className="mt-2">
              In local development that is <span className="font-mono">.env.local</span> in the app
              root; restart the dev server after editing. Never paste a key into this page.
            </p>
          </div>
        </CardContent>
      </Card>

      <TrialCard />

      <ByokCard />

      {/* Account */}
      <Card className="bg-card border-border">
        <CardHeader>
          <CardTitle>Pilot account</CardTitle>
          <CardDescription>
            Sessions are httpOnly cookies. There is no user id in localStorage to tamper with.
          </CardDescription>
        </CardHeader>
        <CardContent className="text-sm">
          <p className="text-foreground">{user?.displayName || '—'}</p>
          <p className="font-mono text-xs text-muted-foreground">{user?.email}</p>
        </CardContent>
      </Card>

      {/* Recent calls */}
      <Card className="bg-card border-border">
        <CardHeader>
          <CardTitle>Recent model calls</CardTitle>
          <CardDescription>
            Real attempts recorded server-side, including failures. No mock output is logged here
            because none is produced.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {recentModelRuns.length === 0 ? (
            <p className="text-sm text-muted-foreground">No calls yet.</p>
          ) : (
            <div className="space-y-1 font-mono text-xs">
              {recentModelRuns.map((r) => (
                <div key={r.id} className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <span className={r.status === 'succeeded' ? 'text-chart-3' : 'text-destructive'}>
                    {r.status}
                  </span>
                  <span className="text-muted-foreground">{r.model ?? '—'}</span>
                  <span className="text-muted-foreground">
                    {r.latencyMs != null ? `${r.latencyMs}ms` : '—'}
                  </span>
                  {r.errorCode && <span className="text-destructive">{r.errorCode}</span>}
                  <span className="text-muted-foreground">
                    {new Date(r.createdAt).toLocaleString()}
                  </span>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

/**
 * Free-trial card.
 *
 * Registration is open and every new account is auto-granted a 14-day hosted-model
 * trial (20 generations). When it ends, an extended-trial code the owner hands out
 * can be redeemed right here. This card is the receiving end. It appears when the
 * account holds a trial or is gated, and stays out of the way otherwise (a paid
 * plan, or a local dev model with no gate).
 */
function TrialCard() {
  const model = usePilotStore((s) => s.model)
  const redeemTrialCode = usePilotStore((s) => s.redeemTrialCode)

  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null)

  const onTrial = Boolean(model?.configured && model?.entitlement === 'trial')
  const gated = Boolean(model && !model.configured && model.code === 'byok_required')
  if (!onTrial && !gated) return null

  const left = model?.trialTurnsRemaining ?? 0

  async function submit(event: { preventDefault: () => void }) {
    event.preventDefault()
    const value = code.trim()
    if (!value || busy) return
    setBusy(true)
    setNote(null)
    const result = await redeemTrialCode(value)
    setBusy(false)
    if (result.ok) {
      setCode('')
      setNote({ ok: true, text: 'Added ' + result.turns + ' free generations on the hosted model.' })
    } else {
      setNote({ ok: false, text: result.error ?? 'Could not redeem that code.' })
    }
  }

  return (
    <Card className="bg-card border-border">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Ticket className="h-5 w-5 text-primary" />
          Free trial
        </CardTitle>
        <CardDescription>
          Your account started with a free hosted-model trial: 20 generations inside a 14-day
          window. When it ends, redeem a code here — credit packs (30 generations, $3) are sold
          in our Ko-fi shop and arrive by email as activation codes — or bring your own key;
          the same account and the same history keep working.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {onTrial ? (
          <p className="flex items-center gap-2 text-sm font-medium text-chart-3">
            <CheckCircle2 className="h-4 w-4" />
            Trial active — {left} hosted generation{left === 1 ? '' : 's'} left
          </p>
        ) : (
          <p className="text-sm text-muted-foreground">No trial turns on this account yet.</p>
        )}

        <form onSubmit={submit} className="flex flex-wrap items-end gap-2">
          <div className="min-w-[220px] flex-1 space-y-1">
            <Label htmlFor="trial-code" className="text-xs text-muted-foreground">
              Trial code
            </Label>
            <Input
              id="trial-code"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="IND-XXXX-XXXX-XXXX"
              autoComplete="off"
              spellCheck={false}
              className="font-mono"
            />
          </div>
          <Button type="submit" size="sm" variant="outline" disabled={busy || !code.trim()} className="gap-2">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Ticket className="h-4 w-4" />}
            Redeem
          </Button>
        </form>

        {note && (
          <p className={'text-sm ' + (note.ok ? 'text-chart-3' : 'text-destructive')}>{note.text}</p>
        )}
      </CardContent>
    </Card>
  )
}

/**
 * Bring-your-own-key card. The entered key lives only in this component and the
 * memory-only byok store; it is never persisted and is cleared on sign-out.
 */
function ByokCard() {
  const connection = useByokStore((s) => s.connection)
  const testing = useByokStore((s) => s.testing)
  const lastTest = useByokStore((s) => s.lastTest)
  const setConnection = useByokStore((s) => s.setConnection)
  const test = useByokStore((s) => s.test)
  const clear = useByokStore((s) => s.clear)

  const [baseUrl, setBaseUrl] = useState(connection?.baseUrl ?? '')
  const [modelId, setModelId] = useState(connection?.modelId ?? '')
  const [apiKey, setApiKey] = useState(connection?.apiKey ?? '')

  const active = Boolean(connection)
  const canSave = baseUrl.trim().length > 0 && modelId.trim().length > 0

  return (
    <Card className={active ? 'bg-card border-chart-3/40' : 'bg-card border-border'}>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Plug className="h-5 w-5 text-primary" />
          Bring your own key
        </CardTitle>
        <CardDescription>
          Run generations on your own model account — any OpenAI-compatible endpoint (OpenAI,
          OpenRouter, a local server). The key is kept in this tab&apos;s memory only: never saved
          to disk, never written to the database, and cleared when you sign out.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {active && (
          <div className="flex items-center gap-2 rounded-md bg-chart-3/10 px-3 py-2 text-sm text-chart-3">
            <CheckCircle2 className="h-4 w-4" />
            Active for this session — requests use <span className="font-mono">{connection?.modelId}</span>
          </div>
        )}

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="byok-base">Endpoint base URL</Label>
            <Input
              id="byok-base"
              className="font-mono"
              placeholder="https://api.openai.com/v1"
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="byok-model">Model id</Label>
            <Input
              id="byok-model"
              className="font-mono"
              placeholder="gpt-4o-mini"
              value={modelId}
              onChange={(e) => setModelId(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="byok-key">API key</Label>
            <Input
              id="byok-key"
              type="password"
              className="font-mono"
              placeholder="sk-…"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              autoComplete="off"
            />
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            disabled={!canSave || testing}
            className="gap-2"
            onClick={async () => {
              setConnection({ provider: '', baseUrl: baseUrl.trim(), modelId: modelId.trim(), apiKey: apiKey.trim() })
              await test()
            }}
          >
            {testing ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
            {active ? 'Re-test & use' : 'Test & use'}
          </Button>
          {active && (
            <Button size="sm" variant="outline" onClick={clear} className="gap-2">
              <Trash2 className="h-4 w-4" />
              Stop using
            </Button>
          )}
        </div>

        {lastTest && (
          <p className={'flex items-start gap-2 text-sm ' + (lastTest.ok ? 'text-chart-3' : 'text-destructive')}>
            {lastTest.ok ? <CheckCircle2 className="mt-0.5 h-4 w-4" /> : <AlertCircle className="mt-0.5 h-4 w-4" />}
            <span>{lastTest.message}</span>
          </p>
        )}
      </CardContent>
    </Card>
  )
}
