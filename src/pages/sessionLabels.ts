import type { Session, SessionStatus, SessionType } from '@/db'
import { t } from '@/i18n'

export const typeLabel = (type: SessionType): string => t(`council.sessionType.${type}`)

export const STATUS_COLOR: Record<SessionStatus, string> = {
  pending: 'grey', running: 'primary', completed: 'positive', failed: 'negative', cancelled: 'grey-7',
}

/** Single-model project analyses share the ask_project type; their purpose is in the config. */
export function sessionLabel(s: Pick<Session, 'type' | 'config'>): string {
  const purpose = (s.config.meta as { purpose?: string } | undefined)?.purpose
  if (purpose === 'brain_draft') return t('council.sessionType.brain_draft')
  if (purpose === 'discovery') return t('council.sessionType.discovery')
  if (purpose === 'discovery_followup') return t('council.sessionType.discovery_followup')
  return typeLabel(s.type)
}
