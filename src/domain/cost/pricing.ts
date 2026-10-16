import type { ModelPrice } from '@/db/repositories/modelPrices'
import type { ProviderId, Usage } from '@/domain/providers/types'

export type PriceLookup = (provider: ProviderId, model: string) => ModelPrice | undefined

export function priceLookup(prices: ModelPrice[]): PriceLookup {
  const byKey = new Map(prices.map((p) => [`${p.provider}/${p.model}`, p]))
  return (provider, model) =>
    byKey.get(`${provider}/${model}`) ??
    // Local models and OpenRouter ":free" models cost nothing; no need to enter a price.
    (provider === 'ollama' || provider === 'lmstudio' || model.endsWith(':free')
      ? { provider, model, inPerMtok: 0, outPerMtok: 0, cachedPerMtok: null }
      : undefined)
}

/** Cost in USD, or null when the model has no price entry (shown as "unpriced", never as $0). */
export function costOf(price: ModelPrice | undefined, usage: Usage): number | null {
  if (!price) return null
  const fresh = Math.max(0, usage.input - usage.cached)
  const cachedRate = price.cachedPerMtok ?? price.inPerMtok
  return (fresh * price.inPerMtok + usage.cached * cachedRate + usage.output * price.outPerMtok) / 1_000_000
}

/** Rough token estimate for budgeting before a call: ~4 characters per token. */
export const estimateTokens = (text: string): number => Math.ceil(text.length / 4)
