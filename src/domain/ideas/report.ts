import { z } from 'zod'

export const DECISIONS = ['BUILD', 'VALIDATE', 'HOLD', 'REJECT'] as const
export type IdeaDecision = (typeof DECISIONS)[number]

export const RUBRIC_DIMENSIONS = ['problem_clarity', 'demand_evidence', 'feasibility', 'effort', 'risk'] as const

/** The judge's output for New Idea and Kill This Idea sessions (ADR-0001: decision + rubric, no score). */
export const IdeaReport = z.object({
  decision: z.enum(DECISIONS),
  decision_reason: z.string(),
  survives_kill_test: z.boolean().nullable(),
  rubric: z.array(
    z.object({ dimension: z.enum(RUBRIC_DIMENSIONS), level: z.enum(['low', 'medium', 'high']), reason: z.string() }),
  ),
  strengths: z.array(z.string()),
  weaknesses: z.array(z.string()),
  critical_assumptions: z.array(z.object({ assumption: z.string(), how_to_validate: z.string() })),
  main_risks: z.array(z.string()),
  suggested_mvp: z.object({ include: z.array(z.string()), exclude: z.array(z.string()) }),
  do_not_build_yet: z.array(z.string()),
  next_steps: z.array(z.string()),
  disagreements: z.array(z.object({ topic: z.string(), positions: z.array(z.string()) })),
  revisit_condition: z.string().nullable(),
})
export type IdeaReport = z.infer<typeof IdeaReport>
