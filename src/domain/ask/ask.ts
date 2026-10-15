import { z } from 'zod'
import type { sessionsRepo } from '@/db/repositories/sessions'
import { costOf, type PriceLookup } from '@/domain/cost/pricing'
import { verifyCitations, type VerifiedCitation } from '@/domain/context/evidence'
import { callStructured } from '@/domain/council/structured'
import { render } from '@/domain/prompts/registry'
import type { AIProvider, ProviderId } from '@/domain/providers/types'
import type { AskContext } from './context'

export const AskAnswer = z.object({
  answer: z.string(),
  citations: z.array(z.object({ file: z.string(), start_line: z.number().int(), end_line: z.number().int(), quote: z.string() })),
  confidence: z.enum(['high', 'medium', 'low']),
  missing_context: z.array(z.string()),
})

export interface AskReport {
  question: string
  answer: string
  confidence: 'high' | 'medium' | 'low'
  citations: VerifiedCitation[]
  missingContext: string[]
  sentFiles: string[]
  searchTerms: string
}

export interface AskDeps {
  provider: (id: ProviderId) => AIProvider
  sessions: ReturnType<typeof sessionsRepo>
  price: PriceLookup
}

export async function askProject(
  deps: AskDeps,
  project: { id: string; name: string },
  question: string,
  searchTerms: string,
  context: AskContext,
  model: { provider: ProviderId; model: string; maxTokens?: number },
  opts: { outputLanguage?: string; signal?: AbortSignal } = {},
): Promise<{ sessionId: string; report?: AskReport; error?: string }> {
  const system = render('ask-project', {
    project_name: project.name,
    facts: context.facts,
    excerpts: context.excerpts,
    output_language: opts.outputLanguage ?? 'Turkish',
  })
  const session = await deps.sessions.create({
    type: 'ask_project',
    mode: 'fast',
    projectId: project.id,
    config: { meta: { purpose: 'ask', question }, model },
  })
  await deps.sessions.markRunning(session.id)
  const res = await callStructured(
    { provider: deps.provider(model.provider), model: model.model, maxTokens: model.maxTokens ?? 8000, system, user: question, schemaName: 'project_answer', signal: opts.signal },
    AskAnswer,
  )
  for (const call of res.calls) {
    await deps.sessions.addMessage({
      sessionId: session.id, round: 'utility', participant: 'ask', provider: model.provider, model: model.model, role: null,
      promptId: call.prompt.id, promptVersion: call.prompt.version, requestFiles: context.files, responseText: call.text,
      responseJson: call.json ?? undefined, tokensIn: call.usage.input, tokensOut: call.usage.output, cachedTokens: call.usage.cached,
      cost: costOf(deps.price(model.provider, model.model), call.usage) ?? 0, latencyMs: Math.round(call.latencyMs), error: call.error,
    })
  }
  if (!res.data) {
    await deps.sessions.finishWithout(session.id, 'failed', res.error)
    return { sessionId: session.id, error: res.error ?? 'unknown error' }
  }

  // Citations are checked against exactly what the model was shown.
  const sources = new Map<string, { text: string; firstLine: number }[]>()
  for (const e of context.sent) sources.set(e.path, [...(sources.get(e.path) ?? []), { text: e.text, firstLine: e.startLine }])
  const report: AskReport = {
    question,
    answer: res.data.answer,
    confidence: res.data.confidence,
    citations: verifyCitations(res.data.citations, sources),
    missingContext: res.data.missing_context,
    sentFiles: context.files,
    searchTerms,
  }
  await deps.sessions.complete(session.id, report)
  return { sessionId: session.id, report }
}
