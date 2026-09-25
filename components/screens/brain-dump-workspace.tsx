'use client'

/**
 * Brain Dump workspace — rewired to the real pilot engine.
 *
 * What changed and why:
 *   - No longer imports `generateFromBrainDump` from `lib/mock-ai-service`.
 *     That function emitted hardcoded Etsy/Gumroad/Fiverr templates no matter
 *     what the model said, so the screen always looked like it worked.
 *   - No longer POSTs a `clientKey`. The route refuses that field with 400; the
 *     model key lives only in the server environment.
 *   - Calls /api/pilot/turn, which runs the same shared core the MCP tools and
 *     the Telegram handler use, and reads history back from /api/pilot/state so
 *     the result survives a page refresh from SQLite rather than localStorage.
 *   - A model outage renders the real error code and message, keeps the input on
 *     screen, and offers a Retry that reuses the same idempotency key so a
 *     retry cannot create a duplicate message or a duplicate next action.
 *
 * The layout, the two-column split, the focus-mode toggle and the card styling
 * are unchanged. Only the output panel now reflects the pilot result shape
 * (interpretation / one question / one next action / remembered facts) instead
 * of marketplace listings, which are out of scope for this pilot.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { useBrainDumpStore, usePilotStore, useUIStore, type TurnOutcome } from '@/lib/stores'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Textarea } from '@/components/ui/textarea'
import {
  AlertCircle,
  ArrowRight,
  Bookmark,
  Check,
  Compass,
  Copy,
  HelpCircle,
  Lightbulb,
  Loader2,
  Maximize2,
  MessageSquare,
  Minimize2,
  Plus,
  RotateCcw,
  Sparkles,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { ModelStatusCard } from './sign-in'

/** A turn that failed, plus the key needed to retry it without duplicating. */
interface PendingRetry {
  key: string
  conversationId: string | null
  projectId: string | null
  text: string
}

function newKey(): string {
  return `web-${crypto.randomUUID()}`
}

