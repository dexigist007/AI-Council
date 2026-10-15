import { getDb } from './client'
import { decisionsRepo } from './repositories/decisions'
import { ideasRepo } from './repositories/ideas'
import { sessionsRepo } from './repositories/sessions'

export async function repos() {
  const db = await getDb()
  return { ideas: ideasRepo(db), sessions: sessionsRepo(db), decisions: decisionsRepo(db) }
}

export type * from './repositories/ideas'
export type * from './repositories/sessions'
export type * from './repositories/decisions'
