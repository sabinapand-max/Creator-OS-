'use client'

/**
 * Mind — the visible map of the ND cognitive engine.
 *
 * This is the artifact that makes the pilot a cognitive OS and not just a content
 * tool: a calm, strengths-first read of how you have been running. Everything here
 * is derived from the signals already living in your brain dumps — the state machine
 * and pattern engine (rule-based, no AI, no network) — so there are no extra
 * questions to answer and no score to chase.
 *
 * Meaning before productivity (VISION_DIRECTIVES.md): a state is named as information,
 * never as a deficit. The tone is permission, not evaluation.
 */

import { usePilotStore, useUIStore } from '@/lib/stores'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Compass, Brain, HeartHandshake, ArrowRight } from 'lucide-react'
import type {
  CognitiveEnergy,
  CognitiveSensory,
  CognitiveStateName,
} from '@/lib/pilot/types.ts'

/** Human names for each state, matching the engine's own labels where it has them. */
const STATE_LABEL: Record<CognitiveStateName, string> = {
  flow: 'In flow',
  focused: 'Focused',
  scattered: 'Scattered',
  overwhelmed: 'Overwhelmed',
  recovering: 'Recovering',
  dormant: 'Quiet',
  hyperfocus: 'Hyperfocused',
  dissociated: 'Checked out',
}

const ENERGY_ORDER: CognitiveEnergy[] = ['high', 'medium', 'low', 'depleted']
const SENSORY_ORDER: CognitiveSensory[] = ['calm', 'moderate', 'elevated', 'overload']

export function MindMap() {
  const { setActiveTab } = useUIStore()
  const map = usePilotStore((s) => s.cognitiveMap)
  const checkIn = usePilotStore((s) => s.checkIn)

  return (
    <div className="min-h-screen p-6 lg:p-8">
      <div className="mx-auto max-w-3xl space-y-6">
        <header className="space-y-2">
          <h1 className="text-3xl font-bold tracking-tight text-foreground">Your Mind</h1>
          <p className="text-muted-foreground">
            A gentle map of how you&rsquo;ve been running. This is information, not a scoreboard
            &mdash; nothing here is good or bad, and you never have to do anything with it.
          </p>
        </header>

        {!map ? (
          <EmptyState onStart={() => setActiveTab('brain-dump')} />
        ) : (
          <>
            <TodayCard
              label={map.label}
              capacityNote={map.capacityNote}
              microStep={map.microStep}
              onStart={() => setActiveTab('brain-dump')}
            />

            <p className="px-1 text-xs text-muted-foreground">
              Tap where you actually are today &mdash; the map updates as you check in.
            </p>
            <div className="grid gap-4 sm:grid-cols-2">
              <Gauge
                title="Energy"
                value={map.energy}
                levels={ENERGY_ORDER}
                onSelect={(v) => checkIn({ energy: v })}
              />
              <Gauge
                title="Sensory load"
                value={map.sensory}
                levels={SENSORY_ORDER}
                onSelect={(v) => checkIn({ sensory: v })}
              />
            </div>

            {map.patternNote && <PatternNote note={map.patternNote} burnoutRisk={map.burnoutRisk} />}

            <Movements history={map.history} />
          </>
        )}
      </div>
    </div>
  )
}

/** What a brand-new (or never-brain-dumped) person sees: the open door, not an analysis. */
function EmptyState({ onStart }: { onStart: () => void }) {
  return (
    <Card className="border-border bg-card">
      <CardContent className="flex flex-col items-center justify-center py-14 text-center">
        <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-primary/10">
          <Compass className="h-8 w-8 text-primary/70" />
        </div>
        <p className="font-medium text-foreground">Your map begins with your first brain dump.</p>
        <p className="mt-1 max-w-md text-sm text-muted-foreground">
          There&rsquo;s nothing to fill in and no quiz to take. The map reads the feeling already
          in your words &mdash; the day you write something down, it starts drawing itself.
        </p>
        <Button onClick={onStart} className="mt-5">
          <Brain className="mr-2 h-4 w-4" />
          Start a brain dump
          <ArrowRight className="ml-1 h-4 w-4" />
        </Button>
      </CardContent>
    </Card>
  )
}

