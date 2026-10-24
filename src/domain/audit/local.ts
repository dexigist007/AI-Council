import type { ChunkWithPath } from '@/db/repositories/projectIndex'
import type { IndexedFile } from '@/db/repositories/projectIndex'
import { redact } from '@/domain/context/redactor'
import type { NewFinding } from '@/db/repositories/findings'
import { t } from '@/i18n'
import { messages } from '@/i18n/locales'

type LocalKey = keyof typeof messages.tr.projects.audit.local
type Params = Record<string, string | number>
const text = (key: LocalKey, params: Params = {}) => t(`projects.audit.local.${key}`, params)
/**
 * Title in the UI language, plus the Turkish reference text as its fingerprint input: the finding keeps
 * its identity (and the user's status on it) when the language changes, and pre-i18n fingerprints match.
 */
function titled(key: LocalKey, params: Params = {}): Pick<NewFinding, 'title' | 'fingerprintTitle'> {
  const reference = messages.tr.projects.audit.local[key].replace(/\{(\w+)\}/g, (m: string, n: string) => (n in params ? String(params[n]) : m))
  return { title: text(key, params), fingerprintTitle: reference }
}

/** Only notes written as comments count; the words inside strings or regexes are not TODOs. */
const TODO = /(?:\/\/|#|\/\*|^\s*\*|<!--|--)\s*(TODO|FIXME|HACK|XXX)\b/
const COMMENT_LINE = /^\s*(?:\/\/|#(?!\[)|\/\*|\*|<!--|--)/
/** Example and test values are not leaks. */
const PLACEHOLDER = /test|fake|dummy|example|sample|invalid|placeholder|changeme|your[_-]|xxxx|<[a-z_]+>/i
/** Key formats specific enough that a match is very likely a real credential. */
const STRONG_KINDS = new Set(['private_key', 'anthropic_key', 'openai_key', 'aws_key', 'github_token', 'google_key', 'stripe_key', 'slack_token', 'url_credentials', 'jwt'])
const isTestPath = (p: string) => /(^|\/)(tests?|__tests__|spec)\/|\.(test|spec)\./.test(p)
const BIG_FILE_LINES = 800

/**
 * Findings that need no AI: every one has exact evidence from the indexed text, so they are
 * stored as confirmed and verified.
 */
export function localFindings(files: IndexedFile[], chunks: ChunkWithPath[]): NewFinding[] {
  const out: NewFinding[] = []
  const todos: { file: string; line: number; text: string }[] = []
  const lastLine = new Map<string, number>()

  for (const c of chunks) {
    lastLine.set(c.path, Math.max(lastLine.get(c.path) ?? 0, c.endLine))
    // Docs and tests show fake keys and TODO words on purpose; only real source lines count.
    if (/\.(md|mdx|txt|rst)$/i.test(c.path) || isTestPath(c.path)) continue
    c.content.split('\n').forEach((line, i) => {
      const lineNo = c.startLine + i
      if (TODO.test(line)) todos.push({ file: c.path, line: lineNo, text: line.trim() })
      if (COMMENT_LINE.test(line) || PLACEHOLDER.test(line)) return
      const r = redact(line)
      if (!r.count) return
      const strong = r.kinds.some((k) => STRONG_KINDS.has(k))
      out.push({
        ...titled('secretTitle', { kinds: r.kinds.join(', ') }),
        description: strong
          ? text('secretStrong')
          : text('secretWeak'),
        category: 'secrets',
        // Generic patterns are noisier: they can never reach P0 on their own.
        severity: strong ? 'high' : 'medium',
        confidence: strong ? 'high' : 'possible',
        evidence: [{ file: c.path, start_line: lineNo, end_line: lineNo, quote: r.text.trim(), verified: true }],
        impact: strong ? 5 : 3, risk: strong ? 5 : 3, urgency: strong ? 4 : 2, effort: 2,
        suggestedFix: text('secretFix'),
      })
    })
  }

  if (todos.length) {
    const fixme = todos.filter((t) => /FIXME|HACK|XXX/.test(t.text)).length
    out.push({
      ...titled('todoTitle', { n: todos.length, fixme }),
      description: text('todoDesc'),
      category: 'maintainability', severity: fixme ? 'medium' : 'low', confidence: 'confirmed',
      evidence: todos.slice(0, 10).map((t) => ({ file: t.file, start_line: t.line, end_line: t.line, quote: t.text, verified: true })),
      impact: 2, risk: fixme ? 3 : 2, urgency: 2, effort: 2,
      suggestedFix: text('todoFix'),
    })
  }

  for (const f of files.filter((x) => x.kind === 'source' && !x.skipReason)) {
    const lines = lastLine.get(f.path) ?? 0
    if (lines > BIG_FILE_LINES) {
      out.push({
        ...titled('bigTitle', { path: f.path, lines }),
        description: text('bigDesc'),
        category: 'maintainability', severity: 'low', confidence: 'confirmed',
        evidence: [{ file: f.path, start_line: 1, end_line: lines, quote: '', verified: true }],
        impact: 2, risk: 2, urgency: 1, effort: 3,
        suggestedFix: text('bigFix'),
      })
    }
  }

  const source = files.filter((f) => f.kind === 'source' && !f.skipReason).length
  const tests = files.filter((f) => f.kind === 'test').length
  if (source >= 10 && tests === 0) {
    out.push({
      ...titled('noTestsTitle'),
      description: text('noTestsDesc', { n: source }),
      category: 'testing', severity: 'medium', confidence: 'confirmed', evidence: [],
      impact: 3, risk: 3, urgency: 2, effort: 3,
      suggestedFix: text('noTestsFix'),
    })
  }
  return out
}
