import type { Idea } from '@/db/repositories/ideas'
import type { CouncilTask } from '@/domain/council/engine'
import { render } from '@/domain/prompts/registry'
import { IdeaReport } from './report'

export type IdeaMode = 'evaluate' | 'kill'

/** Default role sets; the user can change roles per participant before starting. */
export const ROLE_PRESETS: Record<IdeaMode, string[]> = {
  evaluate: ['product-strategist', 'critical-analyst', 'software-architect', 'market-analyst', 'cost-analyst', 'devils-advocate'],
  kill: ['devils-advocate', 'critical-analyst', 'market-analyst', 'cost-analyst', 'software-architect', 'product-strategist'],
}

export function buildIdeaTask(idea: Idea, mode: IdeaMode): CouncilTask<IdeaReport> & { promptVersions: Record<string, number> } {
  const vars = { idea_title: idea.title, idea_body: idea.body.trim() || '(no further description)' }
  const brief = render(mode === 'kill' ? 'idea-kill-brief' : 'idea-brief', vars)
  const judge = render(mode === 'kill' ? 'idea-kill-judge' : 'idea-judge', {})
  return {
    type: mode === 'kill' ? 'kill_idea' : 'new_idea',
    ideaId: idea.id,
    taskBrief: brief.text,
    judgeInstructions: judge.text,
    judgeSchema: IdeaReport,
    // The council prompts are recorded per message; these task prompts are recorded on the session.
    promptVersions: { [brief.id]: brief.version, [judge.id]: judge.version },
  }
}
