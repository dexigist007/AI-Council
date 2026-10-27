// Demo only: a better-sqlite3 database file behind the app's Db interface.
import BetterSqlite from 'better-sqlite3'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Db } from '@/db/types'

const MIGRATIONS = join(import.meta.dirname, '../src-tauri/migrations')

export function openDemoDb(path: string, migrate = false): { db: Db; sqlite: BetterSqlite.Database } {
  const sqlite = new BetterSqlite(path)
  sqlite.pragma('foreign_keys = ON')
  if (migrate) for (const f of readdirSync(MIGRATIONS).filter((f) => f.endsWith('.sql')).sort()) sqlite.exec(readFileSync(join(MIGRATIONS, f), 'utf8'))
  const db: Db = {
    select: async <T>(sql: string, params: (string | number | null)[] = []) => sqlite.prepare(sql).all(...params) as T[],
    execute: async (sql, params = []) => ({ rowsAffected: sqlite.prepare(sql).run(...params).changes }),
  }
  return { db, sqlite }
}
