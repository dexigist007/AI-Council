import { repos } from '@/db'
import { isKeyless } from '@/domain/providers/registry'
import type { ProviderId } from '@/domain/providers/types'

/**
 * Explicit permission per cloud provider before any request carries the user's data
 * (App Store guideline 5.1.2(i)). Local servers (Ollama, LM Studio) never need it.
 */
export const CONSENT_KEY = 'ai_consent'

let cache: Partial<Record<ProviderId, string>> | null = null

async function load(): Promise<Partial<Record<ProviderId, string>>> {
  if (!cache) {
    const raw = await (await repos()).settings.get(CONSENT_KEY)
    cache = raw && typeof raw === 'object' ? (raw as Partial<Record<ProviderId, string>>) : {}
  }
  return cache
}

async function save(next: Partial<Record<ProviderId, string>>) {
  cache = next
  await (await repos()).settings.set(CONSENT_KEY, next)
}

export const needsConsent = (id: ProviderId) => !isKeyless(id)

/** Granted providers with the time of consent. */
export async function consents(): Promise<Partial<Record<ProviderId, string>>> {
  return { ...(await load()) }
}

/** Providers among `ids` that still need the user's permission. */
export async function missingConsent(ids: ProviderId[]): Promise<ProviderId[]> {
  const granted = await load()
  return [...new Set(ids)].filter((id) => needsConsent(id) && !granted[id])
}

export async function grantConsent(ids: ProviderId[]): Promise<void> {
  const now = new Date().toISOString()
  await save({ ...(await load()), ...Object.fromEntries(ids.map((id) => [id, now])) })
}

export async function revokeConsent(id: ProviderId): Promise<void> {
  const next = { ...(await load()) }
  delete next[id]
  await save(next)
}

export async function clearConsents(): Promise<void> {
  await save({})
}

export class ConsentRequiredError extends Error {
  constructor(readonly provider: ProviderId) {
    super(`permission to send data to ${provider} has not been given`)
    this.name = 'ConsentRequiredError'
  }
}

/** Last line of defence in the transport: refuse to send data without permission. */
export async function assertConsent(id: ProviderId): Promise<void> {
  if ((await missingConsent([id])).length) throw new ConsentRequiredError(id)
}
