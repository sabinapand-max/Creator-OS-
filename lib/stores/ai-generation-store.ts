import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export interface EtsyListing {
  title: string
  description: string
  tags: string[]
  pricing: string
  category: string
}

export interface GumroadProduct {
  title: string
  description: string
  pricing: string
  features: string[]
  targetAudience: string
}

export interface FiverrGig {
  title: string
  description: string
  packages: { name: string; price: string; features: string[] }[]
}

export interface SocialContent {
  platform: 'instagram' | 'tiktok' | 'pinterest' | 'twitter'
  content: string
  hashtags: string[]
  hook?: string
}

export interface MonetizationOpportunity {
  type: 'bundle' | 'expansion' | 'upsell' | 'cross-sell'
  title: string
  description: string
  potentialRevenue: string
}

export interface AIGeneration {
  id: string
  brainDumpId: string
  inputSummary: string
  createdAt: Date
  status: 'generating' | 'complete' | 'error'
  etsyListings: EtsyListing[]
  gumroadProducts: GumroadProduct[]
  fiverrGigs: FiverrGig[]
  socialContent: SocialContent[]
  seoTags: string[]
  pricingSuggestions: string[]
  monetizationOpportunities: MonetizationOpportunity[]
}

interface AIGenerationStore {
  generations: AIGeneration[]
  isGenerating: boolean
  currentGenerationId: string | null
  addGeneration: (brainDumpId: string, inputSummary: string) => string
  updateGeneration: (id: string, updates: Partial<AIGeneration>) => void
  setGenerating: (value: boolean) => void
  setCurrentGenerationId: (id: string | null) => void
  deleteGeneration: (id: string) => void
  getGenerationByBrainDumpId: (brainDumpId: string) => AIGeneration | undefined
}

export const useAIGenerationStore = create<AIGenerationStore>()(
  persist(
    (set, get) => ({
      generations: [],
      isGenerating: false,
      currentGenerationId: null,
      addGeneration: (brainDumpId, inputSummary) => {
        const id = crypto.randomUUID()
        const newGeneration: AIGeneration = {
          id,
          brainDumpId,
          inputSummary,
          createdAt: new Date(),
          status: 'generating',
          etsyListings: [],
          gumroadProducts: [],
          fiverrGigs: [],
          socialContent: [],
          seoTags: [],
          pricingSuggestions: [],
          monetizationOpportunities: [],
        }
        set((state) => ({
          generations: [newGeneration, ...state.generations],
          currentGenerationId: id,
          isGenerating: true,
        }))
        return id
      },
      updateGeneration: (id, updates) =>
        set((state) => ({
          generations: state.generations.map((gen) =>
            gen.id === id ? { ...gen, ...updates } : gen
          ),
        })),
      setGenerating: (value) => set({ isGenerating: value }),
      setCurrentGenerationId: (id) => set({ currentGenerationId: id }),
      deleteGeneration: (id) =>
        set((state) => ({
          generations: state.generations.filter((gen) => gen.id !== id),
        })),
      getGenerationByBrainDumpId: (brainDumpId) =>
        get().generations.find((gen) => gen.brainDumpId === brainDumpId),
    }),
    {
      name: 'ai-generations',
    }
  )
)
