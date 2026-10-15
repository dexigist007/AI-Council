import { describe, expect, it } from 'vitest'
import { createTestDb } from './testing'
import { ideasRepo } from './repositories/ideas'
import { sessionsRepo } from './repositories/sessions'
import { decisionsRepo } from './repositories/decisions'
import { defaultProviderConfig, providerConfigsRepo } from './repositories/providerConfigs'

describe('migrations', () => {
  it('apply cleanly and reject invalid enum values', async () => {
    const db = createTestDb()
    await expect(
      db.execute("INSERT INTO ideas (id, title, status, created_at, updated_at) VALUES ('x','t','bogus','n','n')"),
    ).rejects.toThrow(/CHECK/)
  })
})

describe('ideas', () => {
  it('creates, lists and moves rejected ideas to the graveyard', async () => {
    const ideas = ideasRepo(createTestDb())
    const a = await ideas.create({ title: '  TV menu manager ', body: 'restaurants' })
    await ideas.create({ title: 'Other' })
    expect(a.title).toBe('TV menu manager')
    expect(a.status).toBe('draft')

    await ideas.setVerdict(a.id, { status: 'rejected', sessionId: null, rejectReason: 'crowded market',
      revisitCondition: 'a cheaper hardware option appears' })
    const graveyard = await ideas.listGraveyard()
    expect(graveyard).toHaveLength(1)
    expect(graveyard[0]).toMatchObject({ id: a.id, rejectReason: 'crowded market' })
    expect(await ideas.list({ statuses: ['draft'] })).toHaveLength(1)
  })
})

describe('sessions', () => {
  it('records messages and accumulates cost', async () => {
    const db = createTestDb()
    const idea = await ideasRepo(db).create({ title: 'x' })
    const sessions = sessionsRepo(db)
    const s = await sessions.create({ type: 'new_idea', mode: 'fast', ideaId: idea.id, config: { models: 2 } })
    expect(s.config).toEqual({ models: 2 })

    const base = { sessionId: s.id, round: 'independent' as const, participant: 'p1', provider: 'openai',
      model: 'm', role: 'critic', promptId: 'new-idea-analysis', promptVersion: 1, responseText: 'ok',
      tokensIn: 10, tokensOut: 5, cachedTokens: 0, latencyMs: 100, error: null }
    await sessions.addMessage({ ...base, cost: 0.01, responseJson: { claims: [] } })
    await sessions.addMessage({ ...base, participant: 'p2', cost: 0.02 })
    await sessions.complete(s.id, { decision: 'VALIDATE' })

    const done = (await sessions.get(s.id))!
    expect(done.status).toBe('completed')
    expect(done.actualCost).toBeCloseTo(0.03)
    expect(done.finalReport).toEqual({ decision: 'VALIDATE' })
    const msgs = await sessions.listMessages(s.id)
    expect(msgs.map((m) => m.participant)).toEqual(['p1', 'p2'])
    expect(msgs[0]!.responseJson).toEqual({ claims: [] })
    expect(msgs[1]!.responseJson).toBeNull()
    expect(await sessions.list({ ideaId: idea.id })).toHaveLength(1)
  })
})

describe('decisions', () => {
  it('only counts user-approved decisions', async () => {
    const decisions = decisionsRepo(createTestDb())
    const suggested = await decisions.create({ title: 'Use Postgres', userApproved: false })
    await decisions.create({ title: 'Use SQLite', reason: 'single user', userApproved: true })
    expect((await decisions.listApproved()).map((d) => d.title)).toEqual(['Use SQLite'])

    await decisions.approve(suggested.id)
    expect(await decisions.listApproved()).toHaveLength(2)
    expect(await decisions.listPending()).toHaveLength(0)
  })
})

describe('provider configs', () => {
  it('upserts and normalises blank models', async () => {
    const repo = providerConfigsRepo(createTestDb())
    await repo.save({ ...defaultProviderConfig('openai'), defaultModel: '  ' })
    await repo.save({ ...defaultProviderConfig('openai'), enabled: true, defaultModel: ' m1 ', maxTokens: 8000 })
    expect(await repo.list()).toEqual([
      { provider: 'openai', enabled: true, defaultModel: 'm1', temperature: null, maxTokens: 8000 },
    ])
  })
})
