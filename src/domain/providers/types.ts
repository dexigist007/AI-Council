export type ProviderId = 'openai' | 'anthropic' | 'gemini' | 'deepseek' | 'kimi' | 'glm'
  | 'openrouter' | 'groq' | 'mistral' | 'cerebras' | 'ollama' | 'lmstudio'

export interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
}

export interface ChatRequest {
  model: string
  system?: string
  messages: ChatMessage[]
  maxTokens: number
  /** Omitted when undefined; several current models reject non-default values. */
  temperature?: number
  /** Ask for JSON matching this schema. Providers without schema support get JSON mode + the schema in the prompt. */
  responseSchema?: { name: string; schema: Record<string, unknown> }
  /** Mark the system prompt as cacheable where the provider needs explicit opt-in. */
  cacheSystem?: boolean
}

export interface Usage {
  input: number
  output: number
  cached: number
}

export interface ChatResponse {
  text: string
  usage: Usage
  finishReason: string | null
}

export interface ChatOptions {
  onDelta?: (text: string) => void
  /** Aborts the in-flight HTTP request; the promise rejects with CancelledError. */
  signal?: AbortSignal
}

export interface ProviderCapabilities {
  /** Native JSON-schema constrained output. */
  jsonSchema: boolean
}

export interface AIProvider {
  readonly id: ProviderId
  readonly capabilities: ProviderCapabilities
  chat(req: ChatRequest, opts?: ChatOptions): Promise<ChatResponse>
  listModels(): Promise<string[]>
}

// Transport = the Rust `ai_request` command. Injected so adapters can be tested without Tauri.
export interface TransportRequest {
  provider: ProviderId
  method: 'GET' | 'POST'
  path: string
  body?: unknown
  stream: boolean
}

export interface TransportResponse {
  status: number
  body: string | null
}

export type Transport = (
  req: TransportRequest,
  onData?: (data: string) => void,
  signal?: AbortSignal,
) => Promise<TransportResponse>

export class CancelledError extends Error {
  constructor() {
    super('cancelled')
    this.name = 'CancelledError'
  }
}

export type ProviderErrorKind = 'auth' | 'rate_limit' | 'bad_request' | 'server' | 'parse'

export class ProviderError extends Error {
  constructor(
    readonly provider: ProviderId,
    readonly kind: ProviderErrorKind,
    message: string,
    readonly status?: number,
  ) {
    super(`[${provider}] ${message}`)
    this.name = 'ProviderError'
  }

  /** Worth retrying later with the same request. */
  get retryable(): boolean {
    return this.kind === 'rate_limit' || this.kind === 'server'
  }
}
