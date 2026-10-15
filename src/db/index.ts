import { getDb } from './client'
import { decisionsRepo } from './repositories/decisions'
import { ideasRepo } from './repositories/ideas'
import { providerConfigsRepo } from './repositories/providerConfigs'
import { sessionsRepo } from './repositories/sessions'

export async function repos() {
  const db = await getDb()
  return { ideas: ideasRepo(db), sessions: sessionsRepo(db), decisions: decisionsRepo(db), providerConfigs: providerConfigsRepo(db) }
}

export type * from './repositories/ideas'
export type * from './repositories/sessions'
export type * from './repositories/decisions'
export type * from './repositories/providerConfigs'
