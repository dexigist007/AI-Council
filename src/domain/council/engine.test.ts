import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { createTestDb } from '@/db/testing'
import { sessionsRepo } from '@/db/repositories/sessions'
import { priceLookup } from '@/domain/cost/pricing'
import { CancelledError, ProviderError, type AIProvider, type ChatRequest, type ProviderId } from '@/domain/providers/types'
import { runCouncil, type CouncilConfig, type CouncilTask } from './engine'

const Verdict = z.object({ decision: z.enum(['BUILD', 'REJECT']), reasons: z.array(z.string()) })

const task: CouncilTask<z.infer<typeof Verdict>> = {
  type: 'new_idea',
  taskBrief: 'Idea: digital TV menus for restaurants.',
  judgeInstructions: 'Decide BUILD or REJECT.',
  judgeSchema: Verdict,
}

const analysis = (tag: string) => JSON.stringify({
  summary: `${tag} view`,
  claims: [
    { text: `${tag} strength`, type: 'strength', confidence: 'high' },
    { text: `${tag} risk`, type: 'risk', confidence: 'medium' },
  ],
})

type Reply = string | Error | ((req: ChatRequest) => string)

/** Fake provider: picks a scripted reply by round, inferred from the system prompt. */
function fakeProvider(script: { independent?: Reply[]; critique?: Reply; judge?: Reply[] } = {}) {
  const seen: { round: string; req: ChatRequest }[] = []
  let r1 = 0
  let jd = 0
  const provider: AIProvider = {
    id: 'openai',
    capabilities: { jsonSchema: true },
    listModels: async () => [],
    async chat(req, opts) {
      if (opts?.signal?.aborted) throw new CancelledError()
      const sys = req.system ?? ''
      const round = sys.includes('judge of an AI council') ? 'judge' : sys.includes('## Council state') ? 'critique' : 'independent'
      seen.push({ round, req })
      let reply: Reply | undefined
      if (round === 'independent') reply = script.independent?.[r1++] ?? analysis(`m${r1}`)
      else if (round === 'critique') reply = script.critique ?? JSON.stringify({
        reviews: [{ claim_id: 'C1', stance: 'disagree', reason: 'too optimistic' }, { claim_id: 'C99', stance: 'agree', reason: 'x' }],
        missing: [{ text: 'hardware cost', type: 'risk', confidence: 'high' }],
      })
      else reply = script.judge?.[jd++] ?? JSON.stringify({ decision: 'REJECT', reasons: ['crowded'] })
      if (reply instanceof Error) throw reply
      const text = typeof reply === 'function' ? reply(req) : reply
      return { text, usage: { input: 1000, output: 500, cached: 0 }, finishReason: 'stop' }
    },
  }
  return { provider, seen }
}

function setup(provider: AIProvider, prices = true) {
  const db = createTestDb()
  const sessions = sessionsRepo(db)
  const price = priceLookup(prices ? [{ provider: 'openai', model: 'm', inPerMtok: 1, outPerMtok: 10, cachedPerMtok: null }] : [])
  return { sessions, deps: { provider: (_: ProviderId) => provider, sessions, price, retryDelayMs: 0 } }
}

const participants = (n: number, roles = ['product-strategist', 'critical-analyst', 'devils-advocate']) =>
  Array.from({ length: n }, (_, i) => ({ id: `p${i + 1}`, provider: 'openai' as const, model: 'm', roleId: roles[i]! }))

const config = (mode: CouncilConfig['mode'], n = 3, extra: Partial<CouncilConfig> = {}): CouncilConfig => ({
  mode, participants: participants(n), judge: { id: 'judge', provider: 'openai', model: 'm', roleId: 'judge' }, ...extra,
})

