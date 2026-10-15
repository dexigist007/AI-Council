import { ProviderError, type ProviderErrorKind, type ProviderId, type Transport, type TransportRequest } from './types'

function kindFor(status: number): ProviderErrorKind {
  if (status === 401 || status === 403) return 'auth'
  if (status === 429) return 'rate_limit'
  if (status >= 500) return 'server'
  return 'bad_request'
}

function errorMessage(body: string | null): string {
  if (!body) return 'empty response'
  try {
    const j = JSON.parse(body) as { error?: { message?: string } | string; message?: string }
    if (typeof j.error === 'string') return j.error
    return j.error?.message ?? j.message ?? body.slice(0, 500)
  } catch {
    return body.slice(0, 500)
  }
}

/** Sends a request and turns non-2xx responses into ProviderError. */
export async function send(
  transport: Transport,
  req: TransportRequest,
  onData?: (data: string) => void,
): Promise<string | null> {
  const res = await transport(req, onData)
  if (res.status < 200 || res.status >= 300) {
    throw new ProviderError(req.provider, kindFor(res.status), errorMessage(res.body), res.status)
  }
  return res.body
}

export function parseEvent<T>(provider: ProviderId, data: string): T {
  try {
    return JSON.parse(data) as T
  } catch {
    throw new ProviderError(provider, 'parse', `invalid stream event: ${data.slice(0, 200)}`)
  }
}

export function jsonInstruction(schema: Record<string, unknown>): string {
  return `Respond with a single JSON object only, no prose or code fences, matching this JSON Schema:\n${JSON.stringify(schema)}`
}
