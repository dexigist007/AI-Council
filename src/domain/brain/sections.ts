import { t } from '@/i18n'

export const BRAIN_SECTIONS = ['purpose', 'summary', 'architecture', 'modules', 'external_apis', 'data_storage', 'open_questions'] as const
export type BrainSection = (typeof BRAIN_SECTIONS)[number] | 'stack'

export const sectionLabel = (s: BrainSection): string => t(`projects.brain.section.${s}`)

/** Kept for existing callers; each entry is read at access time, so it follows the UI language. */
export const SECTION_LABEL = Object.defineProperties(
  {} as Record<BrainSection, string>,
  Object.fromEntries([...BRAIN_SECTIONS, 'stack' as const].map((s) => [s, { get: () => sectionLabel(s), enumerable: true }])),
)
