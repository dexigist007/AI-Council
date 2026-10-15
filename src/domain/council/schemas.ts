import { z } from 'zod'

export const CLAIM_TYPES = ['strength', 'weakness', 'risk', 'assumption', 'opportunity', 'recommendation'] as const
export const CONFIDENCE = ['high', 'medium', 'low'] as const

const claim = z.object({
  text: z.string().min(1),
  type: z.enum(CLAIM_TYPES),
  confidence: z.enum(CONFIDENCE),
})

/** Round 1: one member's independent analysis. */
export const IndependentOutput = z.object({
  summary: z.string().describe('2-4 sentence summary of your position'),
  claims: z.array(claim).min(1).max(15),
})
export type IndependentOutput = z.infer<typeof IndependentOutput>

/** Round 2: one member's review of the others' claims. */
export const CritiqueOutput = z.object({
  reviews: z.array(
    z.object({
      claim_id: z.string().describe('Claim id exactly as given, e.g. C3'),
      stance: z.enum(['agree', 'disagree', 'wrong_assumption']),
      reason: z.string().min(1),
    }),
  ),
  missing: z.array(claim).max(5),
})
export type CritiqueOutput = z.infer<typeof CritiqueOutput>

/** JSON Schema for provider structured-output parameters. */
export function toJsonSchema(schema: z.ZodType): Record<string, unknown> {
  const { $schema: _, ...rest } = z.toJSONSchema(schema) as Record<string, unknown>
  return rest
}
