<template>
  <q-banner v-if="matches.length" rounded class="bg-amber-1 text-amber-10">
    <template #avatar><q-icon name="history" /></template>
    Bu fikre benzeyen kayıtlar var:
    <div v-for="m in matches" :key="m.idea.id" class="q-mt-xs">
      <router-link :to="`/ideas/${m.idea.id}`" class="text-weight-medium">{{ m.idea.title }}</router-link>
      <q-badge class="q-ml-sm" :color="GRAVEYARD.includes(m.idea.status) ? 'grey-7' : 'primary'">{{ STATUS_LABEL[m.idea.status] }}</q-badge>
      <span v-if="m.idea.rejectReason" class="text-caption"> — {{ m.idea.rejectReason }}</span>
    </div>
  </q-banner>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { GRAVEYARD_STATUSES as GRAVEYARD, type Idea } from '@/db/repositories/ideas'
import { STATUS_LABEL } from '@/domain/ideas/labels'
import { findSimilarIdeas } from '@/domain/ideas/similar'

const props = defineProps<{ text: string; ideas: Idea[]; excludeId?: string }>()
const matches = computed(() => findSimilarIdeas(props.text, props.ideas, props.excludeId))
</script>
