'use client'

/**
 * Dashboard, rewired to the pilot's real state.
 *
 * It used to count entries in `useAIGenerationStore`, a browser-local list of
 * Etsy/Gumroad/Fiverr templates that nothing writes to any more, so a user with
 * real projects on the server was told they had zero brain dumps. Everything
 * here now comes from /api/pilot/state via `usePilotStore`: projects,
 * conversations, open next actions, remembered facts and the recorded model
 * calls — the same calls Social Studio and Marketplace make when they write
 * drafts.
 */

import { usePilotStore, useUIStore } from '@/lib/stores'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Activity,
  AlertCircle,
  ArrowRight,
  Brain,
  CheckCircle2,
  Clock,
  FolderOpen,
  MessagesSquare,
  Settings,
  Share2,
  ShoppingBag,
  Target,
  User,
} from 'lucide-react'

/** Last time anything happened in any conversation, or null for a fresh account. */
function lastActivityAt(conversations: { updatedAt: string; lastMessageAt: string | null }[]) {
  let latest: string | null = null
  for (const c of conversations) {
    const stamp = c.lastMessageAt ?? c.updatedAt
    if (!latest || stamp > latest) latest = stamp
  }
  return latest
}

export function Dashboard() {
  const { setActiveTab } = useUIStore()

  const user = usePilotStore((s) => s.user)
  const model = usePilotStore((s) => s.model)
  const projects = usePilotStore((s) => s.projects)
  const conversations = usePilotStore((s) => s.conversations)
  const latestAction = usePilotStore((s) => s.latestAction)
  const openActions = usePilotStore((s) => s.openActions)
  const facts = usePilotStore((s) => s.facts)
  const recentModelRuns = usePilotStore((s) => s.recentModelRuns)

  const started = projects.length > 0
  const lastActivity = lastActivityAt(conversations)
  const succeededRuns = recentModelRuns.filter((r) => r.status === 'succeeded')

  return (
    <div className="min-h-screen p-6 lg:p-8">
      <div className="mx-auto max-w-6xl space-y-8">
        <header className="space-y-2">
          <h1 className="text-3xl font-bold tracking-tight text-foreground">
            {started ? 'Welcome back' : 'Welcome to your private pilot'}
          </h1>
          <p className="text-muted-foreground">
            {started
              ? `${projects.length} project${projects.length === 1 ? '' : 's'} stored on the server${
                  lastActivity ? ` · last activity ${new Date(lastActivity).toLocaleString()}` : ''
                }`
              : 'Nothing is stored yet. Your first brain dump creates a project and a conversation that survive a refresh.'}
          </p>
        </header>

        {/* Counts, all read back from SQLite through /api/pilot/state. */}
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard icon={FolderOpen} label="Projects" value={projects.length} />
          <StatCard icon={MessagesSquare} label="Conversations" value={conversations.length} />
          <StatCard icon={Target} label="Open next actions" value={openActions.length} />
          <StatCard icon={CheckCircle2} label="Facts remembered" value={facts.length} />
        </div>

        <div className="grid gap-6 lg:grid-cols-2">
          {/* The one next action, exactly as the model proposed it. */}
          <Card className="border-primary/20 bg-gradient-to-br from-primary/5 to-accent/5">
            <CardHeader>
              <div className="flex items-center gap-2">
                <Target className="h-5 w-5 text-primary" />
                <CardTitle>Your one next action</CardTitle>
              </div>
              <CardDescription>
                The last step the model proposed. One step, never a list.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {latestAction ? (
                <div className="rounded-lg bg-card/50 p-4">
                  <p className="font-medium text-foreground">{latestAction.title}</p>
                  {latestAction.detail && (
                    <p className="mt-1 text-sm text-muted-foreground">{latestAction.detail}</p>
                  )}
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <Badge variant="secondary">{latestAction.status}</Badge>
                    <span className="text-xs text-muted-foreground">
                      proposed {new Date(latestAction.createdAt).toLocaleString()}
                    </span>
                  </div>
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center py-8 text-center">
                  <Brain className="mb-4 h-12 w-12 text-muted-foreground/50" />
                  <p className="text-muted-foreground">
                    No next action yet. Say what is on your mind and you will get one.
                  </p>
                </div>
              )}
              <Button onClick={() => setActiveTab('brain-dump')} className="w-full">
                <Brain className="mr-2 h-4 w-4" />
                {started ? 'Continue your brain dump' : 'Start your first brain dump'}
                <ArrowRight className="ml-1 h-4 w-4" />
              </Button>
            </CardContent>
          </Card>

          {/* Proof of what actually ran: recorded calls, not a scripted animation. */}
          <Card className="border-border bg-card">
            <CardHeader>
              <div className="flex items-center gap-2">
                <Activity className="h-5 w-5 text-chart-3" />
                <CardTitle>Recent model calls</CardTitle>
              </div>
              <CardDescription>
                {model?.configured
                  ? `${model.modelId} at ${model.baseUrl}${model.local ? ' · local, nothing leaves this machine' : ''}`
                  : 'No model configured — nothing has been generated'}
              </CardDescription>
            </CardHeader>
            <CardContent>
              {recentModelRuns.length > 0 ? (
                <div className="space-y-2">
                  {recentModelRuns.slice(0, 5).map((run) => (
                    <div
                      key={run.id}
                      className="flex items-center gap-3 rounded-lg bg-secondary/50 p-3 text-sm"
                    >
                      {run.status === 'succeeded' ? (
                        <CheckCircle2 className="h-4 w-4 shrink-0 text-chart-3" />
                      ) : (
                        <AlertCircle className="h-4 w-4 shrink-0 text-destructive" />
                      )}
                      <span className="min-w-0 flex-1 truncate text-foreground">
                        {run.model ?? 'unknown model'}
                      </span>
                      <span className="shrink-0 text-xs text-muted-foreground">
                        {run.status}
                        {run.latencyMs != null ? ` · ${run.latencyMs} ms` : ''}
                      </span>
                      <span className="hidden shrink-0 text-xs text-muted-foreground sm:inline">
                        {new Date(run.createdAt).toLocaleTimeString()}
                      </span>
                    </div>
                  ))}
                  <p className="pt-1 text-xs text-muted-foreground">
                    {succeededRuns.length} of the last {recentModelRuns.length} calls succeeded. A
                    failure keeps your input and can be retried; nothing is filled in with sample
                    text.
                  </p>
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center py-12 text-center">
                  <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-secondary">
                    <Clock className="h-8 w-8 text-muted-foreground/50" />
                  </div>
                  <p className="font-medium text-foreground">No calls recorded yet</p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Directives such as “where was I?” are answered from stored state and never
                    reach the model.
                  </p>
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        <Card className="border-border bg-card">
          <CardHeader>
            <CardTitle>Quick actions</CardTitle>
            <CardDescription>Only the paths that are wired to your pilot data.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid gap-3 sm:grid-cols-3">
              <Button
                variant="outline"
                className="h-auto flex-col gap-2 p-4"
                onClick={() => setActiveTab('brain-dump')}
              >
                <Brain className="h-6 w-6 text-primary" />
                <span>Brain Dump</span>
              </Button>
              <Button
                variant="outline"
                className="h-auto flex-col gap-2 p-4"
                onClick={() => setActiveTab('social')}
              >
                <Share2 className="h-6 w-6 text-chart-3" />
                <span>Social drafts</span>
              </Button>
              <Button
                variant="outline"
                className="h-auto flex-col gap-2 p-4"
                onClick={() => setActiveTab('marketplace')}
              >
                <ShoppingBag className="h-6 w-6 text-chart-5" />
                <span>Offer drafts</span>
              </Button>
              <Button
                variant="outline"
                className="h-auto flex-col gap-2 p-4"
                onClick={() => setActiveTab('memory')}
              >
                <User className="h-6 w-6 text-chart-4" />
                <span>Creator profile</span>
              </Button>
              <Button
                variant="outline"
                className="h-auto flex-col gap-2 p-4"
                onClick={() => setActiveTab('settings')}
              >
                <Settings className="h-6 w-6 text-accent" />
                <span>Model &amp; account</span>
              </Button>
            </div>
            <p className="mt-3 text-xs text-muted-foreground">
              Social Studio and Marketplace write real drafts from your stored project context and
              save them to your account. Nothing is posted, listed or sold from this pilot, and
              Etsy listings and inventory stay out of scope.
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

function StatCard({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof FolderOpen
  label: string
  value: number
}) {
  return (
    <Card className="border-border bg-card">
      <CardContent className="flex items-center gap-4 p-6">
        <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-primary/10">
          <Icon className="h-6 w-6 text-primary" />
        </div>
        <div>
          <p className="text-2xl font-bold text-foreground">{value}</p>
          <p className="text-sm text-muted-foreground">{label}</p>
        </div>
      </CardContent>
    </Card>
  )
}
