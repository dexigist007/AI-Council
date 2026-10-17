/** The owner's standing constraints; saved once, prefilled into every discovery. */
export interface DiscoveryProfile {
  skills: string
  budget: string
  weeklyHours: string
  timeToRevenue: string
  market: string
  exclusions: string
}

export const EMPTY_PROFILE: DiscoveryProfile = { skills: '', budget: '', weeklyHours: '', timeToRevenue: '1 ay', market: '', exclusions: '' }

export const PROFILE_KEY = 'discovery_profile'

export function parseProfile(raw: unknown): DiscoveryProfile {
  const o = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
  const pick = (k: keyof DiscoveryProfile) => (typeof o[k] === 'string' ? (o[k] as string) : EMPTY_PROFILE[k])
  return { skills: pick('skills'), budget: pick('budget'), weeklyHours: pick('weeklyHours'), timeToRevenue: pick('timeToRevenue'), market: pick('market'), exclusions: pick('exclusions') }
}

/** Plain-text block for the prompt; blank fields are named as unknown instead of dropped. */
export function renderProfile(p: DiscoveryProfile): string {
  const line = (label: string, v: string) => `- ${label}: ${v.trim() || 'not stated (do not assume; flag it as an open question)'}`
  return [
    line('Skills and experience', p.skills),
    line('Budget to invest', p.budget),
    line('Hours per week', p.weeklyHours),
    line('Wanted time to first revenue', p.timeToRevenue),
    line('Country / market / language', p.market),
    line('Out of scope', p.exclusions),
  ].join('\n')
}
