import type { CritiqueOutput, IndependentOutput } from './schemas'

export interface Claim {
  id: string
  participantId: string
  roleLabel: string
  text: string
  type: IndependentOutput['claims'][number]['type']
  confidence: IndependentOutput['claims'][number]['confidence']
}

export interface Review {
  claimId: string
  participantId: string
  roleLabel: string
  stance: CritiqueOutput['reviews'][number]['stance']
  reason: string
}

export interface MissingPoint {
  participantId: string
  roleLabel: string
  text: string
  type: Claim['type']
  confidence: Claim['confidence']
}

export interface MemberAnalysis {
  participantId: string
  roleLabel: string
  output: IndependentOutput
}

/** Numbers every round-1 claim (C1, C2, ...) so later rounds can reference them. */
export function collectClaims(analyses: MemberAnalysis[]): Claim[] {
  let n = 0
  return analyses.flatMap((a) =>
    a.output.claims.map((c) => ({ id: `C${++n}`, participantId: a.participantId, roleLabel: a.roleLabel, ...c })),
  )
}

/**
 * Compact text form of the debate, the only thing later rounds see of round 1.
 * Long free-form answers are never forwarded (token control).
 */
export function renderState(analyses: MemberAnalysis[], claims: Claim[], viewerId?: string): string {
  return analyses
    .map((a) => {
      const you = a.participantId === viewerId ? ' (you)' : ''
      const lines = claims
        .filter((c) => c.participantId === a.participantId)
        .map((c) => `- ${c.id} [${c.type}, ${c.confidence}] ${c.text}`)
      return `### ${a.roleLabel}${you}\nPosition: ${a.output.summary}\n${lines.join('\n')}`
    })
    .join('\n\n')
}

/** Keeps reviews of existing claims by someone other than the author; drops the rest. */
export function acceptReviews(output: CritiqueOutput, claims: Claim[], participantId: string, roleLabel: string): Review[] {
  const byId = new Map(claims.map((c) => [c.id, c]))
  return output.reviews
    .filter((r) => {
      const claim = byId.get(r.claim_id.trim().toUpperCase())
      return claim !== undefined && claim.participantId !== participantId
    })
    .map((r) => ({ claimId: r.claim_id.trim().toUpperCase(), participantId, roleLabel, stance: r.stance, reason: r.reason }))
}

export function renderCritique(claims: Claim[], reviews: Review[], missing: MissingPoint[]): string {
  if (reviews.length === 0 && missing.length === 0) return 'No cross-review round was run.'
  const parts: string[] = []
  for (const c of claims) {
    const rs = reviews.filter((r) => r.claimId === c.id)
    if (rs.length === 0) continue
    parts.push(`${c.id} (${c.roleLabel}): ${c.text}\n${rs.map((r) => `  - ${r.roleLabel}: ${r.stance} — ${r.reason}`).join('\n')}`)
  }
  const unreviewed = claims.filter((c) => !reviews.some((r) => r.claimId === c.id)).map((c) => c.id)
  if (unreviewed.length) parts.push(`Not reviewed by anyone: ${unreviewed.join(', ')}`)
  if (missing.length) {
    parts.push(`Points raised as missing:\n${missing.map((m) => `- [${m.type}, ${m.confidence}] (${m.roleLabel}) ${m.text}`).join('\n')}`)
  }
  return parts.join('\n\n')
}
