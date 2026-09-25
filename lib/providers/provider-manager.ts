'use client'

import {
  GroqProvider,
  OpenRouterProvider,
  ClaudeProvider,
  MockProvider,
  type AIProvider,
} from './ai-provider'

export interface ProviderConfig {
  groqKey?: string
  openRouterKey?: string
  claudeKey?: string
  preferredProvider?: 'groq' | 'openrouter' | 'claude'
}

export class ProviderManager {
  private groqProvider: AIProvider | null = null
  private openRouterProvider: AIProvider | null = null
  private claudeProvider: AIProvider | null = null
  private mockProvider: AIProvider = new MockProvider()
  private preferredProvider: 'groq' | 'openrouter' | 'claude' = 'groq'
  private lastUsedProvider: string = ''

  constructor(config: ProviderConfig = {}) {
    this.updateConfig(config)
  }

  updateConfig(config: ProviderConfig): void {
    if (config.groqKey) {
      this.groqProvider = new GroqProvider(config.groqKey)
    }
    if (config.openRouterKey) {
      this.openRouterProvider = new OpenRouterProvider(config.openRouterKey)
    }
    if (config.claudeKey) {
      this.claudeProvider = new ClaudeProvider(config.claudeKey)
    }
    if (config.preferredProvider) {
      this.preferredProvider = config.preferredProvider
    }
  }

  async generate(input: string, systemPrompt?: string): Promise<string> {
    const providers = this.getAvailableProviders()

    if (providers.length === 0) {
      console.warn('[v0] No API keys configured, using Mock provider')
      this.lastUsedProvider = this.mockProvider.getName()
      return this.mockProvider.generate(input, systemPrompt)
    }

    // Try primary provider first
    const primaryProvider = providers.find((p) => p.name === this.preferredProvider)
    if (primaryProvider) {
      try {
        const result = await primaryProvider.provider.generate(input, systemPrompt)
        this.lastUsedProvider = primaryProvider.name
        return result
      } catch (error) {
        console.warn(`[v0] ${primaryProvider.name} failed:`, error)
      }
    }

    // Fallback to first available provider
    for (const { name, provider } of providers) {
      if (name !== this.preferredProvider) {
        try {
          const result = await provider.generate(input, systemPrompt)
          this.lastUsedProvider = name
          console.info(`[v0] Fell back to ${name}`)
          return result
        } catch (error) {
          console.warn(`[v0] ${name} failed:`, error)
        }
      }
    }

    // Final fallback to mock
    console.warn('[v0] All providers failed, using Mock provider')
    this.lastUsedProvider = this.mockProvider.getName()
    return this.mockProvider.generate(input, systemPrompt)
  }

  private getAvailableProviders(): Array<{ name: string; provider: AIProvider }> {
    const available: Array<{ name: string; provider: AIProvider }> = []
    if (this.groqProvider?.isAvailable()) available.push({ name: 'groq', provider: this.groqProvider })
    if (this.openRouterProvider?.isAvailable())
      available.push({ name: 'openrouter', provider: this.openRouterProvider })
    if (this.claudeProvider?.isAvailable()) available.push({ name: 'claude', provider: this.claudeProvider })
    return available
  }

  getLastUsedProvider(): string {
    return this.lastUsedProvider
  }

  getAvailableProviderNames(): string[] {
    return this.getAvailableProviders().map((p) => p.name)
  }

  isOfflineMode(): boolean {
    return this.getAvailableProviders().length === 0
  }
}

let providerManager: ProviderManager | null = null

export function initializeProviderManager(config: ProviderConfig): ProviderManager {
  providerManager = new ProviderManager(config)
  return providerManager
}

export function getProviderManager(): ProviderManager {
  if (!providerManager) {
    providerManager = new ProviderManager()
  }
  return providerManager
}

export function updateProviderConfig(config: ProviderConfig): void {
  getProviderManager().updateConfig(config)
}
