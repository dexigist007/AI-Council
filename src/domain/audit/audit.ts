import type { BrainFact } from '@/db/repositories/brainFacts'
import type { findingsRepo, NewFinding, UpsertResult } from '@/db/repositories/findings'
import type { ChunkWithPath, projectIndexRepo } from '@/db/repositories/projectIndex'
import { buildAskContext, type AskContext } from '@/domain/ask/context'
import { verifyCitations } from '@/domain/context/evidence'
import type { CouncilReport, CouncilTask } from '@/domain/council/engine'
import { render } from '@/domain/prompts/registry'
import { AUDIT_FOCUS } from './categories'
import { AuditReport } from './report'

/** Code budget for the whole audit; every member receives it, so it is multiplied by council size. */
const AUDIT_TOKEN_BUDGET = 16000

/** Picks code per focus area from the local index, sharing one budget fairly between areas. */
export async function selectAuditChunks(
  index: ReturnType<typeof projectIndexRepo>,
  projectId: string,
  focusIds: string[],
): Promise<ChunkWithPath[]> {
  const focus = AUDIT_FOCUS.filter((f) => focusIds.includes(f.id))
  const perFocus = Math.floor(AUDIT_TOKEN_BUDGET / Math.max(1, focus.length))
  const picked = new Map<string, ChunkWithPath>()
  for (const f of focus) {
    const hits = await index.search(projectId, f.query, 25)
    const chunks = await index.getChunks(hits.map((h) => h.chunkId))
    let used = 0
    for (const c of chunks) {
      // Audit source code, not documentation, tests or lockfile-like data.
      if (/\.(md|mdx|txt|rst|json|lock)$/i.test(c.path) || /(^|\/)(tests?|__tests__|spec)\/|\.(test|spec)\./.test(c.path)) continue
      if (picked.has(c.id)) continue
      if (used + c.tokenEst > perFocus) continue
      picked.set(c.id, c)
      used += c.tokenEst
    }
  }
  return [...picked.values()]
}

export function buildAuditTask(project: { id: string; name: string }, context: AskContext, focusIds: string[]): CouncilTask<AuditReport> {
  const labels = AUDIT_FOCUS.filter((f) => focusIds.includes(f.id)).map((f) => f.label).join(', ')
  return {
    type: 'audit',
    projectId: project.id,
    taskBrief: render('audit-brief', { categories: labels, project_name: project.name, facts: context.facts, excerpts: context.excerpts }).text,
    judgeInstructions: render('audit-judge', { output_language: 'Turkish' }).text,
    judgeSchema: AuditReport,
  }
}

export function auditContext(chunks: ChunkWithPath[], facts: BrainFact[]): AskContext {
  return buildAskContext(chunks, facts)
}

/** Default council roles for the chosen focus areas, most specific first. */
export function auditRoles(focusIds: string[]): string[] {
  const roles = AUDIT_FOCUS.filter((f) => focusIds.includes(f.id)).flatMap((f) => f.roles)
  return [...new Set([...roles, 'code-auditor', 'critical-analyst'])]
}

/** Verifies the judge's evidence against what was actually sent, then stores findings. */
export async function saveAuditFindings(
  findings: ReturnType<typeof findingsRepo>,
  projectId: string,
  sessionId: string,
  report: CouncilReport<AuditReport>,
  context: AskContext,
): Promise<UpsertResult & { unverified: number }> {
  const sources = new Map<string, { text: string; firstLine: number }[]>()
  for (const e of context.sent) sources.set(e.path, [...(sources.get(e.path) ?? []), { text: e.text, firstLine: e.startLine }])
  let unverified = 0
  const items: NewFinding[] = report.judge.findings.map((f) => {
    const evidence = verifyCitations(f.evidence, sources)
    if (!evidence.some((e) => e.verified)) unverified++
    return {
      title: f.title,
      description: `${f.description}${f.estimated_effort ? `\n\nTahmini efor: ${f.estimated_effort}` : ''}`,
      category: f.category, severity: f.severity, confidence: f.confidence, evidence,
      impact: f.impact, risk: f.risk, urgency: f.urgency, effort: f.effort, suggestedFix: f.suggested_fix || null,
    }
  })
  const res = await findings.upsertMany(projectId, sessionId, items)
  return { ...res, unverified }
}
