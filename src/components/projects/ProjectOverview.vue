<template>
  <div class="stack">
    <div v-if="!project.indexStats" class="text-soft">{{ t('projects.shared.notIndexed') }}</div>
    <template v-else>
      <div class="row q-col-gutter-md">
        <div v-for="s in summary" :key="s.label" class="col-6 col-md-3">
          <q-card flat bordered><q-card-section>
            <div class="text-caption text-soft">{{ s.label }}</div>
            <div class="text-h6">{{ s.value }}</div>
          </q-card-section></q-card>
        </div>
      </div>
      <q-banner v-if="project.indexStats.truncated" rounded class="tone-warn">
        {{ t('projects.overview.truncated') }}
      </q-banner>

      <q-card flat bordered>
        <q-card-section class="text-subtitle2">
          {{ t('projects.overview.stack') }} <q-badge outline color="primary" class="q-ml-sm">OBSERVED</q-badge>
          <div class="text-caption text-soft">{{ t('projects.overview.stackHint') }}</div>
        </q-card-section>
        <q-card-section class="q-pt-none">
          <div v-if="facts.length === 0" class="text-soft">{{ t('projects.overview.noManifest') }}</div>
          <div v-for="(items, cat) in grouped" :key="cat" class="q-mb-sm">
            <span class="text-caption text-soft q-mr-sm">{{ stackCategory(cat) }}</span>
            <q-chip v-for="f in items" :key="f.id" dense>
              {{ f.statement.split(': ')[1] }}
              <q-tooltip>{{ f.evidence.map((e) => e.file).join(', ') }}</q-tooltip>
            </q-chip>
          </div>
        </q-card-section>
      </q-card>

      <div class="row q-col-gutter-md">
        <div class="col-12 col-md-6">
          <q-card flat bordered class="full-height">
            <q-card-section class="text-subtitle2">{{ t('projects.overview.languages') }}</q-card-section>
            <q-list dense>
              <q-item v-for="[lang, n] in languages" :key="lang">
                <q-item-section>{{ lang }}</q-item-section>
                <q-item-section side>{{ fmtNum(n) }}</q-item-section>
              </q-item>
            </q-list>
          </q-card>
        </div>
        <div class="col-12 col-md-6">
          <q-card flat bordered class="full-height">
            <q-card-section class="text-subtitle2">{{ t('projects.overview.skipped') }}</q-card-section>
            <q-list dense>
              <q-item v-for="(n, reason) in project.indexStats.skipped" :key="reason">
                <q-item-section>{{ skipLabel(String(reason)) }}</q-item-section>
                <q-item-section side>{{ fmtNum(n) }}</q-item-section>
              </q-item>
              <q-item v-if="Object.keys(project.indexStats.skipped).length === 0"><q-item-section class="text-soft">{{ t('projects.overview.none') }}</q-item-section></q-item>
            </q-list>
          </q-card>
        </div>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type { BrainFact, Project } from '@/db'
import { fmtNum, t, type MessageKey } from '@/i18n'
import { skipLabel } from './labels'

const props = defineProps<{ project: Project; facts: BrainFact[] }>()

const STACK_CATEGORIES = ['language', 'framework', 'platform', 'database', 'service', 'tooling']
const stackCategory = (cat: string) => (STACK_CATEGORIES.includes(cat) ? t(`projects.overview.category.${cat}` as MessageKey) : cat)

const summary = computed(() => {
  const s = props.project.indexStats!
  return [
    { label: t('projects.overview.files'), value: fmtNum(s.files) },
    { label: t('projects.overview.indexed'), value: fmtNum(s.indexedFiles) },
    { label: t('projects.overview.chunks'), value: fmtNum(s.chunks) },
    { label: t('projects.overview.lastIndex'), value: t('projects.overview.seconds', { n: (s.durationMs / 1000).toFixed(1) }) },
  ]
})
const languages = computed(() => Object.entries(props.project.indexStats?.languages ?? {}).sort((a, b) => b[1] - a[1]).slice(0, 12))
const grouped = computed(() => {
  const out: Record<string, BrainFact[]> = {}
  for (const f of props.facts) (out[f.statement.split(':')[0]!] ??= []).push(f)
  return out
})
</script>
