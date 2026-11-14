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
  const [recovery, setRecovery] = useState(false)
  const [note, setNote] = useState<string | null>(null)

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    if (busy) return

    setBusy(true)
    setError(null)
    setNote(null)
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

  if (recovery) {
    return (
      <RecoveryFlow
        initialEmail={email}
        onBack={(done) => {
          setRecovery(false)
          if (done) {
            setNote(done)
            setError(null)
          }
        }}
      />
    )
  }

  return (
    <div className="flex min-h-screen w-full items-center justify-center p-6">
      <div className="w-full max-w-md space-y-4">
        <Card className="bg-card border-border">
          <CardHeader>
            <CardTitle className="text-xl">Indigos</CardTitle>
            <CardDescription>
              A capacity-aware workspace for neurodivergent solo creators. Your brain dumps,
              remembered facts and next actions are stored server-side against your account, so the
              same conversation can continue later and on another device.
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

              {note && !error && (
                <div className="flex items-start gap-2 rounded-md border border-chart-3/30 bg-chart-3/10 p-3 text-sm text-chart-3">
                  <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
                  <span>{note}</span>
                </div>
              )}

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
                {mode === 'register' ? 'Create account' : 'Sign in'}
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
                  : 'New here? Create an account'}
              </Button>

              {mode === 'signin' && (
                <button
                  type="button"
                  onClick={() => {
                    setNote(null)
                    setRecovery(true)
                  }}
                  className="block w-full text-center text-xs text-muted-foreground underline hover:text-foreground"
                >
                  Forgot password?
                </button>
              )}

              {mode === 'register' && (
                <p className="text-xs text-muted-foreground">
                  Every new account includes a free 14-day trial of the hosted model — 20 generations,
                  no card and no code needed. Bring your own key in Settings any time to keep going
                  after that.
                </p>
              )}
            </form>

            <p className="pt-1 text-center text-xs text-muted-foreground">
              Trouble signing in?{' '}
              <a href="mailto:contact@indigos.uk" className="underline hover:text-foreground">
                contact@indigos.uk
              </a>
            </p>
          </CardContent>
        </Card>

        {/* Deliberately no model readout here: this screen is public, and printing
            the hosted endpoint and model id to anonymous visitors tells anyone
            where the inference runs. The same honest card shows in-app, once a
            real account is behind the session cookie. */}

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
 * Password recovery: ask for a code by email, then enter code + new password.
 * The server answers the same way whether or not the address exists, so this
 * panel never claims a code was delivered — only that it is on its way.
 */
function RecoveryFlow({
  initialEmail,
  onBack,
}: {
  initialEmail: string
  onBack: (done?: string) => void
}) {
  const [step, setStep] = useState<'email' | 'code'>('email')
  const [email, setEmail] = useState(initialEmail)
  const [code, setCode] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      const res = await fetch('/api/pilot/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(
          step === 'email'
            ? { action: 'forgot', email: email.trim() }
            : { action: 'reset', email: email.trim(), code, password }
        ),
      })
      const data = await res.json().catch(() => ({}))
      if (step === 'email') {
        if (data.ok) setStep('code')
        else setError(data.error ?? 'Something went wrong.')
      } else {
        if (data.ok) onBack('Password changed — sign in with your new password.')
        else setError(data.error ?? 'That code does not work. Request a new one.')
      }
    } catch {
      setError('Could not reach the server. Try again in a moment.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex min-h-screen w-full items-center justify-center p-6">
      <div className="w-full max-w-md space-y-4">
        <Card className="bg-card border-border">
          <CardHeader>
            <CardTitle className="text-xl">
              {step === 'email' ? 'Recover your password' : 'Enter your recovery code'}
            </CardTitle>
            <CardDescription>
              {step === 'email'
                ? 'We email a one-time code to the address on the account. If the address is not registered, the page still says “sent” — that keeps the list of accounts private.'
                : 'The code arrives from trisindigo@agentmail.to and works for 24 hours, once. Check spam if it has not arrived. Codes are case-insensitive.'}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="rc-email">Email</Label>
                <Input
                  id="rc-email"
                  type="email"
                  autoComplete="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  className="bg-secondary/50 border-border"
                  disabled={busy || step === 'code'}
                />
              </div>

              {step === 'code' && (
                <>
                  <div className="space-y-2">
                    <Label htmlFor="rc-code">Recovery code</Label>
                    <Input
                      id="rc-code"
                      autoComplete="one-time-code"
                      required
                      value={code}
                      onChange={(e) => setCode(e.target.value)}
                      placeholder="XXXX-XXXX"
                      className="bg-secondary/50 border-border font-mono uppercase"
                      disabled={busy}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="rc-password">New password</Label>
                    <Input
                      id="rc-password"
                      type="password"
                      autoComplete="new-password"
                      required
                      minLength={10}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="At least 10 characters"
                      className="bg-secondary/50 border-border"
                      disabled={busy}
                    />
                  </div>
                </>
              )}

              {error && (
                <div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
                  <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                  <span>{error}</span>
                </div>
              )}

              <Button type="submit" disabled={busy} className="w-full gap-2">
                {busy && <Loader2 className="h-4 w-4 animate-spin" />}
                {step === 'email' ? 'Send me a code' : 'Set new password'}
              </Button>

              {step === 'code' && (
                <Button
                  type="button"
                  variant="ghost"
                  className="w-full text-muted-foreground"
                  disabled={busy}
                  onClick={() => {
                    setStep('email')
                    setError(null)
                  }}
                >
                  Code not arriving? Send another
                </Button>
              )}

              <Button
                type="button"
                variant="ghost"
                className="w-full text-muted-foreground"
                disabled={busy}
                onClick={() => onBack()}
              >
                Back to sign in
              </Button>
            </form>
          </CardContent>
        </Card>
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
              : `Hosted by Indigos (${model.provider}) — no key needed from you, and you can bring your own key in Settings any time to run on your own account.`}
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
