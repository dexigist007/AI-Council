<template>
  <q-card flat bordered>
    <q-card-section class="row items-center q-gutter-sm">
      <q-spinner-dots v-if="run.status === 'running'" color="primary" size="24px" />
      <q-icon v-else :name="statusIcon" :color="statusColor" size="24px" />
      <div class="text-subtitle1">{{ statusLabel }}</div>
      <q-space />
      <div class="text-caption">Harcanan: <b>${{ run.spentUsd.toFixed(4) }}</b></div>
      <q-btn v-if="run.status === 'running'" outline color="negative" icon="stop" label="Durdur" @click="$emit('cancel')" />
      <q-btn v-else flat dense icon="close" @click="$emit('dismiss')" />
    </q-card-section>
    <q-card-section class="q-pt-none">
      <div class="row items-center q-gutter-sm q-mb-sm">
        <template v-for="(r, i) in rounds" :key="r.name">
          <q-icon v-if="i > 0" name="chevron_right" color="grey-6" />
          <q-chip dense :outline="!isActive(r.name)" :color="isDone(r.name) ? 'positive' : isActive(r.name) ? 'primary' : 'grey-5'"
            :text-color="isDone(r.name) || isActive(r.name) ? 'white' : 'grey-8'" :icon="isDone(r.name) ? 'check' : undefined">
            {{ r.title }}
          </q-chip>
        </template>
      </div>
      <div class="row q-gutter-sm">
        <q-chip v-for="(m, id) in run.members" :key="id" dense :color="memberColor(m.status)" text-color="white" :icon="memberIcon(m.status)">
          {{ id === 'judge' ? 'Judge' : id }}
          <q-tooltip v-if="m.error">{{ m.error }}</q-tooltip>
        </q-chip>
      </div>
      <div v-if="run.error" class="text-negative q-mt-sm">{{ run.error }}</div>
      <div v-if="run.unpriced.length" class="text-caption text-warn q-mt-sm">
        Fiyatsız modeller maliyete dahil değil: {{ run.unpriced.join(', ') }}
      </div>
    </q-card-section>
  </q-card>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type { Round } from '@/db'
import type { ActiveRun } from '@/stores/councilRun'

const props = defineProps<{ run: ActiveRun }>()
defineEmits<{ cancel: []; dismiss: [] }>()

const rounds: { name: Round; title: string }[] = [
  { name: 'independent', title: 'Bağımsız analiz' },
  { name: 'critique', title: 'Çapraz eleştiri' },
  { name: 'judge', title: 'Judge' },
]
const order = rounds.map((r) => r.name)
const isActive = (r: Round) => props.run.status === 'running' && props.run.round === r
const isDone = (r: Round) =>
  props.run.status === 'completed' || (props.run.round !== null && order.indexOf(r) < order.indexOf(props.run.round))

const statusLabel = computed(() => ({ running: 'Council çalışıyor', completed: 'Tamamlandı', failed: 'Başarısız', cancelled: 'Durduruldu' })[props.run.status])
const statusIcon = computed(() => ({ running: '', completed: 'check_circle', failed: 'error', cancelled: 'stop_circle' })[props.run.status])
const statusColor = computed(() => ({ running: '', completed: 'positive', failed: 'negative', cancelled: 'grey' })[props.run.status])
const memberColor = (s: string) => ({ waiting: 'grey-5', start: 'primary', done: 'positive', failed: 'negative' })[s] ?? 'grey'
const memberIcon = (s: string) => ({ waiting: 'schedule', start: 'autorenew', done: 'check', failed: 'error' })[s] ?? 'help'
</script>
