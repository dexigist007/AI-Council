import type { Session, SessionStatus, SessionType } from '@/db'

export const TYPE_LABEL: Record<SessionType, string> = {
  new_idea: 'Fikir değerlendirme',
  kill_idea: 'KILL THIS IDEA',
  ask_project: 'Ask Project',
  audit: 'Audit',
  review_changes: 'Review Changes',
}

export const STATUS_COLOR: Record<SessionStatus, string> = {
  pending: 'grey', running: 'primary', completed: 'positive', failed: 'negative', cancelled: 'grey-7',
}

/** Single-model project analyses share the ask_project type; their purpose is in the config. */
export function sessionLabel(s: Pick<Session, 'type' | 'config'>): string {
  const purpose = (s.config.meta as { purpose?: string } | undefined)?.purpose
  if (purpose === 'brain_draft') return 'Project Brain taslağı'
  if (purpose === 'discovery') return 'Keşif'
  if (purpose === 'discovery_followup') return 'Keşif · devam sorusu'
  return TYPE_LABEL[s.type]
}
