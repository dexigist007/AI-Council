import { z } from 'zod'

export const CANDIDATE_KINDS = ['app', 'game', 'saas', 'service', 'content', 'ecommerce', 'other'] as const
export type CandidateKind = (typeof CANDIDATE_KINDS)[number]

const scenario = z.object({
  amount: z.string().describe('Monthly revenue range after ~3 months, e.g. "$0-50/ay"'),
  assumption: z.string().describe('What has to be true for this number'),
})

/** One shortlisted opportunity, detailed enough to act on tomorrow morning. */
export const Candidate = z.object({
  rank: z.number().int(),
  name: z.string(),
  kind: z.enum(CANDIDATE_KINDS),
  one_liner: z.string(),
  why_this_fits_you: z.string(),
  target_customer: z.string().describe('A specific, reachable group, not "everyone"'),
  problem: z.string(),
  solution: z.string(),
  revenue_model: z.string(),
  pricing: z.string(),
  first_revenue_path: z.string().describe('Who pays first, how you reach them, what you sell them'),
  time_to_first_revenue: z.string(),
  startup_cost: z.string(),
  weekly_hours: z.string(),
  revenue_scenarios: z.object({ pessimistic: scenario, realistic: scenario, optimistic: scenario }),
  unit_economics: z.string(),
  competition: z.string().describe('Existing alternatives by category; no invented company names'),
  differentiation: z.string(),
  distribution_channels: z.array(z.string()),
  key_assumptions: z.array(z.string()),
  main_risks: z.array(z.string()),
  validation_plan: z.array(z.object({ day: z.string(), action: z.string(), success_signal: z.string() })),
  kill_criteria: z.array(z.string()),
  first_30_days: z.array(z.string()),
  confidence: z.enum(['high', 'medium', 'low']),
  supporting_claims: z.array(z.string()).describe('Claim ids from the debate, e.g. C4'),
})
export type Candidate = z.infer<typeof Candidate>

/** The judge's output for a discovery session: a ranked shortlist plus an honest reality check. */
export const DiscoveryReport = z.object({
  summary: z.string(),
  reality_check: z.array(z.string()),
  candidates: z.array(Candidate).min(1).max(5),
  rejected: z.array(z.object({ name: z.string(), reason: z.string() })),
  disagreements: z.array(z.object({ topic: z.string(), positions: z.array(z.string()) })),
  open_questions: z.array(z.string()).describe('What the owner should answer to sharpen the next run'),
})
export type DiscoveryReport = z.infer<typeof DiscoveryReport>
