import { describe, expect, it } from 'vitest'
import { createTestDb } from '@/db/testing'
import { sessionsRepo } from '@/db/repositories/sessions'
import { settingsRepo } from '@/db/repositories/settings'
import { priceLookup } from '@/domain/cost/pricing'
import type { AIProvider } from '@/domain/providers/types'
import { askFollowup, discoveryMeta, type DiscoveryMeta } from './followup'
import { EMPTY_PROFILE, parseProfile, renderProfile } from './profile'
import { DiscoveryReport, type Candidate } from './report'
import { buildDiscoveryTask, candidateToIdea } from './task'

const candidate: Candidate = {
  rank: 1, name: 'Menü QR', kind: 'saas', one_liner: 'QR menü', why_this_fits_you: 'restoran ağı', target_customer: 'Kadıköy kafeleri',
  problem: 'basılı menü', solution: 'QR', revenue_model: 'abonelik', pricing: '₺300/ay', first_revenue_path: '10 kafeye yüz yüze',
  time_to_first_revenue: '2-3 hafta', startup_cost: '$20', weekly_hours: '10',
  revenue_scenarios: {
    pessimistic: { amount: '₺0', assumption: 'kimse ödemez' },
    realistic: { amount: '₺900-1.500', assumption: '3-5 kafe' },
    optimistic: { amount: '₺4.500', assumption: '15 kafe' },
  },
  unit_economics: 'barındırma ₺50', competition: 'ücretsiz QR araçları', differentiation: 'kurulum hizmeti',
  distribution_channels: ['yüz yüze'], key_assumptions: ['kafeler öder'], main_risks: ['ücretsiz rakipler'],
  validation_plan: [{ day: '1-2', action: '20 kafeye git', success_signal: '3 ön sipariş' }],
  kill_criteria: ['20 ziyarette 0 ilgi'], first_30_days: ['MVP'], confidence: 'medium', supporting_claims: ['C1'],
}
const report: DiscoveryReport = { summary: 's', reality_check: ['r'], candidates: [candidate], rejected: [], disagreements: [], open_questions: [] }

describe('discovery', () => {
  it('builds a task with the question, constraints and kinds, and flags blank constraints', () => {
    const t = buildDiscoveryTask({ question: 'Hızlı para', kinds: ['game', 'saas'], profile: { ...EMPTY_PROFILE, skills: 'Android' } })
    expect(t.taskBrief).toContain('Hızlı para')
    expect(t.taskBrief).toContain('Skills and experience: Android')
    expect(t.taskBrief).toContain('Budget to invest: not stated')
    expect(t.taskBrief).toContain('game, SaaS / web tool')
    expect(t).toMatchObject({ type: 'new_idea', ideaId: null, promptVersions: { 'discovery-brief': 1, 'discovery-judge': 1 } })
    expect(DiscoveryReport.safeParse(report).success).toBe(true)
  })

  it('parses stored profiles defensively and stores them in settings', async () => {
    expect(parseProfile(null)).toEqual(EMPTY_PROFILE)
    expect(parseProfile({ skills: 'x', budget: 5 }).budget).toBe(EMPTY_PROFILE.budget)
    expect(renderProfile(EMPTY_PROFILE)).toContain('Wanted time to first revenue: 1 month')
    // Profiles saved with the old Turkish labels still load and render in English.
    expect(parseProfile({ timeToRevenue: '3 ay' }).timeToRevenue).toBe('3m')
    expect(renderProfile({ ...EMPTY_PROFILE, timeToRevenue: '2 hafta' })).toContain('Wanted time to first revenue: 2 weeks')
    const settings = settingsRepo(createTestDb())
    expect(await settings.get('k')).toBeNull()
    await settings.set('k', { skills: 'a' })
    await settings.set('k', { skills: 'b' })
    expect(await settings.get('k')).toEqual({ skills: 'b' })
  })

  it('turns a candidate into an idea with its key context', () => {
    const idea = candidateToIdea(candidate)
    expect(idea.title).toBe('Menü QR')
    expect(idea.body).toContain('10 kafeye yüz yüze')
    expect(idea.body).toContain('- ücretsiz rakipler')
  })

  it('answers a follow-up as a separate session linked to the parent', async () => {
    const sessions = sessionsRepo(createTestDb())
    let system = ''
    const provider: AIProvider = {
      id: 'groq', capabilities: { jsonSchema: false }, listModels: async () => [],
      async chat(req) {
        system = req.system ?? ''
        return { text: JSON.stringify({ ...report, summary: 'revised' }), usage: { input: 1, output: 1, cached: 0 }, finishReason: 'stop' }
      },
    }
    const meta: DiscoveryMeta = { purpose: 'discovery', question: 'Hızlı para', profile: EMPTY_PROFILE }
    const res = await askFollowup({ provider: () => provider, sessions, price: priceLookup([]) }, { sessionId: 'parent', meta, report }, 'Oyun olsaydı?', { provider: 'groq', model: 'llama' })
    expect(res.report!.summary).toBe('revised')
    expect(system).toContain('"name":"Menü QR"')
    const stored = (await sessions.get(res.sessionId))!
    expect(stored.status).toBe('completed')
    expect(discoveryMeta(stored.config)).toMatchObject({ purpose: 'discovery_followup', parentSessionId: 'parent', followup: 'Oyun olsaydı?' })
    expect(discoveryMeta({ meta: { purpose: 'ask' } })).toBeNull()
  })
})
