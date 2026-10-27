<template>
  <q-page padding>
    <div class="text-h5 q-mb-md">{{ t('shell.nav.dashboard') }}</div>
    <q-card v-if="noModels" flat bordered class="q-mb-md welcome" style="max-width: 1100px">
      <q-card-section class="row items-center no-wrap q-gutter-md">
        <q-icon name="key" size="28px" color="primary" />
        <div class="col">
          <div class="text-subtitle1">{{ t('shell.dashboard.welcomeTitle') }}</div>
          <div class="text-soft q-mt-xs">{{ t('shell.dashboard.welcomeBody') }}</div>
        </div>
        <q-btn unelevated color="primary" no-caps :label="t('shell.dashboard.welcomeAction')" to="/settings" />
      </q-card-section>
    </q-card>
    <q-banner v-if="error" class="bg-negative text-white q-mb-md" rounded>{{ t('shell.dashboard.dbError', { error }) }}</q-banner>
    <div class="row q-col-gutter-md q-mb-md" style="max-width: 1100px">
      <div v-for="p in (['P0', 'P1', 'P2', 'P3'] as const)" :key="p" class="col-6 col-md-3">
        <q-card flat bordered class="cursor-pointer" @click="$router.push('/findings')">
          <q-card-section>
            <div class="text-caption text-soft">{{ t('shell.dashboard.openFindings', { p }) }}</div>
            <div class="text-h5" :class="p === 'P0' && open.P0 ? 'text-negative' : ''">{{ open[p] }}</div>
          </q-card-section>
        </q-card>
      </div>
    </div>
    <div class="row q-col-gutter-md" style="max-width: 1100px">
      <div class="col-12 col-md-6">
        <q-card flat bordered class="full-height">
          <q-card-section class="text-subtitle2">{{ t('shell.dashboard.waitingIdeas') }}</q-card-section>
          <q-list v-if="waiting.length" dense separator>
            <q-item v-for="i in waiting" :key="i.id" clickable :to="`/ideas/${i.id}`">
              <q-item-section>{{ i.title }}</q-item-section>
              <q-item-section side><q-badge :color="i.status === 'evaluating' ? 'orange' : 'grey-6'">{{ STATUS_LABEL[i.status] }}</q-badge></q-item-section>
            </q-item>
          </q-list>
          <q-card-section v-else class="text-soft q-pt-none">{{ t('shell.dashboard.noWaiting') }} <router-link to="/ideas">{{ t('shell.dashboard.writeIdea') }}</router-link></q-card-section>
        </q-card>
      </div>
      <div class="col-12 col-md-6">
        <q-card flat bordered class="full-height">
          <q-card-section class="text-subtitle2">{{ t('shell.dashboard.recentSessions') }}</q-card-section>
          <q-list v-if="sessions.length" dense separator>
            <q-item v-for="s in sessions" :key="s.id" clickable :to="`/council/${s.id}`">
              <q-item-section>
                <q-item-label>{{ titles[s.ideaId ?? ''] ?? sessionLabel(s) }}</q-item-label>
                <q-item-label caption>{{ sessionLabel(s) }} · {{ fmtDay(s.createdAt) }}</q-item-label>
              </q-item-section>
              <q-item-section side><q-badge :color="STATUS_COLOR[s.status]">{{ t(`common.status.${s.status}`) }}</q-badge></q-item-section>
            </q-item>
          </q-list>
          <q-card-section v-else class="text-soft q-pt-none">{{ t('shell.dashboard.noSessions') }}</q-card-section>
        </q-card>
      </div>
    </div>
    <q-card v-if="gitRows.length" flat bordered class="q-mt-md" style="max-width: 1100px">
      <q-card-section class="text-subtitle2">{{ t('shell.dashboard.gitStatus') }}</q-card-section>
      <q-list dense separator>
        <q-item v-for="g in gitRows" :key="g.id" clickable :to="`/projects/${g.id}`">
          <q-item-section>{{ g.name }}</q-item-section>
          <q-item-section side class="text-caption">{{ g.branch ?? t('shell.dashboard.detached') }} · {{ g.changed ? t('shell.dashboard.uncommitted', { n: g.changed }) : t('shell.dashboard.clean') }}</q-item-section>
        </q-item>
      </q-list>
    </q-card>
  </q-page>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { repos, type Idea, type Session } from '@/db'
import { STATUS_LABEL } from '@/domain/ideas/labels'
import { STATUS_COLOR, sessionLabel } from './sessionLabels'
import { parseStatus } from '@/domain/git/parse'
import { gitRun } from '@/platform/tauri'
import { fmtDay, t } from '@/i18n'
import { loadModelSlots } from '@/domain/providers/available'

const ideas = ref<Idea[]>([])
const sessions = ref<Session[]>([])
const error = ref<string | null>(null)
const open = ref({ P0: 0, P1: 0, P2: 0, P3: 0 })
const noModels = ref(false)
const gitRows = ref<{ id: string; name: string; branch: string | null; changed: number }[]>([])
const waiting = computed(() => ideas.value.filter((i) => i.status === 'evaluating' || i.status === 'draft').slice(0, 8))
const titles = computed(() => Object.fromEntries(ideas.value.map((i) => [i.id, i.title])))

onMounted(async () => {
  try {
    const r = await repos()
    noModels.value = (await loadModelSlots()).length === 0
    ideas.value = await r.ideas.list()
    sessions.value = await r.sessions.list({ limit: 8 })
    open.value = await r.findings.countOpenByPriority()
    // Local git status only; failures (no repo, folder not reachable) just hide the row.
    const projects = await r.projects.list()
    const rows = await Promise.all(projects.map(async (p) => {
      try {
        const s = parseStatus(await gitRun(p.rootPath, { op: 'status' }))
        return { id: p.id, name: p.name, branch: s.branch, changed: s.files.length }
      } catch {
        return null
      }
    }))
    gitRows.value = rows.filter((x) => x !== null)
  } catch (e) {
    error.value = String(e)
  }
})
</script>
