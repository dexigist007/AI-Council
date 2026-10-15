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

export const CATEGORY_LABEL: Record<FindingCategory, string> = {
  security: 'Güvenlik', secrets: 'Gizli bilgi riski', error_handling: 'Hata yönetimi', architecture: 'Mimari',
  performance: 'Performans', testing: 'Test', configuration: 'Yapılandırma', code_quality: 'Kod kalitesi',
  maintainability: 'Bakım kolaylığı', dependencies: 'Bağımlılıklar', documentation: 'Dokümantasyon',
}
