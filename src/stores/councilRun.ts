import { defineStore } from 'pinia'
import { shallowRef } from 'vue'
import { repos } from '@/db'
import type { Round } from '@/db'
import { runCouncil, type CouncilConfig, type CouncilReport } from '@/domain/council/engine'
import { councilDeps } from '@/domain/council/runtime'
import type { IdeaReport } from '@/domain/ideas/report'
import { buildIdeaTask, type IdeaMode } from '@/domain/ideas/task'
import type { Idea } from '@/db'

export interface ActiveRun {
  ideaId: string
  sessionId: string | null
  status: 'running' | 'completed' | 'failed' | 'cancelled'
  round: Round | null
  members: Record<string, { status: 'waiting' | 'start' | 'done' | 'failed'; error?: string }>
  spentUsd: number
  unpriced: string[]
  error?: string
  report?: CouncilReport<IdeaReport>
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
    active.value = { ideaId: idea.id, sessionId: null, status: 'running', round: null, members, spentUsd: 0, unpriced: [] }
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

  function cancel() {
    controller?.abort()
  }

  function dismiss() {
    if (active.value?.status !== 'running') active.value = null
  }

  return { active, startIdea, cancel, dismiss }
})
