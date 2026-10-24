/** The owner's standing constraints; saved once, prefilled into every discovery. */
export interface DiscoveryProfile {
  skills: string
  budget: string
  weeklyHours: string
  timeToRevenue: string
  market: string
  exclusions: string
}

/** Language-neutral codes for the wanted time to first revenue; the UI translates them. */
export const TIME_TO_REVENUE = ['2w', '1m', '3m', '6m'] as const
export type TimeToRevenue = (typeof TIME_TO_REVENUE)[number]

const TIME_TO_REVENUE_EN: Record<TimeToRevenue, string> = { '2w': '2 weeks', '1m': '1 month', '3m': '3 months', '6m': '6 months' }
// Profiles saved before the codes stored the Turkish label.
const LEGACY_TIME_TO_REVENUE: Record<string, TimeToRevenue> = { '2 hafta': '2w', '1 ay': '1m', '3 ay': '3m', '6 ay': '6m' }

export const EMPTY_PROFILE: DiscoveryProfile = { skills: '', budget: '', weeklyHours: '', timeToRevenue: '1m', market: '', exclusions: '' }

export const PROFILE_KEY = 'discovery_profile'

export function parseProfile(raw: unknown): DiscoveryProfile {
  const o = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
  const pick = (k: keyof DiscoveryProfile) => (typeof o[k] === 'string' ? (o[k] as string) : EMPTY_PROFILE[k])
  const time = pick('timeToRevenue')
  return { skills: pick('skills'), budget: pick('budget'), weeklyHours: pick('weeklyHours'), timeToRevenue: LEGACY_TIME_TO_REVENUE[time] ?? time, market: pick('market'), exclusions: pick('exclusions') }
}

/** Plain-text block for the prompt; blank fields are named as unknown instead of dropped. */
export function renderProfile(p: DiscoveryProfile): string {
  const line = (label: string, v: string) => `- ${label}: ${v.trim() || 'not stated (do not assume; flag it as an open question)'}`
  const time = LEGACY_TIME_TO_REVENUE[p.timeToRevenue] ?? p.timeToRevenue
  return [
    line('Skills and experience', p.skills),
    line('Budget to invest', p.budget),
    line('Hours per week', p.weeklyHours),
    line('Wanted time to first revenue', TIME_TO_REVENUE_EN[time as TimeToRevenue] ?? p.timeToRevenue),
    line('Country / market / language', p.market),
    line('Out of scope', p.exclusions),
  ].join('\n')
}
