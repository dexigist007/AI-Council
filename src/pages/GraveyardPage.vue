<template>
  <q-page padding>
    <div class="text-h5 q-mb-xs">Idea Graveyard</div>
    <div class="text-grey-7 q-mb-lg">Reddedilen veya ertelenen fikirler silinmez; yeni bir fikir bunlara benzerse uyarı alırsın.</div>
    <div v-if="ideas.length === 0" class="text-grey-7">Graveyard boş.</div>
    <div class="stack" style="max-width: 900px">
      <q-card v-for="i in ideas" :key="i.id" flat bordered>
        <q-card-section class="row items-center">
          <router-link :to="`/ideas/${i.id}`" class="text-subtitle1">{{ i.title }}</router-link>
          <q-badge class="q-ml-sm" :color="i.status === 'hold' ? 'warning' : 'negative'">{{ STATUS_LABEL[i.status] }}</q-badge>
          <q-space />
          <span class="text-caption text-grey-7">{{ new Date(i.updatedAt).toLocaleDateString() }}</span>
        </q-card-section>
        <q-card-section class="q-pt-none">
          <div><b>Neden:</b> {{ i.rejectReason ?? '—' }}</div>
          <div v-if="i.revisitCondition"><b>Yeniden değerlendirme koşulu:</b> {{ i.revisitCondition }}</div>
          <div v-if="i.decidedSessionId" class="q-mt-xs text-caption">
            <router-link :to="`/council/${i.decidedSessionId}`">Council raporu (riskler dahil)</router-link>
          </div>
        </q-card-section>
        <q-card-actions><q-btn flat dense icon="restore" label="Yeniden aç" @click="reopen(i.id)" /></q-card-actions>
      </q-card>
    </div>
  </q-page>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { repos, type Idea } from '@/db'
import { STATUS_LABEL } from '@/domain/ideas/labels'

const ideas = ref<Idea[]>([])
const load = async () => (ideas.value = await (await repos()).ideas.listGraveyard())

async function reopen(id: string) {
  await (await repos()).ideas.setDraft(id)
  await load()
}

onMounted(load)
</script>
