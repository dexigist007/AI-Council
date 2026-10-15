import type { Confidence, FindingCategory, Priority, Severity } from './types'

export interface PriorityInput {
  category: FindingCategory
  severity: Severity
  confidence: Confidence
  verified: boolean
  /** 1-5 scales supplied by the model (or by local rules). */
  impact: number
  risk: number
  urgency: number
  effort: number
}

const SEVERITY_WEIGHT: Record<Severity, number> = { critical: 4, high: 3, medium: 2, low: 1, info: 0 }
const clamp = (n: number) => Math.min(5, Math.max(1, Math.round(n || 3)))

/**
 * Deterministic priority (the model only supplies inputs):
 * - P0: verified critical findings, or verified high-severity security/secrets findings.
 * - Otherwise a score from severity, impact, risk and urgency, slightly reduced by effort.
 * - Unverified or speculative findings are capped at P2: no evidence, no urgency.
 */
export function computePriority(f: PriorityInput): { priority: Priority; score: number } {
  const score = SEVERITY_WEIGHT[f.severity] * 2 + (clamp(f.impact) + clamp(f.risk) + clamp(f.urgency)) / 3 - (clamp(f.effort) - 3) * 0.3
  const rounded = Math.round(score * 10) / 10
  const trusted = f.verified && f.confidence !== 'speculative'
  if (trusted && (f.severity === 'critical' || (f.severity === 'high' && (f.category === 'security' || f.category === 'secrets')))) {
    return { priority: 'P0', score: rounded }
  }
  let priority: Priority = score >= 8 ? 'P1' : score >= 5 ? 'P2' : 'P3'
  if (!trusted && priority === 'P1') priority = 'P2'
  return { priority, score: rounded }
}