describe('runCouncil', () => {
  it('runs independent → critique → judge in balanced mode and persists every call', async () => {
    const { provider, seen } = fakeProvider()
    const { deps, sessions } = setup(provider)
    const events: string[] = []
    const run = await runCouncil(deps, task, config('balanced'), { onEvent: (e) => e.type === 'round' && events.push(e.round) })

    expect(run.status).toBe('completed')
    expect(events).toEqual(['independent', 'critique', 'judge'])
    expect(run.report!.judge.decision).toBe('REJECT')
    expect(run.report!.claims.map((c) => c.id)).toEqual(['C1', 'C2', 'C3', 'C4', 'C5', 'C6'])
    // p1 wrote C1, so only p2 and p3 reviews of C1 count; the unknown C99 is dropped.
    expect(run.report!.reviews.map((r) => `${r.claimId}:${r.participantId}`)).toEqual(['C1:p2', 'C1:p3'])
    expect(run.report!.missing).toHaveLength(3)

    const critique = seen.find((s) => s.round === 'critique')!.req.system!
    expect(critique).toContain('C1 [strength, high]')
    expect(critique).toContain('(you)')
    expect(critique).not.toContain('m1 view\n\n') // rendered as compact state, not raw replies
    const judge = seen.find((s) => s.round === 'judge')!.req.system!
    expect(judge).toContain('Critical Analyst: disagree — too optimistic')
    expect(judge).toContain('hardware cost')

    const session = (await sessions.get(run.sessionId))!
    expect(session.status).toBe('completed')
    expect(session.estCost).toBeGreaterThan(0)
    const msgs = await sessions.listMessages(run.sessionId)
    expect(msgs.map((m) => m.round)).toEqual(['independent', 'independent', 'independent', 'critique', 'critique', 'critique', 'judge'])
    expect(msgs[0]).toMatchObject({ promptId: 'council-independent', promptVersion: 2, role: 'product-strategist' })
    // 7 calls × (1000 in × $1 + 500 out × $10) / 1M = $0.042
    expect(session.actualCost).toBeCloseTo(0.042)
  })

  it('skips the critique round in fast mode', async () => {
    const { provider, seen } = fakeProvider()
    const run = await runCouncil(setup(provider).deps, task, config('fast', 2))
    expect(run.status).toBe('completed')
    expect(seen.map((s) => s.round)).toEqual(['independent', 'independent', 'judge'])
    expect(run.report!.reviews).toEqual([])
  })

  it('continues without a member that fails and records why', async () => {
    const { provider } = fakeProvider({ independent: [new ProviderError('openai', 'bad_request', 'model not found', 404)] })
    const run = await runCouncil(setup(provider).deps, task, config('balanced'))
    expect(run.status).toBe('completed')
    expect(run.report!.failed).toEqual([{ participantId: 'p1', error: '[openai] model not found' }])
    expect(new Set(run.report!.claims.map((c) => c.participantId))).toEqual(new Set(['p2', 'p3']))
  })

  it('retries a transient error once and repairs invalid JSON once', async () => {
    const { provider, seen } = fakeProvider({
      independent: [new ProviderError('openai', 'rate_limit', 'slow down', 429), analysis('a'), '```json\n{"summary": 1}\n```', analysis('b'), analysis('c')],
    })
    const { deps, sessions } = setup(provider)
    const run = await runCouncil(deps, task, config('fast'))
    expect(run.status).toBe('completed')
    expect(run.report!.failed).toEqual([])
    const repair = seen.find((s) => s.req.messages.length === 3)!
    expect(repair.req.messages[2]!.content).toContain('summary')
    const msgs = await sessions.listMessages(run.sessionId)
    expect(msgs.filter((m) => m.error).map((m) => m.promptId)).toEqual(['council-independent', 'council-independent'])
    expect(msgs.some((m) => m.promptId === 'json-repair' && !m.error)).toBe(true)
  })

  it('fails the session when the judge cannot produce a valid report', async () => {
    const { provider } = fakeProvider({ judge: ['not json', '{"decision":"MAYBE","reasons":[]}'] })
    const { deps, sessions } = setup(provider)
    const run = await runCouncil(deps, task, config('fast', 2))
    expect(run.status).toBe('failed')
    expect(run.error).toMatch(/judge failed/)
    expect((await sessions.get(run.sessionId))!.status).toBe('failed')
  })

  it('stops before a round that would exceed the budget', async () => {
    const { provider, seen } = fakeProvider()
    // Estimates assume full expected replies: round 1 ≈ 2 × (2000 out × $10/M) ≈ $0.041 fits in $0.045.
    // After it, $0.010 is spent and the judge round (4000 out ≈ $0.041) would exceed the cap.
    const run = await runCouncil(setup(provider).deps, task, config('fast', 2, { budgetUsd: 0.045 }))
    expect(run.status).toBe('failed')
    expect(run.error).toMatch(/^budget/)
    expect(seen.map((s) => s.round)).toEqual(['independent', 'independent'])
  })

  it('marks the session cancelled when aborted', async () => {
    const controller = new AbortController()
    const { provider } = fakeProvider({ independent: [() => { controller.abort(); return analysis('a') }] })
    const { deps, sessions } = setup(provider)
    const run = await runCouncil(deps, task, config('balanced', 2), { signal: controller.signal })
    expect(run.status).toBe('cancelled')
    expect((await sessions.get(run.sessionId))!.status).toBe('cancelled')
  })

  it('rejects a council with fewer than two members', async () => {
    const { provider } = fakeProvider()
    await expect(runCouncil(setup(provider).deps, task, config('fast', 1))).rejects.toThrow(/at least 2/)
  })
})
