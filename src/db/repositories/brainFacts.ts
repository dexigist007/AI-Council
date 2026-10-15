import type { Db } from '../types'
import { newId, nowIso, parseJson } from '../util'

export type FactSource = 'observed' | 'inferred' | 'user_confirmed'

export interface BrainFact {
  id: string
  projectId: string
  section: string
  statement: string
  source: FactSource
  evidence: { file: string; startLine?: number; endLine?: number }[]
  status: 'pending' | 'active' | 'superseded' | 'rejected'
  updatedAt: string
}

interface Row {
  id: string
  project_id: string
  section: string
  statement: string
  source: FactSource
  evidence_json: string
  status: BrainFact['status']
  updated_at: string
}

const map = (r: Row): BrainFact => ({
  id: r.id, projectId: r.project_id, section: r.section, statement: r.statement, source: r.source,
  evidence: parseJson(r.evidence_json, []), status: r.status, updatedAt: r.updated_at,
})

export function brainFactsRepo(db: Db) {
  return {
    async list(projectId: string, section?: string): Promise<BrainFact[]> {
      const rows = section
        ? await db.select<Row>("SELECT * FROM brain_facts WHERE project_id = ? AND section = ? AND status != 'superseded' ORDER BY statement", [projectId, section])
        : await db.select<Row>("SELECT * FROM brain_facts WHERE project_id = ? AND status != 'superseded' ORDER BY section, statement", [projectId])
      return rows.map(map)
    },

    /**
     * Replaces the code-derived (observed) facts of a section. Only the indexer writes observed
     * facts, so they are active immediately; AI-inferred facts never go through here.
     */
    async replaceObserved(projectId: string, section: string, facts: { statement: string; evidence: BrainFact['evidence'] }[]): Promise<void> {
      await db.execute("DELETE FROM brain_facts WHERE project_id = ? AND section = ? AND source = 'observed'", [projectId, section])
      const now = nowIso()
      for (const f of facts) {
        await db.execute(
          "INSERT INTO brain_facts (id, project_id, section, statement, source, evidence_json, status, updated_at) VALUES (?, ?, ?, ?, 'observed', ?, 'active', ?)",
          [newId(), projectId, section, f.statement, JSON.stringify(f.evidence), now],
        )
      }
    },
  }
}
