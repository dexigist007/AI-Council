<template>
  <q-page padding>
    <div class="text-h5 q-mb-xs">Findings</div>
    <div class="text-grey-7 q-mb-md">
      Tüm projelerin bulguları. Öncelik (P0–P3) modelden değil, kurallardan hesaplanır; kanıtı kodda bulunamayan bulgular en fazla P2 olur.
    </div>
    <div style="max-width: 1200px"><FindingsList /></div>
  </q-page>
</template>

<script setup lang="ts">
import FindingsList from '@/components/findings/FindingsList.vue'
</script>
