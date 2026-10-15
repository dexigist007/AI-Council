import type { IndexedFile } from '@/db/repositories/projectIndex'
import { estimateTokens } from '@/domain/cost/pricing'
import { redact } from '@/domain/context/redactor'
import type { FileContent } from '@/platform/tauri'

export interface BrainContext {
  tree: string
  documents: string
  /** Files whose content is included; shown to the user before sending. */
  files: string[]
  redactions: number
  tokens: number
}

const MAX_TREE_FILES = 400
const DOC_CHARS = 8000
const MANIFEST_CHARS = 4000
const TOTAL_DOC_CHARS = 40000

/** Compact tree: all paths when small, otherwise per-directory listings capped with counts. */
export function renderTree(paths: string[]): string {
  if (paths.length <= MAX_TREE_FILES) return paths.join('\n')
  const byDir = new Map<string, string[]>()
  for (const p of paths) {
    const dir = p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '.'
    byDir.set(dir, [...(byDir.get(dir) ?? []), p.slice(p.lastIndexOf('/') + 1)])
  }
  const perDir = Math.max(3, Math.floor(MAX_TREE_FILES / byDir.size))
  return [...byDir.entries()]
    .map(([dir, names]) => {
      const shown = names.slice(0, perDir).join(', ')
      return `${dir}/: ${shown}${names.length > perDir ? ` … (+${names.length - perDir} more)` : ''}`
    })
    .join('\n')
}

/** Which files the brain draft reads: root/docs READMEs and markdown docs, then manifests. */
export function pickBrainFiles(files: IndexedFile[]): string[] {
  const readable = files.filter((f) => !f.skipReason)
  const depth = (p: string) => p.split('/').length
  const docs = readable
    .filter((f) => f.kind === 'doc' && /\.(md|mdx|txt|rst)$/i.test(f.path) && (depth(f.path) === 1 || /^docs?\//i.test(f.path)))
    .sort((a, b) => Number(!/readme/i.test(a.path)) - Number(!/readme/i.test(b.path)) || depth(a.path) - depth(b.path))
    .slice(0, 6)
  const manifests = readable.filter((f) => f.kind === 'manifest').sort((a, b) => depth(a.path) - depth(b.path)).slice(0, 8)
  return [...docs, ...manifests].map((f) => f.path)
}

export function buildBrainContext(files: IndexedFile[], contents: FileContent[]): BrainContext {
  const tree = renderTree(files.filter((f) => !f.skipReason).map((f) => f.path))
  const parts: string[] = []
  const included: string[] = []
  let redactions = 0
  let budget = TOTAL_DOC_CHARS
  for (const c of contents) {
    if (c.content === null || budget <= 0) continue
    const limit = Math.min(budget, /\.(md|mdx|txt|rst)$/i.test(c.path) ? DOC_CHARS : MANIFEST_CHARS)
    const r = redact(c.content.length > limit ? `${c.content.slice(0, limit)}\n… [truncated]` : c.content)
    redactions += r.count
    budget -= r.text.length
    included.push(c.path)
    parts.push(`--- ${c.path} ---\n${r.text}`)
  }
  const documents = parts.join('\n\n') || '(no documentation or manifests found)'
  return { tree, documents, files: included, redactions, tokens: estimateTokens(tree + documents) + 600 }
}
