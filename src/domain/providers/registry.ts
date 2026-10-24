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
}

export const PROVIDERS: ProviderMeta[] = [
  { id: 'ollama', label: 'Ollama', note: 'ollama', keyUrl: 'https://ollama.com/download', keyless: true },
  { id: 'lmstudio', label: 'LM Studio', note: 'lmstudio', keyUrl: 'https://lmstudio.ai', keyless: true },
  { id: 'openrouter', label: 'OpenRouter', note: 'openrouter', keyUrl: 'https://openrouter.ai/keys' },
  { id: 'groq', label: 'Groq', note: 'freeTier', keyUrl: 'https://console.groq.com/keys' },
  { id: 'mistral', label: 'Mistral', note: 'mistral', keyUrl: 'https://console.mistral.ai/api-keys' },
  { id: 'cerebras', label: 'Cerebras', note: 'freeTier', keyUrl: 'https://cloud.cerebras.ai' },
  { id: 'openai', label: 'OpenAI', keyUrl: 'https://platform.openai.com/api-keys' },
  { id: 'anthropic', label: 'Anthropic (Claude)', keyUrl: 'https://console.anthropic.com/settings/keys' },
  { id: 'gemini', label: 'Google Gemini', keyUrl: 'https://aistudio.google.com/apikey' },
  { id: 'deepseek', label: 'DeepSeek', note: 'china', keyUrl: 'https://platform.deepseek.com/api_keys' },
  { id: 'kimi', label: 'Kimi (Moonshot)', note: 'china', keyUrl: 'https://platform.moonshot.ai/console/api-keys' },
  { id: 'glm', label: 'GLM (Z.ai)', note: 'china', keyUrl: 'https://z.ai/manage-apikey/apikey-list' },
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
