<template>
  <div class="stack">
    <q-card flat bordered>
      <q-card-section class="row items-center">
        <div class="col">
          <div class="text-subtitle2">Yerel tarama</div>
          <div class="text-caption text-grey-7">AI kullanmaz, ücretsizdir: TODO/FIXME, kodda gömülü olası gizli bilgiler, çok büyük dosyalar, test eksikliği.</div>
        </div>
        <q-btn outline color="primary" icon="manage_search" label="Yerel taramayı çalıştır" :loading="scanning" :disable="!project.indexedAt" @click="localScan" />
      </q-card-section>
      <q-card-section v-if="localResult" class="q-pt-none text-caption">{{ localResult }}</q-card-section>
    </q-card>

    <q-card v-show="runHere?.status !== 'running'" flat bordered>
      <q-card-section class="text-subtitle2">AI Council denetimi</q-card-section>
      <q-card-section class="q-pt-none stack">
        <div>
          <div class="text-caption text-grey-7 q-mb-xs">Odak alanları (her biri için yerel aramayla kod seçilir)</div>
          <q-option-group v-model="focus" :options="AUDIT_FOCUS.map((f) => ({ label: f.label, value: f.id }))" type="checkbox" inline @update:model-value="prepare" />
        </div>
        <q-banner v-if="slots.length === 0" rounded class="bg-orange-1 text-orange-10">Etkin ve modeli seçilmiş bir sağlayıcı yok (Settings).</q-banner>
        <template v-else>
          <div class="row q-col-gutter-sm">
            <q-btn-toggle v-model="mode" class="col-auto" no-caps unelevated toggle-color="secondary"
              :options="[{ label: 'FAST', value: 'fast' }, { label: 'BALANCED', value: 'balanced' }]" />
            <q-input v-model.number="budget" class="col-3" dense outlined type="number" step="0.5" label="Bütçe (USD)" />
          </div>
          <div v-for="(p, i) in members" :key="i" class="row q-col-gutter-sm items-center">
            <q-select v-model="p.slot" class="col-6" dense outlined :options="slotOptions" emit-value map-options label="Model" />
            <q-select v-model="p.roleId" class="col" dense outlined :options="roleOptions" emit-value map-options label="Rol" />
          </div>
          <q-select v-model="judgeSlot" dense outlined :options="slotOptions" emit-value map-options label="Judge" style="max-width: 50%" />
        </template>
        <div v-if="context">
          <div class="text-caption">
            Gönderilecek: {{ chunks.length }} kod parçası, {{ context.files.length }} dosya · ~{{ (context.tokens / 1000).toFixed(1) }}k token (her üyeye) ·
            tahmini toplam <b>{{ estimateLabel }}</b> ·
            <span :class="context.redactions ? 'text-orange-9' : ''">{{ context.redactions }} maskeleme</span>
          </div>
          <q-expansion-item dense dense-toggle label="Gönderilecek dosyalar" class="text-caption">
            <div class="q-pl-md"><code v-for="f in context.files" :key="f" class="q-mr-sm">{{ f }}</code></div>
          </q-expansion-item>
        </div>
      </q-card-section>
      <q-card-actions class="q-px-md q-pb-md">
        <q-btn unelevated color="primary" icon="fact_check" label="Denetimi başlat" :disable="!!disabledReason" @click="start" />
        <span v-if="disabledReason" class="text-caption text-grey-7 q-ml-md">{{ disabledReason }}</span>
      </q-card-actions>
    </q-card>

    <CouncilProgress v-if="runHere" :run="runHere" @cancel="store.cancel()" @dismiss="store.dismiss()" />
    <q-card v-if="runHere?.auditSaved" flat bordered>
      <q-card-section>
        <div class="text-subtitle2">Denetim tamamlandı</div>
        <div>{{ runHere.auditSaved.added }} yeni bulgu, {{ runHere.auditSaved.updated }} mevcut bulgu güncellendi.
          <span v-if="runHere.auditSaved.unverified" class="text-negative">{{ runHere.auditSaved.unverified }} bulgunun kanıtı kodda bulunamadı (UNVERIFIED, en fazla P2).</span></div>
        <div v-if="summary" class="q-mt-sm" style="white-space: pre-wrap">{{ summary }}</div>
      </q-card-section>
      <q-card-section v-if="opportunities.length" class="q-pt-none">
        <div class="text-subtitle2">Geliştirme fırsatları</div>
        <q-list dense>
          <q-item v-for="(o, i) in opportunities" :key="i">
            <q-item-section>
              <q-item-label>{{ o.title }} <q-badge outline color="positive">değer: {{ o.value }}</q-badge> <q-badge outline>efor: {{ o.effort }}</q-badge></q-item-label>
              <q-item-label caption>{{ o.reason }} <span v-if="o.evidence_files.length">({{ o.evidence_files.join(', ') }})</span></q-item-label>
            </q-item-section>
          </q-item>
        </q-list>
      </q-card-section>
      <q-card-actions><q-btn flat color="primary" label="Bulgulara git" @click="$emit('show-findings')" /></q-card-actions>
    </q-card>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import CouncilProgress from '@/components/council/CouncilProgress.vue'
