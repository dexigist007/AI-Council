import { getDb } from './client'
import { decisionsRepo } from './repositories/decisions'
import { ideasRepo } from './repositories/ideas'
import { brainFactsRepo } from './repositories/brainFacts'
import { projectIndexRepo } from './repositories/projectIndex'
import { projectsRepo } from './repositories/projects'
import { modelPricesRepo } from './repositories/modelPrices'
import { providerConfigsRepo } from './repositories/providerConfigs'
import { sessionsRepo } from './repositories/sessions'

export async function repos() {
  const db = await getDb()
  return { ideas: ideasRepo(db), sessions: sessionsRepo(db), decisions: decisionsRepo(db), providerConfigs: providerConfigsRepo(db), modelPrices: modelPricesRepo(db),
    projects: projectsRepo(db), projectIndex: projectIndexRepo(db), brainFacts: brainFactsRepo(db) }
}

export type * from './repositories/ideas'
export type * from './repositories/sessions'
export type * from './repositories/decisions'
export type * from './repositories/providerConfigs'
export type * from './repositories/modelPrices'
export type * from './repositories/projects'
export type * from './repositories/projectIndex'
export type * from './repositories/brainFacts'
