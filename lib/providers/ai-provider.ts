'use client'

export interface AIProvider {
  generate(input: string, systemPrompt?: string): Promise<string>
  getName(): string
  isAvailable(): boolean
}

export class GroqProvider implements AIProvider {
  private apiKey: string
  private model: string = 'mixtral-8x7b-32768'

  constructor(apiKey: string) {
    this.apiKey = apiKey
  }

  getName(): string {
    return 'Groq'
  }

  isAvailable(): boolean {
    return !!this.apiKey
  }

  async generate(input: string, systemPrompt?: string): Promise<string> {
    if (!this.isAvailable()) {
      throw new Error('Groq API key not configured')
    }

    try {
      const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: this.model,
          messages: [
            ...(systemPrompt ? [{ role: 'system', content: systemPrompt }] : []),
            { role: 'user', content: input },
          ],
          temperature: 0.7,
          max_tokens: 1000,
        }),
      })

      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.error?.message || 'Groq API error')
      }

      const data = await response.json()
      return data.choices[0]?.message?.content || ''
    } catch (error) {
      console.error('[v0] Groq provider error:', error)
      throw error
    }
  }
}

export class OpenRouterProvider implements AIProvider {
  private apiKey: string
  private model: string = 'openai/gpt-3.5-turbo'

  constructor(apiKey: string) {
    this.apiKey = apiKey
  }

  getName(): string {
    return 'OpenRouter'
  }

  isAvailable(): boolean {
    return !!this.apiKey
  }

  async generate(input: string, systemPrompt?: string): Promise<string> {
    if (!this.isAvailable()) {
      throw new Error('OpenRouter API key not configured')
    }

    try {
      const response = await fetch('https://api.openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: this.model,
          messages: [
            ...(systemPrompt ? [{ role: 'system', content: systemPrompt }] : []),
            { role: 'user', content: input },
          ],
          temperature: 0.7,
          max_tokens: 1000,
        }),
      })

      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.error?.message || 'OpenRouter API error')
      }

      const data = await response.json()
      return data.choices[0]?.message?.content || ''
    } catch (error) {
      console.error('[v0] OpenRouter provider error:', error)
      throw error
    }
  }
}

export class ClaudeProvider implements AIProvider {
  private apiKey: string

  constructor(apiKey: string) {
    this.apiKey = apiKey
  }

  getName(): string {
    return 'Claude'
  }

  isAvailable(): boolean {
    return !!this.apiKey
  }

  async generate(input: string, systemPrompt?: string): Promise<string> {
    if (!this.isAvailable()) {
      throw new Error('Claude API key not configured')
    }

    try {
      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'x-api-key': this.apiKey,
          'anthropic-version': '2023-06-01',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'claude-3-sonnet-20240229',
          max_tokens: 1024,
          system: systemPrompt,
          messages: [{ role: 'user', content: input }],
        }),
      })

      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.error?.message || 'Claude API error')
      }

      const data = await response.json()
      return data.content[0]?.text || ''
    } catch (error) {
      console.error('[v0] Claude provider error:', error)
      throw error
    }
  }
}

export class MockProvider implements AIProvider {
  getName(): string {
    return 'Mock (Offline)'
  }

  isAvailable(): boolean {
    return true
  }

  async generate(input: string, systemPrompt?: string): Promise<string> {
    // Simulate network delay
    await new Promise((resolve) => setTimeout(resolve, 800))

    const mockResponses: Record<string, string[]> = {
      etsy: [
        'Handcrafted digital planner for busy professionals - 50+ pages of productivity templates, goal-tracking sheets, and habit trackers. Instantly downloadable PDF. Perfect for entrepreneurs and freelancers.',
        'Premium digital planner bundle: Business, Personal, and Finance sections. Beautifully designed with soft aesthetics. Lifetime access to updates.',
      ],
      gumroad: [
        'Digital product: Complete creator productivity system. Templates, workflows, and guides for building sustainable creative businesses.',
        'Bundle: 100+ social media templates + content calendar + brand guidelines. Ready to customize and use immediately.',
      ],
      social: [
        'Just turned my chaos into clarity with a new system ✨ If you\'re juggling ideas and overwhelm, you might need this too. #CreatorTools #Productivity',
        'Building in public: Creating tools that help creators focus on what matters. What\'s your biggest creative bottleneck? #IndieHackers #Creative',
      ],
      seo: ['digital planner', 'productivity templates', 'creative tools', 'business templates', 'notion templates'],
      monetization: [
        'Sell on Etsy at $12-29 (templates have 70%+ margins)',
        'Create course on Gumroad ($49-99 price point)',
        'Offer as Fiverr service at $150-500/project',
        'Build community on Patreon with exclusive templates',
      ],
    }

    // Determine response type based on input
    let category = 'etsy'
    if (input.toLowerCase().includes('gumroad')) category = 'gumroad'
    else if (input.toLowerCase().includes('social')) category = 'social'
    else if (input.toLowerCase().includes('seo')) category = 'seo'
    else if (input.toLowerCase().includes('monetiz')) category = 'monetization'

    const responses = mockResponses[category] || mockResponses.etsy
    return responses[Math.floor(Math.random() * responses.length)]
  }
}
