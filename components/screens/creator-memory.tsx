'use client'

import { useState } from 'react'
import { useCreatorStore } from '@/lib/stores'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  User,
  Palette,
  Target,
  DollarSign,
  Tag,
  ShoppingBag,
  Save,
  Check,
  X,
  Plus,
} from 'lucide-react'
import { cn } from '@/lib/utils'

const toneOptions = ['friendly', 'professional', 'casual', 'authoritative', 'playful', 'minimal']
const aestheticOptions = ['modern', 'minimal', 'bold', 'vintage', 'elegant', 'creative']
const pricingStyles = ['value-based', 'premium', 'accessible', 'tiered', 'freemium']
const platformOptions = ['etsy', 'gumroad', 'fiverr'] as const

export function CreatorMemory() {
  const { profile, updateProfile, setOnboarded, isOnboarded } = useCreatorStore()
  const [saved, setSaved] = useState(false)
  const [newTag, setNewTag] = useState('')
  const [newProductType, setNewProductType] = useState('')

  const handleSave = () => {
    setOnboarded(true)
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  const addTag = () => {
    if (newTag.trim() && !profile.tags.includes(newTag.trim())) {
      updateProfile({ tags: [...profile.tags, newTag.trim()] })
      setNewTag('')
    }
  }

  const removeTag = (tag: string) => {
    updateProfile({ tags: profile.tags.filter((t) => t !== tag) })
  }

  const addProductType = () => {
    if (newProductType.trim() && !profile.productTypes.includes(newProductType.trim())) {
      updateProfile({ productTypes: [...profile.productTypes, newProductType.trim()] })
      setNewProductType('')
    }
  }

  const removeProductType = (type: string) => {
    updateProfile({ productTypes: profile.productTypes.filter((t) => t !== type) })
  }

  const togglePlatform = (platform: typeof platformOptions[number]) => {
    if (profile.platforms.includes(platform)) {
      updateProfile({ platforms: profile.platforms.filter((p) => p !== platform) })
    } else {
      updateProfile({ platforms: [...profile.platforms, platform] })
    }
  }

  return (
    <div className="min-h-screen p-6 lg:p-8">
      <div className="mx-auto max-w-4xl space-y-6">
        {/* Header */}
        <header className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-foreground">Creator Memory</h1>
            <p className="text-muted-foreground">
              Your creative profile helps AI generate more relevant outputs
            </p>
          </div>
          <Button onClick={handleSave} className="gap-2">
            {saved ? (
              <>
                <Check className="h-4 w-4" />
                Saved
              </>
            ) : (
              <>
                <Save className="h-4 w-4" />
                Save Profile
              </>
            )}
          </Button>
        </header>

        <div className="grid gap-6 lg:grid-cols-2">
          {/* Identity */}
          <Card className="bg-card border-border">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <User className="h-5 w-5 text-primary" />
                Identity
              </CardTitle>
              <CardDescription>Define your creative niche and audience</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="niche">Your Niche</Label>
                <Input
                  id="niche"
                  placeholder="e.g., Digital planning, Notion templates, Art prints"
                  value={profile.niche}
                  onChange={(e) => updateProfile({ niche: e.target.value })}
                  className="bg-secondary/50"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="audience">Target Audience</Label>
                <Input
                  id="audience"
                  placeholder="e.g., Busy entrepreneurs, Creative professionals"
                  value={profile.audience}
                  onChange={(e) => updateProfile({ audience: e.target.value })}
                  className="bg-secondary/50"
                />
              </div>
            </CardContent>
          </Card>

          {/* Style */}
          <Card className="bg-card border-border">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Palette className="h-5 w-5 text-accent" />
                Style
              </CardTitle>
              <CardDescription>Your brand voice and visual aesthetic</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label>Tone of Voice</Label>
                <div className="flex flex-wrap gap-2">
                  {toneOptions.map((tone) => (
                    <button
                      key={tone}
                      onClick={() => updateProfile({ tone })}
                      className={cn(
                        'rounded-full px-3 py-1.5 text-sm font-medium transition-colors capitalize',
                        profile.tone === tone
                          ? 'bg-primary text-primary-foreground'
                          : 'bg-secondary text-muted-foreground hover:bg-secondary/80'
                      )}
                    >
                      {tone}
                    </button>
                  ))}
                </div>
              </div>
              <div className="space-y-2">
                <Label>Aesthetic</Label>
                <div className="flex flex-wrap gap-2">
                  {aestheticOptions.map((aesthetic) => (
                    <button
                      key={aesthetic}
                      onClick={() => updateProfile({ aesthetic })}
                      className={cn(
                        'rounded-full px-3 py-1.5 text-sm font-medium transition-colors capitalize',
                        profile.aesthetic === aesthetic
                          ? 'bg-accent text-accent-foreground'
                          : 'bg-secondary text-muted-foreground hover:bg-secondary/80'
                      )}
                    >
                      {aesthetic}
                    </button>
                  ))}
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Platforms */}
          <Card className="bg-card border-border">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <ShoppingBag className="h-5 w-5 text-chart-3" />
                Platforms
              </CardTitle>
              <CardDescription>Where you sell your products</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex flex-wrap gap-2">
                {platformOptions.map((platform) => (
                  <button
                    key={platform}
                    onClick={() => togglePlatform(platform)}
                    className={cn(
                      'rounded-lg px-4 py-2 text-sm font-medium transition-colors capitalize',
                      profile.platforms.includes(platform)
                        ? 'bg-chart-3 text-chart-3-foreground'
                        : 'bg-secondary text-muted-foreground hover:bg-secondary/80'
                    )}
                  >
                    {platform}
                  </button>
                ))}
              </div>
            </CardContent>
          </Card>

          {/* Pricing */}
          <Card className="bg-card border-border">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <DollarSign className="h-5 w-5 text-chart-4" />
                Pricing Style
              </CardTitle>
              <CardDescription>How you approach pricing</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex flex-wrap gap-2">
                {pricingStyles.map((style) => (
                  <button
                    key={style}
                    onClick={() => updateProfile({ pricingStyle: style })}
                    className={cn(
                      'rounded-full px-3 py-1.5 text-sm font-medium transition-colors capitalize',
                      profile.pricingStyle === style
                        ? 'bg-chart-4 text-chart-4-foreground'
                        : 'bg-secondary text-muted-foreground hover:bg-secondary/80'
                    )}
                  >
                    {style}
                  </button>
                ))}
              </div>
            </CardContent>
          </Card>

          {/* Tags */}
          <Card className="bg-card border-border">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Tag className="h-5 w-5 text-primary" />
                Brand Tags
              </CardTitle>
              <CardDescription>Keywords that describe your brand</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex gap-2">
                <Input
                  placeholder="Add a tag..."
                  value={newTag}
                  onChange={(e) => setNewTag(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && addTag()}
                  className="bg-secondary/50"
                />
                <Button variant="outline" size="icon" onClick={addTag}>
                  <Plus className="h-4 w-4" />
                </Button>
              </div>
              <div className="flex flex-wrap gap-2">
                {profile.tags.map((tag) => (
                  <span
                    key={tag}
                    className="flex items-center gap-1 rounded-full bg-primary/10 px-3 py-1 text-sm text-primary"
                  >
                    {tag}
                    <button
                      onClick={() => removeTag(tag)}
                      className="ml-1 rounded-full p-0.5 hover:bg-primary/20"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </span>
                ))}
                {profile.tags.length === 0 && (
                  <span className="text-sm text-muted-foreground">No tags added yet</span>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Product Types */}
          <Card className="bg-card border-border">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Target className="h-5 w-5 text-accent" />
                Product Types
              </CardTitle>
              <CardDescription>Types of products you create</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex gap-2">
                <Input
                  placeholder="e.g., Templates, Printables, Courses"
                  value={newProductType}
                  onChange={(e) => setNewProductType(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && addProductType()}
                  className="bg-secondary/50"
                />
                <Button variant="outline" size="icon" onClick={addProductType}>
                  <Plus className="h-4 w-4" />
                </Button>
              </div>
              <div className="flex flex-wrap gap-2">
                {profile.productTypes.map((type) => (
                  <span
                    key={type}
                    className="flex items-center gap-1 rounded-full bg-accent/10 px-3 py-1 text-sm text-accent"
                  >
                    {type}
                    <button
                      onClick={() => removeProductType(type)}
                      className="ml-1 rounded-full p-0.5 hover:bg-accent/20"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </span>
                ))}
                {profile.productTypes.length === 0 && (
                  <span className="text-sm text-muted-foreground">No product types added yet</span>
                )}
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}
