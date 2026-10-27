<template>
  <q-page padding>
    <div class="text-h5 q-mb-xs">{{ t('projects.findings.pageTitle') }}</div>
    <div class="text-soft q-mb-md">{{ t('projects.findings.pageIntro') }}</div>
    <div style="max-width: 1200px"><FindingsList /></div>
  </q-page>
</template>

<script setup lang="ts">
import FindingsList from '@/components/findings/FindingsList.vue'
import { t } from '@/i18n'
</script>
