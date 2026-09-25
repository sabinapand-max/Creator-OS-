'use client'

/**
 * Pilot sign-in.
 *
 * The session is an httpOnly cookie set by /api/pilot/auth. This form never
 * touches a model API key and never stores a user id in localStorage, so there
 * is nothing in the browser to tamper with.
 *
 * It also shows the server's model readiness, because "the model is not
 * configured" is the single most likely reason a brain dump produces nothing,
 * and it should be visible before the user types rather than after.
 */

import { useState } from 'react'
import { AlertCircle, CheckCircle2, Loader2, LogIn, UserPlus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { usePilotStore } from '@/lib/stores'

export function SignInScreen() {
  const { signIn, register, model, loadError } = usePilotStore()

  const [mode, setMode] = useState<'signin' | 'register'>('signin')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    if (busy) return

    setBusy(true)
    setError(null)
    try {
      const result =
        mode === 'register'
          ? await register(email.trim(), password, displayName.trim() || undefined)
          : await signIn(email.trim(), password)
      if (!result.ok) setError(result.error ?? 'Something went wrong.')
      // On success the store flips to 'authenticated' and app-shell swaps screens.
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex min-h-screen w-full items-center justify-center p-6">
      <div className="w-full max-w-md space-y-4">
        <Card className="bg-card border-border">
          <CardHeader>
            <CardTitle className="text-xl">Creator OS — private pilot</CardTitle>
            <CardDescription>
              Three-person pilot. Your brain dumps, remembered facts and next actions are stored
              server-side against your account, so the same conversation can continue later and on
              another device.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  autoComplete="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  className="bg-secondary/50 border-border"
                  disabled={busy}
                />
              </div>

              {mode === 'register' && (
                <div className="space-y-2">
                  <Label htmlFor="displayName">
                    Display name <span className="text-muted-foreground">(optional)</span>
                  </Label>
                  <Input
                    id="displayName"
                    autoComplete="nickname"
                    value={displayName}
                    onChange={(e) => setDisplayName(e.target.value)}
                    placeholder="What should the assistant call you?"
                    className="bg-secondary/50 border-border"
                    disabled={busy}
                  />
                </div>
              )}

              <div className="space-y-2">
                <Label htmlFor="password">Password</Label>
                <Input
                  id="password"
                  type="password"
                  autoComplete={mode === 'register' ? 'new-password' : 'current-password'}
                  required
                  minLength={mode === 'register' ? 10 : undefined}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder={mode === 'register' ? 'At least 10 characters' : 'Your password'}
                  className="bg-secondary/50 border-border"
                  disabled={busy}
                />
              </div>

              {error && (
                <div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
                  <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                  <span>{error}</span>
                </div>
              )}

              <Button type="submit" disabled={busy} className="w-full gap-2">
                {busy ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : mode === 'register' ? (
                  <UserPlus className="h-4 w-4" />
                ) : (
                  <LogIn className="h-4 w-4" />
                )}
                {mode === 'register' ? 'Create pilot account' : 'Sign in'}
              </Button>

              <Button
                type="button"
                variant="ghost"
                className="w-full text-muted-foreground"
                disabled={busy}
                onClick={() => {
                  setMode(mode === 'register' ? 'signin' : 'register')
                  setError(null)
                }}
              >
                {mode === 'register'
                  ? 'Already have an account? Sign in'
                  : 'New to the pilot? Create an account'}
              </Button>
            </form>
          </CardContent>
        </Card>

        <ModelStatusCard />

        {loadError && (
          <p className="text-center text-xs text-muted-foreground">
            Server state could not be loaded: {loadError}
          </p>
        )}
      </div>
    </div>
  )
}

/**
 * Shared readout of what the server will actually call. Exported so the Brain
 * Dump screen can show the same honest status next to the generate button.
 */
export function ModelStatusCard({ compact = false }: { compact?: boolean }) {
  const model = usePilotStore((s) => s.model)

  if (!model) {
    return (
      <Card className="bg-card border-border">
        <CardContent className="flex items-center gap-2 py-4 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Checking model configuration…
        </CardContent>
      </Card>
    )
  }

  if (model.configured) {
    return (
      <Card className={compact ? 'bg-card border-border' : 'bg-card border-chart-3/30'}>
        <CardContent className="space-y-1 py-4">
          <div className="flex items-center gap-2 text-sm font-medium text-chart-3">
            <CheckCircle2 className="h-4 w-4" />
            Model configured — real generations
          </div>
          <p className="font-mono text-xs text-muted-foreground">
            {model.modelId} @ {model.baseUrl}
          </p>
          <p className="text-xs text-muted-foreground">
            {model.local
              ? 'Local endpoint. No API key needed and nothing leaves this machine.'
              : `Remote endpoint (${model.provider}). Key held server-side only.`}
          </p>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card className={compact ? 'bg-card border-border' : 'bg-card border-destructive/30'}>
      <CardContent className="space-y-1 py-4">
        <div className="flex items-center gap-2 text-sm font-medium text-destructive">
          <AlertCircle className="h-4 w-4" />
          No model configured — nothing will be generated
        </div>
        <p className="text-xs text-muted-foreground">{model.message}</p>
        <p className="text-xs text-muted-foreground">
          Your input is still saved and you can retry once this is fixed. No placeholder or mock
          text will be shown in the meantime.
        </p>
      </CardContent>
    </Card>
  )
}
