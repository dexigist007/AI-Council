import { describe, expect, it } from 'vitest'
import { createTestDb } from '@/db/testing'
import { brainFactsRepo } from '@/db/repositories/brainFacts'
import { ftsQuery, identifierParts, projectIndexRepo } from '@/db/repositories/projectIndex'
import { projectsRepo } from '@/db/repositories/projects'
import type { ScanEntry } from '@/platform/tauri'
import { indexProject, type IndexerFs } from './indexer'

/** In-memory folder: path → content (null = listed with a skip reason). */
function fakeFs(files: Record<string, { content?: string; skip?: ScanEntry['skip']; mtime?: number }>) {
  const reads: string[] = []
  const fs: IndexerFs = {
    scan: async () => ({
      entries: Object.entries(files).map(([path, f]) => ({ path, size: f.content?.length ?? 10, mtimeMs: f.mtime ?? 1, skip: f.skip ?? null })),
      truncated: false,
    }),
    readFiles: async (_root, paths) => {
      reads.push(...paths)
      return paths.map((path) => ({ path, content: files[path]?.content ?? null, error: null }))
    },
  }
  return { fs, reads, files }
}

async function setup() {
  const db = createTestDb()
  const projects = projectsRepo(db)
  const index = projectIndexRepo(db)
  const brain = brainFactsRepo(db)
  const project = await projects.create({ name: 'demo', rootPath: '/tmp/demo' })
  return { db, projects, index, brain, project }
}

describe('indexProject', () => {
  it('indexes, searches and records stack facts', async () => {
    const s = await setup()
    const { fs } = fakeFs({
      'package.json': { content: JSON.stringify({ dependencies: { vue: '3', firebase: '10' } }) },
      'src/playlist.ts': { content: 'export async function loadPlaylist(url: string) {\n  return parseM3u(await fetch(url))\n}' },
      'src/auth.ts': { content: 'export function signIn() { return firebaseAuth() }' },
      '.env': { skip: 'sensitive' },
      'logo.png': { skip: 'binary' },
    })
    const stats = await indexProject({ fs, ...s }, s.project)
    expect(stats).toMatchObject({ files: 5, indexedFiles: 3, chunks: 3, skipped: { sensitive: 1, binary: 1 }, languages: { TypeScript: 2, JSON: 1 } })

    const hits = await s.index.search(s.project.id, 'playlist yükleme')
    expect(hits[0]).toMatchObject({ path: 'src/playlist.ts', startLine: 1, endLine: 3, symbol: 'loadPlaylist' })
    expect(hits[0]!.snippet).toContain('loadPlaylist')
    expect((await s.index.search(s.project.id, 'firebase')).map((h) => h.path).sort()).toEqual(['package.json', 'src/auth.ts'])

    const facts = await s.brain.list(s.project.id, 'stack')
    expect(facts.map((f) => f.statement)).toEqual(expect.arrayContaining(['framework: Vue', 'service: Firebase']))
    expect(facts.every((f) => f.source === 'observed' && f.evidence[0]!.file === 'package.json')).toBe(true)
    expect((await s.projects.get(s.project.id))!.indexedAt).not.toBeNull()
  })

  it('only re-reads changed files and drops removed ones', async () => {
    const s = await setup()
    const ff = fakeFs({ 'a.ts': { content: 'const alpha = 1' }, 'b.ts': { content: 'const beta = 2' }, 'c.ts': { content: 'const gamma = 3' } })
    await indexProject({ fs: ff.fs, ...s }, s.project)
    ff.reads.length = 0

    ff.files['a.ts'] = { content: 'const alphaChanged = 1', mtime: 2 } // content changed
    ff.files['b.ts'] = { content: 'const beta = 2', mtime: 2 } // touched, same content
    delete ff.files['c.ts']
    const stats = await indexProject({ fs: ff.fs, ...s }, s.project)

    expect(ff.reads).toEqual(['a.ts', 'b.ts'])
    expect(stats.files).toBe(2)
    expect((await s.index.search(s.project.id, 'alphaChanged')).map((h) => h.path)).toEqual(['a.ts'])
    expect(await s.index.search(s.project.id, 'gamma')).toEqual([])
    expect(await s.index.countChunks(s.project.id)).toBe(2)
  })

  it('removes chunks when a file becomes skipped, and project removal clears the index', async () => {
    const s = await setup()
    const ff = fakeFs({ 'big.ts': { content: 'const huge = 1' } })
    await indexProject({ fs: ff.fs, ...s }, s.project)
    ff.files['big.ts'] = { skip: 'too_large', mtime: 2 }
    await indexProject({ fs: ff.fs, ...s }, s.project)
    expect(await s.index.search(s.project.id, 'huge')).toEqual([])
    expect((await s.index.listFiles(s.project.id))[0]).toMatchObject({ skipReason: 'too_large', hash: null })

    await s.projects.remove(s.project.id)
    expect(await s.db.select('SELECT * FROM chunks_fts')).toEqual([])
    expect(await s.db.select('SELECT * FROM files')).toEqual([])
  })
})

describe('identifierParts', () => {
  it('splits camelCase, PascalCase, acronyms and snake_case', () => {
    expect(identifierParts('loadPlaylist(PLAYLIST_URL); new HTTPClient(); x.id')).toBe('load playlist url http client')
  })
})

describe('ftsQuery', () => {
  it('quotes terms so user text cannot inject FTS syntax', () => {
    expect(ftsQuery('Firebase nerede? "AND" NEAR(x)')).toBe('"firebase"* OR "nerede"* OR "and"* OR "near"*')
    expect(ftsQuery('?!')).toBeNull()
  })
})
