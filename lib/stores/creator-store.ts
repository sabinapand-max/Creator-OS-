import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export interface CreatorProfile {
  niche: string
  tone: string
  aesthetic: string
  audience: string
  goals: string[]
  pricingStyle: string
  platforms: ('etsy' | 'gumroad' | 'fiverr')[]
  tags: string[]
  productTypes: string[]
}

interface CreatorStore {
  profile: CreatorProfile
  isOnboarded: boolean
  updateProfile: (updates: Partial<CreatorProfile>) => void
  setOnboarded: (value: boolean) => void
  resetProfile: () => void
}

const defaultProfile: CreatorProfile = {
  niche: '',
  tone: 'friendly',
  aesthetic: 'modern',
  audience: '',
  goals: [],
  pricingStyle: 'value-based',
  platforms: ['etsy', 'gumroad'],
  tags: [],
  productTypes: [],
}

export const useCreatorStore = create<CreatorStore>()(
  persist(
    (set) => ({
      profile: defaultProfile,
      isOnboarded: false,
      updateProfile: (updates) =>
        set((state) => ({
          profile: { ...state.profile, ...updates },
        })),
      setOnboarded: (value) => set({ isOnboarded: value }),
      resetProfile: () => set({ profile: defaultProfile, isOnboarded: false }),
    }),
    {
      name: 'creator-profile',
    }
  )
)
