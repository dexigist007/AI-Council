<template>
  <q-page padding>
    <div class="text-h5 q-mb-xs">{{ t('ideas.graveyard.title') }}</div>
    <div class="text-soft q-mb-lg">{{ t('ideas.graveyard.subtitle') }}</div>
    <div v-if="ideas.length === 0" class="text-soft">{{ t('ideas.graveyard.empty') }}</div>
    <div class="stack" style="max-width: 900px">
      <q-card v-for="i in ideas" :key="i.id" flat bordered>
        <q-card-section class="row items-center">
          <router-link :to="`/ideas/${i.id}`" class="text-subtitle1">{{ i.title }}</router-link>
          <q-badge class="q-ml-sm" :color="i.status === 'hold' ? 'warning' : 'negative'">{{ statusLabel(i.status) }}</q-badge>
          <q-space />
          <span class="text-caption text-soft">{{ fmtDay(i.updatedAt) }}</span>
        </q-card-section>
        <q-card-section class="q-pt-none">
          <div><b>{{ t('ideas.graveyard.why') }}</b> {{ i.rejectReason ?? t('common.none') }}</div>
          <div v-if="i.revisitCondition"><b>{{ t('ideas.revisitCondition') }}</b> {{ i.revisitCondition }}</div>
          <div v-if="i.decidedSessionId" class="q-mt-xs text-caption">
            <router-link :to="`/council/${i.decidedSessionId}`">{{ t('ideas.graveyard.councilReport') }}</router-link>
          </div>
        </q-card-section>
        <q-card-actions><q-btn flat dense icon="restore" :label="t('ideas.graveyard.reopen')" @click="reopen(i.id)" /></q-card-actions>
      </q-card>
    </div>
  </q-page>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { repos, type Idea } from '@/db'
import { statusLabel } from '@/domain/ideas/labels'
import { fmtDay, t } from '@/i18n'

const ideas = ref<Idea[]>([])
const load = async () => (ideas.value = await (await repos()).ideas.listGraveyard())

async function reopen(id: string) {
  await (await repos()).ideas.setDraft(id)
  await load()
}

onMounted(load)
</script>
