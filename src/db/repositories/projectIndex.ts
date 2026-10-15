import type { FileKind } from '@/domain/indexing/classify'
import type { Chunk } from '@/domain/indexing/chunker'
import type { Db, SqlValue } from '../types'
import { newId, nowIso } from '../util'

export interface IndexedFile {
  id: string
  path: string
  lang: string | null
  kind: FileKind
  size: number
  mtimeMs: number
  hash: string | null
  skipReason: string | null
}

interface FileRow {
  id: string
  path: string
  lang: string | null
  kind: FileKind
  size: number
  mtime_ms: number
  hash: string | null
  skip_reason: string | null
}

const mapFile = (r: FileRow): IndexedFile => ({
  id: r.id, path: r.path, lang: r.lang, kind: r.kind, size: r.size, mtimeMs: r.mtime_ms, hash: r.hash, skipReason: r.skip_reason,
})

export interface SearchHit {
  chunkId: string
  path: string
  startLine: number
  endLine: number
  symbol: string | null
  snippet: string
  rank: number
}

/** Rows per multi-row INSERT; keeps IPC round-trips low without nearing SQLite's variable limit. */
const BATCH = 100

async function insertMany(db: Db, table: string, columns: string[], rows: SqlValue[][]) {
  for (let i = 0; i < rows.length; i += BATCH) {
    const batch = rows.slice(i, i + BATCH)
    const placeholders = batch.map(() => `(${columns.map(() => '?').join(',')})`).join(',')
    await db.execute(`INSERT INTO ${table} (${columns.join(',')}) VALUES ${placeholders}`, batch.flat())
  }
}

/** Parts of camelCase / snake_case identifiers, so "playlist" finds loadPlaylist and PLAYLIST_URL. */
export function identifierParts(text: string): string {
  const parts = new Set<string>()
  for (const id of new Set(text.match(/[A-Za-z][A-Za-z0-9_]{3,}/g) ?? [])) {
    const split = id
      .replace(/([a-z0-9])([A-Z])/g, '$1 $2') // loadPlaylist → load Playlist
      .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2') // HTTPClient → HTTP Client
      .split(/[\s_]+/)
    if (split.length < 2) continue // plain words are already in `content`
    for (const p of split) if (p.length > 2) parts.add(p.toLowerCase())
  }
  return [...parts].join(' ')
}

/** Turns free text into a safe FTS5 query: quoted terms, prefix match, OR-ed, ranked by bm25. */
export function ftsQuery(text: string): string | null {
  const terms = [...new Set(text.toLocaleLowerCase('tr').match(/[\p{L}\p{N}_]{2,}/gu) ?? [])].slice(0, 12)
  return terms.length ? terms.map((t) => `"${t}"*`).join(' OR ') : null
}

export function projectIndexRepo(db: Db) {
  async function deleteChunks(fileIds: string[]) {
    for (let i = 0; i < fileIds.length; i += BATCH) {
      const ids = fileIds.slice(i, i + BATCH)
      const marks = ids.map(() => '?').join(',')
      await db.execute(`DELETE FROM chunks_fts WHERE chunk_id IN (SELECT id FROM chunks WHERE file_id IN (${marks}))`, ids)
      await db.execute(`DELETE FROM chunks WHERE file_id IN (${marks})`, ids)
    }
  }

  return {
    async listFiles(projectId: string): Promise<IndexedFile[]> {
      return (await db.select<FileRow>('SELECT * FROM files WHERE project_id = ? ORDER BY path', [projectId])).map(mapFile)
    },

    async removeFiles(fileIds: string[]): Promise<void> {
      await deleteChunks(fileIds)
      for (let i = 0; i < fileIds.length; i += BATCH) {
        const ids = fileIds.slice(i, i + BATCH)
        await db.execute(`DELETE FROM files WHERE id IN (${ids.map(() => '?').join(',')})`, ids)
      }
    },

    /** Inserts or updates file metadata; returns the file id. */
    async upsertFile(projectId: string, f: Omit<IndexedFile, 'id'>): Promise<string> {
      const now = nowIso()
      await db.execute(
        `INSERT INTO files (id, project_id, path, lang, kind, size, mtime_ms, hash, skip_reason, indexed_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (project_id, path) DO UPDATE SET lang = excluded.lang, kind = excluded.kind, size = excluded.size,
           mtime_ms = excluded.mtime_ms, hash = excluded.hash, skip_reason = excluded.skip_reason, indexed_at = excluded.indexed_at`,
        [newId(), projectId, f.path, f.lang, f.kind, f.size, f.mtimeMs, f.hash, f.skipReason, now],
      )
      const rows = await db.select<{ id: string }>('SELECT id FROM files WHERE project_id = ? AND path = ?', [projectId, f.path])
      return rows[0]!.id
    },

    /** Replaces a file's chunks and their full-text entries. */
    async replaceChunks(projectId: string, fileId: string, path: string, chunks: Chunk[]): Promise<void> {
      await deleteChunks([fileId])
      const rows = chunks.map((c) => ({ id: newId(), ...c }))
      await insertMany(db, 'chunks', ['id', 'file_id', 'project_id', 'start_line', 'end_line', 'symbol', 'content', 'token_est'],
        rows.map((c) => [c.id, fileId, projectId, c.startLine, c.endLine, c.symbol, c.content, c.tokenEst]))
      await insertMany(db, 'chunks_fts', ['content', 'path', 'symbol', 'words', 'chunk_id', 'project_id'],
        rows.map((c) => [c.content, path, c.symbol, identifierParts(c.content), c.id, projectId]))
    },

    async countChunks(projectId: string): Promise<number> {
      const rows = await db.select<{ n: number }>('SELECT COUNT(*) AS n FROM chunks WHERE project_id = ?', [projectId])
      return rows[0]?.n ?? 0
    },

    async search(projectId: string, text: string, limit = 20): Promise<SearchHit[]> {
      const q = ftsQuery(text)
      if (!q) return []
      return db.select<SearchHit>(
        `SELECT c.id AS chunkId, f.path AS path, c.start_line AS startLine, c.end_line AS endLine, c.symbol AS symbol,
                snippet(chunks_fts, 0, '«', '»', ' … ', 16) AS snippet, bm25(chunks_fts, 1.0, 4.0, 6.0, 0.8) AS rank
         FROM chunks_fts JOIN chunks c ON c.id = chunks_fts.chunk_id JOIN files f ON f.id = c.file_id
         WHERE chunks_fts MATCH ? AND chunks_fts.project_id = ?
         ORDER BY rank LIMIT ?`,
        [q, projectId, limit],
      )
    },
  }
}
