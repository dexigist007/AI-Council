<template>
  <q-page padding>
    <div class="text-h5 q-mb-xs">{{ t('ideas.decisions.title') }}</div>
    <div class="text-grey-7 q-mb-lg">{{ t('ideas.decisions.subtitle') }}</div>
    <div v-if="rows.length === 0" class="text-grey-7">{{ t('ideas.decisions.empty') }}</div>
    <q-list v-else bordered separator style="max-width: 900px">
      <q-item v-for="d in rows" :key="d.id">
        <q-item-section>
          <q-item-label class="text-weight-medium">{{ d.title }}</q-item-label>
          <q-item-label caption style="white-space: pre-wrap">{{ d.reason }}</q-item-label>
        </q-item-section>
        <q-item-section side top>
          <q-item-label caption>{{ fmtDay(d.decidedAt) }}</q-item-label>
          <router-link v-if="d.sessionId" :to="`/council/${d.sessionId}`" class="text-caption">{{ t('ideas.decisions.session') }}</router-link>
        </q-item-section>
      </q-item>
    </q-list>
  </q-page>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { repos, type Decision } from '@/db'
import { fmtDay, t } from '@/i18n'

const rows = ref<Decision[]>([])
onMounted(async () => (rows.value = await (await repos()).decisions.listApproved()))
</script>
