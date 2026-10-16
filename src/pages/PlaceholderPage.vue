<template>
  <q-page padding>
    <div class="text-h5 q-mb-sm">{{ title }}</div>
    <div class="text-grey-7">{{ description }}</div>
    <q-banner v-if="phase" rounded class="q-mt-lg tone-muted">
      Bu ekran {{ phase }} kapsamında gelecek.
    </q-banner>
    <slot />
  </q-page>
</template>

<script setup lang="ts">
defineProps<{ title: string; description: string; phase?: string }>()
</script>
