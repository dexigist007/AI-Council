import { jsonInstruction, parseEvent, send } from './http'
import type { AIProvider, ChatOptions, ChatRequest, ChatResponse, ProviderCapabilities, ProviderId, Transport } from './types'

interface ChunkEvent {
  choices?: { delta?: { content?: string | null }; finish_reason?: string | null }[]
  usage?: { prompt_tokens?: number; completion_tokens?: number; prompt_tokens_details?: { cached_tokens?: number } }
}

/**
 * Chat Completions API. Serves OpenAI and the OpenAI-compatible providers (DeepSeek, Kimi, GLM);
 * they differ only in endpoint (fixed in Rust) and capabilities.
 */
export class OpenAIChatProvider implements AIProvider {
  constructor(
    readonly id: ProviderId,
    readonly capabilities: ProviderCapabilities,
    private readonly transport: Transport,
  ) {}

  async chat(req: ChatRequest, opts: ChatOptions = {}): Promise<ChatResponse> {
    let system = req.system ?? ''
    let responseFormat: unknown
    if (req.responseSchema) {
      if (this.capabilities.jsonSchema) {
        responseFormat = { type: 'json_schema', json_schema: { name: req.responseSchema.name, schema: req.responseSchema.schema } }
      } else {
        responseFormat = { type: 'json_object' }
        system = [system, jsonInstruction(req.responseSchema.schema)].filter(Boolean).join('\n\n')
      }
    }

    const body: Record<string, unknown> = {
      model: req.model,
      messages: [...(system ? [{ role: 'system', content: system }] : []), ...req.messages],
      // OpenAI's newer models only accept max_completion_tokens; compatible APIs use max_tokens.
      [this.id === 'openai' ? 'max_completion_tokens' : 'max_tokens']: req.maxTokens,
      stream: true,
      stream_options: { include_usage: true },
    }
    if (req.temperature !== undefined) body.temperature = req.temperature
    if (responseFormat) body.response_format = responseFormat

    let text = ''
    let finishReason: string | null = null
    const usage = { input: 0, output: 0, cached: 0 }
    await send(this.transport, { provider: this.id, method: 'POST', path: '/chat/completions', body, stream: true }, (data) => {
      if (data === '[DONE]') return
      const ev = parseEvent<ChunkEvent>(this.id, data)
      const choice = ev.choices?.[0]
      const delta = choice?.delta?.content
      if (delta) {
        text += delta
        opts.onDelta?.(delta)
      }
      if (choice?.finish_reason) finishReason = choice.finish_reason
      if (ev.usage) {
        usage.input = ev.usage.prompt_tokens ?? 0
        usage.output = ev.usage.completion_tokens ?? 0
        usage.cached = ev.usage.prompt_tokens_details?.cached_tokens ?? 0
      }
    })
    return { text, usage, finishReason }
  }

  async listModels(): Promise<string[]> {
    const body = await send(this.transport, { provider: this.id, method: 'GET', path: '/models', stream: false })
    const j = parseEvent<{ data?: { id: string }[] }>(this.id, body ?? '{}')
    return (j.data ?? []).map((m) => m.id).sort()
  }
}
