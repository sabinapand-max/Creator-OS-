import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export interface BufferChannel {
  id: string
  name: string
  service: string // twitter, linkedin, instagram, facebook, etc.
  avatar?: string
}

export interface ScheduledPost {
  id: string
  text: string
  channelId: string
  channelName: string
  service: string
  scheduledAt: string
  status: 'scheduled' | 'sent' | 'failed'
  createdAt: string
}

interface BufferStore {
  // Connection state
  isConnected: boolean
  apiKey: string
  channels: BufferChannel[]
  
  // Scheduled posts
  scheduledPosts: ScheduledPost[]
  
  // Loading states
  isLoadingChannels: boolean
  isScheduling: boolean
  
  // Actions
  setApiKey: (key: string) => void
  setConnected: (connected: boolean) => void
  setChannels: (channels: BufferChannel[]) => void
  addScheduledPost: (post: ScheduledPost) => void
  updatePostStatus: (postId: string, status: ScheduledPost['status']) => void
  removeScheduledPost: (postId: string) => void
  setLoadingChannels: (loading: boolean) => void
  setScheduling: (scheduling: boolean) => void
  disconnect: () => void
}

export const useBufferStore = create<BufferStore>()(
  persist(
    (set) => ({
      isConnected: false,
      apiKey: '',
      channels: [],
      scheduledPosts: [],
      isLoadingChannels: false,
      isScheduling: false,
      
      setApiKey: (key) => set({ apiKey: key }),
      setConnected: (connected) => set({ isConnected: connected }),
      setChannels: (channels) => set({ channels }),
      addScheduledPost: (post) => 
        set((state) => ({ scheduledPosts: [post, ...state.scheduledPosts] })),
      updatePostStatus: (postId, status) =>
        set((state) => ({
          scheduledPosts: state.scheduledPosts.map((p) =>
            p.id === postId ? { ...p, status } : p
          ),
        })),
      removeScheduledPost: (postId) =>
        set((state) => ({
          scheduledPosts: state.scheduledPosts.filter((p) => p.id !== postId),
        })),
      setLoadingChannels: (loading) => set({ isLoadingChannels: loading }),
      setScheduling: (scheduling) => set({ isScheduling: scheduling }),
      disconnect: () => set({ 
        isConnected: false, 
        apiKey: '', 
        channels: [],
      }),
    }),
    {
      name: 'buffer-store',
    }
  )
)
