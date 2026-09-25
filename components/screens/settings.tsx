'use client'

/**
 * Settings — now a read-only view of the *server's* model configuration.
 *
 * This screen used to collect Groq / OpenRouter / Claude keys into browser
 * localStorage and describe that as "stored securely in your browser". It is
 * not secure: anything in localStorage is readable by any script on the page
 * and travels with the browser profile. The keys were then posted to
 * /api/generate as `clientKey`, which that route now refuses with HTTP 400.
 *
 * Model configuration lives in the server environment instead
 * (AI_BASE_URL, AI_MODEL, AI_API_KEY). Nothing on this page can change it, and
 * no key value is ever sent to the browser — only whether one is present.
 *
 * `lib/providers/provider-manager.ts` is left in the repo untouched; it is just
 * no longer reachable from the UI.
 */

import { useState } from 'react'
import { AlertCircle, CheckCircle2, KeyRound, Server, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { useBufferStore, usePilotStore, useUIStore } from '@/lib/stores'

export function SettingsScreen() {
  const model = usePilotStore((s) => s.model)
  const recentModelRuns = usePilotStore((s) => s.recentModelRuns)
  const user = usePilotStore((s) => s.user)
  const { providerSettings, updateProviderSettings } = useUIStore()
  const bufferKey = useBufferStore((s) => s.apiKey)

  const [purged, setPurged] = useState(false)

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
    setPurged(true)
  }

  return (
    <div className="space-y-6 p-6 lg:p-8 animate-in fade-in duration-500">
      <div>
        <h1 className="mb-2 text-3xl font-bold text-balance">Model &amp; account</h1>
        <p className="text-muted-foreground">
          Read-only. The model is configured on the server, not in this browser.
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
                <dd>{model.local ? 'Local (loopback) — nothing leaves this machine' : 'Remote'}</dd>
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

      {/* Browser key purge */}
      <Card className={storedKeys.length ? 'bg-card border-destructive/40' : 'bg-card border-border'}>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <KeyRound className="h-5 w-5 text-muted-foreground" />
            Keys stored in this browser
          </CardTitle>
          <CardDescription>
            Older builds of this app saved provider keys — and a Buffer publishing key — to
            localStorage. No code path uses them any more, and the values should not stay on the
            machine.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {storedKeys.length > 0 ? (
            <>
              <p className="text-sm text-destructive">
                Found {storedKeys.length} leftover value(s):{' '}
                <span className="font-mono">{storedKeys.join(', ')}</span>
              </p>
              <Button variant="outline" onClick={purgeBrowserKeys} className="gap-2 border-destructive/40 text-destructive">
                <Trash2 className="h-4 w-4" />
                Delete them from this browser
              </Button>
            </>
          ) : (
            <p className="flex items-center gap-2 text-sm text-chart-3">
              <CheckCircle2 className="h-4 w-4" />
              {purged ? 'Cleared. No provider or publishing keys remain in this browser.' : 'None. This browser holds no provider or publishing keys.'}
            </p>
          )}
        </CardContent>
      </Card>

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