import { repos, type BrainFact, type ChunkWithPath, type Project } from '@/db'
import type { AskContext } from '@/domain/ask/context'
import { auditContext, auditRoles, buildAuditTask, selectAuditChunks } from '@/domain/audit/audit'
import { AUDIT_FOCUS } from '@/domain/audit/categories'
import { localFindings } from '@/domain/audit/local'
import type { AuditReport } from '@/domain/audit/report'
import { priceLookup, type PriceLookup } from '@/domain/cost/pricing'
import { estimateCouncil, type CouncilConfig, type CouncilMode, type Participant } from '@/domain/council/engine'
import { roleBrief, roleIds } from '@/domain/prompts/registry'
import { loadModelSlots, type ModelSlot } from '@/domain/providers/available'
import { useCouncilRun } from '@/stores/councilRun'

const props = defineProps<{ project: Project }>()
const emit = defineEmits<{ 'show-findings': []; changed: [] }>()
const store = useCouncilRun()

const scanning = ref(false)
const localResult = ref<string | null>(null)
const focus = ref<string[]>(['security', 'error_handling'])
const mode = ref<CouncilMode>('fast')
const budget = ref(1)
const slots = ref<ModelSlot[]>([])
const members = ref<{ slot: string; roleId: string }[]>([])
const judgeSlot = ref('')
const price = ref<PriceLookup>(() => undefined)
const facts = ref<BrainFact[]>([])
const chunks = ref<ChunkWithPath[]>([])
const context = ref<AskContext | null>(null)

const runHere = computed(() => (store.active?.projectId === props.project.id ? store.active : null))
const slotOptions = computed(() => slots.value.map((s) => ({ label: s.label, value: s.key })))
const roleOptions = roleIds().map((id) => ({ label: roleBrief(id).label, value: id }))
const report = computed(() => (runHere.value?.auditReport as { judge?: AuditReport } | undefined)?.judge)
const summary = computed(() => report.value?.summary ?? '')
const opportunities = computed(() => report.value?.opportunities ?? [])

const toParticipant = (slotKey: string, id: string, roleId: string): Participant => {
  const s = slots.value.find((x) => x.key === slotKey)!
  return { id, provider: s.provider, model: s.model, roleId, maxTokens: s.maxTokens ?? undefined, temperature: s.temperature ?? undefined }
}
const config = computed<CouncilConfig | null>(() =>
  members.value.length >= 2 && judgeSlot.value
    ? { mode: mode.value, participants: members.value.map((m, i) => toParticipant(m.slot, `p${i + 1}`, m.roleId)), judge: toParticipant(judgeSlot.value, 'judge', 'judge'), budgetUsd: budget.value > 0 ? budget.value : undefined }
    : null,
)
const estimate = computed(() => (config.value && context.value ? estimateCouncil(buildAuditTask(props.project, context.value, focus.value), config.value, price.value) : null))
const estimateLabel = computed(() => (!estimate.value ? '—' : estimate.value.usd === null ? 'fiyatsız' : `~$${estimate.value.usd.toFixed(3)}`))
const disabledReason = computed(() => {
  if (!props.project.indexedAt) return 'Önce projeyi indeksle.'
  if (store.active?.status === 'running') return 'Başka bir oturum çalışıyor.'
  if (focus.value.length === 0) return 'En az bir odak alanı seç.'
  if (!context.value || chunks.value.length === 0) return 'Seçili alanlar için kod bulunamadı.'
  if (!config.value) return 'En az 2 üye ve bir Judge gerekli.'
  if (estimate.value?.usd != null && config.value.budgetUsd !== undefined && estimate.value.usd > config.value.budgetUsd) return 'Tahmini maliyet bütçeyi aşıyor.'
  return ''
})

async function prepare() {
  const r = await repos()
  chunks.value = await selectAuditChunks(r.projectIndex, props.project.id, focus.value)
  context.value = auditContext(chunks.value, facts.value)
  const roles = auditRoles(focus.value)
  members.value.forEach((m, i) => (m.roleId = roles[i % roles.length]!))
}

async function localScan() {
  scanning.value = true
  try {
    const r = await repos()
    const [files, all] = await Promise.all([r.projectIndex.listFiles(props.project.id), r.projectIndex.allChunks(props.project.id)])
    const found = localFindings(files, all)
    const res = await r.findings.upsertMany(props.project.id, null, found)
    localResult.value = `${found.length} yerel bulgu: ${res.added} yeni, ${res.updated} güncellendi.`
    emit('changed')
  } finally {
    scanning.value = false
  }
}

async function start() {
  if (!config.value || !context.value) return
  await store.startAudit(props.project, focus.value, context.value, config.value)
  emit('changed')
}

onMounted(async () => {
  const r = await repos()
  const [s, p, f] = await Promise.all([loadModelSlots(), r.modelPrices.list(), r.brainFacts.forContext(props.project.id)])
  slots.value = s
  price.value = priceLookup(p)
  facts.value = f
  if (s.length) {
    members.value = Array.from({ length: Math.min(Math.max(s.length, 2), 3) }, (_, i) => ({ slot: s[i % s.length]!.key, roleId: '' }))
    judgeSlot.value = s[s.length - 1]!.key
  }
  if (props.project.indexedAt) await prepare()
})
</script>
