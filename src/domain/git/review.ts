import type { BrainFact } from '@/db/repositories/brainFacts'
import { redact } from '@/domain/context/redactor'
import type { CouncilTask } from '@/domain/council/engine'
import { AuditReport } from '@/domain/audit/report'
import { render } from '@/domain/prompts/registry'
import { estimateTokens } from '@/domain/cost/pricing'
import type { DiffFile } from './parse'

/** Changes larger than this are cut (the user sees which files were left out). */
const REVIEW_TOKEN_BUDGET = 16000
const SKIP = /(^|\/)(package-lock\.json|yarn\.lock|pnpm-lock\.yaml|Cargo\.lock|composer\.lock|Podfile\.lock|go\.sum)$|\.(min\.js|map|svg|snap)$|(^|\/)\.env/i

export interface ReviewContext {
  facts: string
  diff: string
  files: string[]
  skipped: { path: string; reason: string }[]
  /** New-side text of every hunk, for verifying citations. */
  sources: Map<string, { text: string; firstLine: number }[]>
  redactions: number
  tokens: number
}

const FACT_LABEL = { user_confirmed: 'confirmed', observed: 'observed', inferred: 'unconfirmed' } as const

/**
 * Renders the diff for the model: new-file line numbers on kept lines, "+" for added, "-" for
 * removed (no number). Each hunk's new-side lines form one contiguous source for evidence checks.
 */
export function buildReviewContext(files: DiffFile[], facts: BrainFact[]): ReviewContext {
  const parts: string[] = []
  const included: string[] = []
  const skipped: ReviewContext['skipped'] = []
  const sources: ReviewContext['sources'] = new Map()
  let redactions = 0
  let used = 0
  for (const f of files) {
    if (f.binary) { skipped.push({ path: f.path, reason: 'binary' }); continue }
    if (SKIP.test(f.path)) { skipped.push({ path: f.path, reason: 'lock/generated/sensitive' }); continue }
    if (f.status === 'deleted') { skipped.push({ path: f.path, reason: 'deleted' }); continue }
    const header = `=== ${f.path} (${f.status}${f.oldPath ? ` from ${f.oldPath}` : ''}, +${f.additions} -${f.deletions}) ===`
    const body: string[] = []
    for (const h of f.hunks) {
      const newSide: string[] = []
      body.push(`@@ new line ${h.newStart} @@`)
      for (const l of h.lines) {
        const r = redact(l.text)
        redactions += r.count
        if (l.type === '-') body.push(`-     | ${r.text}`)
        else {
          body.push(`${l.type === '+' ? '+' : ' '}${String(l.newLine).padStart(5)}| ${r.text}`)
          newSide.push(r.text)
        }
      }
      if (newSide.length) sources.set(f.path, [...(sources.get(f.path) ?? []), { text: newSide.join('\n'), firstLine: h.newStart }])
    }
    const block = [header, ...body].join('\n')
    const cost = estimateTokens(block)
    if (used + cost > REVIEW_TOKEN_BUDGET) { skipped.push({ path: f.path, reason: 'budget' }); sources.delete(f.path); continue }
    used += cost
    parts.push(block)
    included.push(f.path)
  }
  const factText = facts.filter((f) => f.status !== 'rejected').map((f) => `- [${FACT_LABEL[f.source]}] (${f.section}) ${redact(f.statement).text}`).join('\n')
  return {
    facts: factText || '(no project facts yet)',
    diff: parts.join('\n\n') || '(no reviewable changes)',
    files: included,
    skipped,
    sources,
    redactions,
    tokens: used + estimateTokens(factText) + 700,
  }
}

export function buildReviewTask(project: { id: string; name: string }, target: string, ctx: ReviewContext): CouncilTask<AuditReport> {
  return {
    type: 'review_changes',
    projectId: project.id,
    taskBrief: render('review-changes', { project_name: project.name, target, facts: ctx.facts, diff: ctx.diff }).text,
    judgeInstructions: render('audit-judge', { output_language: 'Turkish' }).text,
    judgeSchema: AuditReport,
  }
}

export const REVIEW_ROLES = ['code-auditor', 'security-reviewer', 'critical-analyst', 'performance-engineer']
