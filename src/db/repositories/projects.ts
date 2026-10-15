import type { Db } from '../types'
import { newId, nowIso, parseJson } from '../util'

export interface ProjectSettings {
  /** Extra gitignore-style exclude patterns on top of the built-in defaults. */
  exclude?: string[]
}

export interface IndexStats {
  files: number
  indexedFiles: number
  chunks: number
  skipped: Record<string, number>
  languages: Record<string, number>
  truncated: boolean
  durationMs: number
}

export interface Project {
  id: string
  name: string
  rootPath: string
  settings: ProjectSettings
  createdAt: string
  indexedAt: string | null
  indexStats: IndexStats | null
}

interface Row {
  id: string
  name: string
  root_path: string
  settings_json: string
  created_at: string
  indexed_at: string | null
  index_stats_json: string | null
}

const map = (r: Row): Project => ({
  id: r.id,
  name: r.name,
  rootPath: r.root_path,
  settings: parseJson(r.settings_json, {}),
  createdAt: r.created_at,
  indexedAt: r.indexed_at,
  indexStats: parseJson(r.index_stats_json, null),
})

export function projectsRepo(db: Db) {
  async function get(id: string): Promise<Project | null> {
    const rows = await db.select<Row>('SELECT * FROM projects WHERE id = ?', [id])
    return rows[0] ? map(rows[0]) : null
  }

  return {
    get,

    async create(input: { name: string; rootPath: string }): Promise<Project> {
      const existing = await db.select<Row>('SELECT * FROM projects WHERE root_path = ?', [input.rootPath])
      if (existing[0]) return map(existing[0])
      const id = newId()
      await db.execute('INSERT INTO projects (id, name, root_path, created_at) VALUES (?, ?, ?, ?)', [id, input.name.trim(), input.rootPath, nowIso()])
      return (await get(id))!
    },

    async list(): Promise<Project[]> {
      return (await db.select<Row>('SELECT * FROM projects ORDER BY name COLLATE NOCASE')).map(map)
    },

    async update(id: string, patch: { name?: string; settings?: ProjectSettings }): Promise<void> {
      await db.execute('UPDATE projects SET name = COALESCE(?, name), settings_json = COALESCE(?, settings_json) WHERE id = ?', [
        patch.name?.trim() ?? null,
        patch.settings ? JSON.stringify(patch.settings) : null,
        id,
      ])
    },

    async setIndexed(id: string, stats: IndexStats): Promise<void> {
      await db.execute('UPDATE projects SET indexed_at = ?, index_stats_json = ? WHERE id = ?', [nowIso(), JSON.stringify(stats), id])
    },

    /** Deletes the project and everything derived from it; the folder itself is untouched. */
    async remove(id: string): Promise<void> {
      await db.execute('DELETE FROM chunks_fts WHERE project_id = ?', [id])
      await db.execute('DELETE FROM projects WHERE id = ?', [id])
    },
  }
}
