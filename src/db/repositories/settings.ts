import type { Db } from '../types'
import { nowIso, parseJson } from '../util'

/** Key/value store for small app-wide preferences. */
export function settingsRepo(db: Db) {
  return {
    async get(key: string): Promise<unknown> {
      const rows = await db.select<{ value_json: string }>('SELECT value_json FROM app_settings WHERE key = ?', [key])
      return rows[0] ? parseJson(rows[0].value_json, null) : null
    },

    async set(key: string, value: unknown): Promise<void> {
      await db.execute(
        `INSERT INTO app_settings (key, value_json, updated_at) VALUES (?, ?, ?)
         ON CONFLICT (key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at`,
        [key, JSON.stringify(value), nowIso()],
      )
    },
  }
}
