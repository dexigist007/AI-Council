import { modelLanguage, t } from '@/i18n'
import { z } from 'zod'
import type { BrainFact, brainFactsRepo } from '@/db/repositories/brainFacts'
import type { sessionsRepo } from '@/db/repositories/sessions'
import { costOf, type PriceLookup } from '@/domain/cost/pricing'
import { callStructured } from '@/domain/council/structured'
import { render } from '@/domain/prompts/registry'
import type { AIProvider, ProviderId } from '@/domain/providers/types'
import type { BrainContext } from './context'
import { BRAIN_SECTIONS } from './sections'

export const BrainDraft = z.object({
  facts: z
    .array(
      z.object({
        section: z.enum(BRAIN_SECTIONS),
        statement: z.string().min(1),
        confidence: z.enum(['high', 'medium', 'low']),
        evidence_files: z.array(z.string()),
      }),
    )
    .max(50),
})

export interface DraftDeps {
  provider: (id: ProviderId) => AIProvider
  sessions: ReturnType<typeof sessionsRepo>
  brain: ReturnType<typeof brainFactsRepo>
  price: PriceLookup
}

export interface DraftModel {
  provider: ProviderId
  model: string
  maxTokens?: number
}

export interface DraftResult {
  sessionId: string
  added: number
  /** Evidence paths the model cited that do not exist in the index (dropped). */
  droppedEvidence: string[]
  error?: string
}

/**
 * One model call that proposes brain facts. Everything it returns is stored as INFERRED and
 * pending: nothing becomes part of the brain until the user confirms it.
 */
export async function generateBrainDraft(
  deps: DraftDeps,
  project: { id: string; name: string },
  context: BrainContext,
  stack: BrainFact[],
  knownPaths: Set<string>,
  model: DraftModel,
  opts: { outputLanguage?: string; signal?: AbortSignal } = {},
): Promise<DraftResult> {
  const system = render('project-brain-draft', {
    project_name: project.name,
    stack: stack.map((f) => `- ${f.statement}`).join('\n') || '(none detected)',
    tree: context.tree,
    documents: context.documents,
    output_language: opts.outputLanguage ?? modelLanguage(),
  })
  const session = await deps.sessions.create({
    type: 'ask_project', // single-model project analysis; the purpose is recorded in config
    mode: 'fast',
    projectId: project.id,
    config: { meta: { purpose: 'brain_draft' }, model },
  })
  await deps.sessions.markRunning(session.id)

  const res = await callStructured(
    { provider: deps.provider(model.provider), model: model.model, maxTokens: model.maxTokens ?? 8000, system, user: 'Write the project facts now.', schemaName: 'brain_draft', signal: opts.signal },
    BrainDraft,
    {},
  )
  for (const call of res.calls) {
    await deps.sessions.addMessage({
      sessionId: session.id, round: 'utility', participant: 'brain', provider: model.provider, model: model.model, role: null,
      promptId: call.prompt.id, promptVersion: call.prompt.version, requestFiles: context.files, responseText: call.text,
      responseJson: call.json ?? undefined, tokensIn: call.usage.input, tokensOut: call.usage.output, cachedTokens: call.usage.cached,
      cost: costOf(deps.price(model.provider, model.model), call.usage) ?? 0, latencyMs: Math.round(call.latencyMs), error: call.error,
    })
  }
  if (!res.data) {
    await deps.sessions.finishWithout(session.id, 'failed', res.error)
    return { sessionId: session.id, added: 0, droppedEvidence: [], error: res.error ?? 'unknown error' }
  }

  const dropped: string[] = []
  const facts = res.data.facts.map((f) => {
    const evidence = f.evidence_files.filter((p) => {
      const ok = knownPaths.has(p)
      if (!ok) dropped.push(p)
      return ok
    })
    const statement = f.confidence === 'low' && !/^\s*\(?(muhtemelen|probably)/i.test(f.statement) ? `(${t('common.confidence.low')}) ${f.statement}` : f.statement
    return { section: f.section, statement, evidence: evidence.map((file) => ({ file })) }
  })
  await deps.brain.replacePendingInferred(project.id, facts, session.id)
  await deps.sessions.complete(session.id, { facts: facts.length, droppedEvidence: dropped })
  return { sessionId: session.id, added: facts.length, droppedEvidence: [...new Set(dropped)] }
}
