import { AnthropicProvider } from './anthropic'
import { GeminiProvider } from './gemini'
import { OpenAIChatProvider } from './openaiChat'
import type { AIProvider, ProviderId, Transport } from './types'

export interface ProviderMeta {
  id: ProviderId
  label: string
  /** Shown in Settings so data-jurisdiction choices are explicit. */
  note?: string
  keyUrl: string
}

export const PROVIDERS: ProviderMeta[] = [
  { id: 'openai', label: 'OpenAI', keyUrl: 'https://platform.openai.com/api-keys' },
  { id: 'anthropic', label: 'Anthropic (Claude)', keyUrl: 'https://console.anthropic.com/settings/keys' },
  { id: 'gemini', label: 'Google Gemini', keyUrl: 'https://aistudio.google.com/apikey' },
  { id: 'deepseek', label: 'DeepSeek', note: 'Çin merkezli servis', keyUrl: 'https://platform.deepseek.com/api_keys' },
  { id: 'kimi', label: 'Kimi (Moonshot)', note: 'Çin merkezli servis', keyUrl: 'https://platform.moonshot.ai/console/api-keys' },
  { id: 'glm', label: 'GLM (Z.ai)', note: 'Çin merkezli servis', keyUrl: 'https://z.ai/manage-apikey/apikey-list' },
]

/** The only place that knows which adapter serves which provider. */
export function createProvider(id: ProviderId, transport: Transport): AIProvider {
  switch (id) {
    case 'anthropic':
      return new AnthropicProvider(transport)
    case 'gemini':
      return new GeminiProvider(transport)
    case 'openai':
      return new OpenAIChatProvider(id, { jsonSchema: true }, transport)
    case 'deepseek':
    case 'kimi':
    case 'glm':
      return new OpenAIChatProvider(id, { jsonSchema: false }, transport)
  }
}
