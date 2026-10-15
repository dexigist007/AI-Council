export type SqlValue = string | number | null

export interface ExecResult {
  rowsAffected: number
}

/**
 * The only database surface repositories depend on.
 * Production: tauri-plugin-sql (`client.ts`). Tests: better-sqlite3 (`testing.ts`).
 * Placeholders are positional `?`, which both drivers accept.
 */
export interface Db {
  select<T>(sql: string, params?: SqlValue[]): Promise<T[]>
  execute(sql: string, params?: SqlValue[]): Promise<ExecResult>
}
