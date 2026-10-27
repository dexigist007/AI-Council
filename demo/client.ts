// Demo only: replaces src/db/client.ts; queries go to the dev server's SQLite (see demo/vite.config.ts).
import type { Db } from '@/db/types'

async function call<T>(kind: 'select' | 'execute', sql: string, params: unknown[] = []): Promise<T> {
  const res = await fetch('/__demo/sql', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ kind, sql, params }) })
  const body = await res.json()
  if (!res.ok) throw new Error(body.error)
  return body.result as T
}

const db: Db = {
  select: <T>(sql: string, params: (string | number | null)[] = []) => call<T[]>('select', sql, params),
  execute: (sql, params = []) => call<{ rowsAffected: number }>('execute', sql, params),
}

export const getDb = async (): Promise<Db> => db