export function BrainDumpWorkspace() {
  const { currentInput, setCurrentInput, clearCurrentInput } = useBrainDumpStore()
  const { focusMode, toggleFocusMode } = useUIStore()

  const submitting = usePilotStore((s) => s.submitting)
  const submitTurn = usePilotStore((s) => s.submitTurn)
  const activeConversationId = usePilotStore((s) => s.activeConversationId)
  const messages = usePilotStore((s) => s.messages)
  const latestAction = usePilotStore((s) => s.latestAction)
  const facts = usePilotStore((s) => s.facts)
  const projects = usePilotStore((s) => s.projects)
  const conversations = usePilotStore((s) => s.conversations)
  const model = usePilotStore((s) => s.model)
  const recentModelRuns = usePilotStore((s) => s.recentModelRuns)

  const [outcome, setOutcome] = useState<TurnOutcome | null>(null)
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const [elapsed, setElapsed] = useState(0)
  /**
   * "New brain dump" cannot be expressed by re-reading /api/pilot/state: that
   * route always resolves an active conversation, so it hands back the one we
   * are trying to leave. This flag is the only way to send a turn with no
   * conversationId, which is what makes the engine create a fresh project.
   */
  const [composingNew, setComposingNew] = useState(false)
  /** Held in a ref, not state: a retry must reuse the exact key that failed. */
  const pendingRetryRef = useRef<PendingRetry | null>(null)

  const activeProject =
    projects.find((p) => p.id === conversations.find((c) => c.id === activeConversationId)?.projectId) ??
    null

  const continuing = !composingNew && Boolean(activeConversationId)
  /** The stored thread belongs to the previous conversation while starting anew. */
  const visibleMessages = composingNew ? [] : messages

  // Honest waiting indicator: real seconds against the real endpoint, not a
  // scripted percentage that implies progress the server never reported.
  useEffect(() => {
    if (!submitting) {
      setElapsed(0)
      return
    }
    const started = Date.now()
    const id = setInterval(() => setElapsed(Math.round((Date.now() - started) / 1000)), 250)
    return () => clearInterval(id)
  }, [submitting])

  const runTurn = useCallback(
    async (text: string, key: string, conversationId: string | null) => {
      const result = await submitTurn({ text, conversationId, idempotencyKey: key })

      // Any turn that reached the engine now has a conversation, including one
      // where the model then failed: the project and the user message are
      // already stored. Leave "new brain dump" mode at that point so a retry
      // continues that conversation instead of starting yet another project.
      const gotConversation =
        'conversationId' in result && typeof result.conversationId === 'string' && result.conversationId
      if (gotConversation) setComposingNew(false)

      if (result.ok) {
        pendingRetryRef.current = null
        setOutcome(result)
        // The draft became a stored message; the thread below shows it now.
        if (result.kind === 'model_turn' || result.kind === 'directive') clearCurrentInput()
        return result
      }

      if (result.kind === 'model_failure') {
        pendingRetryRef.current = {
          key,
          conversationId: result.conversationId,
          projectId: result.projectId,
          text,
        }
      } else {
        pendingRetryRef.current = null
      }
      setOutcome(result)
      return result
    },
    [submitTurn, clearCurrentInput]
  )

  const handleSubmit = useCallback(async () => {
    const text = currentInput.trim()
    if (!text || submitting) return
    await runTurn(text, newKey(), continuing ? activeConversationId : null)
  }, [currentInput, submitting, runTurn, continuing, activeConversationId])

  const handleRetry = useCallback(async () => {
    const pending = pendingRetryRef.current
    if (!pending || submitting) return
    // Same key, same conversation: the server replays or resumes, never
    // duplicates the user message or the next action.
    await runTurn(pending.text, pending.key, pending.conversationId)
  }, [submitting, runTurn])

  /** Directives are answered from stored state and never call the model. */
  const sendDirective = useCallback(
    async (text: string) => {
      if (submitting) return
      await runTurn(text, newKey(), continuing ? activeConversationId : null)
    },
    [submitting, runTurn, continuing, activeConversationId]
  )

  const startNewBrainDump = useCallback(() => {
    pendingRetryRef.current = null
    setOutcome(null)
    setComposingNew(true)
  }, [])

  const copyToClipboard = (text: string, id: string) => {
    navigator.clipboard.writeText(text)
    setCopiedId(id)
    setTimeout(() => setCopiedId(null), 2000)
  }

  const failure = outcome && !outcome.ok && outcome.kind === 'model_failure' ? outcome : null
  const rejected = outcome && !outcome.ok && outcome.kind === 'rejected' ? outcome : null
  const directive = outcome?.ok && outcome.kind === 'directive' ? outcome : null
  const turn = outcome?.ok && outcome.kind === 'model_turn' ? outcome : null

  // After a refresh there is no live `outcome`, but the stored thread is there.
  const lastAssistant = [...visibleMessages].reverse().find((m) => m.role === 'assistant') ?? null
  const restored = !outcome && !composingNew && Boolean(lastAssistant)

  return (
    <div className={cn('min-h-screen', focusMode ? 'p-4' : 'p-6 lg:p-8')}>
      <div className="mx-auto max-w-7xl">
        {/* Header */}
        <header className="mb-6 flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-foreground">Brain Dump</h1>
            <p className="text-muted-foreground">
              Say the messy version. Get one clear reading, at most one question, and one next
              action.
            </p>
            {continuing && activeProject && (
              <p className="mt-1 text-xs text-muted-foreground">
                Continuing <span className="text-foreground">{activeProject.title}</span>
              </p>
            )}
            {composingNew && (
              <p className="mt-1 text-xs text-primary">
                Starting a new brain dump — this creates a separate project.
              </p>
            )}
          </div>
          <div className="flex items-center gap-2">
            {activeConversationId && !composingNew && (
              <Button
                variant="outline"
                size="sm"
                onClick={startNewBrainDump}
                disabled={submitting}
                className="gap-2 border-border text-muted-foreground"
              >
                <Plus className="h-4 w-4" />
                New brain dump
              </Button>
            )}
            <Button
              variant="ghost"
              size="sm"
              onClick={toggleFocusMode}
              className="text-muted-foreground"
            >
              {focusMode ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
            </Button>
          </div>
        </header>

        {/* Main Split Layout */}
        <div className="grid gap-6 lg:grid-cols-2">
          {/* Left Panel - Input */}
          <Card className="bg-card border-border h-fit lg:sticky lg:top-6">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Sparkles className="h-5 w-5 text-primary" />
                Your Ideas
              </CardTitle>
              <CardDescription>
                {continuing
                  ? 'This conversation is open. Typing here continues it — the assistant still has the earlier context.'
                  : 'Type your thoughts, concepts, or rough ideas. Be messy — that\u2019s the point. This starts a new project.'}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <Textarea
                placeholder={
                  continuing
                    ? 'Add to the same brain dump, answer the question, or say what changed…'
                    : `I want to create a digital product about... \n\nOr: I've been thinking about selling templates for...\n\nOr: My audience struggles with...`
                }
                value={currentInput}
                onChange={(e) => setCurrentInput(e.target.value)}
                className="min-h-[300px] resize-none bg-secondary/50 border-border focus:border-primary"
                disabled={submitting}
              />

              <div className="flex items-center justify-between gap-3">
                <span className="text-xs text-muted-foreground">
                  {currentInput.length} characters
                </span>
                <Button onClick={handleSubmit} disabled={!currentInput.trim() || submitting} className="gap-2">
                  {submitting ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Thinking… {elapsed}s
                    </>
                  ) : (
                    <>
                      <Sparkles className="h-4 w-4" />
                      {continuing ? 'Send' : 'Transform Ideas'}
                    </>
                  )}
                </Button>
              </div>

              {/* Waiting indicator */}
              {submitting && (
                <div className="space-y-2">
                  <div className="h-2 w-full overflow-hidden rounded-full bg-secondary">
                    <div className="h-full w-full animate-pulse bg-primary/60" />
                  </div>
                  <p className="text-center text-xs text-muted-foreground">
                    {model?.configured
                      ? `Waiting on ${model.modelId}. A local model can take a while on the first call.`
                      : 'Contacting the model endpoint…'}
                  </p>
                </div>
              )}

              {/* Directives: resolved from stored state, no model call */}
              <div className="flex flex-wrap gap-2 border-t border-border pt-4">
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-2 border-border text-muted-foreground"
                  disabled={submitting || !continuing}
                  onClick={() => sendDirective('save this for later')}
                >
                  <Bookmark className="h-3.5 w-3.5" />
                  Save for later
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-2 border-border text-muted-foreground"
                  disabled={submitting}
                  onClick={() => sendDirective('where was I?')}
                >
                  <Compass className="h-3.5 w-3.5" />
                  Where was I?
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-2 border-border text-muted-foreground"
                  disabled={submitting}
                  onClick={() => sendDirective('/help')}
                >
                  <HelpCircle className="h-3.5 w-3.5" />
                  Help
                </Button>
              </div>

              <ModelStatusCard compact />
            </CardContent>
          </Card>

          {/* Right Panel - Outputs */}
          <div className="space-y-4">
            {failure && (
              <Card className="bg-card border-destructive/40">
                <CardHeader className="pb-3">
                  <CardTitle className="flex items-center gap-2 text-lg text-destructive">
                    <AlertCircle className="h-5 w-5" />
                    No result — the model could not answer
                  </CardTitle>
                  <CardDescription className="font-mono text-xs">{failure.code}</CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  <p className="text-sm text-foreground">{failure.error}</p>
                  <div className="rounded-md bg-secondary/50 p-3 text-xs text-muted-foreground">
                    Your brain dump was saved before the call failed and is still in the thread
                    below. Nothing was invented to fill the gap.
                    {failure.retryable ? ' This is retryable.' : ' This is not retryable as-is.'}
                  </div>
                  {failure.retryable && (
                    <Button onClick={handleRetry} disabled={submitting} className="gap-2">
                      {submitting ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <RotateCcw className="h-4 w-4" />
                      )}
                      Retry the same request
                    </Button>
                  )}
                </CardContent>
              </Card>
            )}

            {rejected && (
              <Card className="bg-card border-destructive/40">
                <CardContent className="flex items-start gap-2 py-4 text-sm text-destructive">
                  <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                  <span>{rejected.error}</span>
                </CardContent>
              </Card>
            )}

            {turn && (
              <>
                <Card className="bg-card border-border">
                  <CardHeader className="pb-3">
                    <CardTitle className="flex items-center gap-2 text-lg">
                      <Lightbulb className="h-5 w-5 text-primary" />
                      What I understood
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <p className="whitespace-pre-line text-sm text-foreground">
                      {turn.turn.interpretation}
                    </p>
                    <div className="flex flex-wrap items-center gap-2 border-t border-border pt-3 text-xs text-muted-foreground">
                      <Badge variant="outline" className="border-border font-mono">
                        {turn.model}
                      </Badge>
                      <span>{turn.latencyMs} ms</span>
                      {turn.deduplicated && (
                        <Badge variant="outline" className="border-chart-3/40 text-chart-3">
                          replayed — not generated twice
                        </Badge>
                      )}
                    </div>
                  </CardContent>
                </Card>

                {turn.turn.question && (
                  <Card className="bg-card border-border">
                    <CardHeader className="pb-3">
                      <CardTitle className="flex items-center gap-2 text-lg">
                        <MessageSquare className="h-5 w-5 text-chart-4" />
                        One thing worth clarifying
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <p className="text-sm text-foreground">{turn.turn.question}</p>
                      <p className="mt-2 text-xs text-muted-foreground">
                        Answer in the box on the left — it continues this same conversation.
                      </p>
                    </CardContent>
                  </Card>
                )}

                {turn.nextAction && <NextActionCard action={turn.nextAction} />}

                {turn.turn.observedFacts.length > 0 && (
                  <FactsCard facts={turn.turn.observedFacts} onCopy={copyToClipboard} copiedId={copiedId} />
                )}
              </>
            )}

            {directive && (
              <Card className="bg-card border-border">
                <CardHeader className="pb-3">
                  <CardTitle className="flex items-center gap-2 text-lg">
                    <Compass className="h-5 w-5 text-accent" />
                    {directive.directive ? directive.directive.replace(/_/g, ' ') : 'Response'}
                  </CardTitle>
                  <CardDescription>Answered from your stored state — no model call.</CardDescription>
                </CardHeader>
                <CardContent>
                  <p className="whitespace-pre-line text-sm text-foreground">{directive.text}</p>
                </CardContent>
              </Card>
            )}

            {restored && (
              <Card className="bg-card border-border">
                <CardHeader className="pb-3">
                  <CardTitle className="flex items-center gap-2 text-lg">
                    <ArrowRight className="h-5 w-5 text-primary" />
                    Last result
                  </CardTitle>
                  <CardDescription>
                    Restored from the server after a refresh — not from browser storage.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  <p className="whitespace-pre-line text-sm text-foreground">
                    {lastAssistant!.content}
                  </p>
                  <div className="flex items-center justify-between border-t border-border pt-3">
                    <span className="text-xs text-muted-foreground">
                      {new Date(lastAssistant!.createdAt).toLocaleString()} · source:{' '}
                      {lastAssistant!.source}
                    </span>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => copyToClipboard(lastAssistant!.content, 'restored')}
                    >
                      {copiedId === 'restored' ? (
                        <Check className="h-4 w-4 text-chart-3" />
                      ) : (
                        <Copy className="h-4 w-4" />
                      )}
                    </Button>
                  </div>
                </CardContent>
              </Card>
            )}

            {restored && latestAction && <NextActionCard action={latestAction} />}

            {/* Thread */}
            {visibleMessages.length > 0 && (
              <Card className="bg-card border-border">
                <CardHeader className="pb-3">
                  <CardTitle className="flex items-center gap-2 text-lg">
                    <MessageSquare className="h-5 w-5 text-muted-foreground" />
                    Conversation
                    <span className="text-sm font-normal text-muted-foreground">
                      ({visibleMessages.length})
                    </span>
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  {visibleMessages.map((m) => (
                    <div
                      key={m.id}
                      className={cn(
                        'rounded-lg p-3 text-sm',
                        m.role === 'user'
                          ? 'bg-primary/10 text-foreground'
                          : 'bg-secondary/50 text-foreground'
                      )}
                    >
                      <div className="mb-1 flex items-center justify-between text-[11px] text-muted-foreground">
                        <span className="uppercase tracking-wide">
                          {m.role === 'user' ? 'You' : 'Assistant'}
                          {m.source && m.source !== 'core' ? ` · ${m.source}` : ''}
                        </span>
                        <span>{new Date(m.createdAt).toLocaleTimeString()}</span>
                      </div>
                      <p className="whitespace-pre-line">{m.content}</p>
                    </div>
                  ))}
                </CardContent>
              </Card>
            )}

            {facts.length > 0 && !turn && (
              <FactsCard
                facts={facts.map((f) => f.content)}
                onCopy={copyToClipboard}
                copiedId={copiedId}
              />
            )}

            {!outcome && !restored && visibleMessages.length === 0 && (
              <Card className="bg-gradient-to-br from-primary/5 to-accent/5 border-primary/20">
                <CardContent className="flex flex-col items-center justify-center py-16 text-center">
                  <div className="flex h-16 w-16 items-center justify-center rounded-full bg-primary/10 mb-4">
                    <Sparkles className="h-8 w-8 text-primary" />
                  </div>
                  <h3 className="text-lg font-medium text-foreground">Ready to transform</h3>
                  <p className="text-muted-foreground mt-2 max-w-sm">
                    Enter your messy thoughts on the left. You get one clear reading, at most one
                    question, and one next action — saved to your account, not just this tab.
                  </p>
                  {model && !model.configured && (
                    <p className="mt-4 max-w-sm text-xs text-destructive">
                      The model is not configured yet, so this will return an honest error rather
                      than placeholder advice. Fix the server environment first.
                    </p>
                  )}
                </CardContent>
              </Card>
            )}

            {recentModelRuns.length > 0 && (
              <details className="rounded-lg border border-border bg-card p-3 text-xs text-muted-foreground">
                <summary className="cursor-pointer select-none">
                  Recent model calls ({recentModelRuns.length})
                </summary>
                <div className="mt-2 space-y-1">
                  {recentModelRuns.map((r) => (
                    <div key={r.id} className="flex items-center justify-between gap-2 font-mono">
                      <span className={r.status === 'succeeded' ? 'text-chart-3' : 'text-destructive'}>
                        {r.status}
                      </span>
                      <span className="truncate">{r.model ?? '—'}</span>
                      <span>{r.latencyMs != null ? `${r.latencyMs}ms` : '—'}</span>
                      <span className="truncate">{r.errorCode ?? ''}</span>
                    </div>
                  ))}
                </div>
              </details>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

function NextActionCard({
  action,
}: {
  action: { title: string; detail?: string | null; status?: string }
}) {
  return (
    <Card className="bg-card border-chart-3/30">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-lg">
          <ArrowRight className="h-5 w-5 text-chart-3" />
          Your one next action
        </CardTitle>
        <CardDescription>Just the next step. Not a list.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        <p className="text-sm font-medium text-foreground">{action.title}</p>
        {action.detail && <p className="text-sm text-muted-foreground">{action.detail}</p>}
        {action.status && (
          <Badge variant="outline" className="border-border font-mono text-[11px]">
            {action.status}
          </Badge>
        )}
      </CardContent>
    </Card>
  )
}

function FactsCard({
  facts,
  onCopy,
  copiedId,
}: {
  facts: string[]
  onCopy: (text: string, id: string) => void
  copiedId: string | null
}) {
  return (
    <Card className="bg-card border-border">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-lg">
          <Bookmark className="h-5 w-5 text-accent" />
          Remembered from this
        </CardTitle>
        <CardDescription>
          Stored on the server with a source and a timestamp, not in this browser. Editing
          or deleting an individual fact from the UI is not wired up yet.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ul className="space-y-1.5">
          {facts.map((fact, i) => (
            <li
              key={i}
              className="flex items-start justify-between gap-2 rounded-md bg-secondary/50 px-3 py-2 text-sm text-muted-foreground"
            >
              <span>{fact}</span>
              <Button
                variant="ghost"
                size="sm"
                className="shrink-0"
                onClick={() => onCopy(fact, `fact-${i}`)}
              >
                {copiedId === `fact-${i}` ? (
                  <Check className="h-3.5 w-3.5 text-chart-3" />
                ) : (
                  <Copy className="h-3.5 w-3.5" />
                )}
              </Button>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  )
}
