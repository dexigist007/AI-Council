import { getDb } from '@/db/client'
import { clearConsents } from '@/domain/consent'
import { projectsFs, secrets } from '@/platform/tauri'

/** Child tables first so foreign keys never block a delete. */
const TABLES = ['finding_evidence', 'findings', 'brain_facts', 'chunks_fts', 'chunks', 'files', 'session_messages', 'decisions', 'sessions', 'ideas', 'projects', 'provider_configs', 'model_prices', 'app_settings']

/** "Delete all data": local database, consents, keychain items and folder grants. */
export async function deleteAllData(): Promise<void> {
  const db = await getDb()
  for (const table of TABLES) await db.execute(`DELETE FROM ${table}`)
  await clearConsents()
  await secrets.clearAll()
  await projectsFs.forgetAll()
}
