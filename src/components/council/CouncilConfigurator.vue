<template>
  <q-card flat bordered>
    <q-card-section class="row items-center q-gutter-md">
      <div class="text-subtitle1">{{ title ?? t('council.configurator.title') }}</div>
      <q-space />
      <slot name="actions" />
      <q-btn-toggle
        v-model="mode" no-caps unelevated toggle-color="secondary"
        :options="[{ label: t('council.mode.fast'), value: 'fast' }, { label: t('council.mode.balanced'), value: 'balanced' }]"
      />
    </q-card-section>

    <q-card-section v-if="loading" class="text-soft">{{ t('council.configurator.loadingProviders') }}</q-card-section>
    <q-card-section v-else-if="available.length === 0">
      <q-banner rounded class="tone-warn">
        {{ t('council.configurator.noProvider') }}
      </q-banner>
    </q-card-section>
    <template v-else>
      <q-card-section class="q-pt-none">
        <div class="text-caption text-soft q-mb-sm">
          {{ mode === 'fast' ? t('council.configurator.fastFlow') : t('council.configurator.balancedFlow') }}
          {{ t('council.configurator.diversityHint') }}
        </div>
        <div v-for="(p, i) in participants" :key="i" class="row q-col-gutter-sm items-center q-mb-xs">
          <q-select v-model="p.slot" class="col-6" dense outlined :options="slotOptions" emit-value map-options :label="t('council.configurator.model')" />
          <q-select v-model="p.roleId" class="col" dense outlined :options="roleOptions" emit-value map-options :label="t('council.configurator.role')" />
          <div class="col-auto">
            <q-btn flat round dense icon="close" :disable="participants.length <= 2" @click="participants.splice(i, 1)" />
          </div>
        </div>
        <q-btn flat dense no-caps icon="add" :label="t('council.configurator.addMember')" :disable="participants.length >= 6" @click="addParticipant" />
      </q-card-section>

      <q-card-section class="q-pt-none row q-col-gutter-sm items-start">
        <q-select
          v-model="judgeSlot" class="col-6" dense outlined :options="slotOptions" emit-value map-options :label="t('council.configurator.judge')"
          :hint="judgeIsMember ? t('council.configurator.judgeIsMember') : t('council.configurator.judgeOutside')"
        />
        <q-input v-model.number="budget" class="col-3" dense outlined type="number" step="0.5" min="0" :label="t('council.configurator.budget')" />
        <div class="col-3 text-caption q-pt-sm">
          <div>{{ t('council.configurator.estimate') }} <b>{{ estimateLabel }}</b></div>
          <div class="text-soft">{{ t('council.configurator.calls', { calls: estimate.calls, tokens: Math.round(estimate.tokens / 1000) }) }}</div>
        </div>
      </q-card-section>
      <q-card-section v-if="estimate.unpriced.length" class="q-pt-none text-caption text-warn">
        {{ t('council.configurator.unpricedModels', { models: estimate.unpriced.join(', ') }) }}
      </q-card-section>

      <q-card-actions class="q-px-md q-pb-md">
        <q-btn unelevated :color="startColor" :icon="startIcon" :label="startLabel ?? t('council.configurator.start')" :disable="disabled" @click="start" />
        <span v-if="disabledReason" class="q-ml-md text-caption text-soft">{{ disabledReason }}</span>
      </q-card-actions>
    </template>
  </q-card>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { t } from '@/i18n'
import { repos } from '@/db'
import { priceLookup, type PriceLookup } from '@/domain/cost/pricing'
import { estimateCouncil, type CouncilConfig, type CouncilMode, type CouncilTask, type Participant } from '@/domain/council/engine'
import { roleBrief, roleIds } from '@/domain/prompts/registry'
import { loadModelSlots, type ModelSlot } from '@/domain/providers/available'

const props = withDefaults(
  defineProps<{
    title?: string
    /** Used for the cost estimate; null while the task is incomplete (e.g. empty question). */
    task: CouncilTask<unknown> | null
    roles: string[]
    busy?: boolean
    /** Extra reason to block starting (e.g. form not filled); shown next to the button. */
    blockReason?: string
    startLabel?: string
    startIcon?: string
    startColor?: string
  }>(),
  { title: undefined, startLabel: undefined, startIcon: 'play_arrow', startColor: 'primary', blockReason: '' },
)
const emit = defineEmits<{ start: [config: CouncilConfig] }>()

const loading = ref(true)
const available = ref<ModelSlot[]>([])
const price = ref<PriceLookup>(() => undefined)
const mode = ref<CouncilMode>('balanced')
const participants = ref<{ slot: string; roleId: string }[]>([])
const judgeSlot = ref('')
const budget = ref(1)

const slotOptions = computed(() => available.value.map((s) => ({ label: s.label, value: s.key })))
const roleOptions = roleIds().map((id) => ({ label: roleBrief(id).label, value: id }))

function assignRoles() {
  participants.value.forEach((p, i) => (p.roleId = props.roles[i % props.roles.length]!))
}
watch(() => props.roles, assignRoles)

function addParticipant() {
  const used = new Set(participants.value.map((p) => p.slot))
  const slot = available.value.find((s) => !used.has(s.key)) ?? available.value[participants.value.length % available.value.length]!
  participants.value.push({ slot: slot.key, roleId: '' })
  assignRoles()
}

const toParticipant = (slotKey: string, id: string, roleId: string): Participant => {
  const s = available.value.find((x) => x.key === slotKey)!
  return { id, provider: s.provider, model: s.model, roleId, maxTokens: s.maxTokens ?? undefined, temperature: s.temperature ?? undefined }
}

const config = computed<CouncilConfig | null>(() => {
  if (!judgeSlot.value || participants.value.length < 2) return null
  return {
    mode: mode.value,
    participants: participants.value.map((p, i) => toParticipant(p.slot, `p${i + 1}`, p.roleId)),
    judge: toParticipant(judgeSlot.value, 'judge', 'judge'),
    budgetUsd: budget.value > 0 ? budget.value : undefined,
  }
})

const judgeIsMember = computed(() => participants.value.some((p) => p.slot === judgeSlot.value))
const estimate = computed(() =>
  config.value && props.task
    ? estimateCouncil(props.task, config.value, price.value)
    : { usd: null, tokens: 0, calls: 0, unpriced: [] as string[] },
)
const estimateLabel = computed(() => (estimate.value.usd === null ? t('common.unpriced') : `~$${estimate.value.usd.toFixed(3)}`))

const disabledReason = computed(() => {
  if (props.busy) return t('council.configurator.busy')
  if (props.blockReason) return props.blockReason
  if (!config.value) return t('council.configurator.needMembers')
  if (estimate.value.usd !== null && config.value.budgetUsd !== undefined && estimate.value.usd > config.value.budgetUsd)
    return t('council.configurator.overBudget')
  return ''
})
const disabled = computed(() => disabledReason.value !== '')

function start() {
  if (config.value) emit('start', config.value)
}

onMounted(async () => {
  const [slots, prices] = await Promise.all([loadModelSlots(), (await repos()).modelPrices.list()])
  price.value = priceLookup(prices)
  available.value = slots
  if (available.value.length) {
    const n = Math.min(Math.max(available.value.length, 2), 4)
    participants.value = Array.from({ length: n }, (_, i) => ({ slot: available.value[i % available.value.length]!.key, roleId: '' }))
    assignRoles()
    judgeSlot.value = available.value[available.value.length - 1]!.key
  }
  loading.value = false
})
</script>
