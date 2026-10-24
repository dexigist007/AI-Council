import type { IdeaStatus } from '@/db/repositories/ideas'
import { t } from '@/i18n'
import type { IdeaDecision, IdeaReport } from './report'

type RubricDimension = IdeaReport['rubric'][number]['dimension']
type Level = 'low' | 'medium' | 'high'

const DECISION_COLOR: Record<IdeaDecision, string> = { BUILD: 'positive', VALIDATE: 'primary', HOLD: 'warning', REJECT: 'negative' }

export const decisionHint = (d: IdeaDecision): string => t(`ideas.decisionHint.${d}`)
export const decisionMeta = (d: IdeaDecision) => ({ label: d, color: DECISION_COLOR[d], hint: decisionHint(d) })
export const statusLabel = (s: IdeaStatus): string => t(`ideas.status.${s}`)
export const rubricLabel = (d: RubricDimension): string => t(`ideas.rubric.${d}`)
export const levelLabel = (l: Level): string => t(`common.level.${l}`)

/** Builds a record whose values are translated on every read, so render-time lookups follow the locale. */
function liveRecord<K extends string, V>(keys: readonly K[], get: (k: K) => V): Readonly<Record<K, V>> {
  const o = {} as Record<K, V>
  for (const k of keys) Object.defineProperty(o, k, { get: () => get(k), enumerable: true })
  return o
}

// Record-style exports kept for existing callers; values are translated when read.
export const DECISION_META = liveRecord<IdeaDecision, { label: string; color: string; hint: string }>(
  ['BUILD', 'VALIDATE', 'HOLD', 'REJECT'], decisionMeta,
)
export const STATUS_LABEL = liveRecord<IdeaStatus, string>(['draft', 'evaluating', 'build', 'validate', 'hold', 'rejected'], statusLabel)
export const RUBRIC_LABEL = liveRecord<RubricDimension, string>(
  ['problem_clarity', 'demand_evidence', 'feasibility', 'effort', 'risk'], rubricLabel,
)
export const LEVEL_LABEL = liveRecord<Level, string>(['low', 'medium', 'high'], levelLabel)

/** For effort and risk "high" is bad; colour by goodness, not by level. */
export function rubricColor(dimension: string, level: 'low' | 'medium' | 'high'): string {
  const inverted = dimension === 'effort' || dimension === 'risk'
  const good = inverted ? level === 'low' : level === 'high'
  const bad = inverted ? level === 'high' : level === 'low'
  return good ? 'positive' : bad ? 'negative' : 'warning'
}

export const decisionToStatus = (d: IdeaDecision): Exclude<IdeaStatus, 'draft' | 'evaluating'> =>
  d === 'REJECT' ? 'rejected' : (d.toLowerCase() as 'build' | 'validate' | 'hold')
