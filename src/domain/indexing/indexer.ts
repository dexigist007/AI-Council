import type { brainFactsRepo } from '@/db/repositories/brainFacts'
import type { projectIndexRepo } from '@/db/repositories/projectIndex'
import type { IndexStats, Project, projectsRepo } from '@/db/repositories/projects'
import type { FileContent, ScanEntry } from '@/platform/tauri'
import { chunkText } from './chunker'
import { isManifest, kindOf, languageOf } from './classify'
import { detectStack } from './detect'

export interface IndexerFs {
  scan(root: string, excludes: string[]): Promise<{ entries: ScanEntry[]; truncated: boolean }>
  readFiles(root: string, paths: string[]): Promise<FileContent[]>
}

export interface IndexerDeps {
  fs: IndexerFs
  projects: ReturnType<typeof projectsRepo>
  index: ReturnType<typeof projectIndexRepo>
  brain: ReturnType<typeof brainFactsRepo>
  hash?: (text: string) => Promise<string>
}

export interface IndexProgress {
  phase: 'scan' | 'read' | 'detect' | 'done'
  done: number
  total: number
}

const READ_BATCH = 40

export async function sha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

/**
 * Incremental index: only files whose size or mtime changed are read, and only files whose
 * content hash changed are re-chunked. Removed files are dropped.
 */
export async function indexProject(deps: IndexerDeps, project: Project, onProgress: (p: IndexProgress) => void = () => {}): Promise<IndexStats> {
  const started = performance.now()
  const hash = deps.hash ?? sha256
  onProgress({ phase: 'scan', done: 0, total: 0 })
  const scan = await deps.fs.scan(project.rootPath, project.settings.exclude ?? [])
  const existing = new Map((await deps.index.listFiles(project.id)).map((f) => [f.path, f]))
  const seen = new Set(scan.entries.map((e) => e.path))

  const removed = [...existing.values()].filter((f) => !seen.has(f.path)).map((f) => f.id)
  if (removed.length) await deps.index.removeFiles(removed)

  const meta = (e: ScanEntry) => ({ path: e.path, lang: languageOf(e.path), kind: kindOf(e.path), size: e.size, mtimeMs: e.mtimeMs })
  const toRead: ScanEntry[] = []
  for (const e of scan.entries) {
    const prev = existing.get(e.path)
    if (e.skip) {
      // Listed for completeness, content never stored.
      if (!prev || prev.skipReason !== e.skip || prev.size !== e.size || prev.mtimeMs !== e.mtimeMs) {
        const id = await deps.index.upsertFile(project.id, { ...meta(e), hash: null, skipReason: e.skip })
        if (prev && !prev.skipReason) await deps.index.replaceChunks(project.id, id, e.path, [])
      }
    } else if (!prev || prev.skipReason || prev.size !== e.size || prev.mtimeMs !== e.mtimeMs) {
      toRead.push(e)
    }
  }

  const manifests: { path: string; content: string }[] = []
  for (let i = 0; i < toRead.length; i += READ_BATCH) {
    onProgress({ phase: 'read', done: i, total: toRead.length })
    const batch = toRead.slice(i, i + READ_BATCH)
    const contents = new Map((await deps.fs.readFiles(project.rootPath, batch.map((e) => e.path))).map((c) => [c.path, c]))
    for (const e of batch) {
      const c = contents.get(e.path)
      if (c?.content == null) continue // vanished or unreadable since the scan
      const digest = await hash(c.content)
      const prev = existing.get(e.path)
      const id = await deps.index.upsertFile(project.id, { ...meta(e), hash: digest, skipReason: null })
      if (prev?.hash !== digest || prev.skipReason) await deps.index.replaceChunks(project.id, id, e.path, chunkText(c.content))
    }
  }

  // Manifests are small; always re-read them so stack facts reflect the current state.
  onProgress({ phase: 'detect', done: 0, total: 0 })
  const manifestPaths = scan.entries.filter((e) => !e.skip && isManifest(e.path)).map((e) => e.path)
  if (manifestPaths.length) {
    for (const c of await deps.fs.readFiles(project.rootPath, manifestPaths)) if (c.content !== null) manifests.push({ path: c.path, content: c.content })
  }
  await deps.brain.replaceObserved(project.id, 'stack', detectStack(manifests).map((f) => ({
    statement: `${f.category}: ${f.name}`,
    evidence: [{ file: f.file }],
  })))

  const skipped: Record<string, number> = {}
  const languages: Record<string, number> = {}
  for (const e of scan.entries) {
    if (e.skip) skipped[e.skip] = (skipped[e.skip] ?? 0) + 1
    const lang = languageOf(e.path)
    if (lang && !e.skip) languages[lang] = (languages[lang] ?? 0) + 1
  }
  const stats: IndexStats = {
    files: scan.entries.length,
    indexedFiles: scan.entries.filter((e) => !e.skip).length,
    chunks: await deps.index.countChunks(project.id),
    skipped,
    languages,
    truncated: scan.truncated,
    durationMs: Math.round(performance.now() - started),
  }
  await deps.projects.setIndexed(project.id, stats)
  onProgress({ phase: 'done', done: toRead.length, total: toRead.length })
  return stats
}
