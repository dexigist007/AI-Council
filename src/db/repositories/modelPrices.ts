import type { ProviderId } from '@/domain/providers/types'
import type { Db } from '../types'

/** USD per million tokens. Maintained by the user in Settings; prices change too often to hardcode. */
export interface ModelPrice {
  provider: ProviderId
  model: string
  inPerMtok: number
  outPerMtok: number
  /** Price of cache-read input tokens; falls back to inPerMtok when null. */
  cachedPerMtok: number | null
}

interface Row {
  provider: ProviderId
  model: string
  in_per_mtok: number
  out_per_mtok: number
  cached_per_mtok: number | null
}

const map = (r: Row): ModelPrice => ({
  provider: r.provider,
  model: r.model,
  inPerMtok: r.in_per_mtok,
  outPerMtok: r.out_per_mtok,
  cachedPerMtok: r.cached_per_mtok,
})

export function modelPricesRepo(db: Db) {
  return {
    async list(): Promise<ModelPrice[]> {
      return (await db.select<Row>('SELECT * FROM model_prices ORDER BY provider, model')).map(map)
    },

    async save(p: ModelPrice): Promise<void> {
      await db.execute(
        `INSERT INTO model_prices (provider, model, in_per_mtok, out_per_mtok, cached_per_mtok) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT (provider, model) DO UPDATE SET in_per_mtok = excluded.in_per_mtok,
           out_per_mtok = excluded.out_per_mtok, cached_per_mtok = excluded.cached_per_mtok`,
        [p.provider, p.model.trim(), p.inPerMtok, p.outPerMtok, p.cachedPerMtok],
      )
    },

    async remove(provider: ProviderId, model: string): Promise<void> {
      await db.execute('DELETE FROM model_prices WHERE provider = ? AND model = ?', [provider, model])
    },
  }
}
