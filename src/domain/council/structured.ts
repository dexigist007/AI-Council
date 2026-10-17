import type { z } from 'zod'
import { render, type RenderedPrompt } from '@/domain/prompts/registry'
import { CancelledError, ProviderError, type AIProvider, type ChatMessage, type Usage } from '@/domain/providers/types'
import { toJsonSchema } from './schemas'

/** One provider call, successful or not; every attempt is persisted. */
export interface CallRecord {
  prompt: RenderedPrompt
  text: string | null
  json: unknown
  usage: Usage
  latencyMs: number
  error: string | null
}

export interface StructuredRequest {
  provider: AIProvider
  model: string
  maxTokens: number
  temperature?: number
  system: RenderedPrompt
  user: string
  schemaName: string
  signal?: AbortSignal
  /** Streamed reply text, for live display only; `attempt` restarts at each new call. */
  onDelta?: (text: string, attempt: number) => void
}

export interface StructuredResult<T> {
  data: T | null
  calls: CallRecord[]
  error: string | null
}

const EMPTY_USAGE: Usage = { input: 0, output: 0, cached: 0 }

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** Extracts the JSON object from a reply, tolerating code fences or stray prose around it. */
export function extractJson(text: string): unknown {
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start === -1 || end < start) throw new Error('no JSON object in reply')
  return JSON.parse(text.slice(start, end + 1))
}

function issues(err: z.ZodError): string {
  return err.issues.slice(0, 10).map((i) => `- ${i.path.join('.') || '(root)'}: ${i.message}`).join('\n')
}

/**
 * Calls a model for JSON matching `schema`. Retries once on transient provider errors and asks the
 * model once to repair invalid output. Never throws for model/provider failures (only cancellation);
 * the caller decides whether a missing result is fatal.
 */
export async function callStructured<T>(
  req: StructuredRequest,
  schema: z.ZodType<T>,
  opts: { retryDelayMs?: number } = {},
): Promise<StructuredResult<T>> {
  const calls: CallRecord[] = []
  const messages: ChatMessage[] = [{ role: 'user', content: req.user }]
  const jsonSchema = toJsonSchema(schema)
  let prompt = req.system
  let lastError = 'no attempt'

  for (let attempt = 0; attempt < 3; attempt++) {
    const started = performance.now()
    let text: string
    let usage: Usage
    try {
      const res = await req.provider.chat(
        {
          model: req.model,
          system: req.system.text,
          messages,
          maxTokens: req.maxTokens,
          temperature: req.temperature,
          responseSchema: { name: req.schemaName, schema: jsonSchema },
          cacheSystem: true,
        },
        { signal: req.signal, onDelta: req.onDelta && ((t) => req.onDelta!(t, attempt)) },
      )
      text = res.text
      usage = res.usage
      if (res.finishReason === 'max_tokens' || res.finishReason === 'length' || res.finishReason === 'MAX_TOKENS') {
        lastError = `reply cut off at max tokens (${req.maxTokens})`
        calls.push({ prompt, text, json: null, usage, latencyMs: performance.now() - started, error: lastError })
        return { data: null, calls, error: lastError }
      }
    } catch (e) {
      if (e instanceof CancelledError) throw e
      lastError = e instanceof Error ? e.message : String(e)
      calls.push({ prompt, text: null, json: null, usage: EMPTY_USAGE, latencyMs: performance.now() - started, error: lastError })
      const transient = e instanceof ProviderError && e.retryable
      if (transient && attempt === 0) {
        await sleep(opts.retryDelayMs ?? 3000)
        continue
      }
      return { data: null, calls, error: lastError }
    }

    let parsed: unknown = null
    try {
      parsed = extractJson(text)
      const result = schema.safeParse(parsed)
      if (result.success) {
        calls.push({ prompt, text, json: result.data, usage, latencyMs: performance.now() - started, error: null })
        return { data: result.data, calls, error: null }
      }
      lastError = issues(result.error)
    } catch (e) {
      lastError = e instanceof Error ? e.message : String(e)
    }
    calls.push({ prompt, text, json: parsed, usage, latencyMs: performance.now() - started, error: `invalid output: ${lastError}` })
    if (prompt.id === 'json-repair') break

    // One repair round: show the model its reply and what was wrong.
    prompt = render('json-repair', { errors: lastError })
    messages.push({ role: 'assistant', content: text }, { role: 'user', content: prompt.text })
  }
  return { data: null, calls, error: lastError }
}
