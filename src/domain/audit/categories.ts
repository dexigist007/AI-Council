import type { FindingCategory } from '@/domain/findings/types'

export interface AuditFocus {
  id: string
  label: string
  /** Search terms used to pick relevant code from the local index. */
  query: string
  roles: string[]
}

/** Each focus maps to a local search, so what the audit looks at is explainable and repeatable. */
export const AUDIT_FOCUS: AuditFocus[] = [
  { id: 'security', label: 'Güvenlik', roles: ['security-reviewer'],
    query: 'auth login password token session cookie jwt sql query exec eval innerHTML dangerouslySetInnerHTML shell command spawn crypto permission admin cors upload' },
  { id: 'error_handling', label: 'Hata yönetimi', roles: ['code-auditor'],
    query: 'catch try throw error exception unwrap expect panic reject finally retry timeout fallback' },
  { id: 'performance', label: 'Performans', roles: ['performance-engineer'],
    query: 'loop forEach map filter cache memory setInterval setTimeout listener subscribe await promise all query fetch pagination buffer stream' },
  { id: 'architecture', label: 'Mimari', roles: ['software-architect'],
    query: 'service manager controller store repository provider router module config singleton global state' },
  { id: 'configuration', label: 'Yapılandırma', roles: ['security-reviewer', 'code-auditor'],
    query: 'config env environment process.env settings debug production api_url baseurl endpoint key secret' },
]

export const FOCUS_CATEGORY_HINT: Record<string, FindingCategory[]> = {
  security: ['security', 'secrets'],
  error_handling: ['error_handling'],
  performance: ['performance'],
  architecture: ['architecture', 'maintainability'],
  configuration: ['configuration', 'secrets'],
}
