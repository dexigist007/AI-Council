import type { CouncilTask } from '@/domain/council/engine'
import { t } from '@/i18n'
import { render } from '@/domain/prompts/registry'
import { renderProfile, type DiscoveryProfile } from './profile'
import { DiscoveryReport, type CandidateKind } from './report'

export interface DiscoveryInput {
  question: string
  kinds: CandidateKind[]
  profile: DiscoveryProfile
}

/** Opportunity hunting needs different eyes than idea review; still editable per member. */
export const DISCOVERY_ROLES = ['opportunity-hunter', 'indie-hacker', 'devils-advocate', 'game-designer', 'cost-analyst', 'market-analyst']

const KIND_LABEL: Record<CandidateKind, string> = {
  app: 'mobile or desktop app', game: 'game', saas: 'SaaS / web tool', service: 'service or freelancing productised',
  content: 'content / audience / info product', ecommerce: 'e-commerce or digital goods', other: 'anything else',
}

export function buildDiscoveryTask(input: DiscoveryInput): CouncilTask<DiscoveryReport> & { promptVersions: Record<string, number> } {
  const brief = render('discovery-brief', {
    question: input.question.trim(),
    profile: renderProfile(input.profile),
    kinds: input.kinds.length ? input.kinds.map((k) => KIND_LABEL[k]).join(', ') : 'any kind',
  })
  const judge = render('discovery-judge', {})
  return {
    type: 'new_idea',
    ideaId: null,
    taskBrief: brief.text,
    judgeInstructions: judge.text,
    judgeSchema: DiscoveryReport,
    promptVersions: { [brief.id]: brief.version, [judge.id]: judge.version },
  }
}

/** Idea body for "turn into idea": enough context for a full council evaluation later. */
export function candidateToIdea(c: DiscoveryReport['candidates'][number]): { title: string; body: string } {
  const list = (xs: string[]) => xs.map((x) => `- ${x}`).join('\n')
  return {
    title: c.name,
    body: [
      c.one_liner,
      t('ideas.candidateIdea.targetCustomer', { value: c.target_customer }),
      t('ideas.candidateIdea.problem', { value: c.problem }),
      t('ideas.candidateIdea.solution', { value: c.solution }),
      t('ideas.candidateIdea.revenueModel', { model: c.revenue_model, pricing: c.pricing }),
      t('ideas.candidateIdea.firstRevenuePath', { value: c.first_revenue_path }),
      `${t('ideas.candidateIdea.assumptions')}\n${list(c.key_assumptions)}`,
      `${t('ideas.candidateIdea.risks')}\n${list(c.main_risks)}`,
    ].join('\n\n'),
  }
}
