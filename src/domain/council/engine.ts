import type { z } from 'zod'
import type { sessionsRepo, Round, SessionType } from '@/db/repositories/sessions'
import { costOf, estimateTokens, type PriceLookup } from '@/domain/cost/pricing'
import { render, roleBrief } from '@/domain/prompts/registry'
import { CancelledError, type AIProvider, type ProviderId } from '@/domain/providers/types'
import { CritiqueOutput, IndependentOutput } from './schemas'
import { acceptReviews, collectClaims, renderCritique, renderState, type Claim, type MemberAnalysis, type MissingPoint, type Review } from './state'
import { callStructured, type CallRecord, type StructuredRequest } from './structured'

export type CouncilMode = 'fast' | 'balanced'

export interface Participant {
  /** Stable id within the session, e.g. "p1"; the judge is "judge". */
  id: string
  provider: ProviderId
  model: string
  /** Role brief id from prompts/roles; ignored for the judge. */
  roleId: string
  maxTokens?: number
  temperature?: number
}

export interface CouncilConfig {
  mode: CouncilMode
  participants: Participant[]
  judge: Participant
  /** Hard cap in USD for the whole session. Unpriced models count as 0 and are reported. */
  budgetUsd?: number
  outputLanguage?: string
  /** Workflow-specific details stored with the session config (e.g. task prompt versions). */
  meta?: Record<string, unknown>
}

/** What a workflow (new idea, kill idea, audit...) plugs into the generic council. */
export interface CouncilTask<J> {
  type: SessionType
  ideaId?: string | null
  projectId?: string | null
  /** The subject plus what to analyse; shown to every member and the judge. */
  taskBrief: string
  /** Report-specific instructions for the judge. */
  judgeInstructions: string
  judgeSchema: z.ZodType<J>
}

export interface CouncilReport<J> {
  judge: J
  claims: Claim[]
  reviews: Review[]
  missing: MissingPoint[]
  /** Members whose analysis failed; the council continued without them. */
  failed: { participantId: string; error: string }[]
}

export type CouncilEvent =
  | { type: 'round'; round: Round }
  | { type: 'call'; participantId: string; status: 'start' | 'done' | 'failed'; error?: string }
  | { type: 'cost'; spentUsd: number; unpriced: string[] }

export interface CouncilDeps {
  provider: (id: ProviderId) => AIProvider
  sessions: ReturnType<typeof sessionsRepo>
  price: PriceLookup
  retryDelayMs?: number
}

export interface CouncilRun<J> {
  sessionId: string
  status: 'completed' | 'failed' | 'cancelled'
  report?: CouncilReport<J>
  error?: string
}

export class BudgetExceededError extends Error {
  constructor(spent: number, estimate: number, budget: number) {
    super(`budget: next round needs ~$${estimate.toFixed(3)}, spent $${spent.toFixed(3)} of $${budget.toFixed(2)}`)
    this.name = 'BudgetExceededError'
  }
}

class CouncilError extends Error {}

const DEFAULT_MAX_TOKENS = 8000
const JUDGE_MAX_TOKENS = 16000
/** Expected reply sizes used only for budgeting. */
const EXPECTED_OUTPUT: Record<'independent' | 'critique' | 'judge', number> = { independent: 2000, critique: 1500, judge: 4000 }
const CLAIM_TOKENS = 60

const language = (c: CouncilConfig) => c.outputLanguage ?? 'Turkish'

function memberVars(p: Participant, task: CouncilTask<unknown>, config: CouncilConfig) {
  const role = roleBrief(p.roleId)
  return { role_label: role.label, role_brief: role.brief, task_brief: task.taskBrief, output_language: language(config) }
}

