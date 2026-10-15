import type { Db } from '../types'
import { newId, nowIso, parseJson } from '../util'

export type SessionType = 'new_idea' | 'kill_idea' | 'ask_project' | 'audit' | 'review_changes'
export type SessionMode = 'fast' | 'balanced' | 'deep'
export type SessionStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled'
export type Round = 'independent' | 'critique' | 'revision' | 'judge' | 'utility'

export interface Session {
  id: string
  projectId: string | null
  ideaId: string | null
  type: SessionType
  mode: SessionMode
  status: SessionStatus
  config: Record<string, unknown>
  finalReport: unknown
  estCost: number | null
  actualCost: number
  error: string | null
  createdAt: string
  finishedAt: string | null
}

interface SessionRow {
  id: string
  project_id: string | null
  idea_id: string | null
  type: SessionType
  mode: SessionMode
  status: SessionStatus
  config_json: string
  final_report_json: string | null
  est_cost: number | null
  actual_cost: number
  error: string | null
  created_at: string
  finished_at: string | null
}

const mapSession = (r: SessionRow): Session => ({
  id: r.id,
  projectId: r.project_id,
  ideaId: r.idea_id,
  type: r.type,
  mode: r.mode,
  status: r.status,
  config: parseJson(r.config_json, {}),
  finalReport: parseJson(r.final_report_json, null),
  estCost: r.est_cost,
  actualCost: r.actual_cost,
  error: r.error,
  createdAt: r.created_at,
  finishedAt: r.finished_at,
})

export interface SessionMessage {
  id: string
  sessionId: string
  round: Round
  participant: string
  provider: string
  model: string
  role: string | null
  promptId: string
  promptVersion: number
  requestFiles: string[]
  responseText: string | null
  responseJson: unknown
  tokensIn: number
  tokensOut: number
  cachedTokens: number
  cost: number
  latencyMs: number | null
  error: string | null
  createdAt: string
}

interface MessageRow {
  id: string
  session_id: string
  round: Round
  participant: string
  provider: string
  model: string
  role: string | null
  prompt_id: string
  prompt_version: number
  request_files_json: string
  response_text: string | null
  response_json: string | null
  tokens_in: number
  tokens_out: number
  cached_tokens: number
  cost: number
  latency_ms: number | null
  error: string | null
  created_at: string
}

const mapMessage = (r: MessageRow): SessionMessage => ({
  id: r.id,
  sessionId: r.session_id,
  round: r.round,
  participant: r.participant,
  provider: r.provider,
  model: r.model,
  role: r.role,
  promptId: r.prompt_id,
  promptVersion: r.prompt_version,
  requestFiles: parseJson(r.request_files_json, []),
  responseText: r.response_text,
  responseJson: parseJson(r.response_json, null),
  tokensIn: r.tokens_in,
  tokensOut: r.tokens_out,
  cachedTokens: r.cached_tokens,
  cost: r.cost,
  latencyMs: r.latency_ms,
  error: r.error,
  createdAt: r.created_at,
})

export type NewMessage = Omit<SessionMessage, 'id' | 'createdAt' | 'requestFiles' | 'responseJson'> & {
  requestFiles?: string[]
  responseJson?: unknown
}

export function sessionsRepo(db: Db) {
  async function get(id: string): Promise<Session | null> {
    const rows = await db.select<SessionRow>('SELECT * FROM sessions WHERE id = ?', [id])
    return rows[0] ? mapSession(rows[0]) : null
  }

  return {
    get,

    async create(input: {
      type: SessionType
      mode: SessionMode
      projectId?: string | null
      ideaId?: string | null
      config?: Record<string, unknown>
      estCost?: number | null
    }): Promise<Session> {
      const id = newId()
      await db.execute(
        `INSERT INTO sessions (id, project_id, idea_id, type, mode, config_json, est_cost, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [id, input.projectId ?? null, input.ideaId ?? null, input.type, input.mode,
          JSON.stringify(input.config ?? {}), input.estCost ?? null, nowIso()],
      )
      return (await get(id))!
    },

    async list(filter: { projectId?: string; ideaId?: string; limit?: number } = {}): Promise<Session[]> {
      const where: string[] = []
      const params: (string | number)[] = []
      if (filter.projectId) { where.push('project_id = ?'); params.push(filter.projectId) }
      if (filter.ideaId) { where.push('idea_id = ?'); params.push(filter.ideaId) }
      params.push(filter.limit ?? 100)
      const rows = await db.select<SessionRow>(
        `SELECT * FROM sessions ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
         ORDER BY created_at DESC LIMIT ?`,
        params,
      )
      return rows.map(mapSession)
    },

    async markRunning(id: string): Promise<void> {
      await db.execute("UPDATE sessions SET status = 'running' WHERE id = ?", [id])
    },

    async complete(id: string, finalReport: unknown): Promise<void> {
      await db.execute(
        "UPDATE sessions SET status = 'completed', final_report_json = ?, finished_at = ? WHERE id = ?",
        [JSON.stringify(finalReport), nowIso(), id],
      )
    },

    async finishWithout(id: string, status: 'failed' | 'cancelled', error: string | null = null): Promise<void> {
      await db.execute('UPDATE sessions SET status = ?, error = ?, finished_at = ? WHERE id = ?',
        [status, error, nowIso(), id])
    },

    /** Stores one model call and adds its cost to the session total. */
    async addMessage(m: NewMessage): Promise<string> {
      const id = newId()
      await db.execute(
        `INSERT INTO session_messages (id, session_id, round, participant, provider, model, role,
           prompt_id, prompt_version, request_files_json, response_text, response_json,
           tokens_in, tokens_out, cached_tokens, cost, latency_ms, error, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [id, m.sessionId, m.round, m.participant, m.provider, m.model, m.role, m.promptId,
          m.promptVersion, JSON.stringify(m.requestFiles ?? []), m.responseText,
          m.responseJson === undefined ? null : JSON.stringify(m.responseJson),
          m.tokensIn, m.tokensOut, m.cachedTokens, m.cost, m.latencyMs, m.error, nowIso()],
      )
      await db.execute('UPDATE sessions SET actual_cost = actual_cost + ? WHERE id = ?', [m.cost, m.sessionId])
      return id
    },

    async listMessages(sessionId: string): Promise<SessionMessage[]> {
      const rows = await db.select<MessageRow>(
        'SELECT * FROM session_messages WHERE session_id = ? ORDER BY created_at, rowid', [sessionId])
      return rows.map(mapMessage)
    },
  }
}
