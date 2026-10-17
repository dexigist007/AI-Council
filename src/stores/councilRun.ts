import { defineStore } from 'pinia'
import { reactive, shallowRef } from 'vue'
import { repos } from '@/db'
import type { Round } from '@/db'
import { runCouncil, type CouncilConfig, type CouncilEvent, type CouncilReport, type CouncilTask } from '@/domain/council/engine'
import { applyEvent, emptyFeed, feedMembers, type DebateFeed } from '@/domain/council/feed'
import type { DiscoveryMeta } from '@/domain/discovery/followup'
import type { DiscoveryReport } from '@/domain/discovery/report'
import { buildDiscoveryTask, type DiscoveryInput } from '@/domain/discovery/task'
import { roleBrief } from '@/domain/prompts/registry'
import { councilDeps } from '@/domain/council/runtime'
import { saveAuditFindings, type EvidenceSources } from '@/domain/audit/audit'
import type { AuditReport } from '@/domain/audit/report'
import type { IdeaReport } from '@/domain/ideas/report'
import { buildIdeaTask, type IdeaMode } from '@/domain/ideas/task'
import type { Idea, Project } from '@/db'

export interface ActiveRun {
  kind: 'idea' | 'project' | 'discovery'
  /** Set for idea / project runs; both null for discovery. */
  ideaId: string | null
  projectId: string | null
  sessionId: string | null
  status: 'running' | 'completed' | 'failed' | 'cancelled'
  round: Round | null
  members: Record<string, { status: 'waiting' | 'start' | 'done' | 'failed'; error?: string; label?: string }>
  spentUsd: number
  unpriced: string[]
  error?: string
  /** Live debate (reactive; mutated in place as events arrive). */
  feed: DebateFeed
  report?: CouncilReport<IdeaReport>
  discoveryReport?: CouncilReport<DiscoveryReport>
  auditReport?: CouncilReport<AuditReport>
  auditSaved?: { added: number; updated: number; unverified: number }
}

/**
 * One council at a time, kept outside components so it survives navigation.
 * The engine owns persistence; this store only mirrors progress for the UI.
 */
export const useCouncilRun = defineStore('councilRun', () => {
  const active = shallowRef<ActiveRun | null>(null)
  let controller: AbortController | null = null

  function patch(p: Partial<ActiveRun>) {
    active.value = { ...active.value!, ...p }
  }

  function begin(kind: ActiveRun['kind'], config: CouncilConfig, ids: { ideaId?: string; projectId?: string } = {}) {
    if (active.value?.status === 'running') throw new Error('Başka bir Council oturumu zaten çalışıyor.')
    const all = [...config.participants, config.judge]
    const members = Object.fromEntries(all.map((p) => [p.id, { status: 'waiting' as const, label: p.model }]))
    const feed = reactive(emptyFeed(feedMembers(config.participants, config.judge, (id) => roleBrief(id).label)))
    active.value = {
      kind, ideaId: ids.ideaId ?? null, projectId: ids.projectId ?? null, sessionId: null, status: 'running', round: null,
      members, spentUsd: 0, unpriced: [], feed,
    }
    controller = new AbortController()
    return { signal: controller.signal, onEvent: (e: CouncilEvent) => onEvent(feed, e) }
  }

  function onEvent(feed: DebateFeed, e: CouncilEvent) {
    applyEvent(feed, e)
    if (e.type === 'round') patch({ round: e.round })
    else if (e.type === 'cost') patch({ spentUsd: e.spentUsd, unpriced: e.unpriced })
    else if (e.type === 'call') {
      patch({ members: { ...active.value!.members, [e.participantId]: { ...active.value!.members[e.participantId], status: e.status, error: e.error } } })
    }
  }

  async function startIdea(idea: Idea, mode: IdeaMode, config: CouncilConfig) {
    const task = buildIdeaTask(idea, mode)
    const r = await repos()
    const opts = begin('idea', config, { ideaId: idea.id })
    await r.ideas.markEvaluating(idea.id)

    try {
      const run = await runCouncil(
        await councilDeps(),
        task,
        { ...config, meta: { ideaMode: mode, promptVersions: task.promptVersions } },
        opts,
      )
      patch({ sessionId: run.sessionId, status: run.status, error: run.error, report: run.report })
      // Without a report the idea goes back to draft; with one it waits for the user's verdict.
      if (run.status !== 'completed') await r.ideas.setDraft(idea.id)
    } catch (e) {
      patch({ status: 'failed', error: e instanceof Error ? e.message : String(e) })
      await r.ideas.setDraft(idea.id)
    } finally {
      controller = null
    }
  }

  /**
   * Runs a council whose judge returns findings (audit, change review) and stores the verified
   * findings for the project.
   */
  async function startProjectCouncil(
    project: Project,
    task: CouncilTask<AuditReport>,
    config: CouncilConfig,
    sources: EvidenceSources,
    meta: Record<string, unknown>,
  ) {
    const opts = begin('project', config, { projectId: project.id })
    try {
      const run = await runCouncil(await councilDeps(), task, { ...config, meta }, opts)
      const saved = run.report ? await saveAuditFindings((await repos()).findings, project.id, run.sessionId, run.report, sources) : undefined
      patch({ sessionId: run.sessionId, status: run.status, error: run.error, auditReport: run.report, auditSaved: saved })
    } catch (e) {
      patch({ status: 'failed', error: e instanceof Error ? e.message : String(e) })
    } finally {
      controller = null
    }
  }

  /** Opportunity discovery: no idea yet, the council proposes and ranks candidates. */
  async function startDiscovery(input: DiscoveryInput, config: CouncilConfig) {
    const task = buildDiscoveryTask(input)
    const opts = begin('discovery', config)
    const meta: DiscoveryMeta & { promptVersions: Record<string, number> } = {
      purpose: 'discovery', question: input.question, profile: input.profile, promptVersions: task.promptVersions,
    }
    try {
      const run = await runCouncil(await councilDeps(), task, { ...config, meta: { ...meta, kinds: input.kinds } }, opts)
      patch({ sessionId: run.sessionId, status: run.status, error: run.error, discoveryReport: run.report })
    } catch (e) {
      patch({ status: 'failed', error: e instanceof Error ? e.message : String(e) })
    } finally {
      controller = null
    }
  }

  function cancel() {
    controller?.abort()
  }

  function dismiss() {
    if (active.value?.status !== 'running') active.value = null
  }

  return { active, startIdea, startProjectCouncil, startDiscovery, cancel, dismiss }
})
