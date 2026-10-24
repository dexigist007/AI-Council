<template>
  <div class="stack">
    <div class="row q-col-gutter-sm items-center">
      <q-select v-model="statusFilter" class="col-12 col-md-3" dense outlined multiple emit-value map-options :options="statusOptions" :label="t('projects.findings.status')" />
      <q-select v-model="priorityFilter" class="col-6 col-md-2" dense outlined multiple :options="['P0', 'P1', 'P2', 'P3']" :label="t('projects.findings.priority')" />
      <q-select v-model="categoryFilter" class="col-6 col-md-3" dense outlined multiple emit-value map-options :options="categoryOptions" :label="t('projects.findings.category')" />
      <q-toggle v-model="verifiedOnly" class="col-auto" :label="t('projects.findings.verifiedOnly')" />
      <q-space />
      <div class="col-auto text-caption text-grey-7">{{ t('projects.findings.count', { n: shown.length }) }}</div>
    </div>

    <div v-if="shown.length === 0" class="text-grey-7">{{ t('projects.findings.empty') }}</div>
    <q-list v-else bordered separator>
      <q-expansion-item v-for="f in shown" :key="f.id" dense>
        <template #header>
          <q-item-section side><q-badge :color="PRIORITY_COLOR[f.priority]" class="text-weight-bold">{{ f.priority }}</q-badge></q-item-section>
          <q-item-section>
            <q-item-label :class="f.status !== 'open' ? 'text-grey-6' : ''">{{ f.title }}</q-item-label>
            <q-item-label caption>
              {{ categoryLabel(f.category) }} · {{ t(`projects.findings.severity.${f.severity}`) }} · {{ t('projects.findings.confidenceLine', { level: t(`projects.findings.confidence.${f.confidence}`) }) }}
              <span v-if="showProject && projectNames[f.projectId]"> · {{ projectNames[f.projectId] }}</span>
            </q-item-label>
          </q-item-section>
          <q-item-section side>
            <div class="row items-center q-gutter-xs no-wrap">
              <q-badge v-if="f.verification === 'unverified'" color="negative" outline>UNVERIFIED</q-badge>
              <q-badge v-if="f.status !== 'open'" color="grey-7">{{ t(`projects.findings.statusLabel.${f.status}`) }}</q-badge>
            </div>
          </q-item-section>
        </template>
        <q-card flat class="q-px-md q-pb-md">
          <div style="white-space: pre-wrap">{{ f.description }}</div>
          <div v-if="f.evidence.length" class="q-mt-sm">
            <div class="text-caption text-grey-7">{{ t('projects.findings.evidence') }}</div>
            <div v-for="(e, i) in f.evidence" :key="i" class="q-mt-xs">
              <q-badge :color="e.verified ? 'positive' : 'negative'" outline class="q-mr-sm">{{ e.verified ? t('projects.findings.evidenceVerified') : t('projects.findings.evidenceMissing') }}</q-badge>
              <code>{{ e.file }}:{{ e.start_line }}<span v-if="e.end_line !== e.start_line">-{{ e.end_line }}</span></code>
              <pre v-if="e.quote" class="quote">{{ e.quote }}</pre>
            </div>
          </div>
          <div v-else class="text-caption text-grey-7 q-mt-sm">{{ t('projects.findings.noEvidence') }}</div>
          <div v-if="f.suggestedFix" class="q-mt-sm"><b>{{ t('projects.findings.suggestedFix') }}</b> {{ f.suggestedFix }}</div>
          <div class="text-caption text-grey-7 q-mt-sm">
            {{ t('projects.findings.scores', { impact: f.impact, risk: f.risk, urgency: f.urgency, effort: f.effort, date: fmtDay(f.lastSeenAt) }) }}
          </div>
          <div class="row q-gutter-sm q-mt-sm">
            <q-btn v-for="s in STATUS_ACTIONS" :key="s.value" size="sm" :outline="f.status !== s.value" :unelevated="f.status === s.value" :color="s.color" :label="s.label()" @click="setStatus(f, s.value)" />
          </div>
        </q-card>
      </q-expansion-item>
    </q-list>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { repos, type Finding } from '@/db'
import { CATEGORIES, categoryLabel, type FindingStatus, type Priority } from '@/domain/findings/types'
import { fmtDay, t } from '@/i18n'

const props = defineProps<{ projectId?: string; refreshKey?: number }>()
const showProject = computed(() => !props.projectId)

const PRIORITY_COLOR: Record<Priority, string> = { P0: 'negative', P1: 'deep-orange', P2: 'warning', P3: 'grey-6' }
const STATUSES: FindingStatus[] = ['open', 'accepted', 'done', 'wontfix', 'false_positive']
const statusOptions = computed(() => STATUSES.map((s) => ({ label: t(`projects.findings.statusLabel.${s}`), value: s })))
const STATUS_ACTIONS: { value: FindingStatus; label: () => string; color: string }[] = [
  { value: 'open', label: () => t('projects.findings.statusLabel.open'), color: 'grey-8' },
  { value: 'accepted', label: () => t('projects.findings.accept'), color: 'primary' },
  { value: 'done', label: () => t('projects.findings.statusLabel.done'), color: 'positive' },
  { value: 'wontfix', label: () => t('projects.findings.statusLabel.wontfix'), color: 'grey-7' },
  { value: 'false_positive', label: () => t('projects.findings.statusLabel.false_positive'), color: 'negative' },
]
const categoryOptions = computed(() => CATEGORIES.map((c) => ({ label: categoryLabel(c), value: c })))

const findings = ref<Finding[]>([])
const projectNames = ref<Record<string, string>>({})
const statusFilter = ref<FindingStatus[]>(['open', 'accepted'])
const priorityFilter = ref<Priority[]>([])
const categoryFilter = ref<string[]>([])
const verifiedOnly = ref(false)

const shown = computed(() => findings.value.filter((f) =>
  (statusFilter.value.length === 0 || statusFilter.value.includes(f.status)) &&
  (priorityFilter.value.length === 0 || priorityFilter.value.includes(f.priority)) &&
  (categoryFilter.value.length === 0 || categoryFilter.value.includes(f.category)) &&
  (!verifiedOnly.value || f.verification === 'verified')))

async function load() {
  const r = await repos()
  findings.value = await r.findings.list({ projectId: props.projectId })
  if (showProject.value) projectNames.value = Object.fromEntries((await r.projects.list()).map((p) => [p.id, p.name]))
}

async function setStatus(f: Finding, status: FindingStatus) {
  await (await repos()).findings.setStatus(f.id, status)
  f.status = status
}

watch(() => props.refreshKey, load)
onMounted(load)
</script>

<style scoped>
.quote { white-space: pre-wrap; font-family: ui-monospace, monospace; font-size: 12px; background: rgba(127, 127, 127, 0.08); padding: 6px 8px; margin: 4px 0 0; border-radius: 4px; }
</style>
