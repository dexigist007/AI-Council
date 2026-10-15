import type { ProviderId } from '@/domain/providers/types'
import type { Db } from '../types'
import { fromBool, toBool } from '../util'

/** Non-secret provider settings. The API key lives in the OS keychain, never here. */
export interface ProviderConfig {
  provider: ProviderId
  enabled: boolean
  defaultModel: string | null
  temperature: number | null
  maxTokens: number | null
}

interface Row {
  provider: ProviderId
  enabled: number
  default_model: string | null
  temperature: number | null
  max_tokens: number | null
}

const map = (r: Row): ProviderConfig => ({
  provider: r.provider,
  enabled: toBool(r.enabled),
  defaultModel: r.default_model,
  temperature: r.temperature,
  maxTokens: r.max_tokens,
})

export const defaultProviderConfig = (provider: ProviderId): ProviderConfig => ({
  provider, enabled: false, defaultModel: null, temperature: null, maxTokens: null,
})

export function providerConfigsRepo(db: Db) {
  return {
    async list(): Promise<ProviderConfig[]> {
      return (await db.select<Row>('SELECT * FROM provider_configs')).map(map)
    },

    async save(c: ProviderConfig): Promise<void> {
      await db.execute(
        `INSERT INTO provider_configs (provider, enabled, default_model, temperature, max_tokens)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT (provider) DO UPDATE SET enabled = excluded.enabled, default_model = excluded.default_model,
           temperature = excluded.temperature, max_tokens = excluded.max_tokens`,
        [c.provider, fromBool(c.enabled), c.defaultModel?.trim() || null, c.temperature, c.maxTokens],
      )
    },
  }
}
