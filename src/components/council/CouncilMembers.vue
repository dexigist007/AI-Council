<template>
  <div class="stack">
    <q-banner v-if="slots.length === 0" rounded class="bg-orange-1 text-orange-10">Etkin ve modeli seçilmiş bir sağlayıcı yok (Settings).</q-banner>
    <template v-else>
      <div class="row q-col-gutter-sm items-center">
        <q-btn-toggle v-model="mode" class="col-auto" no-caps unelevated toggle-color="secondary"
          :options="[{ label: 'FAST', value: 'fast' }, { label: 'BALANCED', value: 'balanced' }]" />
        <q-input v-model.number="budget" class="col-3" dense outlined type="number" step="0.5" label="Bütçe (USD)" />
      </div>
      <div v-for="(m, i) in members" :key="i" class="row q-col-gutter-sm items-center">
        <q-select v-model="m.slot" class="col-6" dense outlined :options="slotOptions" emit-value map-options label="Model" />
        <q-select v-model="m.roleId" class="col" dense outlined :options="roleOptions" emit-value map-options label="Rol" />
      </div>
      <q-select v-model="judgeSlot" dense outlined :options="slotOptions" emit-value map-options label="Judge" style="max-width: 50%" />
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import type { CouncilConfig, CouncilMode, Participant } from '@/domain/council/engine'
import { roleBrief, roleIds } from '@/domain/prompts/registry'
import { loadModelSlots, type ModelSlot } from '@/domain/providers/available'

/** Shared member/judge/budget picker for project councils (audit, change review). */
const props = defineProps<{ roles: string[]; size?: number }>()
const config = defineModel<CouncilConfig | null>({ required: true })

const slots = ref<ModelSlot[]>([])
const members = ref<{ slot: string; roleId: string }[]>([])
const judgeSlot = ref('')
const mode = ref<CouncilMode>('fast')
const budget = ref(1)
const slotOptions = computed(() => slots.value.map((s) => ({ label: s.label, value: s.key })))
const roleOptions = roleIds().map((id) => ({ label: roleBrief(id).label, value: id }))

const toParticipant = (slotKey: string, id: string, roleId: string): Participant => {
  const s = slots.value.find((x) => x.key === slotKey)!
  return { id, provider: s.provider, model: s.model, roleId, maxTokens: s.maxTokens ?? undefined, temperature: s.temperature ?? undefined }
}

watch(() => props.roles, (roles) => members.value.forEach((m, i) => (m.roleId = roles[i % roles.length]!)), { immediate: false })
watch([members, judgeSlot, mode, budget], () => {
  config.value = members.value.length >= 2 && judgeSlot.value
    ? {
        mode: mode.value,
        participants: members.value.map((m, i) => toParticipant(m.slot, `p${i + 1}`, m.roleId)),
        judge: toParticipant(judgeSlot.value, 'judge', 'judge'),
        budgetUsd: budget.value > 0 ? budget.value : undefined,
      }
    : null
}, { deep: true })

onMounted(async () => {
  slots.value = await loadModelSlots()
  if (slots.value.length) {
    const n = Math.min(Math.max(slots.value.length, 2), props.size ?? 3)
    members.value = Array.from({ length: n }, (_, i) => ({ slot: slots.value[i % slots.value.length]!.key, roleId: props.roles[i % props.roles.length]! }))
    judgeSlot.value = slots.value[slots.value.length - 1]!.key
  }
})
</script>
