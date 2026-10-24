import { modelLanguage } from '@/i18n'
import type { sessionsRepo } from '@/db/repositories/sessions'
import { costOf, type PriceLookup } from '@/domain/cost/pricing'
import { callStructured } from '@/domain/council/structured'
import { render } from '@/domain/prompts/registry'
import type { AIProvider, ProviderId } from '@/domain/providers/types'
import { renderProfile, type DiscoveryProfile } from './profile'
import { DiscoveryReport } from './report'

export interface FollowupDeps {
  provider: (id: ProviderId) => AIProvider
  sessions: ReturnType<typeof sessionsRepo>
  price: PriceLookup
}

export interface DiscoveryMeta {
  purpose: 'discovery' | 'discovery_followup'
  question: string
  profile: DiscoveryProfile
  /** Follow-ups only: the session whose report was revised, and the owner's follow-up. */
  parentSessionId?: string
  followup?: string
}

/**
 * One judge call that revises an existing discovery report for a follow-up question. Stored as its
 * own session so the original report stays untouched and both can be compared.
 */
export async function askFollowup(
  deps: FollowupDeps,
  parent: { sessionId: string; meta: DiscoveryMeta; report: DiscoveryReport },
  followup: string,
  model: { provider: ProviderId; model: string; maxTokens?: number },
  opts: { outputLanguage?: string; signal?: AbortSignal; onDelta?: (text: string) => void } = {},
): Promise<{ sessionId: string; report?: DiscoveryReport; error?: string }> {
  const language = opts.outputLanguage ?? modelLanguage()
  const system = render('discovery-followup', {
    profile: renderProfile(parent.meta.profile),
    question: parent.meta.question,
    report: JSON.stringify(parent.report),
    output_language: language,
  })
  const meta: DiscoveryMeta = { ...parent.meta, purpose: 'discovery_followup', parentSessionId: parent.sessionId, followup }
  const session = await deps.sessions.create({ type: 'new_idea', mode: 'fast', config: { meta, model, outputLanguage: language } })
  await deps.sessions.markRunning(session.id)
  const res = await callStructured(
    {
      provider: deps.provider(model.provider), model: model.model, maxTokens: model.maxTokens ?? 16000, system,
      user: followup, schemaName: 'discovery_report', signal: opts.signal, onDelta: opts.onDelta && ((t) => opts.onDelta!(t)),
    },
    DiscoveryReport,
  )
  for (const call of res.calls) {
    await deps.sessions.addMessage({
      sessionId: session.id, round: 'judge', participant: 'judge', provider: model.provider, model: model.model, role: 'judge',
      promptId: call.prompt.id, promptVersion: call.prompt.version, responseText: call.text, responseJson: call.json ?? undefined,
      tokensIn: call.usage.input, tokensOut: call.usage.output, cachedTokens: call.usage.cached,
      cost: costOf(deps.price(model.provider, model.model), call.usage) ?? 0, latencyMs: Math.round(call.latencyMs), error: call.error,
    })
  }
  if (!res.data) {
    await deps.sessions.finishWithout(session.id, 'failed', res.error)
    return { sessionId: session.id, error: res.error ?? 'unknown error' }
  }
  await deps.sessions.complete(session.id, res.data)
  return { sessionId: session.id, report: res.data }
}

export const discoveryMeta = (config: Record<string, unknown>): DiscoveryMeta | null => {
  const m = config.meta as Partial<DiscoveryMeta> | undefined
  return m?.purpose === 'discovery' || m?.purpose === 'discovery_followup' ? (m as DiscoveryMeta) : null
}
