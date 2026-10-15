import { describe, expect, it } from 'vitest'
import { createTestDb } from '@/db/testing'
import { projectsRepo } from '@/db/repositories/projects'
import { sessionsRepo } from '@/db/repositories/sessions'
import type { BrainFact } from '@/db/repositories/brainFacts'
import { priceLookup } from '@/domain/cost/pricing'
import { locateQuote } from '@/domain/context/evidence'
import type { AIProvider, ChatRequest } from '@/domain/providers/types'
import { askProject } from './ask'
import { buildAskContext, mergeChunks } from './context'

const chunk = (id: string, path: string, startLine: number, lines: string[]) =>
  ({ id, path, startLine, endLine: startLine + lines.length - 1, content: lines.join('\n'), tokenEst: 10 })

describe('locateQuote', () => {
  const text = 'function load(url) {\n  const res = await fetch(url)\n  return parse(res)\n}'
  it('finds quotes across whitespace and line breaks and reports real lines', () => {
    expect(locateQuote(text, 'const res = await fetch(url)', 10)).toEqual({ start: 11, end: 11 })
    expect(locateQuote(text, 'await   fetch(url) return parse(res)', 1)).toEqual({ start: 2, end: 3 })
  })
  it('rejects invented or too-short quotes', () => {
    expect(locateQuote(text, 'await axios.get(url)')).toBeNull()
    expect(locateQuote(text, 'url')).toBeNull()
  })
})

describe('ask context', () => {
  it('merges adjacent chunks of a file, numbers lines and redacts', () => {
    const merged = mergeChunks([chunk('b', 'a.ts', 4, ['d', 'e']), chunk('a', 'a.ts', 1, ['a', 'b', 'c']), chunk('c', 'b.ts', 1, ['x'])])
    expect(merged.map((m) => `${m.path}:${m.startLine}-${m.endLine}`)).toEqual(['a.ts:1-5', 'b.ts:1-1'])
    expect(merged[0]!.content).toBe('a\nb\nc\nd\ne')

    const facts = [
      { section: 'purpose', statement: 'IPTV player', source: 'user_confirmed', status: 'active' },
      { section: 'stack', statement: 'framework: Vue', source: 'observed', status: 'active' },
      { section: 'summary', statement: 'maybe uses Redis', source: 'inferred', status: 'pending' },
    ] as BrainFact[]
    const ctx = buildAskContext([chunk('k', 'cfg.ts', 7, ['const apiKey = "sk-proj-abcdefghijklmnopqrstuvwx"'])], facts)
    expect(ctx.excerpts).toContain('=== cfg.ts:7-7 ===\n7| const apiKey = "sk-********"')
    expect(ctx.redactions).toBe(1)
    expect(ctx.facts).toBe('- [confirmed] (purpose) IPTV player\n- [observed] (stack) framework: Vue\n- [unconfirmed] (summary) maybe uses Redis')
  })
})

describe('askProject', () => {
  it('answers from the excerpts and verifies citations against what was sent', async () => {
    const db = createTestDb()
    const project = await projectsRepo(db).create({ name: 'demo', rootPath: '/x' })
    const sessions = sessionsRepo(db)
    const seen: ChatRequest[] = []
    const reply = {
      answer: 'Playlist fetch ile yükleniyor.',
      citations: [
        { file: 'src/playlist.ts', start_line: 99, end_line: 99, quote: 'const res = await fetch(url)' }, // wrong lines, real quote
        { file: 'src/playlist.ts', start_line: 1, end_line: 1, quote: 'cache.set(url, res) // invented' },
        { file: 'src/other.ts', start_line: 1, end_line: 1, quote: 'not sent to the model at all' },
      ],
      confidence: 'medium',
      missing_context: ['parse() implementation'],
    }
    const provider: AIProvider = {
      id: 'anthropic', capabilities: { jsonSchema: true }, listModels: async () => [],
      chat: async (req) => (seen.push(req), { text: JSON.stringify(reply), usage: { input: 1000, output: 200, cached: 0 }, finishReason: 'end_turn' }),
    }
    const ctx = buildAskContext([chunk('1', 'src/playlist.ts', 20, ['async function load(url) {', '  const res = await fetch(url)', '}'])], [])
    const res = await askProject({ provider: () => provider, sessions, price: priceLookup([]) }, project, 'Playlist nasıl yükleniyor?', 'playlist load', ctx, { provider: 'anthropic', model: 'm' })

    expect(seen[0]!.messages[0]!.content).toBe('Playlist nasıl yükleniyor?')
    expect(seen[0]!.system).toContain('21|   const res = await fetch(url)')
    expect(res.report!.citations.map((c) => [c.verified, c.start_line])).toEqual([[true, 21], [false, 1], [false, 1]])
    expect(res.report!.missingContext).toEqual(['parse() implementation'])
    const session = (await sessions.get(res.sessionId))!
    expect(session).toMatchObject({ status: 'completed', config: { meta: { purpose: 'ask', question: 'Playlist nasıl yükleniyor?' } } })
    expect((await sessions.listMessages(res.sessionId))[0]!.requestFiles).toEqual(['src/playlist.ts'])
  })
})
