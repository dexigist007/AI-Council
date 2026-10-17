import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { createTestDb } from '@/db/testing'
import { sessionsRepo } from '@/db/repositories/sessions'
import { priceLookup } from '@/domain/cost/pricing'
import type { AIProvider, ChatRequest } from '@/domain/providers/types'
import { runCouncil, type CouncilConfig, type CouncilEvent } from './engine'
import { applyEvent, emptyFeed, feedFromReport, feedMembers, liveFragments } from './feed'

const analysis = (tag: string) => JSON.stringify({
  summary: `${tag} view`,
  claims: [{ text: `${tag} strength`, type: 'strength', confidence: 'high' }, { text: `${tag} risk`, type: 'risk', confidence: 'low' }],
})

/** Streams every reply in two chunks so delta events are exercised. */
function streamingProvider(): AIProvider {
  let r1 = 0
  return {
    id: 'openai', capabilities: { jsonSchema: true }, listModels: async () => [],
    async chat(req: ChatRequest, opts) {
      const sys = req.system ?? ''
      const text = sys.includes('judge of an AI council')
        ? JSON.stringify({ ok: true })
        : sys.includes('## Council state')
          ? JSON.stringify({ reviews: [{ claim_id: 'C1', stance: 'disagree', reason: 'nope' }], missing: [] })
          : analysis(`m${++r1}`)
      const mid = Math.floor(text.length / 2)
      opts?.onDelta?.(text.slice(0, mid))
      opts?.onDelta?.(text.slice(mid))
      return { text, usage: { input: 10, output: 10, cached: 0 }, finishReason: 'stop' }
    },
  }
}

const config: CouncilConfig = {
  mode: 'balanced',
  participants: [
    { id: 'p1', provider: 'openai', model: 'a', roleId: 'product-strategist' },
    { id: 'p2', provider: 'openai', model: 'b', roleId: 'devils-advocate' },
  ],
  judge: { id: 'judge', provider: 'openai', model: 'j', roleId: 'judge' },
}

describe('debate feed', () => {
  it('follows a live council: streams, analyses with ids, reviews, and clears live text', async () => {
    const db = createTestDb()
    const provider = streamingProvider()
    const feed = emptyFeed(feedMembers(config.participants, config.judge, (id) => id))
    const events: CouncilEvent[] = []
    const run = await runCouncil(
      { provider: () => provider, sessions: sessionsRepo(db), price: priceLookup([]), retryDelayMs: 0 },
      { type: 'new_idea', taskBrief: 'x', judgeInstructions: 'y', judgeSchema: z.object({ ok: z.boolean() }) },
      config,
      { onEvent: (e) => { events.push(e); applyEvent(feed, e) } },
    )
    expect(run.status).toBe('completed')
    expect(events.some((e) => e.type === 'delta' && e.participantId === 'judge')).toBe(true)
    expect(feed.analyses.map((a) => a.participantId).sort()).toEqual(['p1', 'p2'])
    expect(feed.analyses.flatMap((a) => a.claims.map((c) => c.id)).sort()).toEqual(['C1', 'C2', 'C3', 'C4'])
    // p1 authored C1, so only p2's review of C1 is accepted.
    const reviewed = feed.reviews.flatMap((r) => r.reviews)
    expect(reviewed.every((r) => r.claimId === 'C1' && r.participantId !== 'p1')).toBe(true)
    expect(feed.live).toEqual({})
    expect(run.report!.positions!.map((p) => p.summary).sort()).toEqual(['m1 view', 'm2 view'])

    const rebuilt = feedFromReport(feed.members, run.report!)
    expect(rebuilt.analyses.map((a) => a.summary).sort()).toEqual(['m1 view', 'm2 view'])
    expect(rebuilt.reviews.flatMap((r) => r.reviews)).toEqual(reviewed)
  })

  it('restarts live text on a retry instead of appending to the broken reply', () => {
    const feed = emptyFeed([])
    applyEvent(feed, { type: 'delta', participantId: 'p1', round: 'independent', text: '{"broken', attempt: 0 })
    applyEvent(feed, { type: 'delta', participantId: 'p1', round: 'independent', text: '{"ok', attempt: 1 })
    expect(feed.live.p1!.text).toBe('{"ok')
    applyEvent(feed, { type: 'call', participantId: 'p1', status: 'failed', error: 'boom' })
    expect(feed.live.p1).toBeUndefined()
    expect(feed.failed.p1).toBe('boom')
  })

  it('shows readable fragments of half-written JSON', () => {
    const partial = '{"summary":"Pazar \\"kalabalık\\" ama","claims":[{"text":"Restoranlar öder","type":"strength"},{"text":"Uygulama mağazası onayı'
    expect(liveFragments(partial)).toEqual(['Pazar "kalabalık" ama', 'Restoranlar öder', 'Uygulama mağazası onayı…'])
  })
})
