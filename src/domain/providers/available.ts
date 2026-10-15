import { repos } from '@/db'
import { secrets } from '@/platform/tauri'
import { PROVIDERS } from './registry'
import type { ProviderId } from './types'

/** A model the user can pick: enabled provider, key in the keychain, default model chosen. */
export interface ModelSlot {
  key: string
  label: string
  provider: ProviderId
  model: string
  maxTokens: number | null
  temperature: number | null
}

export async function loadModelSlots(): Promise<ModelSlot[]> {
  const configs = (await (await repos()).providerConfigs.list()).filter((c) => c.enabled && c.defaultModel)
  const withKey = await Promise.all(configs.map(async (c) => ((await secrets.exists(c.provider).catch(() => false)) ? c : null)))
  return withKey
    .filter((c) => c !== null)
    .map((c) => ({
      key: `${c.provider}/${c.defaultModel}`,
      label: `${PROVIDERS.find((p) => p.id === c.provider)?.label ?? c.provider} · ${c.defaultModel}`,
      provider: c.provider,
      model: c.defaultModel!,
      maxTokens: c.maxTokens,
      temperature: c.temperature,
    }))
}
