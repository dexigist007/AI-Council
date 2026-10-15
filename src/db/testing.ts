// Test-only: an in-memory database with the real migrations applied. Never import from app code.
import BetterSqlite from 'better-sqlite3'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Db } from './types'

const MIGRATIONS_DIR = join(import.meta.dirname, '../../src-tauri/migrations')

export function createTestDb(): Db {
  const sqlite = new BetterSqlite(':memory:')
  sqlite.pragma('foreign_keys = ON')
  for (const file of readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort()) {
    sqlite.exec(readFileSync(join(MIGRATIONS_DIR, file), 'utf8'))
  }
  return {
    select: async <T>(sql: string, params: (string | number | null)[] = []) =>
      sqlite.prepare(sql).all(...params) as T[],
    execute: async (sql, params = []) => ({ rowsAffected: sqlite.prepare(sql).run(...params).changes }),
  }
}