/** Pre-run estimate for the UI; null when no participating model has a price. */
export function estimateCouncil(task: CouncilTask<unknown>, config: CouncilConfig, price: PriceLookup) {
  const n = config.participants.length
  const stateTokens = n * 10 * CLAIM_TOKENS
  const briefTokens = estimateTokens(task.taskBrief) + 500
  const calls: { p: Participant; input: number; output: number }[] = [
    ...config.participants.map((p) => ({ p, input: briefTokens, output: EXPECTED_OUTPUT.independent })),
    ...(config.mode === 'balanced'
      ? config.participants.map((p) => ({ p, input: briefTokens + stateTokens, output: EXPECTED_OUTPUT.critique }))
      : []),
    { p: config.judge, input: briefTokens + stateTokens * (config.mode === 'balanced' ? 2 : 1), output: EXPECTED_OUTPUT.judge },
  ]
  let usd = 0
  let pricedCalls = 0
  const unpriced = new Set<string>()
  for (const c of calls) {
    const cost = costOf(price(c.p.provider, c.p.model), { input: c.input, output: c.output, cached: 0 })
    if (cost === null) {
      unpriced.add(`${c.p.provider}/${c.p.model}`)
    } else {
      usd += cost
      pricedCalls++
    }
  }
  const tokens = calls.reduce((s, c) => s + c.input + c.output, 0)
  return { usd: pricedCalls ? usd : null, tokens, calls: calls.length, unpriced: [...unpriced] }
}

