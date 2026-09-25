'use client'

/**
 * Social Studio, wired to real generations.
 *
 * What changed: this screen used to read `useAIGenerationStore`, a browser-local
 * list that nothing wrote to any more, so it could only ever show an empty state.
 * It now calls /api/pilot/drafts, which runs one real model call against the
 * signed-in user's stored project context and saves the result server-side.
 *
 * Two deliberate omissions:
 *  - No scheduling and no Buffer. Publishing is gated off during the pilot, so a
 *    "Schedule" button here would either lie or fail. Drafts are copied out by
 *    hand, and the banner says so.
 *  - No Etsy. It is out of scope for this pilot and is not a channel at all.
 *
 * LinkedIn is included and selected by default: the brief asks for LinkedIn among
 * the visibility outputs.
 */
import { useEffect, useMemo, useState } from 'react'
import { useDraftsStore, usePilotStore, useUIStore } from '@/lib/stores'
import { SOCIAL_CHANNELS, type DraftChannel, type ContentDraft } from '@/lib/pilot/types.ts'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Textarea } from '@/components/ui/textarea'
import {
  AlertCircle,
  Check,
  Copy,
  Filter,
  Hash,
  Instagram,
  Linkedin,
  Loader2,
  Pin,
  Share2,
  Sparkles,
  Trash2,
  Twitter,
  Video,
  Zap,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { ModelStatusCard } from './sign-in'

/** LinkedIn first: the brief asks for it among the visibility outputs. */
const DEFAULT_CHANNELS: DraftChannel[] = ['linkedin', 'instagram', 'twitter']
/** Server-side cap, mirrored here so the button cannot ask for more. */
const MAX_CHANNELS = 4

const channelIcons: Record<DraftChannel, React.ElementType> = {
  linkedin: Linkedin,
  instagram: Instagram,
  twitter: Twitter,
  tiktok: Video,
  pinterest: Pin,
  gumroad: Share2,
  fiverr: Share2,
}

const channelColors: Record<DraftChannel, string> = {
  linkedin: 'bg-blue-500/20 text-blue-400',
  instagram: 'bg-gradient-to-br from-purple-500/20 to-pink-500/20 text-pink-400',
  twitter: 'bg-sky-500/20 text-sky-400',
  tiktok: 'bg-gradient-to-br from-cyan-500/20 to-pink-500/20 text-cyan-400',
  pinterest: 'bg-red-500/20 text-red-400',
  gumroad: 'bg-chart-3/20 text-chart-3',
  fiverr: 'bg-chart-5/20 text-chart-5',
}

/** The text a user copies out: body, then hashtags when there are any. */
function draftAsText(draft: ContentDraft): string {
  const tags = draft.payload.hashtags ?? []
  if (tags.length === 0) return draft.body
  return `${draft.body}\n\n${tags.map((t) => `#${t.replace(/^#/, '')}`).join(' ')}`
}

export function SocialContentStudio() {
  const drafts = useDraftsStore((s) => s.drafts)
  const generating = useDraftsStore((s) => s.generating)
  const loading = useDraftsStore((s) => s.loading)
  const hydrated = useDraftsStore((s) => s.hydrated)
  const error = useDraftsStore((s) => s.error)
  const lastGeneration = useDraftsStore((s) => s.lastGeneration)
  const load = useDraftsStore((s) => s.load)
  const generate = useDraftsStore((s) => s.generate)
  const remove = useDraftsStore((s) => s.remove)

  const projects = usePilotStore((s) => s.projects)
  const model = usePilotStore((s) => s.model)
  const { setActiveTab } = useUIStore()

  const [selected, setSelected] = useState<DraftChannel[]>(DEFAULT_CHANNELS)
  const [projectId, setProjectId] = useState<string>('')
  const [brief, setBrief] = useState('')
  const [filter, setFilter] = useState<'all' | DraftChannel>('all')
  const [copiedId, setCopiedId] = useState<string | null>(null)

  useEffect(() => {
    load()
  }, [load])

  const social = useMemo(() => drafts.filter((d) => d.kind === 'social'), [drafts])
  const filtered = filter === 'all' ? social : social.filter((d) => d.channel === filter)

  const projectTitle = (id: string | null) =>
    projects.find((p) => p.id === id)?.title ?? null

  const toggleChannel = (channel: DraftChannel) => {
    setSelected((current) => {
      if (current.includes(channel)) return current.filter((c) => c !== channel)
      if (current.length >= MAX_CHANNELS) return current
      return [...current, channel]
    })
  }

  const copyToClipboard = (text: string, id: string) => {
    navigator.clipboard.writeText(text)
    setCopiedId(id)
    setTimeout(() => setCopiedId(null), 2000)
  }

  const onGenerate = async () => {
    if (selected.length === 0 || generating) return
    const result = await generate({
      kind: 'social',
      channels: selected,
      projectId: projectId || null,
      brief: brief.trim() || null,
    })
    if (result.ok) setBrief('')
  }

  const noProjects = projects.length === 0

  return (
    <div className="min-h-screen p-6 lg:p-8">
      <div className="mx-auto max-w-6xl space-y-6">
        {/* Header */}
        <header className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-foreground">
              Social Content Studio
            </h1>
            <p className="text-muted-foreground">
              Drafts written by your model from what you have stored. Copy them out and edit them.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Filter className="h-4 w-4 text-muted-foreground" />
            <div className="flex flex-wrap gap-1 rounded-lg bg-secondary p-1">
              {(['all', ...SOCIAL_CHANNELS] as const).map((channel) => (
                <button
                  key={channel}
                  onClick={() => setFilter(channel)}
                  className={cn(
                    'rounded-md px-3 py-1.5 text-sm font-medium transition-colors capitalize',
                    filter === channel
                      ? 'bg-background text-foreground shadow-sm'
                      : 'text-muted-foreground hover:text-foreground'
                  )}
                >
                  {channel}
                </button>
              ))}
            </div>
          </div>
        </header>

        {/* Drafts only: no scheduling, no publishing, nothing leaves the app. */}
        <Card className="bg-card border-chart-5/30">
          <CardContent className="flex items-start gap-3 py-4">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-chart-5" />
            <p className="text-sm text-muted-foreground">
              <span className="font-medium text-foreground">Drafts only.</span> Nothing here is
              posted, scheduled or sent anywhere — publishing stays switched off for this pilot.
              The channel label records where the text is meant to go, nothing more.
            </p>
          </CardContent>
        </Card>

        {/* Generator */}
        <Card className="bg-card border-border">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Sparkles className="h-5 w-5 text-primary" />
              Write drafts
            </CardTitle>
            <CardDescription>
              One model call writes one draft per channel you pick, using only the project context
              already stored for you.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <ModelStatusCard compact />

            {/* Channel picker */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <p className="text-sm font-medium text-foreground">Channels</p>
                <span className="text-xs text-muted-foreground">
                  {/* Not "N of 4": there are five channels and four is the per-run
                      cap, so "3 of 4" reads as though a channel were missing. */}
                  {selected.length} selected · up to {MAX_CHANNELS} per run
                </span>
              </div>
              <div className="flex flex-wrap gap-2">
                {SOCIAL_CHANNELS.map((channel) => {
                  const Icon = channelIcons[channel]
                  const isOn = selected.includes(channel)
                  return (
                    <button
                      key={channel}
                      onClick={() => toggleChannel(channel)}
                      disabled={generating}
                      aria-pressed={isOn}
                      className={cn(
                        'flex items-center gap-2 rounded-lg border px-3 py-2 text-sm capitalize transition-colors disabled:opacity-50',
                        isOn
                          ? 'border-primary bg-primary/10 text-foreground'
                          : 'border-border bg-secondary/40 text-muted-foreground hover:text-foreground'
                      )}
                    >
                      <Icon className="h-4 w-4" />
                      {channel}
                    </button>
                  )
                })}
              </div>
              {selected.length >= MAX_CHANNELS && (
                <p className="text-xs text-muted-foreground">
                  Up to {MAX_CHANNELS} at a time, so the model has room to write each one properly.
                </p>
              )}
            </div>

            {/* Which project to write from */}
            <div className="space-y-2">
              <p className="text-sm font-medium text-foreground">Write from</p>
              {noProjects ? (
                <p className="text-sm text-muted-foreground">
                  No project stored yet. Drafts are written from your own context, never invented,
                  so do one brain dump first.
                </p>
              ) : (
                <select
                  value={projectId}
                  onChange={(e) => setProjectId(e.target.value)}
                  disabled={generating}
                  className="w-full rounded-md border border-border bg-secondary/40 px-3 py-2 text-sm text-foreground disabled:opacity-50 sm:max-w-sm"
                >
                  <option value="">Most recent project ({projects[0]?.title})</option>
                  {projects.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.title}
                    </option>
                  ))}
                </select>
              )}
            </div>

            {/* Optional steer */}
            <div className="space-y-2">
              <p className="text-sm font-medium text-foreground">
                Steer it <span className="font-normal text-muted-foreground">(optional)</span>
              </p>
              <Textarea
                value={brief}
                onChange={(e) => setBrief(e.target.value)}
                placeholder="e.g. Focus on the newsletter, not the book. Keep it plain, no launch hype."
                maxLength={1000}
                disabled={generating}
                className="min-h-[70px] resize-y"
              />
            </div>

            {error && (
              <div className="flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/10 p-3">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
                <p className="text-sm text-destructive">{error}</p>
              </div>
            )}

            <div className="flex flex-wrap items-center gap-3">
              <Button
                onClick={onGenerate}
                disabled={generating || selected.length === 0 || noProjects || !model?.configured}
                className="gap-2"
              >
                {generating ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Writing…
                  </>
                ) : (
                  <>
                    <Zap className="h-4 w-4" />
                    Generate drafts
                  </>
                )}
              </Button>
              {noProjects && (
                <Button variant="outline" onClick={() => setActiveTab('brain-dump')} className="gap-2">
                  <Sparkles className="h-4 w-4" />
                  Start a brain dump first
                </Button>
              )}
              {generating && (
                <span className="text-xs text-muted-foreground">
                  A local model writes these one channel at a time. It can take 10–60 seconds.
                </span>
              )}
            </div>

            {lastGeneration && lastGeneration.kind === 'social' && (
              <div className="space-y-1">
                <p className="text-xs text-muted-foreground">
                  Last run: {lastGeneration.model || 'unknown model'} ·{' '}
                  {(lastGeneration.latencyMs / 1000).toFixed(1)}s
                  {lastGeneration.projectTitle ? ` · from “${lastGeneration.projectTitle}”` : ''} ·{' '}
                  {lastGeneration.delivered} of {lastGeneration.requested} channels written
                </p>
                {lastGeneration.delivered < lastGeneration.requested && (
                  <p className="flex items-start gap-1.5 text-xs text-chart-5">
                    <AlertCircle className="mt-0.5 h-3 w-3 shrink-0" />
                    <span>
                      The model stopped before it finished
                      {lastGeneration.truncated ? ' — it hit its token limit mid-answer' : ''}, so
                      only {lastGeneration.delivered} of {lastGeneration.requested} drafts were
                      written. What you see is what it completed; nothing was filled in for the
                      rest. Ask for fewer channels at once, or raise AI_DRAFT_MAX_TOKENS on the
                      server.
                    </span>
                  </p>
                )}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Drafts */}
        {loading && !hydrated ? (
          <Card className="bg-card border-border">
            <CardContent className="flex items-center gap-2 py-10 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading your drafts…
            </CardContent>
          </Card>
        ) : filtered.length > 0 ? (
          <div className="grid gap-4 md:grid-cols-2">
            {filtered.map((draft) => {
              const Icon = channelIcons[draft.channel] ?? Share2
              const colorClass = channelColors[draft.channel] ?? 'bg-primary/20 text-primary'
              const tags = draft.payload.hashtags ?? []
              const source = projectTitle(draft.projectId)

              return (
                <Card key={draft.id} className="bg-card border-border overflow-hidden">
                  <CardHeader className="pb-3">
                    <div className="flex items-center justify-between gap-2">
                      <div className={cn('flex items-center gap-2 rounded-full px-3 py-1', colorClass)}>
                        <Icon className="h-4 w-4" />
                        <span className="text-sm font-medium capitalize">{draft.channel}</span>
                      </div>
                      <div className="flex items-center gap-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => copyToClipboard(draftAsText(draft), draft.id)}
                        >
                          {copiedId === draft.id ? (
                            <>
                              <Check className="h-4 w-4 text-chart-3 mr-1" />
                              Copied
                            </>
                          ) : (
                            <>
                              <Copy className="h-4 w-4 mr-1" />
                              Copy
                            </>
                          )}
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => remove(draft.id)}
                          className="text-muted-foreground hover:text-destructive"
                        >
                          <Trash2 className="h-4 w-4 mr-1" />
                          Delete
                        </Button>
                      </div>
                    </div>
                    {draft.payload.hook && (
                      <div className="mt-2 flex items-start gap-2 text-sm">
                        <Zap className="mt-0.5 h-4 w-4 shrink-0 text-chart-5" />
                        <span className="text-muted-foreground">Hook:</span>
                        <span className="font-medium text-foreground">{draft.payload.hook}</span>
                      </div>
                    )}
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="rounded-lg bg-secondary/50 p-4">
                      <p className="whitespace-pre-line text-sm text-foreground leading-relaxed">
                        {draft.body}
                      </p>
                    </div>

                    {draft.payload.note && (
                      <p className="rounded-md border border-chart-5/30 bg-chart-5/10 p-2 text-xs text-muted-foreground">
                        The model flagged: {draft.payload.note}
                      </p>
                    )}

                    {tags.length > 0 && (
                      <div className="space-y-2">
                        <div className="flex items-center gap-2 text-sm text-muted-foreground">
                          <Hash className="h-4 w-4" />
                          <span>Hashtags</span>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-auto p-1"
                            onClick={() =>
                              copyToClipboard(
                                tags.map((t) => `#${t.replace(/^#/, '')}`).join(' '),
                                `${draft.id}-tags`
                              )
                            }
                          >
                            {copiedId === `${draft.id}-tags` ? (
                              <Check className="h-3 w-3 text-chart-3" />
                            ) : (
                              <Copy className="h-3 w-3" />
                            )}
                          </Button>
                        </div>
                        <div className="flex flex-wrap gap-1.5">
                          {tags.map((tag, i) => (
                            <span
                              key={i}
                              className="rounded-full bg-primary/10 px-2 py-0.5 text-xs text-primary"
                            >
                              {tag.replace(/^#/, '')}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Provenance: which model wrote this, from which project, when. */}
                    <div className="flex flex-wrap items-center gap-2 border-t border-border pt-3">
                      <Badge variant="outline" className="font-mono text-[10px]">
                        {draft.model || 'model not recorded'}
                      </Badge>
                      {source && (
                        <span className="text-xs text-muted-foreground truncate max-w-[14rem]">
                          from “{source}”
                        </span>
                      )}
                      <span className="text-xs text-muted-foreground ml-auto">
                        {new Date(draft.createdAt).toLocaleString()}
                      </span>
                    </div>
                  </CardContent>
                </Card>
              )
            })}
          </div>
        ) : (
          <Card className="bg-gradient-to-br from-primary/5 to-accent/5 border-primary/20">
            <CardContent className="flex flex-col items-center justify-center py-16 text-center">
              <div className="flex h-16 w-16 items-center justify-center rounded-full bg-primary/10 mb-4">
                <Share2 className="h-8 w-8 text-primary" />
              </div>
              <h3 className="text-lg font-medium text-foreground">
                {social.length === 0
                  ? 'No social drafts yet'
                  : filter === 'all'
                    ? 'No social drafts yet'
                    : `No ${filter} drafts yet`}
              </h3>
              <p className="text-muted-foreground mt-2 max-w-md">
                {noProjects
                  ? 'Drafts are written from your own stored context, never invented. Do one brain dump first and this screen will have something real to write about.'
                  : 'Pick your channels above and generate. Each draft is written by the configured model from your stored project context, saved to your account, and stays here after a refresh.'}
              </p>
              {social.length > 0 && filter !== 'all' && (
                <Button variant="outline" onClick={() => setFilter('all')} className="mt-4">
                  Show all channels
                </Button>
              )}
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  )
}
