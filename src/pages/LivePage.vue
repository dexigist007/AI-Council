<template>
  <q-page padding>
    <div class="stack" style="max-width: 1400px">
      <div>
        <div class="text-h5">Canlı tartışma</div>
        <div class="text-soft">Çalışan council'da her üyenin ne yazdığı, kime itiraz ettiği ve Judge'ın kararı anlık olarak burada.</div>
      </div>
      <template v-if="run">
        <CouncilProgress :run="run" @cancel="store.cancel()" @dismiss="store.dismiss()" />
        <DebateFeedView :feed="run.feed" :judge-done="run.status === 'completed'" />
        <q-btn v-if="run.sessionId" unelevated no-caps color="primary" icon="article" label="Raporu ve oturumu aç" :to="`/council/${run.sessionId}`" class="self-start" />
      </template>
      <q-banner v-else rounded class="tone-muted">
        Şu an çalışan bir council yok. Keşif, Ideas veya bir projeden council başlattığında tartışma burada canlı akar.
        Geçmiş oturumların tartışmaları <router-link to="/council">Council</router-link> sayfasında.
      </q-banner>
    </div>
  </q-page>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import CouncilProgress from '@/components/council/CouncilProgress.vue'
import DebateFeedView from '@/components/council/DebateFeedView.vue'
import { useCouncilRun } from '@/stores/councilRun'

const store = useCouncilRun()
const run = computed(() => store.active)
</script>
