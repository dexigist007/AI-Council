import type { Db } from '../types'
import { newId, nowIso } from '../util'

export type IdeaStatus = 'draft' | 'evaluating' | 'build' | 'validate' | 'hold' | 'rejected'

/** Statuses shown in the Idea Graveyard. Ideas are never deleted, only parked here. */
export const GRAVEYARD_STATUSES: IdeaStatus[] = ['hold', 'rejected']

export interface Idea {
  id: string
  title: string
  body: string
  status: IdeaStatus
  rejectReason: string | null
  revisitCondition: string | null
  decidedSessionId: string | null
  createdAt: string
  updatedAt: string
}

interface IdeaRow {
  id: string
  title: string
  body: string
  status: IdeaStatus
  reject_reason: string | null
  revisit_condition: string | null
  decided_session_id: string | null
  created_at: string
  updated_at: string
}

const map = (r: IdeaRow): Idea => ({
  id: r.id,
  title: r.title,
  body: r.body,
  status: r.status,
  rejectReason: r.reject_reason,
  revisitCondition: r.revisit_condition,
  decidedSessionId: r.decided_session_id,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
})

export interface IdeaVerdict {
  status: Exclude<IdeaStatus, 'draft' | 'evaluating'>
  sessionId: string | null
  rejectReason?: string | null
  revisitCondition?: string | null
}

export function ideasRepo(db: Db) {
  async function get(id: string): Promise<Idea | null> {
    const rows = await db.select<IdeaRow>('SELECT * FROM ideas WHERE id = ?', [id])
    return rows[0] ? map(rows[0]) : null
  }

  return {
    get,

    async create(input: { title: string; body?: string }): Promise<Idea> {
      const id = newId()
      const now = nowIso()
      await db.execute(
        'INSERT INTO ideas (id, title, body, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
        [id, input.title.trim(), input.body ?? '', now, now],
      )
      return (await get(id))!
    },

    async list(filter: { statuses?: IdeaStatus[] } = {}): Promise<Idea[]> {
      const statuses = filter.statuses ?? []
      const where = statuses.length ? `WHERE status IN (${statuses.map(() => '?').join(',')})` : ''
      const rows = await db.select<IdeaRow>(`SELECT * FROM ideas ${where} ORDER BY updated_at DESC`, statuses)
      return rows.map(map)
    },

    listGraveyard(): Promise<Idea[]> {
      return this.list({ statuses: GRAVEYARD_STATUSES })
    },

    async update(id: string, patch: { title?: string; body?: string }): Promise<void> {
      await db.execute(
        'UPDATE ideas SET title = COALESCE(?, title), body = COALESCE(?, body), updated_at = ? WHERE id = ?',
        [patch.title?.trim() ?? null, patch.body ?? null, nowIso(), id],
      )
    },

    /** Back to draft: after a failed/cancelled session, or reopening an idea from the graveyard. */
    async setDraft(id: string): Promise<void> {
      await db.execute(
        "UPDATE ideas SET status = 'draft', reject_reason = NULL, revisit_condition = NULL, updated_at = ? WHERE id = ?",
        [nowIso(), id],
      )
    },

    async markEvaluating(id: string): Promise<void> {
      await db.execute("UPDATE ideas SET status = 'evaluating', updated_at = ? WHERE id = ?", [nowIso(), id])
    },

    /** Records the user's verdict. A council report alone never changes an idea's status. */
    async setVerdict(id: string, v: IdeaVerdict): Promise<void> {
      await db.execute(
        `UPDATE ideas SET status = ?, decided_session_id = ?, reject_reason = ?, revisit_condition = ?,
         updated_at = ? WHERE id = ?`,
        [v.status, v.sessionId, v.rejectReason ?? null, v.revisitCondition ?? null, nowIso(), id],
      )
    },
  }
}
