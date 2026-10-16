<template>
  <q-page padding>
    <div v-if="!session" class="text-grey-7">Yükleniyor…</div>
    <div v-else class="stack" style="max-width: 1100px">
      <div>
        <div class="text-h5">{{ sessionLabel(session) }} · {{ session.mode.toUpperCase() }}</div>
        <div class="text-caption text-grey-7">
          {{ new Date(session.createdAt).toLocaleString() }} ·
          <q-badge :color="STATUS_COLOR[session.status]">{{ session.status }}</q-badge> ·
          tahmini {{ session.estCost === null ? 'fiyatsız' : `$${session.estCost.toFixed(4)}` }} · gerçekleşen ${{ session.actualCost.toFixed(4) }}
          <span v-if="session.ideaId"> · <router-link :to="`/ideas/${session.ideaId}`">fikre git</router-link></span>
        </div>
        <div v-if="session.error" class="text-negative q-mt-sm">{{ session.error }}</div>
      </div>

      <IdeaReportView v-if="ideaReport" :report="ideaReport.judge" :council="ideaReport" />
      <AskAnswerView v-if="askReport" :report="askReport" />
      <q-card v-if="findingsReport" flat bordered>
        <q-card-section>
          <div class="text-subtitle2">Özet</div>
          <div style="white-space: pre-wrap">{{ findingsReport.judge.summary }}</div>
          <div class="text-caption text-grey-7 q-mt-sm">
            Judge {{ findingsReport.judge.findings.length }} bulgu üretti; doğrulanmış hâlleri projenin Findings sekmesinde.
            <router-link v-if="session.projectId" :to="`/projects/${session.projectId}`">projeye git</router-link>
          </div>
        </q-card-section>
      </q-card>

      <q-card flat bordered>
        <q-card-section class="text-subtitle2">Model çağrıları ({{ messages.length }})</q-card-section>
        <q-list separator>
          <q-expansion-item v-for="m in messages" :key="m.id" dense>
            <template #header>
              <q-item-section avatar><q-icon :name="m.error ? 'error' : 'check'" :color="m.error ? 'negative' : 'positive'" /></q-item-section>
              <q-item-section>
                <q-item-label>{{ m.round }} · {{ m.participant }} · {{ m.role }}</q-item-label>
                <q-item-label caption>{{ m.provider }}/{{ m.model }} · {{ m.promptId }}@v{{ m.promptVersion }}</q-item-label>
              </q-item-section>
              <q-item-section side class="text-caption">
                {{ m.tokensIn }} in / {{ m.tokensOut }} out<span v-if="m.cachedTokens"> ({{ m.cachedTokens }} cache)</span> · ${{ m.cost.toFixed(4) }}
                · {{ ((m.latencyMs ?? 0) / 1000).toFixed(1) }}s
              </q-item-section>
            </template>
            <q-card flat class="q-pa-md tone-muted">
              <div v-if="m.error" class="text-negative q-mb-sm">{{ m.error }}</div>
              <pre class="q-ma-none text-caption" style="white-space: pre-wrap; max-height: 400px; overflow: auto">{{ m.responseText ?? '(yanıt yok)' }}</pre>
            </q-card>
          </q-expansion-item>
        </q-list>
      </q-card>
    </div>
  </q-page>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRoute } from 'vue-router'
import IdeaReportView from '@/components/ideas/IdeaReportView.vue'
import AskAnswerView from '@/components/projects/AskAnswerView.vue'
import type { AskReport } from '@/domain/ask/ask'
import type { AuditReport } from '@/domain/audit/report'
import { repos, type Session, type SessionMessage } from '@/db'
import type { CouncilReport } from '@/domain/council/engine'
import type { IdeaReport } from '@/domain/ideas/report'
import { STATUS_COLOR, sessionLabel } from './sessionLabels'

const route = useRoute()
const session = ref<Session | null>(null)
const messages = ref<SessionMessage[]>([])
const ideaReport = computed(() =>
  session.value?.finalReport && (session.value.type === 'new_idea' || session.value.type === 'kill_idea')
    ? (session.value.finalReport as CouncilReport<IdeaReport>)
    : null,
)

const findingsReport = computed(() =>
  session.value?.finalReport && (session.value.type === 'audit' || session.value.type === 'review_changes')
    ? (session.value.finalReport as CouncilReport<AuditReport>)
    : null,
)

const askReport = computed(() =>
  session.value?.finalReport && (session.value.config.meta as { purpose?: string } | undefined)?.purpose === 'ask'
    ? (session.value.finalReport as AskReport)
    : null,
)

onMounted(async () => {
  const r = await repos()
  const id = route.params.id as string
  session.value = await r.sessions.get(id)
  messages.value = await r.sessions.listMessages(id)
})
</script>
