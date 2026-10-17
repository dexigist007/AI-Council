import type { Round } from '@/db/repositories/sessions'
import type { CouncilEvent, CouncilReport, Participant } from './engine'
import type { IndependentOutput } from './schemas'
import type { Claim, MissingPoint, Review } from './state'

/**
 * The debate as the user watches it: who said what, in arrival order, plus what each member is
 * writing right now. Built from live engine events, or from a stored report for past sessions.
 */
export interface FeedMember {
  id: string
  roleLabel: string
  provider: string
  model: string
}

export interface FeedAnalysis {
  participantId: string
  roleLabel: string
  summary: string
  /** Claim ids are filled in once round 1 finishes. */
  claims: (IndependentOutput['claims'][number] & { id?: string })[]
}

export interface FeedReview {
  participantId: string
  roleLabel: string
  reviews: Review[]
  missing: MissingPoint[]
}

export interface DebateFeed {
  members: FeedMember[]
  /** Text streamed so far by members who are writing now, keyed by participant id. */
  live: Record<string, { round: Round; attempt: number; text: string }>
  analyses: FeedAnalysis[]
  claims: Claim[]
  reviews: FeedReview[]
  failed: Record<string, string>
}

export function emptyFeed(members: FeedMember[]): DebateFeed {
  return { members, live: {}, analyses: [], claims: [], reviews: [], failed: {} }
}

export function feedMembers(participants: Participant[], judge: Participant, roleLabel: (roleId: string) => string): FeedMember[] {
  return [
    ...participants.map((p) => ({ id: p.id, roleLabel: roleLabel(p.roleId), provider: p.provider, model: p.model })),
    { id: judge.id, roleLabel: 'Judge', provider: judge.provider, model: judge.model },
  ]
}

/** Applies one engine event in place (the feed is a reactive object in the UI). */
export function applyEvent(feed: DebateFeed, e: CouncilEvent): void {
  switch (e.type) {
    case 'delta': {
      const cur = feed.live[e.participantId]
      // A retry or JSON repair starts a fresh reply; do not glue it onto the broken one.
      if (!cur || cur.round !== e.round || cur.attempt !== e.attempt) feed.live[e.participantId] = { round: e.round, attempt: e.attempt, text: e.text }
      else cur.text += e.text
      break
    }
    case 'call':
      if (e.status === 'start') delete feed.failed[e.participantId]
      if (e.status !== 'start') delete feed.live[e.participantId]
      if (e.status === 'failed') feed.failed[e.participantId] = e.error ?? 'bilinmeyen hata'
      break
    case 'analysis':
      feed.analyses.push({ participantId: e.participantId, roleLabel: e.roleLabel, summary: e.output.summary, claims: e.output.claims.map((c) => ({ ...c })) })
      break
    case 'claims':
      feed.claims = e.claims
      for (const a of feed.analyses) {
        const own = e.claims.filter((c) => c.participantId === a.participantId)
        a.claims.forEach((c, i) => (c.id = own[i]?.id))
      }
      break
    case 'review':
      feed.reviews.push({ participantId: e.participantId, roleLabel: e.roleLabel, reviews: e.reviews, missing: e.missing })
      break
  }
}

/** Rebuilds the debate of a finished session from its stored report. */
export function feedFromReport(members: FeedMember[], report: CouncilReport<unknown>, summaries: Record<string, string> = {}): DebateFeed {
  const feed = emptyFeed(members)
  const order = [...new Set(report.claims.map((c) => c.participantId))]
  const positions = new Map((report.positions ?? []).map((p) => [p.participantId, p.summary]))
  feed.analyses = order.map((pid) => {
    const own = report.claims.filter((c) => c.participantId === pid)
    return {
      participantId: pid,
      roleLabel: own[0]!.roleLabel,
      summary: positions.get(pid) ?? summaries[pid] ?? '',
      claims: own.map(({ id, text, type, confidence }) => ({ id, text, type, confidence })),
    }
  })
  feed.claims = report.claims
  const reviewers = [...new Set([...report.reviews.map((r) => r.participantId), ...report.missing.map((m) => m.participantId)])]
  feed.reviews = reviewers.map((pid) => ({
    participantId: pid,
    roleLabel: (report.reviews.find((r) => r.participantId === pid) ?? report.missing.find((m) => m.participantId === pid))!.roleLabel,
    reviews: report.reviews.filter((r) => r.participantId === pid),
    missing: report.missing.filter((m) => m.participantId === pid),
  }))
  for (const f of report.failed) feed.failed[f.participantId] = f.error
  return feed
}

/**
 * Readable fragments of a reply that is still streaming as JSON: the string values of the fields
 * people care about, so the live view shows sentences instead of braces.
 */
export function liveFragments(text: string, max = 4): string[] {
  const out: string[] = []
  const re = /"(?:summary|text|reason|name|one_liner|decision_reason|problem|answer)"\s*:\s*"((?:[^"\\]|\\.)*)("?)/g
  for (let m = re.exec(text); m; m = re.exec(text)) {
    const value = m[1]!.replace(/\\n/g, ' ').replace(/\\"/g, '"').replace(/\\\\/g, '\\').trim()
    if (value) out.push(m[2] ? value : `${value}…`)
  }
  return out.slice(-max)
}
