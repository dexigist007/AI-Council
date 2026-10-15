import type { Db } from '../types'
import { fromBool, newId, nowIso, toBool } from '../util'

/**
 * A decision is a real project decision only when userApproved is true.
 * AI suggestions may be stored unapproved but never count as decisions (see listApproved).
 */
export interface Decision {
  id: string
  projectId: string | null
  ideaId: string | null
  sessionId: string | null
  title: string
  reason: string
  userApproved: boolean
  decidedAt: string
}

interface DecisionRow {
  id: string
  project_id: string | null
  idea_id: string | null
  session_id: string | null
  title: string
  reason: string
  user_approved: number
  decided_at: string
}

const map = (r: DecisionRow): Decision => ({
  id: r.id,
  projectId: r.project_id,
  ideaId: r.idea_id,
  sessionId: r.session_id,
  title: r.title,
  reason: r.reason,
  userApproved: toBool(r.user_approved),
  decidedAt: r.decided_at,
})

export function decisionsRepo(db: Db) {
  return {
    async create(input: {
      title: string
      reason?: string
      projectId?: string | null
      ideaId?: string | null
      sessionId?: string | null
      userApproved: boolean
    }): Promise<Decision> {
      const id = newId()
      await db.execute(
        `INSERT INTO decisions (id, project_id, idea_id, session_id, title, reason, user_approved, decided_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [id, input.projectId ?? null, input.ideaId ?? null, input.sessionId ?? null, input.title.trim(),
          input.reason ?? '', fromBool(input.userApproved), nowIso()],
      )
      const rows = await db.select<DecisionRow>('SELECT * FROM decisions WHERE id = ?', [id])
      return map(rows[0]!)
    },

    async approve(id: string): Promise<void> {
      await db.execute('UPDATE decisions SET user_approved = 1, decided_at = ? WHERE id = ?', [nowIso(), id])
    },

    async listApproved(projectId?: string): Promise<Decision[]> {
      const rows = projectId
        ? await db.select<DecisionRow>(
          'SELECT * FROM decisions WHERE user_approved = 1 AND project_id = ? ORDER BY decided_at DESC', [projectId])
        : await db.select<DecisionRow>('SELECT * FROM decisions WHERE user_approved = 1 ORDER BY decided_at DESC')
      return rows.map(map)
    },

    async listPending(): Promise<Decision[]> {
      const rows = await db.select<DecisionRow>(
        'SELECT * FROM decisions WHERE user_approved = 0 ORDER BY decided_at DESC')
      return rows.map(map)
    },
  }
}
