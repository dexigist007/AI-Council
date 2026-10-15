import { repos } from '@/db'
import { projectsFs } from '@/platform/tauri'
import type { IndexerDeps } from './indexer'

export async function indexerDeps(): Promise<IndexerDeps> {
  const r = await repos()
  return { fs: projectsFs, projects: r.projects, index: r.projectIndex, brain: r.brainFacts }
}
