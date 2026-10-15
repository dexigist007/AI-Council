import { describe, expect, it } from 'vitest'
import { createTestDb } from '@/db/testing'
import { brainFactsRepo } from '@/db/repositories/brainFacts'
import type { IndexedFile } from '@/db/repositories/projectIndex'
import { projectsRepo } from '@/db/repositories/projects'
import { sessionsRepo } from '@/db/repositories/sessions'
import { priceLookup } from '@/domain/cost/pricing'
import type { AIProvider, ChatRequest } from '@/domain/providers/types'
import { buildBrainContext, pickBrainFiles, renderTree } from './context'
import { generateBrainDraft } from './draft'

const file = (path: string, kind: IndexedFile['kind'], skipReason: string | null = null): IndexedFile =>
  ({ id: path, path, kind, lang: null, size: 1, mtimeMs: 1, hash: null, skipReason })

describe('brain context', () => {
  const files = [
    file('README.md', 'doc'), file('docs/setup.md', 'doc'), file('src/deep/notes.md', 'doc'), file('package.json', 'manifest'),
    file('src/main.ts', 'source'), file('.env', 'config', 'sensitive'),
  ]

  it('picks top-level docs (README first) and manifests, never skipped files', () => {
    expect(pickBrainFiles(files)).toEqual(['README.md', 'docs/setup.md', 'package.json'])
  })

  it('redacts, truncates and reports what will be sent', () => {
    const ctx = buildBrainContext(files, [
      { path: 'README.md', content: `# App\nDATABASE_URL=postgres://u:pa55word@h/db\n${'x'.repeat(9000)}`, error: null },
      { path: 'package.json', content: '{"name":"app"}', error: null },
      { path: 'gone.md', content: null, error: 'missing' },
    ])
    expect(ctx.files).toEqual(['README.md', 'package.json'])
    expect(ctx.redactions).toBe(1)
    expect(ctx.documents).not.toContain('pa55word')
    expect(ctx.documents).toContain('[truncated]')
    expect(ctx.tree).not.toContain('.env')
  })

  it('compresses large trees per directory', () => {
    const paths = Array.from({ length: 900 }, (_, i) => `src/d${i % 3}/f${i}.ts`)
    const tree = renderTree(paths)
    expect(tree.split('\n')).toHaveLength(3)
    expect(tree).toContain('more)')
  })
})

describe('generateBrainDraft', () => {
  async function setup(reply: string) {
    const db = createTestDb()
    const project = await projectsRepo(db).create({ name: 'demo', rootPath: '/x' })
    const brain = brainFactsRepo(db)
    const sessions = sessionsRepo(db)
    const seen: ChatRequest[] = []
    const provider: AIProvider = {
      id: 'anthropic', capabilities: { jsonSchema: true }, listModels: async () => [],
      chat: async (req) => (seen.push(req), { text: reply, usage: { input: 2000, output: 500, cached: 0 }, finishReason: 'end_turn' }),
    }
    const deps = { provider: () => provider, sessions, brain, price: priceLookup([{ provider: 'anthropic', model: 'm', inPerMtok: 4, outPerMtok: 20, cachedPerMtok: null }]) }
    return { db, project, brain, sessions, seen, deps }
  }
  const ctx = { tree: 'src/player.ts', documents: '--- README.md ---\nIPTV player', files: ['README.md'], redactions: 0, tokens: 100 }

  it('stores facts as pending INFERRED, drops invented evidence, records the call', async () => {
    const reply = JSON.stringify({ facts: [
      { section: 'purpose', statement: 'Smart TV IPTV player', confidence: 'high', evidence_files: ['README.md'] },
      { section: 'modules', statement: 'Playback lives in src/player.ts', confidence: 'medium', evidence_files: ['src/player.ts', 'src/invented.ts'] },
      { section: 'data_storage', statement: 'Uses local storage for playlists', confidence: 'low', evidence_files: [] },
    ] })
    const s = await setup(reply)
    const res = await generateBrainDraft(s.deps, s.project, ctx, [], new Set(['README.md', 'src/player.ts']), { provider: 'anthropic', model: 'm' })

    expect(res).toMatchObject({ added: 3, droppedEvidence: ['src/invented.ts'] })
    expect(s.seen[0]!.system).toContain('IPTV player')
    const facts = await s.brain.list(s.project.id)
    expect(facts.every((f) => f.source === 'inferred' && f.status === 'pending')).toBe(true)
    expect(facts.find((f) => f.section === 'modules')!.evidence).toEqual([{ file: 'src/player.ts' }])
    expect(facts.find((f) => f.section === 'data_storage')!.statement).toMatch(/^\(düşük güven\)/)

    const msgs = await s.sessions.listMessages(res.sessionId)
    expect(msgs[0]).toMatchObject({ promptId: 'project-brain-draft', requestFiles: ['README.md'], cost: 0.018 })
    expect((await s.sessions.get(res.sessionId))!.config).toMatchObject({ meta: { purpose: 'brain_draft' } })
  })

  it('keeps confirmed facts when a new draft replaces pending ones', async () => {
    const s = await setup(JSON.stringify({ facts: [{ section: 'summary', statement: 'new', confidence: 'high', evidence_files: [] }] }))
    await s.brain.replacePendingInferred(s.project.id, [{ section: 'summary', statement: 'old pending', evidence: [] }, { section: 'purpose', statement: 'keep me', evidence: [] }], null)
    const keep = (await s.brain.list(s.project.id)).find((f) => f.statement === 'keep me')!
    await s.brain.confirm(keep.id, 'kept and edited')
    await generateBrainDraft(s.deps, s.project, ctx, [], new Set(), { provider: 'anthropic', model: 'm' })

    const facts = await s.brain.list(s.project.id)
    expect(facts.map((f) => `${f.statement}|${f.source}|${f.status}`).sort()).toEqual(['kept and edited|user_confirmed|active', 'new|inferred|pending'])
    const ctxFacts = await s.brain.forContext(s.project.id)
    expect(ctxFacts[0]!.source).toBe('user_confirmed')
  })

  it('fails the session without touching facts when the model output is unusable', async () => {
    const s = await setup('not json at all')
    const res = await generateBrainDraft(s.deps, s.project, ctx, [], new Set(), { provider: 'anthropic', model: 'm' })
    expect(res.error).toBeTruthy()
    expect((await s.sessions.get(res.sessionId))!.status).toBe('failed')
    expect(await s.brain.list(s.project.id)).toEqual([])
  })
})
