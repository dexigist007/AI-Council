<template>
  <q-page padding>
    <div class="stack" style="max-width: 1200px">
      <div>
        <div class="text-h5">{{ t('ideas.discovery.title') }}</div>
        <div class="text-soft">{{ t('ideas.discovery.intro') }}</div>
      </div>

      <template v-if="!runHere || runHere.status !== 'running'">
        <q-card flat bordered>
          <q-card-section class="stack">
            <q-input
              v-model="question" outlined autogrow :label="t('ideas.discovery.question')"
              :hint="t('ideas.discovery.questionHint')"
            />
            <div>
              <div class="text-caption q-mb-xs">{{ t('ideas.discovery.kinds') }}</div>
              <q-option-group v-model="kinds" type="checkbox" inline :options="kindOptions" />
            </div>
          </q-card-section>
          <q-separator />
          <q-card-section>
            <div class="row items-center q-mb-sm">
              <div class="text-subtitle2">{{ t('ideas.discovery.profile') }}</div>
              <q-space />
              <span v-if="profileSaved" class="text-caption text-positive q-mr-sm">{{ t('ideas.discovery.saved') }}</span>
              <q-btn flat dense no-caps icon="save" :label="t('ideas.discovery.saveProfile')" @click="saveProfile" />
            </div>
            <div class="text-caption text-soft q-mb-sm">
              {{ t('ideas.discovery.profileHint') }}
            </div>
            <div class="row q-col-gutter-sm">
              <q-input v-model="profile.skills" class="col-12" dense outlined autogrow :label="t('ideas.discovery.skills')"
                :hint="t('ideas.discovery.skillsHint')" />
              <q-input v-model="profile.budget" class="col-6 col-md-3" dense outlined :label="t('ideas.discovery.budget')" :hint="t('ideas.discovery.budgetHint')" />
              <q-input v-model="profile.weeklyHours" class="col-6 col-md-3" dense outlined :label="t('ideas.discovery.weeklyHours')" :hint="t('ideas.discovery.weeklyHoursHint')" />
              <q-select v-model="profile.timeToRevenue" class="col-6 col-md-3" dense outlined :label="t('ideas.discovery.timeToRevenue')"
                :options="timeOptions" emit-value map-options />
              <q-input v-model="profile.market" class="col-6 col-md-3" dense outlined :label="t('ideas.discovery.market')" :hint="t('ideas.discovery.marketHint')" />
              <q-input v-model="profile.exclusions" class="col-12" dense outlined :label="t('ideas.discovery.exclusions')" :hint="t('ideas.discovery.exclusionsHint')" />
            </div>
          </q-card-section>
        </q-card>

        <CouncilConfigurator
          :title="t('ideas.discovery.councilTitle')" :task="task" :roles="DISCOVERY_ROLES" :busy="store.active?.status === 'running'"
          :block-reason="question.trim() ? '' : t('ideas.discovery.blockReason')" :start-label="t('ideas.discovery.start')" start-icon="explore"
          @start="start"
        />
      </template>

      <template v-if="runHere">
        <CouncilProgress :run="runHere" @cancel="store.cancel()" @dismiss="store.dismiss()" />
        <DebateFeedView :feed="runHere.feed" :judge-done="!!runHere.discoveryReport" />
        <template v-if="runHere.discoveryReport">
          <DiscoveryReportView :report="runHere.discoveryReport.judge" />
          <q-btn v-if="runHere.sessionId" flat no-caps color="primary" icon="open_in_new" :label="t('ideas.discovery.openSession')" :to="`/council/${runHere.sessionId}`" />
        </template>
      </template>

      <q-card v-if="past.length" flat bordered>
        <q-card-section class="text-subtitle2">{{ t('ideas.discovery.past') }}</q-card-section>
        <q-list separator>
          <q-item v-for="s in past" :key="s.id" clickable :to="`/council/${s.id}`">
            <q-item-section>
              <q-item-label class="ellipsis">{{ discoveryMeta(s.config)?.followup ?? discoveryMeta(s.config)?.question }}</q-item-label>
              <q-item-label caption>
                {{ discoveryMeta(s.config)?.purpose === 'discovery_followup' ? t('ideas.discovery.followup') : t('ideas.discovery.discovery') }} · {{ fmtDate(s.createdAt) }}
              </q-item-label>
            </q-item-section>
            <q-item-section side><q-badge :color="STATUS_COLOR[s.status]">{{ t(`common.status.${s.status}`) }}</q-badge></q-item-section>
          </q-item>
        </q-list>
      </q-card>
    </div>
  </q-page>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import CouncilConfigurator from '@/components/council/CouncilConfigurator.vue'
import CouncilProgress from '@/components/council/CouncilProgress.vue'
import DebateFeedView from '@/components/council/DebateFeedView.vue'
import DiscoveryReportView from '@/components/discovery/DiscoveryReportView.vue'
import { repos, type Session } from '@/db'
import type { CouncilConfig } from '@/domain/council/engine'
import { discoveryMeta } from '@/domain/discovery/followup'
import { EMPTY_PROFILE, PROFILE_KEY, TIME_TO_REVENUE, parseProfile, type DiscoveryProfile } from '@/domain/discovery/profile'
import type { CandidateKind } from '@/domain/discovery/report'
import { buildDiscoveryTask, DISCOVERY_ROLES } from '@/domain/discovery/task'
import { fmtDate, t } from '@/i18n'
import { useCouncilRun } from '@/stores/councilRun'
import { STATUS_COLOR } from './sessionLabels'

const store = useCouncilRun()
const question = ref('')
const kinds = ref<CandidateKind[]>([])
const profile = ref<DiscoveryProfile>({ ...EMPTY_PROFILE })
const profileSaved = ref(false)
const past = ref<Session[]>([])

const KIND_OPTIONS = ['app', 'game', 'saas', 'service', 'content', 'ecommerce'] as const
const kindOptions = computed(() => KIND_OPTIONS.map((k) => ({ label: t(`ideas.discovery.kind.${k}`), value: k })))
const timeOptions = computed(() => TIME_TO_REVENUE.map((v) => ({ label: t(`ideas.discovery.time.${v}`), value: v })))

const runHere = computed(() => (store.active?.kind === 'discovery' ? store.active : null))
const task = computed(() => (question.value.trim() ? buildDiscoveryTask({ question: question.value, kinds: kinds.value, profile: profile.value }) : null))

watch(profile, () => (profileSaved.value = false), { deep: true })

async function saveProfile() {
  await (await repos()).settings.set(PROFILE_KEY, profile.value)
  profileSaved.value = true
}

async function loadPast() {
  past.value = (await (await repos()).sessions.list({ limit: 200 })).filter((s) => discoveryMeta(s.config)).slice(0, 20)
}

async function start(config: CouncilConfig) {
  await store.startDiscovery({ question: question.value, kinds: kinds.value, profile: { ...profile.value } }, config)
  await loadPast()
}

onMounted(async () => {
  profile.value = parseProfile(await (await repos()).settings.get(PROFILE_KEY))
  profileSaved.value = false
  await loadPast()
})
</script>
