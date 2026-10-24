<template>
  <q-page padding>
    <div v-if="!session" class="text-grey-7">{{ t('common.loading') }}</div>
    <div v-else class="stack" style="max-width: 1100px">
      <div>
        <div class="text-h5">{{ sessionLabel(session) }} · {{ session.mode.toUpperCase() }}</div>
        <div class="text-caption text-grey-7">
          {{ fmtDate(session.createdAt) }} ·
          <q-badge :color="STATUS_COLOR[session.status]">{{ t(`common.status.${session.status}`) }}</q-badge> ·
          {{ t('council.session.estimated') }} {{ session.estCost === null ? t('common.unpriced') : `$${session.estCost.toFixed(4)}` }} · {{ t('council.session.actual') }} ${{ session.actualCost.toFixed(4) }}
          <span v-if="session.ideaId"> · <router-link :to="`/ideas/${session.ideaId}`">{{ t('council.session.goToIdea') }}</router-link></span>
          <span v-if="dMeta?.parentSessionId"> · <router-link :to="`/council/${dMeta.parentSessionId}`">{{ t('council.session.previousReport') }}</router-link></span>
        </div>
        <div v-if="session.error" class="text-negative q-mt-sm">{{ session.error }}</div>
      </div>

      <q-card v-if="dMeta" flat bordered>
        <q-card-section>
          <div class="text-caption text-soft">{{ t('council.session.request') }}</div>
          <div>{{ dMeta.question }}</div>
          <template v-if="dMeta.followup">
            <div class="text-caption text-soft q-mt-sm">{{ t('council.session.followup') }}</div>
            <div>{{ dMeta.followup }}</div>
          </template>
        </q-card-section>
      </q-card>

      <q-expansion-item v-if="feed" v-model="feedOpen" icon="forum" :label="t('council.session.debate', { claims: feed.claims.length, reviews: feed.reviews.reduce((n, r) => n + r.reviews.length, 0) })"
        header-class="text-subtitle1" class="debate-box">
        <div class="q-pa-md"><DebateFeedView :feed="feed" judge-done /></div>
      </q-expansion-item>

      <template v-if="discoveryReport">
        <DiscoveryReportView :report="discoveryReport" />
        <q-card flat bordered>
          <q-card-section>
            <div class="text-subtitle2 q-mb-xs">{{ t('council.session.followup') }}</div>
            <div class="text-caption text-soft q-mb-sm">
              {{ t('council.session.followupHint') }}
            </div>
            <q-input v-model="followup" outlined autogrow :label="t('council.session.yourQuestion')" :disable="asking" />
            <div class="row items-center q-mt-sm q-gutter-sm">
              <q-btn unelevated color="primary" no-caps icon="send" :label="t('council.session.ask')" :loading="asking" :disable="!followup.trim() || !followupModel" @click="ask" />
              <span v-if="!followupModel" class="text-caption text-soft">{{ t('council.session.noJudgeModel') }}</span>
              <span v-else class="text-caption text-soft">{{ followupModel.provider }} · {{ followupModel.model }}</span>
              <span v-if="askError" class="text-negative text-caption">{{ askError }}</span>
            </div>
            <div v-if="asking && liveText" class="q-mt-sm text-caption text-soft">
              {{ t('council.feed.typing', { count: fmtNum(liveText.length) }) }}
              <div v-for="(l, i) in liveFragments(liveText)" :key="i">{{ l }}</div>
            </div>
          </q-card-section>
        </q-card>
      </template>

      <IdeaReportView v-if="ideaReport" :report="ideaReport.judge" :council="ideaReport" />
      <AskAnswerView v-if="askReport" :report="askReport" />
      <q-card v-if="findingsReport" flat bordered>
        <q-card-section>
          <div class="text-subtitle2">{{ t('council.session.summary') }}</div>
          <div style="white-space: pre-wrap">{{ findingsReport.judge.summary }}</div>
          <div class="text-caption text-grey-7 q-mt-sm">
            {{ t('council.session.findingsNote', { count: findingsReport.judge.findings.length }) }}
            <router-link v-if="session.projectId" :to="`/projects/${session.projectId}`">{{ t('council.session.goToProject') }}</router-link>
          </div>
        </q-card-section>
      </q-card>

      <q-card flat bordered>
        <q-card-section class="text-subtitle2">{{ t('council.session.modelCalls', { count: messages.length }) }}</q-card-section>
        <q-list separator>
          <q-expansion-item v-for="m in messages" :key="m.id" dense>
            <template #header>
              <q-item-section avatar><q-icon :name="m.error ? 'error' : 'check'" :color="m.error ? 'negative' : 'positive'" /></q-item-section>
              <q-item-section>
                <q-item-label>{{ m.round }} · {{ m.participant }} · {{ m.role }}</q-item-label>
                <q-item-label caption>{{ m.provider }}/{{ m.model }} · {{ m.promptId }}@v{{ m.promptVersion }}</q-item-label>
              </q-item-section>
              <q-item-section side class="text-caption">
                {{ m.tokensIn }} in / {{ m.tokensOut }} out<span v-if="m.cachedTokens"> {{ t('council.session.cache', { count: m.cachedTokens }) }}</span> · ${{ m.cost.toFixed(4) }}
                · {{ ((m.latencyMs ?? 0) / 1000).toFixed(1) }}s
              </q-item-section>
            </template>
            <q-card flat class="q-pa-md tone-muted">
              <div v-if="m.error" class="text-negative q-mb-sm">{{ m.error }}</div>
              <pre class="q-ma-none text-caption" style="white-space: pre-wrap; max-height: 400px; overflow: auto">{{ m.responseText ?? t('council.session.noResponse') }}</pre>
            </q-card>
          </q-expansion-item>
        </q-list>
      </q-card>
    </div>
  </q-page>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import IdeaReportView from '@/components/ideas/IdeaReportView.vue'
