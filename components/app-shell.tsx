'use client'

/**
 * App shell.
 *
 * Now session-gated. Every pilot route resolves the user from an httpOnly
 * cookie and returns 401 without one, so rendering the workspace for a signed-out
 * visitor would only produce a wall of failed requests. The sign-in screen is
 * shown instead, and state is hydrated once on mount from /api/pilot/state.
 */

import { useEffect } from 'react'
import { AlertCircle, Loader2 } from 'lucide-react'
import { usePilotStore, useUIStore } from '@/lib/stores'
import { Sidebar } from './sidebar'
import { Dashboard } from './screens/dashboard'
import { BrainDumpWorkspace } from './screens/brain-dump-workspace'
import { CreatorMemory } from './screens/creator-memory'
import { MarketplaceGenerator } from './screens/marketplace-generator'
import { SocialContentStudio } from './screens/social-content-studio'
import { SettingsScreen } from './screens/settings'
import { SignInScreen } from './screens/sign-in'

/**
 * Screens that still hold state outside the pilot, labelled rather than hidden.
 *
 * `memory` edits a creator profile that lives only in this browser and that the
 * model never reads, so it says so out loud instead of looking like pilot state.
 *
 * `marketplace` and `social` used to be listed here: they read a browser-local
 * list nothing wrote to any more, so they could only show an empty state. Both
 * now call /api/pilot/drafts, which runs a real model call over the signed-in
 * user's stored project context and saves the result server-side. They carry
 * their own "drafts only, nothing is published" banner instead. Etsy listings
 * and product inventory remain out of scope and the marketplace tab says so.
 */
const LOCAL_ONLY_TABS = new Set(['memory'])

export function AppShell() {
  const { activeTab, focusMode } = useUIStore()
  const status = usePilotStore((s) => s.status)
  const hydrated = usePilotStore((s) => s.hydrated)
  const loadError = usePilotStore((s) => s.loadError)
  const refresh = usePilotStore((s) => s.refresh)

  useEffect(() => {
    void refresh()
  }, [refresh])

  if (!hydrated) {
    return (
      <div className="flex h-screen w-full items-center justify-center">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading your pilot workspace…
        </div>
      </div>
    )
  }

  if (status !== 'authenticated') {
    return <SignInScreen />
  }

  const renderScreen = () => {
    switch (activeTab) {
      case 'dashboard':
        return <Dashboard />
      case 'brain-dump':
        return <BrainDumpWorkspace />
      case 'memory':
        return <CreatorMemory />
      case 'marketplace':
        return <MarketplaceGenerator />
      case 'social':
        return <SocialContentStudio />
      case 'settings':
        return <SettingsScreen />
      default:
        return <Dashboard />
    }
  }

  return (
    <div className="flex h-screen w-full overflow-hidden">
      {!focusMode && <Sidebar />}
      <main className="flex-1 overflow-auto">
        {loadError && (
          <div className="flex items-center gap-2 border-b border-destructive/30 bg-destructive/10 px-4 py-2 text-xs text-destructive">
            <AlertCircle className="h-3.5 w-3.5 shrink-0" />
            Could not reach the pilot server: {loadError}
          </div>
        )}
        {LOCAL_ONLY_TABS.has(activeTab) && <LocalOnlyNotice />}
        {renderScreen()}
      </main>
    </div>
  )
}

function LocalOnlyNotice() {
  return (
    <div className="flex items-start gap-2 border-b border-border bg-secondary/40 px-4 py-2 text-xs text-muted-foreground">
      <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-chart-4" />
      <span>
        This profile is stored <strong className="text-foreground">only in this browser</strong>.
        It is not part of your pilot record and the model never reads it. The facts the pilot
        remembers are held server-side and shown in Brain Dump under “Remembered from this”.
      </span>
    </div>
  )
}
