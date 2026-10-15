import type { BrainFact } from '@/db/repositories/brainFacts'
import type { ChunkWithPath } from '@/db/repositories/projectIndex'
import { redact } from '@/domain/context/redactor'

export interface AskExcerpt {
  path: string
  startLine: number
  endLine: number
  /** Redacted text as sent to the model. */
  text: string
}

export interface AskContext {
  facts: string
  excerpts: string
  sent: AskExcerpt[]
  files: string[]
  redactions: number
  tokens: number
}

const FACT_LABEL = { user_confirmed: 'confirmed', observed: 'observed', inferred: 'unconfirmed' } as const

/** Chunks of the same file that touch or overlap are merged so the model sees continuous code. */
export function mergeChunks(chunks: ChunkWithPath[]): ChunkWithPath[] {
  const byFile = new Map<string, ChunkWithPath[]>()
  for (const c of chunks) byFile.set(c.path, [...(byFile.get(c.path) ?? []), c])
  const out: ChunkWithPath[] = []
  for (const list of byFile.values()) {
    list.sort((a, b) => a.startLine - b.startLine)
    let cur = { ...list[0]! }
    for (const c of list.slice(1)) {
      if (c.startLine <= cur.endLine + 1) {
        const extra = c.content.split('\n').slice(Math.max(0, cur.endLine - c.startLine + 1))
        cur = { ...cur, endLine: Math.max(cur.endLine, c.endLine), content: [cur.content, ...extra].join('\n'), tokenEst: cur.tokenEst + c.tokenEst }
      } else {
        out.push(cur)
        cur = { ...c }
      }
    }
    out.push(cur)
  }
  return out
}

export function buildAskContext(chunks: ChunkWithPath[], facts: BrainFact[]): AskContext {
  let redactions = 0
  const sent: AskExcerpt[] = mergeChunks(chunks).map((c) => {
    const r = redact(c.content)
    redactions += r.count
    return { path: c.path, startLine: c.startLine, endLine: c.endLine, text: r.text }
  })
  const excerpts = sent
    .map((e) => {
      const numbered = e.text.split('\n').map((line, i) => `${e.startLine + i}| ${line}`).join('\n')
      return `=== ${e.path}:${e.startLine}-${e.endLine} ===\n${numbered}`
    })
    .join('\n\n')
  const factText = facts
    .filter((f) => f.status !== 'rejected')
    .map((f) => `- [${FACT_LABEL[f.source]}] (${f.section}) ${redact(f.statement).text}`)
    .join('\n')
  return {
    facts: factText || '(no project facts yet)',
    excerpts: excerpts || '(no code excerpts selected)',
    sent,
    files: [...new Set(sent.map((e) => e.path))],
    redactions,
    tokens: Math.ceil((factText.length + excerpts.length) / 4) + 700,
  }
}
