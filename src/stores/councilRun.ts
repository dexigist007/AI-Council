import { defineStore } from 'pinia'
import { shallowRef } from 'vue'
import { repos } from '@/db'
import type { Round } from '@/db'
import { runCouncil, type CouncilConfig, type CouncilReport } from '@/domain/council/engine'
import { councilDeps } from '@/domain/council/runtime'
import type { AskContext } from '@/domain/ask/context'
import { buildAuditTask, saveAuditFindings } from '@/domain/audit/audit'
import type { IdeaReport } from '@/domain/ideas/report'
import { buildIdeaTask, type IdeaMode } from '@/domain/ideas/task'
import type { Idea, Project } from '@/db'

export interface ActiveRun {
  /** Exactly one of ideaId / projectId is set. */
  ideaId: string | null
  projectId: string | null
  sessionId: string | null
  status: 'running' | 'completed' | 'failed' | 'cancelled'
  round: Round | null
  members: Record<string, { status: 'waiting' | 'start' | 'done' | 'failed'; error?: string }>
  spentUsd: number
  unpriced: string[]
  error?: string
  report?: CouncilReport<IdeaReport>
  auditReport?: CouncilReport<unknown>
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

  async function startIdea(idea: Idea, mode: IdeaMode, config: CouncilConfig) {
    if (active.value?.status === 'running') throw new Error('Başka bir Council oturumu zaten çalışıyor.')
    const task = buildIdeaTask(idea, mode)
    const r = await repos()
    const members = Object.fromEntries([...config.participants, config.judge].map((p) => [p.id, { status: 'waiting' as const }]))
    active.value = { ideaId: idea.id, projectId: null, sessionId: null, status: 'running', round: null, members, spentUsd: 0, unpriced: [] }
    controller = new AbortController()
    await r.ideas.markEvaluating(idea.id)

    try {
      const run = await runCouncil(
        await councilDeps(),
        task,
        { ...config, meta: { ideaMode: mode, promptVersions: task.promptVersions } },
        {
          signal: controller.signal,
          onEvent: (e) => {
            if (e.type === 'round') patch({ round: e.round })
            else if (e.type === 'cost') patch({ spentUsd: e.spentUsd, unpriced: e.unpriced })
            else patch({ members: { ...active.value!.members, [e.participantId]: { status: e.status, error: e.error } } })
          },
        },
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

  async function startAudit(project: Project, focusIds: string[], context: AskContext, config: CouncilConfig) {
    if (active.value?.status === 'running') throw new Error('Başka bir Council oturumu zaten çalışıyor.')
    const task = buildAuditTask(project, context, focusIds)
    const members = Object.fromEntries([...config.participants, config.judge].map((p) => [p.id, { status: 'waiting' as const }]))
    active.value = { ideaId: null, projectId: project.id, sessionId: null, status: 'running', round: null, members, spentUsd: 0, unpriced: [] }
    controller = new AbortController()
    try {
      const run = await runCouncil(await councilDeps(), task, { ...config, meta: { focus: focusIds, sentFiles: context.files } }, {
        signal: controller.signal,
        onEvent: (e) => {
          if (e.type === 'round') patch({ round: e.round })
          else if (e.type === 'cost') patch({ spentUsd: e.spentUsd, unpriced: e.unpriced })
          else patch({ members: { ...active.value!.members, [e.participantId]: { status: e.status, error: e.error } } })
        },
      })
      const saved = run.report
        ? await saveAuditFindings((await repos()).findings, project.id, run.sessionId, run.report as never, context)
        : undefined
      patch({ sessionId: run.sessionId, status: run.status, error: run.error, auditReport: run.report, auditSaved: saved })
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

  return { active, startIdea, startAudit, cancel, dismiss }
})
