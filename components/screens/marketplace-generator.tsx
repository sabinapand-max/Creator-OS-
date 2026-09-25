'use client'

/**
 * Marketplace, wired to real generations.
 *
 * What changed: this screen used to read `useAIGenerationStore`, a browser-local
 * list nothing wrote to any more, so every tab showed an empty state forever.
 * Gumroad and Fiverr now come from /api/pilot/drafts with kind 'offer' — one
 * real model call against the signed-in user's stored project context, saved
 * server-side and deletable.
 *
 * Etsy stays out of scope on purpose. The brief excludes Etsy listings and
 * product inventory, so 'etsy' is not a draft channel at all and the tab says so
 * plainly instead of pretending to generate listings.
 *
 * Nothing here is listed, priced for sale or published. A draft is text the user
 * reads, edits and copies out by hand.
 */
import { useEffect, useMemo, useState } from 'react'
import { useDraftsStore, usePilotStore, useUIStore, type MarketplaceTab } from '@/lib/stores'
import { OFFER_CHANNELS, type ContentDraft, type DraftChannel } from '@/lib/pilot/types.ts'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Textarea } from '@/components/ui/textarea'
import {
  AlertCircle,
  Ban,
  Briefcase,
  Check,
  Copy,
  DollarSign,
  Loader2,
  ShoppingBag,
  Sparkles,
  Trash2,
  Users,
  Zap,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { ModelStatusCard } from './sign-in'

const tabs: { id: MarketplaceTab; label: string; description: string }[] = [
  { id: 'gumroad', label: 'Gumroad', description: 'Digital products & courses' },
  { id: 'fiverr', label: 'Fiverr', description: 'Services & gigs' },
  { id: 'etsy', label: 'Etsy', description: 'Out of scope for this pilot' },
]

/** Plain text a user copies out, with every field the model filled in. */
function offerAsText(draft: ContentDraft): string {
  const lines: string[] = []
  if (draft.title) lines.push(draft.title, '')
  if (draft.payload.pricing) lines.push(`Price: ${draft.payload.pricing}`, '')
  lines.push(draft.body)
  const features = draft.payload.features ?? []
  if (features.length > 0) {
    lines.push('', 'What is included:')
    for (const f of features) lines.push(`- ${f}`)
  }
  if (draft.payload.audience) lines.push('', `Who it is for: ${draft.payload.audience}`)
  const packages = draft.payload.packages ?? []
  if (packages.length > 0) {
    lines.push('', 'Packages:')
    for (const p of packages) {
      lines.push(`${p.name} — ${p.price}`)
      for (const f of p.features) lines.push(`  - ${f}`)
    }
  }
  return lines.join('\n')
}

export function MarketplaceGenerator() {
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
  const { marketplaceTab, setMarketplaceTab, setActiveTab } = useUIStore()

  const [selected, setSelected] = useState<DraftChannel[]>(['gumroad'])
  const [projectId, setProjectId] = useState<string>('')
  const [brief, setBrief] = useState('')
  const [copiedId, setCopiedId] = useState<string | null>(null)

  useEffect(() => {
    load()
  }, [load])

  const offers = useMemo(() => drafts.filter((d) => d.kind === 'offer'), [drafts])
  const onTab = marketplaceTab === 'etsy' ? [] : offers.filter((d) => d.channel === marketplaceTab)

  const projectTitle = (id: string | null) => projects.find((p) => p.id === id)?.title ?? null
  const noProjects = projects.length === 0

  const toggleChannel = (channel: DraftChannel) => {
    setSelected((current) =>
      current.includes(channel)
        ? current.filter((c) => c !== channel)
        : [...current, channel].slice(0, OFFER_CHANNELS.length)
    )
  }

  const copyToClipboard = (text: string, id: string) => {
    navigator.clipboard.writeText(text)
    setCopiedId(id)
    setTimeout(() => setCopiedId(null), 2000)
  }

  const onGenerate = async () => {
    if (selected.length === 0 || generating) return
    const result = await generate({
      kind: 'offer',
      channels: selected,
      projectId: projectId || null,
      brief: brief.trim() || null,
    })
    if (result.ok) setBrief('')
  }

  return (
    <div className="min-h-screen p-6 lg:p-8">
      <div className="mx-auto max-w-6xl space-y-6">
        {/* Header */}
        <header>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">
            Marketplace Generator
          </h1>
          <p className="text-muted-foreground">
            Offer drafts written by your model from what you have stored. Nothing is listed or sold
            from here.
          </p>
        </header>

        {/* Tabs */}
        <div className="flex flex-wrap gap-2 border-b border-border pb-2">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setMarketplaceTab(tab.id)}
              className={cn(
                'flex flex-col items-start rounded-lg px-4 py-3 text-left transition-colors',
                marketplaceTab === tab.id
                  ? 'bg-primary/10 text-primary'
                  : 'text-muted-foreground hover:bg-secondary/50'
              )}
            >
              <span className="font-medium">{tab.label}</span>
              <span className="text-xs opacity-70">{tab.description}</span>
            </button>
          ))}
        </div>

        {/* Etsy: out of scope, said plainly rather than left as a dead tab. */}
        {marketplaceTab === 'etsy' ? (
          <Card className="bg-secondary/30 border-dashed">
            <CardContent className="flex flex-col items-center justify-center py-14 text-center">
              <div className="flex h-14 w-14 items-center justify-center rounded-full bg-muted mb-4">
                <Ban className="h-7 w-7 text-muted-foreground" />
              </div>
              <h3 className="text-lg font-medium text-foreground">
                Etsy listings are out of scope for this pilot
              </h3>
              <p className="text-muted-foreground mt-2 max-w-md">
                This pilot deliberately excludes Etsy listings, product inventory and stock counts,
                so nothing generates them and the model is told not to propose them either.
                Gumroad and Fiverr drafts are real and available now.
              </p>
              <div className="mt-4 flex flex-wrap justify-center gap-2">
                <Button onClick={() => setMarketplaceTab('gumroad')} className="gap-2">
                  <ShoppingBag className="h-4 w-4" />
                  Go to Gumroad
                </Button>
                <Button variant="outline" onClick={() => setMarketplaceTab('fiverr')} className="gap-2">
                  <Briefcase className="h-4 w-4" />
                  Go to Fiverr
                </Button>
              </div>
            </CardContent>
          </Card>
        ) : (
          <>
            {/* Generator */}
            <Card className="bg-card border-border">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Sparkles className="h-5 w-5 text-primary" />
                  Write an offer draft
                </CardTitle>
                <CardDescription>
                  One model call, using only the project context already stored for you. Prices are
                  suggestions the model marks as such — confirm them before you list anything.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <ModelStatusCard compact />

                <div className="space-y-2">
                  <p className="text-sm font-medium text-foreground">Where the offer goes</p>
                  <div className="flex flex-wrap gap-2">
                    {OFFER_CHANNELS.map((channel) => {
                      const Icon = channel === 'gumroad' ? ShoppingBag : Briefcase
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
                </div>

                <div className="space-y-2">
                  <p className="text-sm font-medium text-foreground">Write from</p>
                  {noProjects ? (
                    <p className="text-sm text-muted-foreground">
                      No project stored yet. Drafts are written from your own context, never
                      invented, so do one brain dump first.
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

                <div className="space-y-2">
                  <p className="text-sm font-medium text-foreground">
                    Steer it <span className="font-normal text-muted-foreground">(optional)</span>
                  </p>
                  <Textarea
                    value={brief}
                    onChange={(e) => setBrief(e.target.value)}
                    placeholder="e.g. A £12 PDF kit for people with six focused hours a week. Three Fiverr tiers, no retainers."
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
                        Generate offer draft
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
                      A local model writes these one offer at a time. It can take 10–60 seconds.
                    </span>
                  )}
                </div>

                {lastGeneration && lastGeneration.kind === 'offer' && (
                  <div className="space-y-1">
                    <p className="text-xs text-muted-foreground">
                      Last run: {lastGeneration.model || 'unknown model'} ·{' '}
                      {(lastGeneration.latencyMs / 1000).toFixed(1)}s
                      {lastGeneration.projectTitle ? ` · from “${lastGeneration.projectTitle}”` : ''} ·{' '}
                      {lastGeneration.delivered} of {lastGeneration.requested} offers written
                    </p>
                    {lastGeneration.delivered < lastGeneration.requested && (
                      <p className="flex items-start gap-1.5 text-xs text-chart-5">
                        <AlertCircle className="mt-0.5 h-3 w-3 shrink-0" />
                        <span>
                          The model stopped before it finished
                          {lastGeneration.truncated ? ' — it hit its token limit mid-answer' : ''},
                          so only {lastGeneration.delivered} of {lastGeneration.requested} offer
                          drafts were written. Offer drafts are the longest thing this pilot asks
                          for; generate one channel at a time, or raise AI_DRAFT_MAX_TOKENS on the
                          server.
                        </span>
                      </p>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Drafts for this tab */}
            {loading && !hydrated ? (
              <Card className="bg-card border-border">
                <CardContent className="flex items-center gap-2 py-10 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Loading your drafts…
                </CardContent>
              </Card>
            ) : onTab.length > 0 ? (
              <div className="grid gap-4 md:grid-cols-2">
                {onTab.map((draft) => {
                  const features = draft.payload.features ?? []
                  const packages = draft.payload.packages ?? []
                  const source = projectTitle(draft.projectId)

                  return (
                    <Card
                      key={draft.id}
                      className={cn(
                        'bg-card border-border',
                        packages.length > 0 && 'md:col-span-2'
                      )}
                    >
                      <CardHeader className="pb-3">
                        <div className="flex items-start justify-between gap-2">
                          <CardTitle className="text-base leading-tight">
                            {draft.title || `${draft.channel} offer draft`}
                          </CardTitle>
                          <div className="flex shrink-0 items-center gap-1">
                            {draft.payload.pricing && (
                              <span className="rounded-full bg-chart-3/10 px-2 py-0.5 text-sm font-medium text-chart-3">
                                {draft.payload.pricing}
                              </span>
                            )}
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => remove(draft.id)}
                              className="text-muted-foreground hover:text-destructive"
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </div>
                        </div>
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

                        {features.length > 0 && (
                          <div className="space-y-1.5">
                            {features.map((feature, i) => (
                              <div key={i} className="flex items-start gap-2 text-sm text-muted-foreground">
                                <Check className="mt-0.5 h-3 w-3 shrink-0 text-chart-3" />
                                <span>{feature}</span>
                              </div>
                            ))}
                          </div>
                        )}

                        {draft.payload.audience && (
                          <div className="flex items-start gap-2 text-sm text-muted-foreground">
                            <Users className="mt-0.5 h-4 w-4 shrink-0" />
                            <span>{draft.payload.audience}</span>
                          </div>
                        )}

                        {packages.length > 0 && (
                          <div className="grid gap-3 sm:grid-cols-3">
                            {packages.map((pkg, i) => (
                              <div
                                key={i}
                                className={cn(
                                  'space-y-2 rounded-lg p-4',
                                  i === 1 ? 'border border-primary/20 bg-primary/10' : 'bg-secondary/50'
                                )}
                              >
                                <div className="flex items-center justify-between gap-2">
                                  <span className="font-medium text-foreground">{pkg.name}</span>
                                  <span className="font-medium text-chart-3">{pkg.price}</span>
                                </div>
                                <ul className="space-y-1">
                                  {pkg.features.map((feature, j) => (
                                    <li
                                      key={j}
                                      className="flex items-start gap-2 text-xs text-muted-foreground"
                                    >
                                      <Check className="mt-0.5 h-3 w-3 shrink-0 text-chart-3" />
                                      {feature}
                                    </li>
                                  ))}
                                </ul>
                              </div>
                            ))}
                          </div>
                        )}

                        {/* Provenance: which model wrote this, from which project, when. */}
                        <div className="flex flex-wrap items-center gap-2 border-t border-border pt-3">
                          <Badge variant="outline" className="font-mono text-[10px]">
                            {draft.model || 'model not recorded'}
                          </Badge>
                          {source && (
                            <span className="max-w-[14rem] truncate text-xs text-muted-foreground">
                              from “{source}”
                            </span>
                          )}
                          <span className="ml-auto text-xs text-muted-foreground">
                            {new Date(draft.createdAt).toLocaleString()}
                          </span>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => copyToClipboard(offerAsText(draft), draft.id)}
                          >
                            {copiedId === draft.id ? (
                              <>
                                <Check className="mr-2 h-4 w-4 text-chart-3" />
                                Copied
                              </>
                            ) : (
                              <>
                                <Copy className="mr-2 h-4 w-4" />
                                Copy details
                              </>
                            )}
                          </Button>
                        </div>
                      </CardContent>
                    </Card>
                  )
                })}
              </div>
            ) : (
              <Card className="bg-gradient-to-br from-primary/5 to-accent/5 border-primary/20">
                <CardContent className="flex flex-col items-center justify-center py-14 text-center">
                  <div className="flex h-16 w-16 items-center justify-center rounded-full bg-primary/10 mb-4">
                    {marketplaceTab === 'gumroad' ? (
                      <ShoppingBag className="h-8 w-8 text-primary" />
                    ) : (
                      <Briefcase className="h-8 w-8 text-primary" />
                    )}
                  </div>
                  <h3 className="text-lg font-medium text-foreground">
                    No {marketplaceTab} drafts yet
                  </h3>
                  <p className="text-muted-foreground mt-2 max-w-md">
                    {noProjects
                      ? 'Offer drafts are written from your own stored context, never invented. Do one brain dump first and this screen will have something real to write about.'
                      : `Pick ${marketplaceTab} above and generate. The draft is written by the configured model from your stored project context, saved to your account, and stays here after a refresh.`}
                  </p>
                  {offers.length > 0 && (
                    <p className="text-xs text-muted-foreground mt-3">
                      You have {offers.length} offer draft{offers.length === 1 ? '' : 's'} on other
                      tabs.
                    </p>
                  )}
                  <div className="mt-4 flex items-center gap-2 text-xs text-muted-foreground">
                    <DollarSign className="h-3 w-3" />
                    Drafts only — nothing is listed, priced for sale or published from here.
                  </div>
                </CardContent>
              </Card>
            )}
          </>
        )}
      </div>
    </div>
  )
}
