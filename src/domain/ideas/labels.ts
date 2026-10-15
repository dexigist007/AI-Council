import type { IdeaStatus } from '@/db/repositories/ideas'
import type { IdeaDecision, IdeaReport } from './report'

export const DECISION_META: Record<IdeaDecision, { label: string; color: string; hint: string }> = {
  BUILD: { label: 'BUILD', color: 'positive', hint: 'Şimdi yapılmaya değer' },
  VALIDATE: { label: 'VALIDATE', color: 'primary', hint: 'Önce kritik varsayımlar test edilmeli' },
  HOLD: { label: 'HOLD', color: 'warning', hint: 'Şimdi değil; yeniden değerlendirme koşulu var' },
  REJECT: { label: 'REJECT', color: 'negative', hint: 'Yapmaya değmez' },
}

export const STATUS_LABEL: Record<IdeaStatus, string> = {
  draft: 'Taslak',
  evaluating: 'Karar bekliyor',
  build: 'BUILD',
  validate: 'VALIDATE',
  hold: 'HOLD',
  rejected: 'REJECT',
}

export const RUBRIC_LABEL: Record<IdeaReport['rubric'][number]['dimension'], string> = {
  problem_clarity: 'Problem netliği',
  demand_evidence: 'Talep kanıtı',
  feasibility: 'Fizibilite',
  effort: 'Efor',
  risk: 'Risk',
}

/** For effort and risk "high" is bad; colour by goodness, not by level. */
export function rubricColor(dimension: string, level: 'low' | 'medium' | 'high'): string {
  const inverted = dimension === 'effort' || dimension === 'risk'
  const good = inverted ? level === 'low' : level === 'high'
  const bad = inverted ? level === 'high' : level === 'low'
  return good ? 'positive' : bad ? 'negative' : 'warning'
}

export const LEVEL_LABEL = { low: 'Düşük', medium: 'Orta', high: 'Yüksek' } as const

export const decisionToStatus = (d: IdeaDecision): Exclude<IdeaStatus, 'draft' | 'evaluating'> =>
  d === 'REJECT' ? 'rejected' : (d.toLowerCase() as 'build' | 'validate' | 'hold')