import DebateFeedView from '@/components/council/DebateFeedView.vue'
import DiscoveryReportView from '@/components/discovery/DiscoveryReportView.vue'
import { feedFromReport, feedMembers, liveFragments } from '@/domain/council/feed'
import { councilDeps } from '@/domain/council/runtime'
import { askFollowup, discoveryMeta } from '@/domain/discovery/followup'
import type { DiscoveryReport } from '@/domain/discovery/report'
import { roleBrief } from '@/domain/prompts/registry'
import type { ProviderId } from '@/domain/providers/types'
import AskAnswerView from '@/components/projects/AskAnswerView.vue'
import type { AskReport } from '@/domain/ask/ask'
import type { AuditReport } from '@/domain/audit/report'
import { repos, type Session, type SessionMessage } from '@/db'
import { fmtDate, fmtNum, t } from '@/i18n'
import type { CouncilConfig, CouncilReport } from '@/domain/council/engine'
import type { IdeaReport } from '@/domain/ideas/report'
import { STATUS_COLOR, sessionLabel } from './sessionLabels'

const route = useRoute()
const session = ref<Session | null>(null)
const messages = ref<SessionMessage[]>([])
const router = useRouter()
const dMeta = computed(() => (session.value ? discoveryMeta(session.value.config) : null))
const ideaReport = computed(() =>
  session.value?.finalReport && !dMeta.value && (session.value.type === 'new_idea' || session.value.type === 'kill_idea')
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

/** Discovery: the council's judge report, or a follow-up's revised report (stored bare). */
const discoveryReport = computed<DiscoveryReport | null>(() => {
  const rep = session.value?.finalReport
  if (!rep || !dMeta.value) return null
  return dMeta.value.purpose === 'discovery' ? (rep as CouncilReport<DiscoveryReport>).judge : (rep as DiscoveryReport)
})

/** Recorded debate of a multi-member council session, rebuilt from its report. */
const feedOpen = ref(false)
const feed = computed(() => {
  const s = session.value
  const cfg = s?.config as Partial<CouncilConfig> | undefined
  const rep = s?.finalReport as CouncilReport<unknown> | null
  if (!s || !cfg?.participants || !cfg.judge || !rep?.claims) return null
  const label = (id: string) => { try { return roleBrief(id).label } catch { return id } }
  const summaries = Object.fromEntries(
    messages.value
      .filter((m) => m.round === 'independent' && m.responseJson && typeof (m.responseJson as { summary?: unknown }).summary === 'string')
      .map((m) => [m.participant, (m.responseJson as { summary: string }).summary]),
  )
  return feedFromReport(feedMembers(cfg.participants, cfg.judge, label), rep, summaries)
})

const followup = ref('')
const asking = ref(false)
const askError = ref('')
const liveText = ref('')
const followupModel = computed(() => {
  const cfg = session.value?.config as { judge?: { provider: ProviderId; model: string; maxTokens?: number }; model?: { provider: ProviderId; model: string; maxTokens?: number } } | undefined
  return cfg?.judge ?? cfg?.model ?? null
})

async function ask() {
  if (!session.value || !dMeta.value || !discoveryReport.value || !followupModel.value) return
  asking.value = true
  askError.value = ''
  liveText.value = ''
  try {
    const m = followupModel.value
    const res = await askFollowup(
      await councilDeps(),
      { sessionId: session.value.id, meta: dMeta.value, report: discoveryReport.value },
      followup.value.trim(),
      { provider: m.provider, model: m.model, maxTokens: m.maxTokens },
      { onDelta: (t) => (liveText.value += t) },
    )
    if (res.error) askError.value = res.error
    else {
      followup.value = ''
      await router.push(`/council/${res.sessionId}`)
    }
  } finally {
    asking.value = false
  }
}

async function load(id: string) {
  const r = await repos()
  session.value = await r.sessions.get(id)
  messages.value = await r.sessions.listMessages(id)
}

onMounted(() => load(route.params.id as string))
watch(() => route.params.id, (id) => id && load(id as string))
</script>
