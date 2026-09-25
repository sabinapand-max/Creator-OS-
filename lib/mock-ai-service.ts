import type {
  AIGeneration,
  EtsyListing,
  GumroadProduct,
  FiverrGig,
  SocialContent,
  MonetizationOpportunity,
} from './stores/ai-generation-store'

// Simulates AI processing delay
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

// Extract keywords from input for more relevant mock outputs
function extractKeywords(input: string): string[] {
  const words = input.toLowerCase().split(/\s+/)
  const stopWords = new Set(['a', 'an', 'the', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of', 'i', 'want', 'need', 'make', 'create', 'with', 'from', 'like', 'about'])
  return words.filter(word => word.length > 3 && !stopWords.has(word)).slice(0, 5)
}

// Enhance content with AI response context if available
function enhanceWithAI(input: string, aiResponse?: string): string {
  if (!aiResponse) return input
  // Use AI response to enhance the input context
  return `${input} (AI insights: ${aiResponse.slice(0, 200)})`
}

function generateEtsyListings(input: string, aiResponse?: string): EtsyListing[] {
  const keywords = extractKeywords(input)
  const keyword = keywords[0] || 'creative'
  const enhanced = enhanceWithAI(input, aiResponse)
  
  return [
    {
      title: `Premium ${keyword.charAt(0).toUpperCase() + keyword.slice(1)} Digital Download Bundle`,
      description: `Transform your creative workflow with this comprehensive ${keyword} bundle. Includes multiple formats, instant download, and lifetime updates. Perfect for entrepreneurs and creators looking to level up their brand. Based on: ${enhanced.slice(0, 100)}...`,
      tags: [keyword, 'digital download', 'instant access', 'printable', 'editable', 'commercial use'],
      pricing: '$19.99 - $49.99',
      category: 'Digital Downloads',
    },
    {
      title: `Minimalist ${keyword.charAt(0).toUpperCase() + keyword.slice(1)} Template Collection`,
      description: `Clean, modern templates designed for ${keyword} enthusiasts. Fully customizable in Canva and Adobe. Stand out with professional designs that save hours of work.`,
      tags: [keyword, 'template', 'canva', 'minimalist', 'modern', 'professional'],
      pricing: '$12.99 - $29.99',
      category: 'Templates',
    },
    {
      title: `${keyword.charAt(0).toUpperCase() + keyword.slice(1)} Starter Kit for Beginners`,
      description: `Everything you need to get started with ${keyword}. Step-by-step guides, checklists, and bonus resources. Perfect for those just starting their journey.`,
      tags: [keyword, 'starter kit', 'beginner', 'guide', 'checklist', 'resources'],
      pricing: '$9.99 - $24.99',
      category: 'Digital Downloads',
    },
  ]
}

function generateGumroadProducts(input: string, aiResponse?: string): GumroadProduct[] {
  const keywords = extractKeywords(input)
  const keyword = keywords[0] || 'creative'
  
  return [
    {
      title: `The Ultimate ${keyword.charAt(0).toUpperCase() + keyword.slice(1)} Masterclass`,
      description: `A comprehensive course teaching you everything about ${keyword}. From fundamentals to advanced strategies, become a pro in weeks, not years.`,
      pricing: '$97',
      features: [
        '12+ hours of video content',
        'Downloadable worksheets',
        'Private community access',
        'Monthly Q&A calls',
        'Lifetime updates',
      ],
      targetAudience: `Aspiring ${keyword} creators and entrepreneurs`,
    },
    {
      title: `${keyword.charAt(0).toUpperCase() + keyword.slice(1)} Resource Vault`,
      description: `500+ curated resources for ${keyword}. Tools, templates, swipe files, and more. Updated monthly with new additions.`,
      pricing: '$47',
      features: [
        '500+ resources',
        'Monthly updates',
        'Notion dashboard',
        'Quick-start guides',
        'Commercial license',
      ],
      targetAudience: `Busy ${keyword} professionals who want shortcuts`,
    },
  ]
}

function generateFiverrGigs(input: string, aiResponse?: string): FiverrGig[] {
  const keywords = extractKeywords(input)
  const keyword = keywords[0] || 'creative'
  
  return [
    {
      title: `I will create professional ${keyword} content for your brand`,
      description: `Get high-quality ${keyword} deliverables tailored to your brand. Fast turnaround, unlimited revisions, and satisfaction guaranteed.`,
      packages: [
        { name: 'Basic', price: '$25', features: ['1 deliverable', '3 day delivery', '1 revision'] },
        { name: 'Standard', price: '$50', features: ['3 deliverables', '2 day delivery', '3 revisions', 'Source files'] },
        { name: 'Premium', price: '$100', features: ['5 deliverables', '1 day delivery', 'Unlimited revisions', 'Source files', 'Priority support'] },
      ],
    },
  ]
}

function generateSocialContent(input: string): SocialContent[] {
  const keywords = extractKeywords(input)
  const keyword = keywords[0] || 'creative'
  
  return [
    {
      platform: 'instagram',
      content: `Stop scrolling - this changed everything for me.\n\nI used to struggle with ${keyword} until I discovered this simple framework.\n\nHere's what I learned:\n\n1. Start with why (your purpose drives everything)\n2. Keep it simple (complexity kills momentum)\n3. Stay consistent (small steps beat big leaps)\n\nDrop a 🔥 if this resonates.`,
      hashtags: [`#${keyword}`, '#creatorlife', '#entrepreneur', '#growthmindset', '#digitalcreator'],
      hook: 'Stop scrolling - this changed everything for me.',
    },
    {
      platform: 'tiktok',
      content: `POV: You finally figured out ${keyword}\n\n*shows transformation*\n\nBefore: Overwhelmed, confused, stuck\nAfter: Clear, focused, thriving\n\nThe secret? I stopped overcomplicating it.\n\nFollow for more ${keyword} tips!`,
      hashtags: [`#${keyword}`, '#creatortok', '#learnontiktok', '#smallbusiness'],
      hook: 'POV: You finally figured out the secret',
    },
    {
      platform: 'pinterest',
      content: `The Complete ${keyword.charAt(0).toUpperCase() + keyword.slice(1)} Guide for Beginners | Step by Step Tutorial | Free Resources Included | Perfect for Entrepreneurs`,
      hashtags: [`#${keyword}`, '#entrepreneur', '#digitalproducts', '#sidehustle'],
    },
    {
      platform: 'twitter',
      content: `Hot take: Most people overcomplicate ${keyword}.\n\nHere's the simple truth:\n\n→ Pick one thing\n→ Do it consistently\n→ Iterate based on feedback\n\nThat's it. That's the whole strategy.`,
      hashtags: [`#${keyword}`, '#buildinpublic'],
    },
  ]
}

function generateSEOTags(input: string): string[] {
  const keywords = extractKeywords(input)
  const baseTags = [
    'digital products',
    'passive income',
    'creator economy',
    'online business',
    'templates',
    'digital downloads',
    'printables',
    'etsy seller',
    'gumroad creator',
  ]
  return [...keywords, ...baseTags].slice(0, 12)
}

function generatePricingSuggestions(input: string): string[] {
  return [
    'Entry tier: $9-19 (impulse buy, high volume potential)',
    'Mid tier: $29-49 (sweet spot for most digital products)',
    'Premium tier: $97-197 (comprehensive courses/bundles)',
    'Consider a pay-what-you-want minimum of $5 for community building',
    'Bundle 3+ products at 40% discount to increase AOV',
  ]
}

function generateMonetizationOpportunities(input: string): MonetizationOpportunity[] {
  const keywords = extractKeywords(input)
  const keyword = keywords[0] || 'product'
  
  return [
    {
      type: 'bundle',
      title: `${keyword.charAt(0).toUpperCase() + keyword.slice(1)} Ultimate Bundle`,
      description: `Combine your top 3-5 products into a premium bundle at 30% off individual prices. Increases perceived value and average order value.`,
      potentialRevenue: '+40% AOV',
    },
    {
      type: 'expansion',
      title: 'Niche Down Variation',
      description: `Create industry-specific versions (e.g., for coaches, designers, writers). Each variation can be sold separately.`,
      potentialRevenue: '3x product catalog',
    },
    {
      type: 'upsell',
      title: 'Premium Support Add-on',
      description: `Offer 1:1 setup calls or priority email support for an additional fee. High margin, low effort.`,
      potentialRevenue: '+$50-100/sale',
    },
    {
      type: 'cross-sell',
      title: 'Complementary Mini-Product',
      description: `Create a quick-win mini product (checklist, cheat sheet) that pairs with main offering.`,
      potentialRevenue: '+$9-19/sale',
    },
  ]
}

export async function generateFromBrainDump(
  input: string,
  aiResponse?: string,
  onProgress?: (progress: number) => void
): Promise<Partial<AIGeneration>> {
  // Simulate AI processing with progress updates
  onProgress?.(10)
  await delay(500)
  
  const etsyListings = generateEtsyListings(input, aiResponse)
  onProgress?.(25)
  await delay(400)
  
  const gumroadProducts = generateGumroadProducts(input, aiResponse)
  onProgress?.(40)
  await delay(400)
  
  const fiverrGigs = generateFiverrGigs(input, aiResponse)
  onProgress?.(55)
  await delay(300)
  
  const socialContent = generateSocialContent(input)
  onProgress?.(70)
  await delay(300)
  
  const seoTags = generateSEOTags(input)
  onProgress?.(85)
  await delay(200)
  
  const pricingSuggestions = generatePricingSuggestions(input)
  const monetizationOpportunities = generateMonetizationOpportunities(input)
  onProgress?.(100)
  
  return {
    status: 'complete',
    etsyListings,
    gumroadProducts,
    fiverrGigs,
    socialContent,
    seoTags,
    pricingSuggestions,
    monetizationOpportunities,
  }
}
