import type { VerifiedCitation } from '@/domain/context/evidence'
import { fingerprint } from '@/domain/findings/fingerprint'
import { computePriority } from '@/domain/findings/priority'
import type { Confidence, FindingCategory, FindingStatus, Priority, Severity } from '@/domain/findings/types'
import type { Db } from '../types'
import { fromBool, newId, nowIso, toBool } from '../util'

export interface NewFinding {
  title: string
  /** Language-independent text for the fingerprint when `title` is translated (rule-based findings). */
  fingerprintTitle?: string
  description: string
  category: FindingCategory
  severity: Severity
  confidence: Confidence
  evidence: VerifiedCitation[]
  impact: number
  risk: number
  urgency: number
  effort: number
  suggestedFix: string | null
}

export interface Finding extends Omit<NewFinding, 'evidence' | 'fingerprintTitle'> {
  id: string
  projectId: string
  sessionId: string | null
  verification: 'verified' | 'unverified'
  priority: Priority
  status: FindingStatus
  evidence: VerifiedCitation[]
  createdAt: string
  lastSeenAt: string
}

interface Row {
  id: string; project_id: string; session_id: string | null; title: string; description: string; category: FindingCategory
  severity: Severity; confidence: Confidence; verification: 'verified' | 'unverified'; impact: number; risk: number; urgency: number
  effort: number; priority: Priority; suggested_fix: string | null; status: FindingStatus; created_at: string; last_seen_at: string
}
interface EvidenceRow { finding_id: string; file_path: string; start_line: number; end_line: number; quote: string | null; verified: number }

export interface UpsertResult { added: number; updated: number }

const PRIORITY_ORDER = "CASE priority WHEN 'P0' THEN 0 WHEN 'P1' THEN 1 WHEN 'P2' THEN 2 ELSE 3 END"

export function findingsRepo(db: Db) {
  async function attachEvidence(rows: Row[]): Promise<Finding[]> {
    if (rows.length === 0) return []
    const ev = await db.select<EvidenceRow>(
      `SELECT * FROM finding_evidence WHERE finding_id IN (${rows.map(() => '?').join(',')}) ORDER BY rowid`, rows.map((r) => r.id))
    return rows.map((r) => ({
      id: r.id, projectId: r.project_id, sessionId: r.session_id, title: r.title, description: r.description, category: r.category,
      severity: r.severity, confidence: r.confidence, verification: r.verification, impact: r.impact, risk: r.risk, urgency: r.urgency,
      effort: r.effort, priority: r.priority, suggestedFix: r.suggested_fix, status: r.status, createdAt: r.created_at, lastSeenAt: r.last_seen_at,
      evidence: ev.filter((e) => e.finding_id === r.id).map((e) => ({
        file: e.file_path, start_line: e.start_line, end_line: e.end_line, quote: e.quote ?? '', verified: toBool(e.verified),
      })),
    }))
  }

  return {
    /**
     * Saves findings, computing verification and priority here (never trusting the model for them).
     * A finding seen before is refreshed; its status is kept, so dismissed findings stay dismissed.
     */
    async upsertMany(projectId: string, sessionId: string | null, findings: NewFinding[]): Promise<UpsertResult> {
      let added = 0
      let updated = 0
      const now = nowIso()
      for (const f of findings) {
        const verified = f.evidence.some((e) => e.verified)
        const { priority } = computePriority({ ...f, verified })
        const fp = fingerprint(f.category, f.fingerprintTitle ?? f.title, f.evidence[0]?.file ?? null)
        const existing = await db.select<{ id: string }>('SELECT id FROM findings WHERE project_id = ? AND fingerprint = ?', [projectId, fp])
        let id: string
        if (existing[0]) {
          id = existing[0].id
          updated++
          await db.execute(
            `UPDATE findings SET session_id = ?, title = ?, description = ?, severity = ?, confidence = ?, verification = ?, impact = ?,
               risk = ?, urgency = ?, effort = ?, priority = ?, suggested_fix = ?, last_seen_at = ? WHERE id = ?`,
            [sessionId, f.title, f.description, f.severity, f.confidence, verified ? 'verified' : 'unverified', f.impact, f.risk,
              f.urgency, f.effort, priority, f.suggestedFix, now, id],
          )
          await db.execute('DELETE FROM finding_evidence WHERE finding_id = ?', [id])
        } else {
          id = newId()
          added++
          await db.execute(
            `INSERT INTO findings (id, project_id, session_id, title, description, category, severity, confidence, verification,
               impact, risk, urgency, effort, priority, suggested_fix, fingerprint, created_at, last_seen_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [id, projectId, sessionId, f.title, f.description, f.category, f.severity, f.confidence, verified ? 'verified' : 'unverified',
              f.impact, f.risk, f.urgency, f.effort, priority, f.suggestedFix, fp, now, now],
          )
        }
        for (const e of f.evidence) {
          await db.execute(
            'INSERT INTO finding_evidence (id, finding_id, file_path, start_line, end_line, quote, verified) VALUES (?, ?, ?, ?, ?, ?, ?)',
            [newId(), id, e.file, e.start_line, e.end_line, e.quote, fromBool(e.verified)],
          )
        }
      }
      return { added, updated }
    },

    async list(filter: { projectId?: string; statuses?: FindingStatus[] } = {}): Promise<Finding[]> {
      const where: string[] = []
      const params: string[] = []
      if (filter.projectId) { where.push('project_id = ?'); params.push(filter.projectId) }
      if (filter.statuses?.length) { where.push(`status IN (${filter.statuses.map(() => '?').join(',')})`); params.push(...filter.statuses) }
      const rows = await db.select<Row>(
        `SELECT * FROM findings ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY ${PRIORITY_ORDER}, last_seen_at DESC`, params)
      return attachEvidence(rows)
    },

    async setStatus(id: string, status: FindingStatus): Promise<void> {
      await db.execute('UPDATE findings SET status = ? WHERE id = ?', [status, id])
    },

    async countOpenByPriority(): Promise<Record<Priority, number>> {
      const rows = await db.select<{ priority: Priority; n: number }>(
        "SELECT priority, COUNT(*) AS n FROM findings WHERE status IN ('open','accepted') GROUP BY priority")
      const out: Record<Priority, number> = { P0: 0, P1: 0, P2: 0, P3: 0 }
      for (const r of rows) out[r.priority] = r.n
      return out
    },
  }
}
