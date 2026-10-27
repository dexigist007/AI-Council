<template>
  <q-page padding>
    <div v-if="!idea" class="text-soft">{{ notFound ? t('ideas.detail.notFound') : t('common.loading') }}</div>
    <div v-else class="stack" style="max-width: 1000px">
      <div class="row items-start">
        <div class="col">
          <div class="text-h5">{{ idea.title }}</div>
          <div class="text-soft q-mt-xs" style="white-space: pre-wrap">{{ idea.body }}</div>
        </div>
        <div class="col-auto q-gutter-sm">
          <q-badge :color="idea.status === 'evaluating' ? 'orange' : 'primary'">{{ statusLabel(idea.status) }}</q-badge>
          <q-btn v-if="canEdit" flat dense icon="edit" @click="editing = !editing" />
        </div>
      </div>

      <q-card v-if="editing" flat bordered>
        <q-card-section class="q-gutter-sm">
          <q-input v-model="draftTitle" dense outlined :label="t('ideas.detail.idea')" />
          <q-input v-model="draftBody" outlined autogrow type="textarea" :label="t('ideas.detail.detail')" />
        </q-card-section>
        <q-card-actions align="right"><q-btn unelevated color="primary" :label="t('common.save')" @click="saveEdit" /></q-card-actions>
      </q-card>

      <SimilarIdeas :text="`${idea.title} ${idea.body}`" :ideas="others" :exclude-id="idea.id" />

      <q-banner v-if="parked" rounded class="tone-muted">
        {{ t('ideas.detail.parked', { status: statusLabel(idea.status), reason: idea.rejectReason ?? t('common.none') }) }}
        <span v-if="idea.revisitCondition"><br />{{ t('ideas.detail.revisit', { condition: idea.revisitCondition }) }}</span>
        <template #action><q-btn flat :label="t('ideas.detail.reopen')" @click="reopen" /></template>
      </q-banner>

      <CouncilProgress v-if="runHere" :run="runHere" @cancel="store.cancel()" @dismiss="store.dismiss()" />

      <template v-if="latest">
        <VerdictPanel v-if="idea.status === 'evaluating' && runHere?.status !== 'running'" :idea="idea" :report="latest.report.judge"
          :session-id="latest.sessionId" @decided="load" />
        <div class="text-caption text-soft">
          {{ latest.type === 'kill_idea' ? t('ideas.detail.kill') : t('ideas.detail.evaluation') }} · {{ fmtDate(latest.createdAt) }} ·
          <router-link :to="`/council/${latest.sessionId}`">{{ t('ideas.detail.sessionDetail') }}</router-link>
        </div>
        <IdeaReportView :report="latest.report.judge" :council="latest.report" />
      </template>

      <!-- v-show keeps the chosen models and roles while a run is in progress. -->
      <CouncilSetup v-if="!parked" v-show="runHere?.status !== 'running'" :idea="idea" :busy="store.active?.status === 'running'" @start="start" />

      <q-card v-if="sessions.length" flat bordered>
        <q-card-section class="text-subtitle2">{{ t('ideas.detail.history') }}</q-card-section>
        <q-list dense separator>
          <q-item v-for="s in sessions" :key="s.id" clickable :to="`/council/${s.id}`">
            <q-item-section>{{ s.type === 'kill_idea' ? t('ideas.detail.killShort') : t('ideas.detail.evaluation') }} · {{ s.mode.toUpperCase() }}</q-item-section>
            <q-item-section side>{{ t(`common.status.${s.status}`) }} · ${{ s.actualCost.toFixed(4) }}</q-item-section>
            <q-item-section side>{{ fmtDate(s.createdAt) }}</q-item-section>
          </q-item>
        </q-list>
      </q-card>
    </div>
  </q-page>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import CouncilProgress from '@/components/council/CouncilProgress.vue'
import CouncilSetup from '@/components/council/CouncilSetup.vue'
import IdeaReportView from '@/components/ideas/IdeaReportView.vue'
import SimilarIdeas from '@/components/ideas/SimilarIdeas.vue'
import VerdictPanel from '@/components/ideas/VerdictPanel.vue'
import { repos, type Idea, type Session } from '@/db'
import { GRAVEYARD_STATUSES } from '@/db/repositories/ideas'
import type { CouncilConfig, CouncilReport } from '@/domain/council/engine'
import { statusLabel } from '@/domain/ideas/labels'
import type { IdeaReport } from '@/domain/ideas/report'
import type { IdeaMode } from '@/domain/ideas/task'
import { fmtDate, t } from '@/i18n'
import { useCouncilRun } from '@/stores/councilRun'

const route = useRoute()
const store = useCouncilRun()
const idea = ref<Idea | null>(null)
const notFound = ref(false)
const others = ref<Idea[]>([])
const sessions = ref<Session[]>([])
const editing = ref(false)
const draftTitle = ref('')
const draftBody = ref('')

const runHere = computed(() => (store.active?.ideaId === idea.value?.id ? store.active : null))
const parked = computed(() => !!idea.value && GRAVEYARD_STATUSES.includes(idea.value.status))
const canEdit = computed(() => idea.value?.status === 'draft')
const latest = computed(() => {
  const s = sessions.value.find((x) => x.status === 'completed' && x.finalReport)
  return s ? { sessionId: s.id, type: s.type, createdAt: s.createdAt, report: s.finalReport as CouncilReport<IdeaReport> } : null
})

async function load() {
  const r = await repos()
  const id = route.params.id as string
  idea.value = await r.ideas.get(id)
  notFound.value = !idea.value
  if (!idea.value) return
  draftTitle.value = idea.value.title
  draftBody.value = idea.value.body
  others.value = await r.ideas.list()
  sessions.value = await r.sessions.list({ ideaId: id })
}

async function saveEdit() {
  await (await repos()).ideas.update(idea.value!.id, { title: draftTitle.value, body: draftBody.value })
  editing.value = false
  await load()
}

async function reopen() {
  await (await repos()).ideas.setDraft(idea.value!.id)
  await load()
}

async function start(mode: IdeaMode, config: CouncilConfig) {
  const run = store.startIdea(idea.value!, mode, config)
  await load() // shows "evaluating" while it runs
  await run.catch(() => {})
  await load()
}

// Reload when a run for this idea finishes, even if it was started before navigating here.
watch(() => runHere.value?.status, (s, prev) => { if (prev === 'running' && s !== 'running') void load() })
watch(() => route.params.id, () => void load())
onMounted(load)
</script>
