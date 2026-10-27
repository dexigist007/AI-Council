import { AnthropicProvider } from './anthropic'
import { GeminiProvider } from './gemini'
import { OpenAIChatProvider } from './openaiChat'
import type { AIProvider, ProviderId, Transport } from './types'

export interface ProviderMeta {
  id: ProviderId
  label: string
  /** i18n key of a badge shown in Settings, so data-jurisdiction and free-tier terms are explicit. */
  note?: 'china' | 'ollama' | 'lmstudio' | 'openrouter' | 'freeTier' | 'mistral'
  keyUrl: string
  /** Local server without an API key (Ollama, LM Studio). */
  keyless?: boolean
  /** Who receives the data, shown in the consent dialog (cloud providers only). */
  operator?: string
  privacyUrl?: string
}

export const PROVIDERS: ProviderMeta[] = [
  { id: 'ollama', label: 'Ollama', note: 'ollama', keyUrl: 'https://ollama.com/download', keyless: true },
  { id: 'lmstudio', label: 'LM Studio', note: 'lmstudio', keyUrl: 'https://lmstudio.ai', keyless: true },
  { id: 'openrouter', label: 'OpenRouter', note: 'openrouter', keyUrl: 'https://openrouter.ai/keys', operator: 'OpenRouter (USA), which forwards to the model provider', privacyUrl: 'https://openrouter.ai/privacy' },
  { id: 'groq', label: 'Groq', note: 'freeTier', keyUrl: 'https://console.groq.com/keys', operator: 'Groq (USA)', privacyUrl: 'https://groq.com/privacy-policy/' },
  { id: 'mistral', label: 'Mistral', note: 'mistral', keyUrl: 'https://console.mistral.ai/api-keys', operator: 'Mistral AI (France)', privacyUrl: 'https://mistral.ai/terms' },
  { id: 'cerebras', label: 'Cerebras', note: 'freeTier', keyUrl: 'https://cloud.cerebras.ai', operator: 'Cerebras (USA)', privacyUrl: 'https://www.cerebras.ai/privacy-policy' },
  { id: 'openai', label: 'OpenAI', keyUrl: 'https://platform.openai.com/api-keys', operator: 'OpenAI (USA)', privacyUrl: 'https://openai.com/policies/privacy-policy/' },
  { id: 'anthropic', label: 'Anthropic (Claude)', keyUrl: 'https://console.anthropic.com/settings/keys', operator: 'Anthropic (USA)', privacyUrl: 'https://www.anthropic.com/legal/privacy' },
  { id: 'gemini', label: 'Google Gemini', keyUrl: 'https://aistudio.google.com/apikey', operator: 'Google (USA)', privacyUrl: 'https://policies.google.com/privacy' },
  { id: 'deepseek', label: 'DeepSeek', note: 'china', keyUrl: 'https://platform.deepseek.com/api_keys', operator: 'DeepSeek (China)', privacyUrl: 'https://www.deepseek.com/' },
  { id: 'kimi', label: 'Kimi (Moonshot)', note: 'china', keyUrl: 'https://platform.moonshot.ai/console/api-keys', operator: 'Moonshot AI (China)', privacyUrl: 'https://www.moonshot.ai/' },
  { id: 'glm', label: 'GLM (Z.ai)', note: 'china', keyUrl: 'https://z.ai/manage-apikey/apikey-list', operator: 'Zhipu AI / Z.ai (China)', privacyUrl: 'https://z.ai/' },
]

/** The only place that knows which adapter serves which provider. */
export function createProvider(id: ProviderId, transport: Transport): AIProvider {
  switch (id) {
    case 'anthropic':
      return new AnthropicProvider(transport)
    case 'gemini':
      return new GeminiProvider(transport)
    case 'openai':
    case 'lmstudio': // LM Studio rejects json_object but supports json_schema
      return new OpenAIChatProvider(id, { jsonSchema: true }, transport)
    case 'deepseek':
    case 'kimi':
    case 'glm':
    case 'openrouter':
    case 'groq':
    case 'mistral':
    case 'cerebras':
    case 'ollama':
      return new OpenAIChatProvider(id, { jsonSchema: false }, transport)
  }
}

export const isKeyless = (id: ProviderId): boolean => PROVIDERS.find((p) => p.id === id)?.keyless === true