export async function runCouncil<J>(
  deps: CouncilDeps,
  task: CouncilTask<J>,
  config: CouncilConfig,
  opts: { signal?: AbortSignal; onEvent?: (e: CouncilEvent) => void } = {},
): Promise<CouncilRun<J>> {
  if (config.participants.length < 2) throw new Error('a council needs at least 2 participants')
  const emit = opts.onEvent ?? (() => {})
  const estimate = estimateCouncil(task, config, deps.price)
  const session = await deps.sessions.create({
    type: task.type,
    mode: config.mode,
    ideaId: task.ideaId ?? null,
    projectId: task.projectId ?? null,
    config: { ...config, outputLanguage: language(config) },
    estCost: estimate.usd,
  })
  await deps.sessions.markRunning(session.id)

  let spent = 0
  const unpriced = new Set<string>()

  async function persist(round: Round, p: Participant, call: CallRecord) {
    const cost = costOf(deps.price(p.provider, p.model), call.usage)
    if (cost === null && call.usage.input + call.usage.output > 0) unpriced.add(`${p.provider}/${p.model}`)
    spent += cost ?? 0
    await deps.sessions.addMessage({
      sessionId: session.id, round, participant: p.id, provider: p.provider, model: p.model,
      role: p.id === 'judge' ? 'judge' : p.roleId, promptId: call.prompt.id, promptVersion: call.prompt.version,
      responseText: call.text, responseJson: call.json ?? undefined, tokensIn: call.usage.input,
      tokensOut: call.usage.output, cachedTokens: call.usage.cached, cost: cost ?? 0,
      latencyMs: Math.round(call.latencyMs), error: call.error,
    })
    emit({ type: 'cost', spentUsd: spent, unpriced: [...unpriced] })
  }

  function checkBudget(calls: { p: Participant; inputText: string; expectedOut: number }[]) {
    if (config.budgetUsd === undefined) return
    const est = calls.reduce((sum, c) => {
      const usage = { input: estimateTokens(c.inputText), output: c.expectedOut, cached: 0 }
      return sum + (costOf(deps.price(c.p.provider, c.p.model), usage) ?? 0)
    }, 0)
    if (spent + est > config.budgetUsd) throw new BudgetExceededError(spent, est, config.budgetUsd)
  }

  async function ask<T>(round: Round, p: Participant, req: Omit<StructuredRequest, 'provider' | 'model' | 'maxTokens' | 'temperature' | 'signal'>, schema: z.ZodType<T>) {
    if (opts.signal?.aborted) throw new CancelledError()
    emit({ type: 'call', participantId: p.id, status: 'start' })
    const res = await callStructured(
      { ...req, provider: deps.provider(p.provider), model: p.model, maxTokens: p.maxTokens ?? (p.id === 'judge' ? JUDGE_MAX_TOKENS : DEFAULT_MAX_TOKENS), temperature: p.temperature, signal: opts.signal },
      schema,
      { retryDelayMs: deps.retryDelayMs },
    )
    for (const call of res.calls) await persist(round, p, call)
    emit({ type: 'call', participantId: p.id, status: res.data ? 'done' : 'failed', error: res.error ?? undefined })
    return res
  }

  try {
    // Round 1: independent analysis, in parallel, nobody sees anyone else.
    emit({ type: 'round', round: 'independent' })
    const r1Prompts = config.participants.map((p) => ({ p, system: render('council-independent', memberVars(p, task, config)) }))
    checkBudget(r1Prompts.map(({ p, system }) => ({ p, inputText: system.text, expectedOut: EXPECTED_OUTPUT.independent })))
    const r1 = await Promise.all(
      r1Prompts.map(({ p, system }) =>
        ask('independent', p, { system, user: 'Give your independent analysis now.', schemaName: 'independent_analysis' }, IndependentOutput),
      ),
    )
    const analyses: MemberAnalysis[] = []
    const failed: CouncilReport<J>['failed'] = []
    r1.forEach((res, i) => {
      const p = config.participants[i]!
      if (res.data) analyses.push({ participantId: p.id, roleLabel: roleBrief(p.roleId).label, output: res.data })
      else failed.push({ participantId: p.id, error: res.error ?? 'unknown error' })
    })
    if (analyses.length === 0) throw new CouncilError(`no member produced an analysis: ${failed.map((f) => f.error).join('; ')}`)
    const claims = collectClaims(analyses)

    // Round 2 (balanced): cross-review of the compact council state.
    const reviews: Review[] = []
    const missing: MissingPoint[] = []
    if (config.mode === 'balanced' && analyses.length >= 2) {
      emit({ type: 'round', round: 'critique' })
      const members = config.participants.filter((p) => analyses.some((a) => a.participantId === p.id))
      const r2Prompts = members.map((p) => ({
        p,
        system: render('council-critique', { ...memberVars(p, task, config), council_state: renderState(analyses, claims, p.id) }),
      }))
      checkBudget(r2Prompts.map(({ p, system }) => ({ p, inputText: system.text, expectedOut: EXPECTED_OUTPUT.critique })))
      const r2 = await Promise.all(
        r2Prompts.map(({ p, system }) =>
          ask('critique', p, { system, user: 'Give your cross-review now.', schemaName: 'cross_review' }, CritiqueOutput),
        ),
      )
      r2.forEach((res, i) => {
        const p = members[i]!
        if (!res.data) return // a missing review weakens the debate but is not fatal
        const label = roleBrief(p.roleId).label
        reviews.push(...acceptReviews(res.data, claims, p.id, label))
        missing.push(...res.data.missing.map((m) => ({ participantId: p.id, roleLabel: label, ...m })))
      })
    }

    // Final round: the judge weighs arguments and writes the task-specific report.
    emit({ type: 'round', round: 'judge' })
    const judgeSystem = render('council-judge', {
      task_brief: task.taskBrief,
      council_state: renderState(analyses, claims),
      critique_summary: renderCritique(claims, reviews, missing),
      judge_instructions: task.judgeInstructions,
      output_language: language(config),
    })
    checkBudget([{ p: config.judge, inputText: judgeSystem.text, expectedOut: EXPECTED_OUTPUT.judge }])
    const verdict = await ask('judge', config.judge, { system: judgeSystem, user: 'Write the final report now.', schemaName: 'final_report' }, task.judgeSchema)
    if (!verdict.data) throw new CouncilError(`judge failed: ${verdict.error}`)

    const report: CouncilReport<J> = { judge: verdict.data, claims, reviews, missing, failed }
    await deps.sessions.complete(session.id, report)
    return { sessionId: session.id, status: 'completed', report }
  } catch (e) {
    if (e instanceof CancelledError) {
      await deps.sessions.finishWithout(session.id, 'cancelled')
      return { sessionId: session.id, status: 'cancelled' }
    }
    const error = e instanceof Error ? e.message : String(e)
    await deps.sessions.finishWithout(session.id, 'failed', error)
    return { sessionId: session.id, status: 'failed', error }
  }
}