function TodayCard({
  label,
  capacityNote,
  microStep,
  onStart,
}: {
  label: string
  capacityNote: string
  microStep: string
  onStart: () => void
}) {
  return (
    <Card className="border-primary/20 bg-primary/5">
      <CardHeader>
        <CardTitle className="text-xl">{label} today</CardTitle>
        <CardDescription>{capacityNote}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-foreground">
          <span className="font-medium">Sized for today:</span> {microStep}
        </p>
        <Button onClick={onStart} size="sm">
          <Brain className="mr-2 h-4 w-4" />
          Start here
          <ArrowRight className="ml-1 h-4 w-4" />
        </Button>
      </CardContent>
    </Card>
  )
}

/** A single, non-judgemental indicator you can tap. The active level is highlighted; none is "wrong". */
function Gauge<T extends string>({
  title,
  value,
  levels,
  onSelect,
}: {
  title: string
  value: T
  levels: T[]
  onSelect: (value: T) => void
}) {
  return (
    <Card className="border-border bg-card">
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-medium text-muted-foreground">{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="flex flex-wrap gap-2">
          {levels.map((level) => {
            const active = level === value
            return (
              <button
                key={level}
                type="button"
                onClick={() => onSelect(level)}
                aria-pressed={active}
                className={
                  'cursor-pointer rounded-full px-3 py-1 text-sm capitalize transition-colors ' +
                  (active
                    ? 'bg-primary/15 font-medium text-foreground ring-1 ring-primary/30'
                    : 'text-muted-foreground/70 hover:bg-muted hover:text-foreground')
                }
              >
                {level}
              </button>
            )
          })}
        </div>
      </CardContent>
    </Card>
  )
}

/** One gentle, strengths-first observation. Softened further when burnout risk is elevated. */
function PatternNote({ note, burnoutRisk }: { note: string; burnoutRisk: 'low' | 'medium' | 'high' }) {
  return (
    <Card className="border-chart-4/30 bg-chart-4/5">
      <CardContent className="flex items-start gap-3 p-5">
        <HeartHandshake className="mt-0.5 h-5 w-5 shrink-0 text-chart-4" />
        <div className="space-y-1">
          <p className="text-sm font-medium text-foreground">
            {burnoutRisk === 'low' ? 'A pattern worth noticing' : 'A note on your recent rhythm'}
          </p>
          <p className="text-sm text-muted-foreground">{note}</p>
        </div>
      </CardContent>
    </Card>
  )
}

/** The transitions that made today, most recent last. Capped so it stays a map, not a log. */
function Movements({ history }: { history: { to: CognitiveStateName; timestamp: string }[] }) {
  const recent = history.slice(-10)
  if (recent.length <= 1) {
    return (
      <p className="px-1 text-xs text-muted-foreground">
        The map fills in as your state shifts over more brain dumps. One movement so far &mdash;
        that&rsquo;s enough to start.
      </p>
    )
  }
  return (
    <Card className="border-border bg-card">
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-medium text-muted-foreground">Recent movements</CardTitle>
      </CardHeader>
      <CardContent>
        <ol className="space-y-2">
          {recent.map((entry, i) => (
            <li key={`${entry.timestamp}-${i}`} className="flex items-center gap-3 text-sm">
              <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-primary/50" />
              <span className="flex-1 text-foreground">{STATE_LABEL[entry.to] ?? entry.to}</span>
              <span className="shrink-0 text-xs text-muted-foreground">
                {new Date(entry.timestamp).toLocaleDateString(undefined, {
                  month: 'short',
                  day: 'numeric',
                })}
              </span>
            </li>
          ))}
        </ol>
      </CardContent>
    </Card>
  )
}
