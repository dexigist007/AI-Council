/**
 * Checks model citations against real file text. A citation counts as verified only if its quote
 * is literally present (ignoring whitespace differences); line numbers are then corrected to where
 * the quote actually is. Used by Ask Project and the audit.
 */
export interface Citation {
  file: string
  start_line: number
  end_line: number
  quote: string
}

export interface VerifiedCitation extends Citation {
  verified: boolean
}

const squash = (s: string) => s.replace(/\s+/g, ' ').trim()

/** Line (1-based, relative to `firstLine`) where the quote starts in `text`, or null. */
export function locateQuote(text: string, quote: string, firstLine = 1): { start: number; end: number } | null {
  const q = squash(quote)
  if (q.length < 8) return null // too short to prove anything
  const lines = text.split('\n')
  // Build the squashed text while remembering which line each character came from.
  let flat = ''
  const lineOf: number[] = []
  lines.forEach((line, i) => {
    const part = squash(line)
    if (!part) return
    if (flat) {
      flat += ' '
      lineOf.push(i)
    }
    flat += part
    for (let k = 0; k < part.length; k++) lineOf.push(i)
  })
  const at = flat.indexOf(q)
  if (at === -1) return null
  return { start: lineOf[at]! + firstLine, end: lineOf[at + q.length - 1]! + firstLine }
}

/** `sources` maps a file path to text snippets with the line number of their first line. */
export function verifyCitations(citations: Citation[], sources: Map<string, { text: string; firstLine: number }[]>): VerifiedCitation[] {
  return citations.map((c) => {
    for (const s of sources.get(c.file) ?? []) {
      const hit = locateQuote(s.text, c.quote, s.firstLine)
      if (hit) return { ...c, start_line: hit.start, end_line: hit.end, verified: true }
    }
    return { ...c, verified: false }
  })
}
