<template>
  <q-page padding>
    <div class="text-h5 q-mb-sm">{{ title }}</div>
    <div class="text-soft">{{ description }}</div>
    <q-banner v-if="phase" rounded class="q-mt-lg tone-muted">
      {{ t('shell.placeholder.comingIn', { phase }) }}
    </q-banner>
    <slot />
  </q-page>
</template>

<script setup lang="ts">
import { t } from '@/i18n'
defineProps<{ title: string; description: string; phase?: string }>()
</script>
