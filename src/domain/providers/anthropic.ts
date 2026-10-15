import { parseEvent, send } from './http'
import { ProviderError, type AIProvider, type ChatOptions, type ChatRequest, type ChatResponse, type Transport } from './types'

type AnthropicEvent =
  | { type: 'message_start'; message: { usage: { input_tokens?: number; cache_read_input_tokens?: number; cache_creation_input_tokens?: number } } }
  | { type: 'content_block_delta'; delta: { type: string; text?: string } }
  | { type: 'message_delta'; delta: { stop_reason?: string | null }; usage?: { output_tokens?: number } }
  | { type: 'error'; error: { type: string; message: string } }
  | { type: string }

/** Messages API. Sampling parameters are never sent: current Claude models reject them. */
export class AnthropicProvider implements AIProvider {
  readonly id = 'anthropic' as const
  readonly capabilities = { jsonSchema: true }

  constructor(private readonly transport: Transport) {}

  async chat(req: ChatRequest, opts: ChatOptions = {}): Promise<ChatResponse> {
    const body: Record<string, unknown> = {
      model: req.model,
      max_tokens: req.maxTokens,
      messages: req.messages,
      stream: true,
    }
    if (req.system) {
      body.system = [{ type: 'text', text: req.system, ...(req.cacheSystem ? { cache_control: { type: 'ephemeral' } } : {}) }]
    }
    if (req.responseSchema) {
      body.output_config = { format: { type: 'json_schema', schema: req.responseSchema.schema } }
    }

    let text = ''
    let finishReason: string | null = null
    const usage = { input: 0, output: 0, cached: 0 }
    await send(this.transport, { provider: this.id, method: 'POST', path: '/messages', body, stream: true }, (data) => {
      const ev = parseEvent<AnthropicEvent>(this.id, data)
      if (ev.type === 'message_start' && 'message' in ev) {
        const u = ev.message.usage
        // input_tokens excludes cached tokens; report total input with cached as a subset.
        usage.cached = u.cache_read_input_tokens ?? 0
        usage.input = (u.input_tokens ?? 0) + usage.cached + (u.cache_creation_input_tokens ?? 0)
      } else if (ev.type === 'content_block_delta' && 'delta' in ev) {
        // Thinking deltas are skipped; only visible text is part of the answer.
        if (ev.delta.type === 'text_delta' && ev.delta.text) {
          text += ev.delta.text
          opts.onDelta?.(ev.delta.text)
        }
      } else if (ev.type === 'message_delta' && 'delta' in ev) {
        finishReason = ev.delta.stop_reason ?? finishReason
        if (ev.usage?.output_tokens !== undefined) usage.output = ev.usage.output_tokens
      } else if (ev.type === 'error' && 'error' in ev) {
        throw new ProviderError(this.id, ev.error.type === 'overloaded_error' ? 'server' : 'bad_request', ev.error.message)
      }
    }, opts.signal)
    if (finishReason === 'refusal') throw new ProviderError(this.id, 'bad_request', 'model declined the request (refusal)')
    return { text, usage, finishReason }
  }

  async listModels(): Promise<string[]> {
    const body = await send(this.transport, { provider: this.id, method: 'GET', path: '/models?limit=100', stream: false })
    const j = parseEvent<{ data?: { id: string }[] }>(this.id, body ?? '{}')
    return (j.data ?? []).map((m) => m.id)
  }
}
