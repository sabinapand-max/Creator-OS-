'use client'

/**
 * Scheduling dialog.
 *
 * Publishing is disabled for this pilot, so the Buffer API key input that used
 * to live here is gone: a key typed into a dialog ends up in localStorage and is
 * then sent in a request body, which is exactly where secrets must not be. The
 * server route refuses the call unless PILOT_PUBLISHING_ENABLED is set, and reads
 * BUFFER_API_KEY from its own environment.
 */

import { useState, useCallback, useEffect } from 'react'
import { useBufferStore } from '@/lib/stores'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Loader2, Calendar, Clock, Send, AlertCircle, CheckCircle2 } from 'lucide-react'
import { cn } from '@/lib/utils'

interface ScheduleModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  initialContent?: string
  platform?: string
}

export function ScheduleModal({ open, onOpenChange, initialContent = '', platform }: ScheduleModalProps) {
  const { 
    isConnected, 
    apiKey, 
    channels, 
    isScheduling,
    setConnected,
    setChannels,
    setScheduling,
    addScheduledPost,
    isLoadingChannels,
    setLoadingChannels,
  } = useBufferStore()
  
  const [content, setContent] = useState(initialContent)
  const [selectedChannelId, setSelectedChannelId] = useState<string>('')
  const [scheduleDate, setScheduleDate] = useState('')
  const [scheduleTime, setScheduleTime] = useState('')
  const [scheduleMode, setScheduleMode] = useState<'now' | 'queue' | 'custom'>('queue')
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)

  // Reset state when modal opens
  useEffect(() => {
    if (open) {
      setContent(initialContent)
      setError(null)
      setSuccess(false)
      
      // Pre-select channel based on platform hint
      if (platform && channels.length > 0) {
        const matchingChannel = channels.find(
          ch => ch.service.toLowerCase().includes(platform.toLowerCase())
        )
        if (matchingChannel) {
          setSelectedChannelId(matchingChannel.id)
        }
      }
    }
  }, [open, initialContent, platform, channels])

  // Load channels when connected
  const loadChannels = useCallback(async () => {
    if (!apiKey) return
    
    setLoadingChannels(true)
    setError(null)
    
    try {
      const response = await fetch('/api/buffer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'getChannels' }),
      })
      
      const data = await response.json()
      
      if (data.error) {
        setError(data.error)
        setConnected(false)
      } else {
        setChannels(data.channels || [])
        setConnected(true)
      }
    } catch (err) {
      setError('Failed to load channels')
    } finally {
      setLoadingChannels(false)
    }
  }, [apiKey, setChannels, setConnected, setLoadingChannels])

  useEffect(() => {
    if (open && apiKey && channels.length === 0) {
      loadChannels()
    }
  }, [open, apiKey, channels.length, loadChannels])

  const handleSchedule = async () => {
    if (!content.trim()) {
      setError('Please enter content to post')
      return
    }
    
    if (!selectedChannelId) {
      setError('Please select a channel')
      return
    }
    
    setScheduling(true)
    setError(null)
    
    try {
      let scheduledAt: string | undefined
      
      if (scheduleMode === 'custom' && scheduleDate && scheduleTime) {
        scheduledAt = new Date(`${scheduleDate}T${scheduleTime}`).toISOString()
      }
      
      const response = await fetch('/api/buffer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'schedulePost',
          text: content,
          channelId: selectedChannelId,
          scheduledAt: scheduleMode === 'custom' ? scheduledAt : undefined,
        }),
      })
      
      const data = await response.json()
      
      if (data.error) {
        setError(data.error)
      } else {
        const channel = channels.find(ch => ch.id === selectedChannelId)
        addScheduledPost({
          id: data.post?.id || `local-${Date.now()}`,
          text: content,
          channelId: selectedChannelId,
          channelName: channel?.name || 'Unknown',
          service: channel?.service || 'unknown',
          scheduledAt: scheduledAt || new Date().toISOString(),
          status: 'scheduled',
          createdAt: new Date().toISOString(),
        })
        setSuccess(true)
        setTimeout(() => {
          onOpenChange(false)
          setSuccess(false)
          setContent('')
        }, 1500)
      }
    } catch (err) {
      setError('Failed to schedule post')
    } finally {
      setScheduling(false)
    }
  }

  // Get platform icon
  const getPlatformIcon = (service: string) => {
    const icons: Record<string, string> = {
      twitter: 'X',
      linkedin: 'in',
      instagram: 'IG',
      facebook: 'fb',
      pinterest: 'P',
      tiktok: 'TT',
    }
    return icons[service.toLowerCase()] || service[0]?.toUpperCase()
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px] bg-card border-border">
        <DialogHeader>
          <DialogTitle className="text-foreground">
            {success ? 'Scheduled Successfully' : 'Schedule to Buffer'}
          </DialogTitle>
          <DialogDescription className="text-muted-foreground">
            {success 
              ? 'Your post has been scheduled and will be published automatically.'
              : 'Schedule this content to your connected social media accounts.'}
          </DialogDescription>
        </DialogHeader>

        {success ? (
          <div className="flex flex-col items-center justify-center py-8 gap-3">
            <div className="h-12 w-12 rounded-full bg-primary/20 flex items-center justify-center">
              <CheckCircle2 className="h-6 w-6 text-primary" />
            </div>
            <p className="text-sm text-muted-foreground">Redirecting...</p>
          </div>
        ) : !isConnected || !apiKey ? (
          <div className="space-y-4 py-4">
            <div className="flex items-start gap-3 rounded-lg border border-border bg-secondary/40 p-4">
              <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-chart-4" />
              <div className="space-y-1 text-sm">
                <p className="font-medium text-foreground">
                  Publishing is disabled during this pilot
                </p>
                <p className="text-muted-foreground">
                  Nothing is scheduled or posted from here. The server refuses this route unless
                  the operator explicitly sets{' '}
                  <span className="font-mono">PILOT_PUBLISHING_ENABLED=true</span>.
                </p>
                <p className="text-muted-foreground">
                  A Buffer API key is never entered in the browser. It belongs in{' '}
                  <span className="font-mono">BUFFER_API_KEY</span> in the server environment, and
                  this dialog can neither read nor change it.
                </p>
              </div>
            </div>

            {error && (
              <div className="flex items-center gap-2 text-sm text-destructive">
                <AlertCircle className="h-4 w-4" />
                {error}
              </div>
            )}
          </div>
        ) : (
          <div className="space-y-4 py-4">
            {/* Content */}
            <div className="space-y-2">
              <Label htmlFor="content" className="text-foreground">Content</Label>
              <Textarea
                id="content"
                value={content}
                onChange={(e) => setContent(e.target.value)}
                placeholder="What would you like to share?"
                className="min-h-[100px] bg-input border-border resize-none"
              />
              <p className="text-xs text-muted-foreground text-right">
                {content.length} characters
              </p>
            </div>

            {/* Channel Selection */}
            <div className="space-y-2">
              <Label className="text-foreground">Channel</Label>
              {isLoadingChannels ? (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Loading channels...
                </div>
              ) : channels.length > 0 ? (
                <Select value={selectedChannelId} onValueChange={setSelectedChannelId}>
                  <SelectTrigger className="bg-input border-border">
                    <SelectValue placeholder="Select a channel" />
                  </SelectTrigger>
                  <SelectContent className="bg-popover border-border">
                    {channels.map((channel) => (
                      <SelectItem key={channel.id} value={channel.id}>
                        <div className="flex items-center gap-2">
                          <span className="inline-flex h-5 w-5 items-center justify-center rounded bg-primary/20 text-[10px] font-bold text-primary">
                            {getPlatformIcon(channel.service)}
                          </span>
                          <span>{channel.name}</span>
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                <p className="text-sm text-muted-foreground">
                  No channels found. Connect social accounts in Buffer first.
                </p>
              )}
            </div>

            {/* Schedule Options */}
            <div className="space-y-2">
              <Label className="text-foreground">When to post</Label>
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant={scheduleMode === 'queue' ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => setScheduleMode('queue')}
                  className={cn(
                    scheduleMode !== 'queue' && 'border-border text-muted-foreground'
                  )}
                >
                  Add to Queue
                </Button>
                <Button
                  type="button"
                  variant={scheduleMode === 'custom' ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => setScheduleMode('custom')}
                  className={cn(
                    scheduleMode !== 'custom' && 'border-border text-muted-foreground'
                  )}
                >
                  <Calendar className="mr-1 h-3 w-3" />
                  Custom Time
                </Button>
              </div>
            </div>

            {/* Custom Date/Time */}
            {scheduleMode === 'custom' && (
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label htmlFor="date" className="text-foreground text-xs">Date</Label>
                  <Input
                    id="date"
                    type="date"
                    value={scheduleDate}
                    onChange={(e) => setScheduleDate(e.target.value)}
                    min={new Date().toISOString().split('T')[0]}
                    className="bg-input border-border"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="time" className="text-foreground text-xs">Time</Label>
                  <Input
                    id="time"
                    type="time"
                    value={scheduleTime}
                    onChange={(e) => setScheduleTime(e.target.value)}
                    className="bg-input border-border"
                  />
                </div>
              </div>
            )}

            {error && (
              <div className="flex items-center gap-2 text-sm text-destructive">
                <AlertCircle className="h-4 w-4" />
                {error}
              </div>
            )}
          </div>
        )}

        {!success && isConnected && (
          <DialogFooter>
            <Button variant="outline" onClick={() => onOpenChange(false)} className="border-border">
              Cancel
            </Button>
            <Button onClick={handleSchedule} disabled={isScheduling || !selectedChannelId}>
              {isScheduling ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Scheduling...
                </>
              ) : (
                <>
                  <Send className="mr-2 h-4 w-4" />
                  {scheduleMode === 'queue' ? 'Add to Queue' : 'Schedule Post'}
                </>
              )}
            </Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  )
}
