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
  /** Local server without an API key (Ollama, LM Studio). */
  keyless?: boolean
}

export const PROVIDERS: ProviderMeta[] = [
  { id: 'openai', label: 'OpenAI', keyUrl: 'https://platform.openai.com/api-keys' },
  { id: 'anthropic', label: 'Anthropic (Claude)', keyUrl: 'https://console.anthropic.com/settings/keys' },
  { id: 'gemini', label: 'Google Gemini', keyUrl: 'https://aistudio.google.com/apikey' },
  { id: 'deepseek', label: 'DeepSeek', note: 'Çin merkezli servis', keyUrl: 'https://platform.deepseek.com/api_keys' },
  { id: 'kimi', label: 'Kimi (Moonshot)', note: 'Çin merkezli servis', keyUrl: 'https://platform.moonshot.ai/console/api-keys' },
  { id: 'ollama', label: 'Ollama (yerel)', note: 'Ücretsiz, bu bilgisayarda çalışır; veri dışarı çıkmaz', keyUrl: 'https://ollama.com/download', keyless: true },
  { id: 'lmstudio', label: 'LM Studio (yerel)', note: 'Ücretsiz, bu bilgisayarda çalışır; Developer sekmesinden sunucuyu başlat', keyUrl: 'https://lmstudio.ai', keyless: true },
  { id: 'openrouter', label: 'OpenRouter', note: '":free" ile biten modeller ücretsiz; ücretsiz modeller veriyi eğitimde kullanabilir', keyUrl: 'https://openrouter.ai/keys' },
  { id: 'groq', label: 'Groq', note: 'Ücretsiz katman (hız limitli)', keyUrl: 'https://console.groq.com/keys' },
  { id: 'mistral', label: 'Mistral', note: 'Ücretsiz deneme katmanı; veri eğitimde kullanılabilir', keyUrl: 'https://console.mistral.ai/api-keys' },
  { id: 'cerebras', label: 'Cerebras', note: 'Ücretsiz katman (hız limitli)', keyUrl: 'https://cloud.cerebras.ai' },
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
