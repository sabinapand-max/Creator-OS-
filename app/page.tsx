'use client'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { AppShell } from '@/components/app-shell'
import { usePilotStore } from '@/lib/stores'
import {
  Brain,
  Zap,
  BookOpen,
  PenLine,
  BarChart3,
  ArrowRight,
  Sparkles,
  Shield,
  Clock,
  MessageSquare,
} from 'lucide-react'

export default function Home() {
  const status = usePilotStore((s) => s.status)
  if (status === 'authenticated') return <AppShell />
  return <LandingPage />
}

/* ────────────────────────────────────────
   Landing page — visible before sign-in
   ──────────────────────────────────────── */

function LandingPage() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Top nav bar */}
      <header className="sticky top-0 z-50 border-b border-border/60 bg-background/80 backdrop-blur-sm">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3 sm:px-6">
          <div className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-primary" />
            <span className="font-semibold tracking-tight">Creator OS</span>
          </div>
          <nav className="hidden items-center gap-6 text-sm text-muted-foreground md:flex">
            <a href="#features" className="hover:text-foreground transition-colors">Features</a>
            <a href="#how-it-works" className="hover:text-foreground transition-colors">How it works</a>
            <a href="#pricing" className="hover:text-foreground transition-colors">Who it's for</a>
          </nav>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" className="text-sm" asChild>
              <a href="/api/pilot/auth/register">Sign up</a>
            </Button>
            <Button size="sm" className="text-sm" asChild>
              <a href="/api/pilot/auth/signin">Sign in</a>
            </Button>
          </div>
        </div>
      </header>

      {/* Hero */}
      <section className="relative overflow-hidden">
        <div className="absolute inset-0 -z-10 bg-gradient-to-b from-primary/8 via-transparent to-transparent opacity-30" />
        <div className="mx-auto max-w-6xl px-4 py-20 sm:py-28 sm:px-6 text-center">
          <Badge variant="secondary" className="mb-6 bg-secondary/60 px-3 py-1 text-xs font-normal ring-1 ring-border">
            Pilot — invite only
          </Badge>
          <h1 className="text-4xl font-bold leading-tight sm:text-5xl lg:text-6xl tracking-tight">
            A workspace built for<br className="hidden sm:block" />
            {' '}minds that work sideways
          </h1>
          <p className="mt-6 text-lg text-muted-foreground max-w-2xl mx-auto leading-relaxed">
            Creator OS is an AI-native pilot workspace designed for neurodivergent solo creators.
            Capture everything in a brain dump. The model surfaces exactly one next action
            so you can swim instead of whale-watch.
          </p>
          <div className="mt-10 flex flex-wrap items-center justify-center gap-4">
            <Button size="lg" className="text-base px-8" asChild>
              <a href="/api/pilot/auth/register">
                Try the pilot <ArrowRight className="ml-2 h-4 w-4" />
              </a>
            </Button>
            <Button size="lg" variant="outline" asChild>
              <a href="#features">See how it works</a>
            </Button>
          </div>
          <p className="mt-4 text-xs text-muted-foreground">
            No credit card. Works in your browser. Data stored locally in your pilot session.
          </p>
        </div>
      </section>

      {/* Feature grid */}
      <section id="features" className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
        <div className="text-center mb-12">
          <h2 className="text-3xl font-bold tracking-tight">Six tools. One thread.</h2>
          <p className="mt-3 text-muted-foreground">Everything lives in a single persistent workspace — nothing gets lost between tabs or apps.</p>
        </div>
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {[
            { icon: Brain, title: 'Brain Dump', desc: 'Throw messy thoughts into a stream. The system keeps context across turns, remembers earlier decisions, and builds toward re-entry cards.' },
            { icon: BookOpen, title: 'Creator Memory', desc: 'A correction-correctable fact store. Add, edit, or delete memories. Everything has timestamps and source attribution.' },
            { icon: PenLine, title: 'Content Studio', desc: 'Draft social posts, captions, and snippets. Every draft carries a banner reminding you: "drafts only, nothing published."' },
            { icon: BarChart3, title: 'Dashboard', desc: 'Your projects at a glance. See active threads, saved drafts, and upcoming actions without digging through folders.' },
            { icon: Zap, title: 'Capacity Awareness', desc: 'Built around energy states. Tag entries as high-focus or low-energy so the model adapts its suggestions to where you actually are.' },
            { icon: Shield, title: 'Privacy-first', desc: 'API keys never touch localStorage. Inference runs server-side with httpOnly cookies. Your data stays in your pilot session.' },
          ].map(({ icon: Icon, title, desc }) => (
            <Card key={title} className="border-border/60 bg-card/40 hover:bg-card/70 transition-colors group">
              <CardHeader className="pb-2">
                <div className="mb-2 inline-flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 text-primary group-hover:bg-primary/20 transition-colors">
                  <Icon className="h-5 w-5" />
                </div>
                <CardTitle className="text-base">{title}</CardTitle>
              </CardHeader>
              <CardContent>
                <CardDescription className="text-sm leading-relaxed">{desc}</CardDescription>
              </CardContent>
            </Card>
          ))}
        </div>
      </section>

      {/* How it works — numbered steps */}
      <section id="how-it-works" className="bg-secondary/30 border-y border-border/40">
        <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
          <div className="text-center mb-12">
            <h2 className="text-3xl font-bold tracking-tight">How it feels to use</h2>
            <p className="mt-3 text-muted-foreground">Three rules. No dashboards to configure, no tags to manage.</p>
          </div>
          <div className="max-w-3xl mx-auto space-y-8">
            {[
              { num: '1', title: 'Dump', detail: 'Type whatever\'s spinning in your head — fragments, half-formed ideas, random links. Don\'t format, don\'t organize.' },
              { num: '2', title: 'Surface', detail: 'The model reads everything since your last turn and produces exactly one actionable next step — not ten, not three, one.' },
              { num: '3', title: 'Re-enter', detail: 'Come back tomorrow. Re-entry cards name your project and the single next action so you pick up where you left off, zero context loss.' },
            ].map(({ num, title, detail }) => (
              <div key={num} className="flex gap-4 items-start">
                <div className="flex-shrink-0 mt-0.5 flex h-10 w-10 items-center justify-center rounded-full bg-primary text-primary-foreground text-sm font-bold">
                  {num}
                </div>
                <div>
                  <h3 className="text-lg font-semibold">{title}</h3>
                  <p className="text-muted-foreground text-sm mt-1 leading-relaxed">{detail}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Who it's for */}
      <section id="pricing" className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
        <div className="text-center mb-12">
          <h2 className="text-3xl font-bold tracking-tight">Built for who?</h2>
          <p className="mt-3 text-muted-foreground max-w-xl mx-auto">
            If regular productivity systems make you want to close the laptop, this was built by someone
            who did.
          </p>
        </div>
        <div className="grid gap-6 sm:grid-cols-2 max-w-3xl mx-auto">
          <Card className="border-border/60 bg-card/40">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Avatar className="h-6 w-6">
                  <AvatarFallback className="text-xs bg-primary/20 text-primary">ND</AvatarFallback>
                </Avatar>
                Neurodivergent creators
              </CardTitle>
            </CardHeader>
            <CardContent className="text-sm text-muted-foreground leading-relaxed">
              ADHD brains think in constellations, not checklists. This tool doesn't force linear workflows.
              Dump sideways, get structured output from the model. No task fields, no statuses, no "complete by Friday."
            </CardContent>
          </Card>
          <Card className="border-border/60 bg-card/40">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Avatar className="h-6 w-6">
                  <AvatarFallback className="text-xs bg-primary/20 text-primary">SO</AvatarFallback>
                </Avatar>
                Solo operators
              </CardTitle>
            </CardHeader>
            <CardContent className="text-sm text-muted-foreground leading-relaxed">
              Writers, makers, indie authors building things nobody asked you to build. One person holding
              context across writing, outreach, publishing, finance, and life. Creator OS holds the context.
            </CardContent>
          </Card>
        </div>
      </section>

      {/* CTA */}
      <section className="bg-gradient-to-b from-primary/5 to-transparent border-t border-border/40">
        <div className="mx-auto max-w-4xl px-4 py-16 text-center sm:px-6">
          <h2 className="text-3xl font-bold tracking-tight">Ready to stop whale-watching?</h2>
          <p className="mt-3 text-muted-foreground max-w-xl mx-auto">
            Join the pilot. Your brain dump becomes structured action — automatically.
          </p>
          <div className="mt-8">
            <Button size="lg" className="text-base px-10" asChild>
              <a href="/api/pilot/auth/register">Start your first brain dump →</a>
            </Button>
          </div>
          <p className="mt-4 text-xs text-muted-foreground">Free during pilot. Email-only access. No spam.</p>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-border/40">
        <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6 flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Sparkles className="h-4 w-4" />
            <span>Creator OS © IndigoStudio</span>
          </div>
          <div className="flex items-center gap-6 text-sm text-muted-foreground">
            <a href="https://indigos.uk" target="_blank" rel="noopener noreferrer" className="hover:text-foreground transition-colors">Indigos.uk</a>
            <Separator orientation="vertical" className="h-4 bg-border/40" />
            <span>Pilot build · Nov 2026</span>
          </div>
        </div>
      </footer>
    </div>
  )
}
