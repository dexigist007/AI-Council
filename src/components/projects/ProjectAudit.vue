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
        <CouncilMembers v-model="config" :roles="roles" />
        <div v-if="context">
          <div class="text-caption">
            Gönderilecek: {{ chunks.length }} kod parçası, {{ context.files.length }} dosya · ~{{ (context.tokens / 1000).toFixed(1) }}k token (her üyeye) ·
            tahmini toplam <b>{{ estimateLabel }}</b> ·
            <span :class="context.redactions ? 'text-warn' : ''">{{ context.redactions }} maskeleme</span>
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
import CouncilMembers from '@/components/council/CouncilMembers.vue'
import CouncilProgress from '@/components/council/CouncilProgress.vue'
import { repos, type BrainFact, type ChunkWithPath, type Project } from '@/db'
import type { AskContext } from '@/domain/ask/context'
import { auditContext, auditRoles, buildAuditTask, selectAuditChunks, sourcesFromExcerpts } from '@/domain/audit/audit'
import { AUDIT_FOCUS } from '@/domain/audit/categories'
import { localFindings } from '@/domain/audit/local'
import type { AuditReport } from '@/domain/audit/report'
import { priceLookup, type PriceLookup } from '@/domain/cost/pricing'
import { estimateCouncil, type CouncilConfig } from '@/domain/council/engine'
import { useCouncilRun } from '@/stores/councilRun'

const props = defineProps<{ project: Project }>()
const emit = defineEmits<{ 'show-findings': []; changed: [] }>()
const store = useCouncilRun()

const scanning = ref(false)
const localResult = ref<string | null>(null)
const focus = ref<string[]>(['security', 'error_handling'])
const price = ref<PriceLookup>(() => undefined)
const config = ref<CouncilConfig | null>(null)
const facts = ref<BrainFact[]>([])
const chunks = ref<ChunkWithPath[]>([])
const context = ref<AskContext | null>(null)

const runHere = computed(() => (store.active?.projectId === props.project.id ? store.active : null))
const roles = computed(() => auditRoles(focus.value))
const report = computed(() => (runHere.value?.auditReport as { judge?: AuditReport } | undefined)?.judge)
const summary = computed(() => report.value?.summary ?? '')
const opportunities = computed(() => report.value?.opportunities ?? [])

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
  await store.startProjectCouncil(props.project, buildAuditTask(props.project, context.value, focus.value), config.value,
    sourcesFromExcerpts(context.value.sent), { focus: focus.value, sentFiles: context.value.files })
  emit('changed')
}

onMounted(async () => {
  const r = await repos()
  const [p, f] = await Promise.all([r.modelPrices.list(), r.brainFacts.forContext(props.project.id)])
  price.value = priceLookup(p)
  facts.value = f
  if (props.project.indexedAt) await prepare()
})
</script>
