'use client'

/**
 * Spark — the one-time strengths assessment, ported from the nd-cognitive-os engine.
 *
 * Forty taps, one question at a time, then a strengths-first profile that never
 * calls a low dimension a deficit (the original's translation layer verbatim).
 * Scoring and translation are rule-based and run server-side for free — no AI
 * judges these answers, the person's own responses do.
 *
 * Why it exists here and not as a second app: the profile feeds the same engine
 * the Mind map and brain-dump replies read. Knowing you are "The Burning Spark —
 * strongest in Cognitive Intensity" changes the guidance you get, not just the
 * badge you see.
 */

import { useState } from 'react'
import { usePilotStore, useUIStore } from '@/lib/stores'
import { SPARK_DIMENSION_NAMES, SPARK_QUESTIONS } from '@/lib/pilot/cognitive/spark.ts'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Flame, ArrowLeft, ArrowRight, Check, Loader2 } from 'lucide-react'

const LIKERT = [0, 1, 2, 3, 4]

export function SparkScreen() {
  const spark = usePilotStore((s) => s.spark)
  const [retaking, setRetaking] = useState(false)

  if (spark && !retaking) return <ProfileView onRetake={() => setRetaking(true)} />
  return <Assessment onDone={() => setRetaking(false)} />
}

/* ------------------------------------------------------------------ assessment */

function Assessment({ onDone }: { onDone: () => void }) {
  const submitSpark = usePilotStore((s) => s.submitSpark)
  const [responses, setResponses] = useState<(number | null)[]>(() => Array(SPARK_QUESTIONS.length).fill(null))
  const [idx, setIdx] = useState(0)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const answered = responses.filter((r) => r !== null).length
  const q = SPARK_QUESTIONS[idx]
  const isLast = idx === SPARK_QUESTIONS.length - 1

  const pick = async (value: number) => {
    const next = [...responses]
    next[idx] = value
    setResponses(next)
    setError(null)

    if (!isLast) {
      setIdx(idx + 1)
      return
    }
    // Answered the last question: submit straight away — one fewer tap to sit on.
    setSaving(true)
    const result = await submitSpark(next as number[])
    setSaving(false)
    if (result.ok) onDone()
    else setError(result.error ?? 'Could not save your answers.')
  }

  const progress = Math.round((answered / SPARK_QUESTIONS.length) * 100)

  return (
    <div className="min-h-screen p-6 lg:p-8">
      <div className="mx-auto max-w-2xl space-y-6">
        <header className="space-y-2">
          <h1 className="flex items-center gap-2 text-3xl font-bold tracking-tight text-foreground">
            <Flame className="h-7 w-7 text-primary" />
            Know your spark
          </h1>
          <p className="text-muted-foreground">
            Forty taps, once. There are no wrong answers and no score to chase &mdash; this only
            names what is <em>strong</em> in how you think, feel and sense, and the pilot starts
            reading you through it.
          </p>
        </header>

        <div>
          <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-primary transition-all duration-300"
              style={{ width: `${progress}%` }}
            />
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            Question {idx + 1} of {SPARK_QUESTIONS.length} &middot; {answered} answered
          </p>
        </div>

        <Card className="border-primary/20">
          <CardHeader>
            <CardDescription>
              {SPARK_DIMENSION_NAMES[q.dim]} &middot; question {idx + 1}
            </CardDescription>
            <CardTitle className="text-lg leading-snug text-foreground">{q.text}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-5 gap-2">
              {LIKERT.map((value) => {
                const active = responses[idx] === value
                return (
                  <button
                    key={value}
                    type="button"
                    onClick={() => !saving && void pick(value)}
                    aria-pressed={active}
                    disabled={saving}
                    className={
                      'cursor-pointer rounded-lg py-3 text-sm font-medium transition-colors disabled:cursor-wait ' +
                      (active
                        ? 'bg-primary text-primary-foreground ring-1 ring-primary/40'
                        : 'bg-muted text-muted-foreground hover:bg-muted/70 hover:text-foreground')
                    }
                  >
                    {value}
                  </button>
                )
              })}
            </div>
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>Strongly disagree</span>
              <span>Strongly agree</span>
            </div>
            {saving && (
              <p className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                Scoring your profile&hellip;
              </p>
            )}
            {error && <p className="text-sm text-destructive">{error}</p>}
          </CardContent>
        </Card>

        <div className="flex items-center justify-between">
          <Button variant="ghost" size="sm" onClick={() => setIdx(Math.max(0, idx - 1))} disabled={idx === 0}>
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back
          </Button>
          {!isLast && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setIdx(Math.min(SPARK_QUESTIONS.length - 1, idx + 1))}
              disabled={responses[idx] === null}
            >
              Skip ahead
              <ArrowRight className="ml-2 h-4 w-4" />
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}

/* --------------------------------------------------------------------- profile */

function ProfileView({ onRetake }: { onRetake: () => void }) {
  const spark = usePilotStore((s) => s.spark)
  const { setActiveTab } = useUIStore()
  if (!spark) return null

  const quiet = spark.dimensions.filter((d) => d.band === 'quiet')

  return (
    <div className="min-h-screen p-6 lg:p-8">
      <div className="mx-auto max-w-2xl space-y-6">
        <header className="space-y-2">
          <h1 className="flex items-center gap-2 text-3xl font-bold tracking-tight text-foreground">
            <Flame className="h-7 w-7 text-primary" />
            {spark.profileType}
          </h1>
          <p className="text-muted-foreground">
            Your spark runs at {spark.sparkIndex} of 20. This is a reading of your intensity, not
            a diagnosis &mdash; and brain dumps from now on are framed through what is strong here.
          </p>
        </header>

        {spark.active.length === 0 ? (
          <Card>
            <CardContent className="py-8 text-center text-sm text-muted-foreground">
              Your dimensions all sit quiet right now &mdash; which is its own kind of profile: low
              noise, room to start. Take the assessment again on a louder week if you like.
            </CardContent>
          </Card>
        ) : (
          spark.active.map((d) => (
            <Card key={d.key} className="border-border bg-card">
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-base">
                  <Check className="h-4 w-4 shrink-0 text-primary" />
                  {d.name}
                  <span className="text-xs font-normal text-muted-foreground">
                    {d.score.toFixed(1)} / 4
                  </span>
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                <p className="text-sm font-medium text-foreground">{d.strength}</p>
                <p className="text-sm text-muted-foreground">{d.guidance}</p>
              </CardContent>
            </Card>
          ))
        )}

        {quiet.length > 0 && (
          <p className="px-1 text-xs text-muted-foreground">
            {quiet.map((d) => d.name).join(', ')} sit quieter in your profile. Nothing to fix there
            &mdash; the map just works from what is loud.
          </p>
        )}

        <div className="flex flex-wrap gap-3">
          <Button onClick={() => setActiveTab('mind')}>
            <ArrowRight className="mr-2 h-4 w-4" />
            Back to your Mind
          </Button>
          <Button variant="ghost" size="sm" onClick={onRetake}>
            Retake
          </Button>
        </div>
      </div>
    </div>
  )
}
