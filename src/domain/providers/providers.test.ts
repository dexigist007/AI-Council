import { describe, expect, it } from 'vitest'
import { createProvider } from './registry'
import { ProviderError, type Transport, type TransportRequest } from './types'

/** Fake transport: records the request and replays SSE data payloads. */
function fake(events: unknown[], status = 200, body: string | null = null) {
  const calls: TransportRequest[] = []
  const transport: Transport = async (req, onData) => {
    calls.push(req)
    if (status === 200 && req.stream) for (const e of events) onData?.(typeof e === 'string' ? e : JSON.stringify(e))
    return { status, body }
  }
  return { transport, calls }
}

const schema = { name: 'r', schema: { type: 'object', properties: { ok: { type: 'boolean' } } } }

describe('OpenAI-compatible', () => {
  it('streams text and usage, uses native schema on OpenAI', async () => {
    const { transport, calls } = fake([
      { choices: [{ delta: { content: 'Hel' } }] },
      { choices: [{ delta: { content: 'lo' }, finish_reason: 'stop' }] },
      { choices: [], usage: { prompt_tokens: 10, completion_tokens: 2, prompt_tokens_details: { cached_tokens: 4 } } },
      '[DONE]',
    ])
    const deltas: string[] = []
    const res = await createProvider('openai', transport).chat(
      { model: 'm', system: 'sys', messages: [{ role: 'user', content: 'hi' }], maxTokens: 50, responseSchema: schema },
      { onDelta: (d) => deltas.push(d) },
    )
    expect(res).toEqual({ text: 'Hello', finishReason: 'stop', usage: { input: 10, output: 2, cached: 4 } })
    expect(deltas).toEqual(['Hel', 'lo'])
    const body = calls[0]!.body as Record<string, any>
    expect(calls[0]).toMatchObject({ provider: 'openai', path: '/chat/completions', stream: true })
    expect(body.max_completion_tokens).toBe(50)
    expect(body.temperature).toBeUndefined()
    expect(body.response_format.type).toBe('json_schema')
    expect(body.messages[0]).toEqual({ role: 'system', content: 'sys' })
  })

  it('falls back to JSON mode plus prompt schema on DeepSeek', async () => {
    const { transport, calls } = fake(['[DONE]'])
    await createProvider('deepseek', transport).chat({ model: 'm', messages: [], maxTokens: 5, temperature: 0.2, responseSchema: schema })
    const body = calls[0]!.body as Record<string, any>
    expect(body.response_format).toEqual({ type: 'json_object' })
    expect(body.max_tokens).toBe(5)
    expect(body.temperature).toBe(0.2)
    expect(body.messages[0].content).toContain('JSON Schema')
  })

  it('maps HTTP errors to typed ProviderError', async () => {
    const { transport } = fake([], 429, '{"error":{"message":"slow down"}}')
    const err = await createProvider('kimi', transport).chat({ model: 'm', messages: [], maxTokens: 5 }).catch((e) => e)
    expect(err).toBeInstanceOf(ProviderError)
    expect(err).toMatchObject({ kind: 'rate_limit', status: 429, retryable: true })
    expect(err.message).toContain('slow down')
  })
})

describe('Anthropic', () => {
  it('parses message events, skips thinking, never sends temperature', async () => {
    const { transport, calls } = fake([
      { type: 'message_start', message: { usage: { input_tokens: 5, cache_read_input_tokens: 100, cache_creation_input_tokens: 0 } } },
      { type: 'content_block_delta', delta: { type: 'thinking_delta', thinking: '...' } },
      { type: 'content_block_delta', delta: { type: 'text_delta', text: '{"ok":true}' } },
      { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 7 } },
      { type: 'message_stop' },
    ])
    const res = await createProvider('anthropic', transport).chat({
      model: 'claude-opus-5-5', system: 's', cacheSystem: true, messages: [{ role: 'user', content: 'x' }],
      maxTokens: 100, temperature: 0.7, responseSchema: schema,
    })
    expect(res).toEqual({ text: '{"ok":true}', finishReason: 'end_turn', usage: { input: 105, output: 7, cached: 100 } })
    const body = calls[0]!.body as Record<string, any>
    expect(body.temperature).toBeUndefined()
    expect(body.system[0].cache_control).toEqual({ type: 'ephemeral' })
    expect(body.output_config.format.type).toBe('json_schema')
  })

  it('treats refusal and stream errors as failures', async () => {
    const refusal = fake([{ type: 'message_delta', delta: { stop_reason: 'refusal' } }])
    await expect(createProvider('anthropic', refusal.transport).chat({ model: 'm', messages: [], maxTokens: 5 }))
      .rejects.toThrow(/refusal/)
    const overloaded = fake([{ type: 'error', error: { type: 'overloaded_error', message: 'busy' } }])
    const err = await createProvider('anthropic', overloaded.transport).chat({ model: 'm', messages: [], maxTokens: 5 }).catch((e) => e)
    expect(err).toMatchObject({ kind: 'server' })
  })
})

describe('Gemini', () => {
  it('maps roles, skips thought parts and counts thinking as output', async () => {
    const { transport, calls } = fake([
      { candidates: [{ content: { parts: [{ text: 'hmm', thought: true }, { text: 'A' }] } }] },
      { candidates: [{ content: { parts: [{ text: 'B' }] }, finishReason: 'STOP' }],
        usageMetadata: { promptTokenCount: 9, candidatesTokenCount: 2, thoughtsTokenCount: 3, cachedContentTokenCount: 1 } },
    ])
    const res = await createProvider('gemini', transport).chat({
      model: 'gemini-x', system: 's', maxTokens: 10,
      messages: [{ role: 'user', content: 'q' }, { role: 'assistant', content: 'a' }],
    })
    expect(res).toEqual({ text: 'AB', finishReason: 'STOP', usage: { input: 9, output: 5, cached: 1 } })
    const body = calls[0]!.body as Record<string, any>
    expect(calls[0]!.path).toBe('/models/gemini-x:streamGenerateContent?alt=sse')
    expect(body.contents.map((c: any) => c.role)).toEqual(['user', 'model'])
    expect(body.systemInstruction.parts[0].text).toBe('s')
  })

  it('lists generation-capable models without the models/ prefix', async () => {
    const body = JSON.stringify({ models: [
      { name: 'models/gemini-b', supportedGenerationMethods: ['generateContent'] },
      { name: 'models/embed', supportedGenerationMethods: ['embedContent'] },
    ] })
    const { transport } = fake([], 200, body)
    expect(await createProvider('gemini', transport).listModels()).toEqual(['gemini-b'])
  })
})
