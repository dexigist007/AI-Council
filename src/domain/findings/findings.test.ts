import { describe, expect, it } from 'vitest'
import { createTestDb } from '@/db/testing'
import { findingsRepo, type NewFinding } from '@/db/repositories/findings'
import type { IndexedFile } from '@/db/repositories/projectIndex'
import { projectsRepo } from '@/db/repositories/projects'
import { localFindings } from '@/domain/audit/local'
import { fingerprint } from './fingerprint'
import { computePriority, type PriorityInput } from './priority'

const base: PriorityInput = { category: 'code_quality', severity: 'medium', confidence: 'high', verified: true, impact: 3, risk: 3, urgency: 3, effort: 3 }

describe('computePriority', () => {
  it.each([
    [{ severity: 'critical' }, 'P0'],
    [{ severity: 'high', category: 'security' }, 'P0'],
    [{ severity: 'high', category: 'secrets' }, 'P0'],
    [{ severity: 'high', category: 'security', verified: false }, 'P2'], // no evidence, no P0
    [{ severity: 'critical', confidence: 'speculative' }, 'P1'], // score 11 but not trusted → capped? see below
    [{ severity: 'high', impact: 4, risk: 4, urgency: 4 }, 'P1'],
    [{ severity: 'high', impact: 4, risk: 4, urgency: 4, verified: false }, 'P2'],
    [{ severity: 'medium' }, 'P2'],
    [{ severity: 'low', impact: 2, risk: 2, urgency: 2 }, 'P3'],
    [{ severity: 'info', impact: 5, risk: 5, urgency: 5 }, 'P2'],
  ] as [Partial<PriorityInput>, string][])('%o → %s', (patch, expected) => {
    const p = computePriority({ ...base, ...patch }).priority
    // Untrusted findings never reach P0/P1.
    expect(p).toBe(patch.confidence === 'speculative' ? 'P2' : expected)
  })
})

describe('fingerprint', () => {
  it('ignores word order, case, accents and filler but keeps the file', () => {
    expect(fingerprint('security', 'SQL injection in user search query', 'api/users.ts'))
      .toBe(fingerprint('security', 'user search query: SQL Injection', 'api/users.ts'))
    expect(fingerprint('security', 'SQL injection in user search query', 'api/users.ts'))
      .not.toBe(fingerprint('security', 'SQL injection in user search query', 'api/orders.ts'))
    expect(fingerprint('error_handling', 'Hata yönetimi eksik', null)).toBe(fingerprint('error_handling', 'hata YONETIMI eksik', null))
  })
})

