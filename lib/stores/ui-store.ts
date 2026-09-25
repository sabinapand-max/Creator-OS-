import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export type ActiveTab = 'dashboard' | 'brain-dump' | 'marketplace' | 'social' | 'memory' | 'settings'
export type MarketplaceTab = 'etsy' | 'gumroad' | 'fiverr'

interface ProviderSettings {
  groqKey: string
  openRouterKey: string
  claudeKey: string
  preferredProvider: 'groq' | 'openrouter' | 'claude'
}

interface UIStore {
  activeTab: ActiveTab
  marketplaceTab: MarketplaceTab
  selectedGenerationId: string | null
  sidebarCollapsed: boolean
  focusMode: boolean
  isLoading: boolean
  providerStatus: {
    isOffline: boolean
    lastProvider: string
  }
  providerSettings: ProviderSettings
  setActiveTab: (tab: ActiveTab) => void
  setMarketplaceTab: (tab: MarketplaceTab) => void
  setSelectedGenerationId: (id: string | null) => void
  toggleSidebar: () => void
  setSidebarCollapsed: (collapsed: boolean) => void
  toggleFocusMode: () => void
  setFocusMode: (value: boolean) => void
  setLoading: (value: boolean) => void
  setProviderStatus: (status: UIStore['providerStatus']) => void
  updateProviderSettings: (settings: Partial<ProviderSettings>) => void
}

export const useUIStore = create<UIStore>()(
  persist(
    (set) => ({
      activeTab: 'dashboard',
      // 'gumroad' rather than 'etsy': Etsy listings are out of scope for this
      // pilot, so the default tab should land on one that really generates.
      // A browser that already persisted 'etsy' keeps it and sees the honest
      // out-of-scope panel, with one click through to the working tabs.
      marketplaceTab: 'gumroad',
      selectedGenerationId: null,
      sidebarCollapsed: false,
      focusMode: false,
      isLoading: false,
      providerStatus: {
        isOffline: false,
        lastProvider: '',
      },
      providerSettings: {
        groqKey: '',
        openRouterKey: '',
        claudeKey: '',
        preferredProvider: 'groq',
      },
      setActiveTab: (tab) => set({ activeTab: tab }),
      setMarketplaceTab: (tab) => set({ marketplaceTab: tab }),
      setSelectedGenerationId: (id) => set({ selectedGenerationId: id }),
      toggleSidebar: () => set((state) => ({ sidebarCollapsed: !state.sidebarCollapsed })),
      setSidebarCollapsed: (collapsed) => set({ sidebarCollapsed: collapsed }),
      toggleFocusMode: () => set((state) => ({ focusMode: !state.focusMode })),
      setFocusMode: (value) => set({ focusMode: value }),
      setLoading: (value) => set({ isLoading: value }),
      setProviderStatus: (status) => set({ providerStatus: status }),
      updateProviderSettings: (settings) =>
        set((state) => ({
          providerSettings: { ...state.providerSettings, ...settings },
        })),
    }),
    {
      name: 'ui-store',
    }
  )
)
