// Demo only: the real app UI in a browser, backed by a seeded SQLite file instead of Tauri.
//   DEMO_DB=/path/demo.db npx vite --config demo/vite.config.ts
import BetterSqlite from 'better-sqlite3'
import { fileURLToPath, URL } from 'node:url'
import { defineConfig, mergeConfig, type Plugin } from 'vite'
import base from '../vite.config'

const swap: Record<string, string> = {
  [fileURLToPath(new URL('../src/db/client.ts', import.meta.url))]: fileURLToPath(new URL('./client.ts', import.meta.url)),
  [fileURLToPath(new URL('../src/platform/tauri.ts', import.meta.url))]: fileURLToPath(new URL('./platform.ts', import.meta.url)),
}

function demo(): Plugin {
  const path = process.env.DEMO_DB
  if (!path) throw new Error('set DEMO_DB to a database made by demo/seed.ts')
  const sqlite = new BetterSqlite(path)
  sqlite.pragma('foreign_keys = ON')
  return {
    name: 'ai-council-demo',
    enforce: 'pre',
    async resolveId(source, importer, options) {
      const resolved = await this.resolve(source, importer, { ...options, skipSelf: true })
      return resolved && swap[resolved.id] ? swap[resolved.id] : null
    },
    configureServer(server) {
      server.middlewares.use('/__demo/sql', (req, res) => {
        let body = ''
        req.on('data', (c) => (body += c))
        req.on('end', () => {
          res.setHeader('content-type', 'application/json')
          try {
            const { kind, sql, params } = JSON.parse(body) as { kind: string; sql: string; params: unknown[] }
            const stmt = sqlite.prepare(sql)
            const result = kind === 'select' ? stmt.all(...params) : { rowsAffected: stmt.run(...params).changes }
            res.end(JSON.stringify({ result }))
          } catch (e) {
            res.statusCode = 500
            res.end(JSON.stringify({ error: String(e) }))
          }
        })
      })
    },
  }
}

export default mergeConfig(base, defineConfig({
  plugins: [demo()],
  define: { __BUILD__: JSON.stringify('demo') },
  server: { port: 1430, strictPort: true },
}))