describe('localFindings', () => {
  const file = (path: string, kind: IndexedFile['kind']): IndexedFile => ({ id: path, path, kind, lang: null, size: 1, mtimeMs: 1, hash: null, skipReason: null })
  const chunk = (path: string, startLine: number, lines: string[]) => ({ id: path + startLine, path, startLine, endLine: startLine + lines.length - 1, content: lines.join('\n'), tokenEst: 1 })

  it('finds secrets in source, TODOs and big files with exact evidence; ignores docs and tests', () => {
    const files = [file('src/api.ts', 'source'), file('README.md', 'doc'), file('src/api.test.ts', 'test'), file('src/big.ts', 'source')]
    const chunks = [
      chunk('src/api.ts', 10, ['const k = "sk-proj-abcdefghijklmnopqrstuvwxyz12"', '// TODO: retry on failure', '// FIXME broken on Windows']),
      chunk('README.md', 1, ['OPENAI_API_KEY=sk-proj-abcdefghijklmnopqrstuvwxyz12', 'TODO write docs']),
      chunk('src/api.test.ts', 1, ['const fake = "sk-proj-abcdefghijklmnopqrstuvwxyz12"']),
      chunk('src/big.ts', 700, Array.from({ length: 150 }, () => 'x()')),
    ]
    const found = localFindings(files, chunks)
    const secrets = found.filter((f) => f.category === 'secrets')
    expect(secrets).toHaveLength(1)
    expect(secrets[0]!.evidence[0]).toMatchObject({ file: 'src/api.ts', start_line: 10, verified: true })
    expect(secrets[0]!.evidence[0]!.quote).not.toContain('abcdefghij') // evidence itself is redacted
    const todo = found.find((f) => f.title.includes('TODO'))!
    expect(todo).toMatchObject({ title: '2 TODO/FIXME notu (1 FIXME/HACK)', severity: 'medium' })
    expect(todo.evidence.map((e) => e.start_line)).toEqual([11, 12])
    expect(found.some((f) => f.title.startsWith('Çok büyük dosya: src/big.ts (849'))).toBe(true)
  })

  it('ignores TODO words outside comments, example values, comments and inline test keys', () => {
    const files = [file('src/scan.ts', 'source'), file('src/lib.rs', 'source')]
    const chunks = [
      chunk('src/scan.ts', 1, [
        'const TODO = /TODO|FIXME/', // the word in code, not a note
        'title: `${n} TODO/FIXME notu`',
        '// scheme://user:password@host keeps the user', // comment
        'const demo = "sk-ant-invalid-test-key-0000000000000"', // placeholder words
        '# FIXME: real note',
      ]),
      chunk('src/lib.rs', 1, ['let password = "hunter2hunter2";', 'let k = "AKIAIOSFODNN7ABCDEFG";']),
    ]
    const found = localFindings(files, chunks)
    expect(found.map((f) => `${f.title}|${f.severity}`)).toEqual([
      'Kodda gömülü olası gizli bilgi (assignment)|medium',
      'Kodda gömülü olası gizli bilgi (aws_key)|high',
      '1 TODO/FIXME notu (1 FIXME/HACK)|medium',
    ])
  })

  it('reports a project without tests', () => {
    const files = Array.from({ length: 12 }, (_, i) => file(`src/f${i}.ts`, 'source'))
    expect(localFindings(files, []).map((f) => f.title)).toEqual(['Projede hiç test dosyası yok'])
  })
})

describe('findingsRepo', () => {
  const f = (patch: Partial<NewFinding> = {}): NewFinding => ({
    title: 'SQL injection in search', description: 'd', category: 'security', severity: 'high', confidence: 'high',
    evidence: [{ file: 'api.ts', start_line: 3, end_line: 3, quote: 'db.query(`SELECT ${q}`)', verified: true }],
    impact: 4, risk: 5, urgency: 4, effort: 2, suggestedFix: 'use params', ...patch,
  })

  it('computes priority/verification itself, dedupes and keeps dismissed status', async () => {
    const db = createTestDb()
    const project = await projectsRepo(db).create({ name: 'p', rootPath: '/p' })
    const repo = findingsRepo(db)
    expect(await repo.upsertMany(project.id, null, [f(), f({ title: 'Missing error handling', category: 'error_handling', severity: 'medium', evidence: [{ file: 'a.ts', start_line: 1, end_line: 1, quote: 'x', verified: false }] })])).toEqual({ added: 2, updated: 0 })

    let list = await repo.list({ projectId: project.id })
    expect(list.map((x) => [x.priority, x.verification])).toEqual([['P0', 'verified'], ['P2', 'unverified']])

    await repo.setStatus(list[0]!.id, 'false_positive')
    expect(await repo.upsertMany(project.id, null, [f({ title: 'Search: SQL injection' })])).toEqual({ added: 0, updated: 1 })
    list = await repo.list({ projectId: project.id })
    expect(list[0]).toMatchObject({ status: 'false_positive', title: 'Search: SQL injection' })
    expect(list[0]!.evidence).toHaveLength(1)
    expect(await repo.list({ projectId: project.id, statuses: ['open'] })).toHaveLength(1)
    expect(await repo.countOpenByPriority()).toEqual({ P0: 0, P1: 0, P2: 1, P3: 0 })
  })
})
