import { z } from 'zod'
import { CATEGORIES, CONFIDENCES, SEVERITIES } from '@/domain/findings/types'

const scale = z.number().int().min(1).max(5)

export const AuditReport = z.object({
  summary: z.string(),
  findings: z.array(
    z.object({
      title: z.string().min(1),
      description: z.string(),
      category: z.enum(CATEGORIES),
      severity: z.enum(SEVERITIES),
      confidence: z.enum(CONFIDENCES),
      evidence: z.array(z.object({ file: z.string(), start_line: z.number().int(), end_line: z.number().int(), quote: z.string() })),
      impact: scale,
      risk: scale,
      urgency: scale,
      effort: scale,
      suggested_fix: z.string(),
      estimated_effort: z.string(),
    }),
  ).max(40),
  opportunities: z.array(
    z.object({ title: z.string(), value: z.enum(['high', 'medium', 'low']), effort: z.enum(['high', 'medium', 'low']), reason: z.string(), evidence_files: z.array(z.string()) }),
  ).max(5),
})
export type AuditReport = z.infer<typeof AuditReport>
