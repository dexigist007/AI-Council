<template>
  <div class="stack">
    <q-input v-model="query" dense outlined clearable debounce="250" :placeholder="t('projects.files.searchPlaceholder')">
      <template #prepend><q-icon name="search" /></template>
    </q-input>

    <q-card v-if="query" flat bordered>
      <q-card-section class="text-subtitle2">{{ t('projects.files.results', { n: hits.length }) }} <span class="text-caption text-soft">{{ t('projects.files.localOnly') }}</span></q-card-section>
      <q-list dense separator>
        <q-item v-for="h in hits" :key="h.chunkId">
          <q-item-section>
            <q-item-label class="text-weight-medium">{{ h.path }}:{{ h.startLine }}-{{ h.endLine }}
              <q-badge v-if="h.symbol" outline class="q-ml-sm">{{ h.symbol }}</q-badge></q-item-label>
            <q-item-label caption class="snippet" v-html="highlight(h.snippet)" />
          </q-item-section>
        </q-item>
      </q-list>
    </q-card>

    <q-table
      v-else flat bordered dense :rows="files" :columns="columns" row-key="id" :filter="filter" virtual-scroll
      style="max-height: 600px" :rows-per-page-options="[0]" :pagination="{ rowsPerPage: 0 }"
    >
      <template #top>
        <div class="text-subtitle2">{{ t('projects.files.count', { n: fmtNum(files.length) }) }}</div>
        <q-space />
        <q-input v-model="filter" dense borderless :placeholder="t('projects.files.filter')"><template #append><q-icon name="filter_list" /></template></q-input>
      </template>
      <template #body-cell-skipReason="p">
        <q-td :props="p"><q-badge v-if="p.value" color="grey-6">{{ skipLabel(p.value) }}</q-badge></q-td>
      </template>
    </q-table>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import type { QTableColumn } from 'quasar'
import { repos, type IndexedFile, type SearchHit } from '@/db'
import { fmtNum, t } from '@/i18n'
import { skipLabel } from './labels'

const props = defineProps<{ projectId: string; refreshKey: number }>()
const files = ref<IndexedFile[]>([])
const query = ref('')
const filter = ref('')
const hits = ref<SearchHit[]>([])

const columns = computed<QTableColumn<IndexedFile>[]>(() => [
  { name: 'path', label: t('projects.files.col.path'), field: 'path', align: 'left', sortable: true },
  { name: 'lang', label: t('projects.files.col.lang'), field: 'lang', align: 'left', sortable: true },
  { name: 'kind', label: t('projects.files.col.kind'), field: 'kind', align: 'left', sortable: true },
  { name: 'size', label: t('projects.files.col.size'), field: 'size', sortable: true, format: (v: number) => `${(v / 1024).toFixed(1)} KB` },
  { name: 'skipReason', label: t('projects.files.col.status'), field: 'skipReason', align: 'left' },
])

/** Escapes the snippet, then turns FTS markers into highlights (code must never be rendered as HTML). */
function highlight(s: string): string {
  const esc = s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  return esc.replace(/«/g, '<mark>').replace(/»/g, '</mark>')
}

async function load() {
  files.value = await (await repos()).projectIndex.listFiles(props.projectId)
}

watch(query, async (q) => {
  hits.value = q ? await (await repos()).projectIndex.search(props.projectId, q, 30) : []
})
watch(() => props.refreshKey, load)
onMounted(load)
</script>

<style scoped>
.snippet {
  font-family: ui-monospace, monospace;
  white-space: pre-wrap;
}
</style>
