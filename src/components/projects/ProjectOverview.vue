<template>
  <div class="stack">
    <div v-if="!project.indexStats" class="text-grey-7">Proje henüz indekslenmedi.</div>
    <template v-else>
      <div class="row q-col-gutter-md">
        <div v-for="s in summary" :key="s.label" class="col-6 col-md-3">
          <q-card flat bordered><q-card-section>
            <div class="text-caption text-grey-7">{{ s.label }}</div>
            <div class="text-h6">{{ s.value }}</div>
          </q-card-section></q-card>
        </div>
      </div>
      <q-banner v-if="project.indexStats.truncated" rounded class="bg-orange-1 text-orange-10">
        Dosya sınırına (20.000) ulaşıldı; indeks eksik. Settings sekmesinden gereksiz klasörleri hariç tut.
      </q-banner>

      <q-card flat bordered>
        <q-card-section class="text-subtitle2">
          Teknoloji yığını <q-badge outline color="primary" class="q-ml-sm">OBSERVED</q-badge>
          <div class="text-caption text-grey-7">Manifest dosyalarından okundu; her biri kaynak dosyasını gösterir.</div>
        </q-card-section>
        <q-card-section class="q-pt-none">
          <div v-if="facts.length === 0" class="text-grey-7">Tanınan bir manifest bulunamadı.</div>
          <div v-for="(items, cat) in grouped" :key="cat" class="q-mb-sm">
            <span class="text-caption text-grey-7 q-mr-sm">{{ CATEGORY_LABEL[cat] ?? cat }}</span>
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
            <q-card-section class="text-subtitle2">Diller (dosya sayısı)</q-card-section>
            <q-list dense>
              <q-item v-for="[lang, n] in languages" :key="lang">
                <q-item-section>{{ lang }}</q-item-section>
                <q-item-section side>{{ n }}</q-item-section>
              </q-item>
            </q-list>
          </q-card>
        </div>
        <div class="col-12 col-md-6">
          <q-card flat bordered class="full-height">
            <q-card-section class="text-subtitle2">İçeriği okunmayan dosyalar</q-card-section>
            <q-list dense>
              <q-item v-for="(n, reason) in project.indexStats.skipped" :key="reason">
                <q-item-section>{{ SKIP_LABEL[reason] ?? reason }}</q-item-section>
                <q-item-section side>{{ n }}</q-item-section>
              </q-item>
              <q-item v-if="Object.keys(project.indexStats.skipped).length === 0"><q-item-section class="text-grey-7">Yok</q-item-section></q-item>
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
import { SKIP_LABEL } from './labels'

const props = defineProps<{ project: Project; facts: BrainFact[] }>()

const CATEGORY_LABEL: Record<string, string> = {
  language: 'Dil', framework: 'Framework', platform: 'Platform', database: 'Veritabanı', service: 'Servis', tooling: 'Araç',
}

const summary = computed(() => {
  const s = props.project.indexStats!
  return [
    { label: 'Dosya', value: s.files },
    { label: 'İndekslenen', value: s.indexedFiles },
    { label: 'Kod parçası', value: s.chunks },
    { label: 'Son indeksleme', value: `${(s.durationMs / 1000).toFixed(1)} sn` },
  ]
})
const languages = computed(() => Object.entries(props.project.indexStats?.languages ?? {}).sort((a, b) => b[1] - a[1]).slice(0, 12))
const grouped = computed(() => {
  const out: Record<string, BrainFact[]> = {}
  for (const f of props.facts) (out[f.statement.split(':')[0]!] ??= []).push(f)
  return out
})
</script>
