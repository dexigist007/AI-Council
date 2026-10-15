import { repos } from '@/db'
import { priceLookup } from '@/domain/cost/pricing'
import { createProvider } from '@/domain/providers/registry'
import { tauriTransport } from '@/platform/tauri'
import type { CouncilDeps } from './engine'

/** Wires the council engine to the real database, prices and the Tauri transport. */
export async function councilDeps(): Promise<CouncilDeps> {
  const r = await repos()
  return {
    provider: (id) => createProvider(id, tauriTransport),
    sessions: r.sessions,
    price: priceLookup(await r.modelPrices.list()),
  }
}
