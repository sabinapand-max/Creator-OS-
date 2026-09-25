'use client'

import { usePilotStore, useUIStore, type ActiveTab } from '@/lib/stores'
import { cn } from '@/lib/utils'
import {
  LayoutDashboard,
  Brain,
  User,
  ShoppingBag,
  Share2,
  ChevronLeft,
  ChevronRight,
  Sparkles,
  Settings,
  LogOut,
} from 'lucide-react'
import { Button } from '@/components/ui/button'

const navItems: { id: ActiveTab; label: string; icon: React.ElementType }[] = [
  { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { id: 'brain-dump', label: 'Brain Dump', icon: Brain },
  { id: 'marketplace', label: 'Marketplace', icon: ShoppingBag },
  { id: 'social', label: 'Social Studio', icon: Share2 },
  { id: 'memory', label: 'Creator Memory', icon: User },
  { id: 'settings', label: 'Settings', icon: Settings },
]

export function Sidebar() {
  const { activeTab, setActiveTab, sidebarCollapsed, toggleSidebar } = useUIStore()
  const user = usePilotStore((s) => s.user)
  const signOut = usePilotStore((s) => s.signOut)

  return (
    <aside
      className={cn(
        'relative flex h-full flex-col border-r border-border bg-sidebar transition-all duration-300',
        sidebarCollapsed ? 'w-16' : 'w-64'
      )}
    >
      {/* Logo */}
      <div className="flex h-16 items-center gap-3 border-b border-sidebar-border px-4">
        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10">
          <Sparkles className="h-5 w-5 text-primary" />
        </div>
        {!sidebarCollapsed && (
          <div className="flex flex-col">
            <span className="text-sm font-semibold text-sidebar-foreground">Creator OS</span>
            <span className="text-xs text-muted-foreground">Expansion Engine</span>
          </div>
        )}
      </div>

      {/* Navigation */}
      <nav className="flex-1 space-y-1 p-3">
        {navItems.map((item) => {
          const Icon = item.icon
          const isActive = activeTab === item.id
          
          return (
            <button
              key={item.id}
              onClick={() => setActiveTab(item.id)}
              className={cn(
                'flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-all',
                isActive
                  ? 'bg-sidebar-accent text-sidebar-accent-foreground'
                  : 'text-muted-foreground hover:bg-sidebar-accent/50 hover:text-sidebar-foreground'
              )}
            >
              <Icon className={cn('h-5 w-5 shrink-0', isActive && 'text-primary')} />
              {!sidebarCollapsed && <span>{item.label}</span>}
            </button>
          )
        })}
      </nav>

      {/* Signed-in pilot account */}
      {user && (
        <div className="border-t border-sidebar-border px-3 pt-3">
          <div className={cn('flex items-center gap-2', sidebarCollapsed && 'justify-center')}>
            <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/10">
              <User className="h-4 w-4 text-primary" />
            </div>
            {!sidebarCollapsed && (
              <div className="min-w-0 flex-1">
                <p className="truncate text-xs font-medium text-sidebar-foreground">
                  {user.displayName || user.email}
                </p>
                <p className="truncate text-[11px] text-muted-foreground">pilot account</p>
              </div>
            )}
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => void signOut()}
            className="mt-1 w-full justify-center text-muted-foreground hover:text-foreground"
          >
            <LogOut className="h-4 w-4" />
            {!sidebarCollapsed && <span className="ml-2">Sign out</span>}
          </Button>
        </div>
      )}

      {/* Collapse Toggle */}
      <div className="border-t border-sidebar-border p-3">
        <Button
          variant="ghost"
          size="sm"
          onClick={toggleSidebar}
          className="w-full justify-center text-muted-foreground hover:text-foreground"
        >
          {sidebarCollapsed ? (
            <ChevronRight className="h-4 w-4" />
          ) : (
            <>
              <ChevronLeft className="h-4 w-4 mr-2" />
              <span>Collapse</span>
            </>
          )}
        </Button>
      </div>
    </aside>
  )
}
