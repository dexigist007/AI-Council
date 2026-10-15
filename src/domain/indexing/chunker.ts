import { estimateTokens } from '@/domain/cost/pricing'

export interface Chunk {
  startLine: number
  endLine: number
  symbol: string | null
  content: string
  tokenEst: number
}

const TARGET_LINES = 120
const MIN_LINES = 60
const MAX_LINES = 180

/**
 * Declaration starts across common languages. Used only to pick nicer split points and a symbol
 * name; correctness never depends on it (tree-sitter can replace this later).
 */
const DECLARATION =
  /^\s*(?:export\s+)?(?:default\s+)?(?:public\s+|private\s+|protected\s+|internal\s+|static\s+|abstract\s+|final\s+|open\s+|override\s+|async\s+|pub(?:\(crate\))?\s+|suspend\s+|data\s+)*(?:function\*?|class|interface|enum|struct|trait|impl|fn|def|func|fun|object|type|const|let|var|module|namespace)\s+([A-Za-z_$][\w$]*)/

export function declarationName(line: string): string | null {
  return DECLARATION.exec(line)?.[1] ?? null
}

/** Splits a file into line ranges of roughly TARGET_LINES, preferring to cut before a declaration. */
export function chunkText(text: string): Chunk[] {
  const lines = text.replace(/\r\n?/g, '\n').split('\n')
  if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop()
  const chunks: Chunk[] = []
  let start = 0
  while (start < lines.length) {
    let end = Math.min(start + TARGET_LINES, lines.length)
    if (lines.length - start > MAX_LINES) {
      // Cut before a declaration between MIN and MAX lines: the first one past TARGET, else the
      // last one before it; with none, cut at TARGET.
      for (let i = start + MIN_LINES; i < Math.min(start + MAX_LINES, lines.length); i++) {
        if (!declarationName(lines[i]!)) continue
        end = i
        if (i >= start + TARGET_LINES) break
      }
    } else {
      end = lines.length
    }
    const slice = lines.slice(start, end)
    const content = slice.join('\n')
    if (content.trim()) {
      const symbol = slice.map(declarationName).find((n) => n !== null) ?? null
      chunks.push({ startLine: start + 1, endLine: end, symbol, content, tokenEst: estimateTokens(content) })
    }
    start = end
  }
  return chunks
}
