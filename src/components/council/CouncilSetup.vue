<template>
  <q-card flat bordered>
    <q-card-section class="row items-center q-gutter-md">
      <div class="text-subtitle1">Council'ı topla</div>
      <q-space />
      <q-btn-toggle
        v-model="ideaMode" no-caps unelevated toggle-color="primary"
        :options="[{ label: 'Değerlendir', value: 'evaluate' }, { label: 'KILL THIS IDEA', value: 'kill', icon: 'local_fire_department' }]"
        @update:model-value="assignRoles"
      />
      <q-btn-toggle
        v-model="mode" no-caps unelevated toggle-color="secondary"
        :options="[{ label: 'FAST', value: 'fast' }, { label: 'BALANCED', value: 'balanced' }]"
      />
    </q-card-section>

    <q-card-section v-if="loading" class="text-grey-7">Sağlayıcılar yükleniyor…</q-card-section>
    <q-card-section v-else-if="available.length === 0">
      <q-banner rounded class="tone-warn">
        Etkin ve modeli seçilmiş bir sağlayıcı yok. Settings'te en az bir sağlayıcıya anahtar ekleyip etkinleştir
        ve varsayılan modelini seç.
      </q-banner>
    </q-card-section>
    <template v-else>
      <q-card-section class="q-pt-none">
        <div class="text-caption text-grey-7 q-mb-sm">
          {{ mode === 'fast' ? 'FAST: bağımsız analiz → Judge.' : 'BALANCED: bağımsız analiz → çapraz eleştiri → Judge.' }}
          Farklı sağlayıcılar daha gerçek görüş ayrılığı üretir; aynı sağlayıcıyı farklı rollerle de kullanabilirsin.
        </div>
        <div v-for="(p, i) in participants" :key="i" class="row q-col-gutter-sm items-center q-mb-xs">
          <q-select v-model="p.slot" class="col-6" dense outlined :options="slotOptions" emit-value map-options label="Model" />
          <q-select v-model="p.roleId" class="col" dense outlined :options="roleOptions" emit-value map-options label="Rol" />
          <div class="col-auto">
            <q-btn flat round dense icon="close" :disable="participants.length <= 2" @click="participants.splice(i, 1)" />
          </div>
        </div>
        <q-btn flat dense no-caps icon="add" label="Üye ekle" :disable="participants.length >= 6" @click="addParticipant" />
      </q-card-section>

      <q-card-section class="q-pt-none row q-col-gutter-sm items-start">
        <q-select
          v-model="judgeSlot" class="col-6" dense outlined :options="slotOptions" emit-value map-options label="Judge"
          :hint="judgeIsMember ? 'Judge aynı zamanda üye; kendi görüşünü kayırabilir.' : 'Konsey dışı Judge (önerilen).'"
        />
        <q-input v-model.number="budget" class="col-3" dense outlined type="number" step="0.5" min="0" label="Bütçe (USD)" />
        <div class="col-3 text-caption q-pt-sm">
          <div>Tahmini: <b>{{ estimateLabel }}</b></div>
          <div class="text-grey-7">{{ estimate.calls }} çağrı · ~{{ Math.round(estimate.tokens / 1000) }}k token</div>
        </div>
      </q-card-section>
      <q-card-section v-if="estimate.unpriced.length" class="q-pt-none text-caption text-warn">
        Fiyatı girilmemiş modeller: {{ estimate.unpriced.join(', ') }} (Settings → Model fiyatları).
      </q-card-section>

      <q-card-actions class="q-px-md q-pb-md">
        <q-btn
          unelevated :color="ideaMode === 'kill' ? 'negative' : 'primary'"
          :icon="ideaMode === 'kill' ? 'local_fire_department' : 'play_arrow'"
          :label="ideaMode === 'kill' ? 'Fikri öldürmeye çalış' : 'Council başlat'" :disable="disabled" @click="start"
        />
        <span v-if="disabledReason" class="q-ml-md text-caption text-grey-7">{{ disabledReason }}</span>
      </q-card-actions>
    </template>
  </q-card>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { repos, type Idea } from '@/db'
import { priceLookup, type PriceLookup } from '@/domain/cost/pricing'
import { estimateCouncil, type CouncilConfig, type CouncilMode, type Participant } from '@/domain/council/engine'
import { buildIdeaTask, ROLE_PRESETS, type IdeaMode } from '@/domain/ideas/task'
import { roleBrief, roleIds } from '@/domain/prompts/registry'
import { loadModelSlots, type ModelSlot } from '@/domain/providers/available'

const props = defineProps<{ idea: Idea; busy?: boolean }>()
const emit = defineEmits<{ start: [mode: IdeaMode, config: CouncilConfig] }>()

const loading = ref(true)
const available = ref<ModelSlot[]>([])
const price = ref<PriceLookup>(() => undefined)
const ideaMode = ref<IdeaMode>('evaluate')
const mode = ref<CouncilMode>('balanced')
const participants = ref<{ slot: string; roleId: string }[]>([])
const judgeSlot = ref('')
const budget = ref(1)

const slotOptions = computed(() => available.value.map((s) => ({ label: s.label, value: s.key })))
const roleOptions = roleIds().map((id) => ({ label: roleBrief(id).label, value: id }))

function assignRoles() {
  const preset = ROLE_PRESETS[ideaMode.value]
  participants.value.forEach((p, i) => (p.roleId = preset[i % preset.length]!))
}

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
  config.value
    ? estimateCouncil(buildIdeaTask(props.idea, ideaMode.value), config.value, price.value)
    : { usd: null, tokens: 0, calls: 0, unpriced: [] as string[] },
)
const estimateLabel = computed(() => (estimate.value.usd === null ? 'fiyatsız' : `~$${estimate.value.usd.toFixed(3)}`))

const disabledReason = computed(() => {
  if (props.busy) return 'Başka bir oturum çalışıyor.'
  if (!config.value) return 'En az 2 üye ve bir Judge gerekli.'
  if (estimate.value.usd !== null && config.value.budgetUsd !== undefined && estimate.value.usd > config.value.budgetUsd)
    return 'Tahmini maliyet bütçeyi aşıyor.'
  return ''
})
const disabled = computed(() => disabledReason.value !== '')

function start() {
  if (config.value) emit('start', ideaMode.value, config.value)
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
