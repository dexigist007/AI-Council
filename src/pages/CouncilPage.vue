<template>
  <q-page padding>
    <div class="text-h5 q-mb-md">Council oturumları</div>
    <div v-if="rows.length === 0" class="text-grey-7">Henüz oturum yok. Ideas'ten bir fikir için Council başlat.</div>
    <q-list v-else bordered separator style="max-width: 1000px">
      <q-item v-for="s in rows" :key="s.id" clickable :to="`/council/${s.id}`">
        <q-item-section>
          <q-item-label>{{ titles[s.ideaId ?? ''] ?? '—' }}</q-item-label>
          <q-item-label caption>{{ sessionLabel(s) }} · {{ s.mode.toUpperCase() }} · {{ new Date(s.createdAt).toLocaleString() }}</q-item-label>
        </q-item-section>
        <q-item-section side>
          <q-badge :color="STATUS_COLOR[s.status]">{{ s.status }}</q-badge>
          <q-item-label caption class="q-mt-xs">${{ s.actualCost.toFixed(4) }}</q-item-label>
        </q-item-section>
      </q-item>
    </q-list>
  </q-page>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { repos, type Session } from '@/db'
import { STATUS_COLOR, sessionLabel } from './sessionLabels'

const rows = ref<Session[]>([])
const titles = ref<Record<string, string>>({})

onMounted(async () => {
  const r = await repos()
  rows.value = await r.sessions.list()
  titles.value = Object.fromEntries((await r.ideas.list()).map((i) => [i.id, i.title]))
})
</script>
