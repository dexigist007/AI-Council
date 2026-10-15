import { parseEvent, send } from './http'
import type { AIProvider, ChatOptions, ChatRequest, ChatResponse, Transport } from './types'

interface GeminiChunk {
  candidates?: { content?: { parts?: { text?: string; thought?: boolean }[] }; finishReason?: string }[]
  usageMetadata?: {
    promptTokenCount?: number
    candidatesTokenCount?: number
    thoughtsTokenCount?: number
    cachedContentTokenCount?: number
  }
}

export class GeminiProvider implements AIProvider {
  readonly id = 'gemini' as const
  readonly capabilities = { jsonSchema: true }

  constructor(private readonly transport: Transport) {}

  async chat(req: ChatRequest, opts: ChatOptions = {}): Promise<ChatResponse> {
    const generationConfig: Record<string, unknown> = { maxOutputTokens: req.maxTokens }
    if (req.temperature !== undefined) generationConfig.temperature = req.temperature
    if (req.responseSchema) {
      generationConfig.responseMimeType = 'application/json'
      generationConfig.responseJsonSchema = req.responseSchema.schema
    }
    const body: Record<string, unknown> = {
      contents: req.messages.map((m) => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] })),
      generationConfig,
    }
    if (req.system) body.systemInstruction = { parts: [{ text: req.system }] }

    let text = ''
    let finishReason: string | null = null
    const usage = { input: 0, output: 0, cached: 0 }
    const path = `/models/${encodeURIComponent(req.model)}:streamGenerateContent?alt=sse`
    await send(this.transport, { provider: this.id, method: 'POST', path, body, stream: true }, (data) => {
      const ev = parseEvent<GeminiChunk>(this.id, data)
      const cand = ev.candidates?.[0]
      for (const part of cand?.content?.parts ?? []) {
        if (part.text && !part.thought) {
          text += part.text
          opts.onDelta?.(part.text)
        }
      }
      if (cand?.finishReason) finishReason = cand.finishReason
      const u = ev.usageMetadata
      if (u) {
        usage.input = u.promptTokenCount ?? 0
        // Thinking tokens are billed as output.
        usage.output = (u.candidatesTokenCount ?? 0) + (u.thoughtsTokenCount ?? 0)
        usage.cached = u.cachedContentTokenCount ?? 0
      }
    })
    return { text, usage, finishReason }
  }

  async listModels(): Promise<string[]> {
    const body = await send(this.transport, { provider: this.id, method: 'GET', path: '/models?pageSize=1000', stream: false })
    const j = parseEvent<{ models?: { name: string; supportedGenerationMethods?: string[] }[] }>(this.id, body ?? '{}')
    return (j.models ?? [])
      .filter((m) => m.supportedGenerationMethods?.includes('generateContent') ?? true)
      .map((m) => m.name.replace(/^models\//, ''))
      .sort()
  }
}
