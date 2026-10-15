import type { SessionStatus, SessionType } from '@/db'

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
