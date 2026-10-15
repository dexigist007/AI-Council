<template>
  <q-page padding>
    <div class="text-h5 q-mb-md">Dashboard</div>
    <q-banner v-if="error" class="bg-negative text-white q-mb-md" rounded>Veritabanı hatası: {{ error }}</q-banner>
    <div class="row q-col-gutter-md" style="max-width: 1100px">
      <div class="col-12 col-md-6">
        <q-card flat bordered class="full-height">
          <q-card-section class="text-subtitle2">Karar bekleyen fikirler</q-card-section>
          <q-list v-if="waiting.length" dense separator>
            <q-item v-for="i in waiting" :key="i.id" clickable :to="`/ideas/${i.id}`">
              <q-item-section>{{ i.title }}</q-item-section>
              <q-item-section side><q-badge :color="i.status === 'evaluating' ? 'orange' : 'grey-6'">{{ STATUS_LABEL[i.status] }}</q-badge></q-item-section>
            </q-item>
          </q-list>
          <q-card-section v-else class="text-grey-7 q-pt-none">Yok. <router-link to="/ideas">Yeni bir fikir yaz.</router-link></q-card-section>
        </q-card>
      </div>
      <div class="col-12 col-md-6">
        <q-card flat bordered class="full-height">
          <q-card-section class="text-subtitle2">Son Council oturumları</q-card-section>
          <q-list v-if="sessions.length" dense separator>
            <q-item v-for="s in sessions" :key="s.id" clickable :to="`/council/${s.id}`">
              <q-item-section>
                <q-item-label>{{ titles[s.ideaId ?? ''] ?? sessionLabel(s) }}</q-item-label>
                <q-item-label caption>{{ sessionLabel(s) }} · {{ new Date(s.createdAt).toLocaleDateString() }}</q-item-label>
              </q-item-section>
              <q-item-section side><q-badge :color="STATUS_COLOR[s.status]">{{ s.status }}</q-badge></q-item-section>
            </q-item>
          </q-list>
          <q-card-section v-else class="text-grey-7 q-pt-none">Henüz oturum yok.</q-card-section>
        </q-card>
      </div>
    </div>
    <div class="text-caption text-grey-6 q-mt-lg">Projeler, bulgular ve Git değişiklikleri ilgili fazlarda buraya eklenecek.</div>
  </q-page>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { repos, type Idea, type Session } from '@/db'
import { STATUS_LABEL } from '@/domain/ideas/labels'
import { STATUS_COLOR, sessionLabel } from './sessionLabels'

const ideas = ref<Idea[]>([])
const sessions = ref<Session[]>([])
const error = ref<string | null>(null)
const waiting = computed(() => ideas.value.filter((i) => i.status === 'evaluating' || i.status === 'draft').slice(0, 8))
const titles = computed(() => Object.fromEntries(ideas.value.map((i) => [i.id, i.title])))

onMounted(async () => {
  try {
    const r = await repos()
    ideas.value = await r.ideas.list()
    sessions.value = await r.sessions.list({ limit: 8 })
  } catch (e) {
    error.value = String(e)
  }
})
</script>
