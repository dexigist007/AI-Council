import Database from '@tauri-apps/plugin-sql'
import type { Db } from './types'

// Must match DB_URL in src-tauri/src/lib.rs; migrations run there when the database is loaded.
const DB_URL = 'sqlite:ai-council.db'

let instance: Promise<Db> | null = null

async function open(): Promise<Db> {
  const conn = await Database.load(DB_URL)
  // WAL persists in the file; foreign keys are enabled by the driver per connection.
  await conn.execute('PRAGMA journal_mode = WAL')
  return {
    select: (sql, params = []) => conn.select(sql, params),
    execute: async (sql, params = []) => ({ rowsAffected: (await conn.execute(sql, params)).rowsAffected }),
  }
}

export function getDb(): Promise<Db> {
  instance ??= open().catch((e) => {
    instance = null
    throw e
  })
  return instance
}
