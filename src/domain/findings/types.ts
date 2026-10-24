import { t } from '@/i18n'

export const CATEGORIES = [
  'security', 'secrets', 'error_handling', 'architecture', 'performance', 'testing', 'configuration',
  'code_quality', 'maintainability', 'dependencies', 'documentation',
] as const
export type FindingCategory = (typeof CATEGORIES)[number]

export const SEVERITIES = ['critical', 'high', 'medium', 'low', 'info'] as const
export type Severity = (typeof SEVERITIES)[number]

export const CONFIDENCES = ['confirmed', 'high', 'possible', 'speculative'] as const
export type Confidence = (typeof CONFIDENCES)[number]

export type Priority = 'P0' | 'P1' | 'P2' | 'P3'
export type FindingStatus = 'open' | 'accepted' | 'wontfix' | 'done' | 'false_positive'

export const categoryLabel = (c: FindingCategory): string => t(`projects.findings.categoryLabel.${c}`)

/** Kept for existing callers; each entry is read at access time, so it follows the UI language. */
export const CATEGORY_LABEL = Object.defineProperties(
  {} as Record<FindingCategory, string>,
  Object.fromEntries(CATEGORIES.map((c) => [c, { get: () => categoryLabel(c), enumerable: true }])),
)
