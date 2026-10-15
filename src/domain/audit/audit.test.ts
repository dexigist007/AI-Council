import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { createTestDb } from '@/db/testing'
import { findingsRepo } from '@/db/repositories/findings'
import { projectsRepo } from '@/db/repositories/projects'
import { sessionsRepo } from '@/db/repositories/sessions'
import { projectIndexRepo } from '@/db/repositories/projectIndex'
import { brainFactsRepo } from '@/db/repositories/brainFacts'
import { priceLookup } from '@/domain/cost/pricing'
import { runCouncil } from '@/domain/council/engine'
import { indexProject } from '@/domain/indexing/indexer'
import type { AIProvider } from '@/domain/providers/types'
import { auditContext, auditRoles, buildAuditTask, saveAuditFindings, selectAuditChunks } from './audit'
import type { AuditReport } from './report'

const files: Record<string, string> = {
  'src/db.ts': 'export function findUser(q: string) {\n  return db.query(`SELECT * FROM users WHERE name = \'${q}\'`)\n}',
  'src/load.ts': 'export async function load(url: string) {\n  try { return await fetch(url) } catch (e) {}\n}',
  'README.md': 'auth password token query catch',
  'src/db.test.ts': 'it("query", () => {})',
}

async function setup() {
  const db = createTestDb()
  const projects = projectsRepo(db)
  const project = await projects.create({ name: 'demo', rootPath: '/demo' })
  const index = projectIndexRepo(db)
  const fs = {
    scan: async () => ({ entries: Object.keys(files).map((path) => ({ path, size: files[path]!.length, mtimeMs: 1, skip: null })), truncated: false }),
    readFiles: async (_: string, paths: string[]) => paths.map((path) => ({ path, content: files[path] ?? null, error: null })),
  }
  await indexProject({ fs, projects, index, brain: brainFactsRepo(db) }, project)
  return { db, project, index }
}

describe('audit', () => {
  it('selects source code per focus area, skipping docs and tests', async () => {
    const s = await setup()
    const chunks = await selectAuditChunks(s.index, s.project.id, ['security', 'error_handling'])
    expect(chunks.map((c) => c.path).sort()).toEqual(['src/db.ts', 'src/load.ts'])
    expect(auditRoles(['security'])).toEqual(['security-reviewer', 'code-auditor', 'critical-analyst'])
  })

  it('runs as a council and stores verified, prioritised findings', async () => {
    const s = await setup()
    const chunks = await selectAuditChunks(s.index, s.project.id, ['security', 'error_handling'])
    const ctx = auditContext(chunks, [])
    const task = buildAuditTask(s.project, ctx, ['security', 'error_handling'])
    expect(task.taskBrief).toContain("2| return db.query(`SELECT * FROM users WHERE name = '${q}'`)".replace('2| ', '2|   '))

    const judge: AuditReport = {
      summary: 's',
      findings: [
        { title: 'SQL injection in findUser', description: 'q is interpolated', category: 'security', severity: 'high', confidence: 'confirmed',
          evidence: [{ file: 'src/db.ts', start_line: 9, end_line: 9, quote: "SELECT * FROM users WHERE name = '${q}'" }],
          impact: 5, risk: 5, urgency: 4, effort: 1, suggested_fix: 'parameterised query', estimated_effort: '30 minutes' },
        { title: 'Errors swallowed in load', description: 'empty catch', category: 'error_handling', severity: 'medium', confidence: 'high',
          evidence: [{ file: 'src/load.ts', start_line: 2, end_line: 2, quote: 'catch (e) {}' }],
          impact: 3, risk: 3, urgency: 2, effort: 1, suggested_fix: 'log and rethrow', estimated_effort: '' },
        { title: 'Possible race in cache', description: 'guess', category: 'performance', severity: 'high', confidence: 'possible',
          evidence: [{ file: 'src/cache.ts', start_line: 1, end_line: 1, quote: 'cache.set(k, v)' }],
          impact: 4, risk: 4, urgency: 4, effort: 2, suggested_fix: 'lock', estimated_effort: '' },
      ],
      opportunities: [],
    }
    const analysis = JSON.stringify({ summary: 'x', claims: [{ text: 'SQL injection', type: 'risk', confidence: 'high' }] })
    const provider: AIProvider = {
      id: 'anthropic', capabilities: { jsonSchema: true }, listModels: async () => [],
      chat: async (req) => ({ text: (req.system ?? '').includes('judge of an AI council') ? JSON.stringify(judge) : analysis, usage: { input: 1, output: 1, cached: 0 }, finishReason: 'end_turn' }),
    }
    const sessions = sessionsRepo(s.db)
    const p = (id: string, roleId: string) => ({ id, provider: 'anthropic' as const, model: 'm', roleId })
    const run = await runCouncil({ provider: () => provider, sessions, price: priceLookup([]), retryDelayMs: 0 }, task,
      { mode: 'fast', participants: [p('p1', 'security-reviewer'), p('p2', 'code-auditor')], judge: p('judge', 'judge') })
    expect(run.status).toBe('completed')

    const repo = findingsRepo(s.db)
    const saved = await saveAuditFindings(repo, s.project.id, run.sessionId, run.report!, ctx)
    expect(saved).toEqual({ added: 3, updated: 0, unverified: 1 })
    const list = await repo.list({ projectId: s.project.id })
    expect(list.map((f) => `${f.priority}|${f.verification}|${f.title}`)).toEqual([
      'P0|verified|SQL injection in findUser',
      'P2|verified|Errors swallowed in load',
      'P2|unverified|Possible race in cache', // high severity but no evidence: capped
    ])
    expect(list[0]!.evidence[0]!.start_line).toBe(2) // corrected from the model's 9
    expect((await sessions.get(run.sessionId))!.type).toBe('audit')
    expect(z.string().parse(list[1]!.description)).not.toContain('Tahmini efor')
  })
})
