<template>
  <q-page padding>
    <div class="stack" style="max-width: 1400px">
      <div>
        <div class="text-h5">{{ t('council.live.title') }}</div>
        <div class="text-soft">{{ t('council.live.subtitle') }}</div>
      </div>
      <template v-if="run">
        <CouncilProgress :run="run" @cancel="store.cancel()" @dismiss="store.dismiss()" />
        <DebateFeedView :feed="run.feed" :judge-done="run.status === 'completed'" />
        <q-btn v-if="run.sessionId" unelevated no-caps color="primary" icon="article" :label="t('council.live.openReport')" :to="`/council/${run.sessionId}`" class="self-start" />
      </template>
      <q-banner v-else rounded class="tone-muted">
        {{ t('council.live.idle') }}
        {{ t('council.live.pastBefore') }} <router-link to="/council">{{ t('council.live.councilLink') }}</router-link> {{ t('council.live.pastAfter') }}
      </q-banner>
    </div>
  </q-page>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import CouncilProgress from '@/components/council/CouncilProgress.vue'
import DebateFeedView from '@/components/council/DebateFeedView.vue'
import { useCouncilRun } from '@/stores/councilRun'
import { t } from '@/i18n'

const store = useCouncilRun()
const run = computed(() => store.active)
</script>
