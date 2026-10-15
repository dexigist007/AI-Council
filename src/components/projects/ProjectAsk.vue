<template>
  <div class="stack">
    <q-card flat bordered>
      <q-card-section class="stack">
        <q-input v-model="question" outlined autogrow type="textarea" label="Projeye sor"
          placeholder="Örn: Playlist yüklenirken RAM neden artıyor? · Firebase nerelerde kullanılıyor?" />
        <div class="row q-col-gutter-sm items-center">
          <q-input v-model="terms" class="col" dense outlined label="Yerel arama terimleri"
            hint="Kodda geçen kelimeler daha iyi sonuç verir (İngilizce isimler, fonksiyon adları). AI kullanılmaz." @keyup.enter="find" />
          <div class="col-auto"><q-btn unelevated color="primary" icon="search" label="Kod parçalarını bul" :disable="!terms.trim()" :loading="finding" @click="find" /></div>
        </div>
      </q-card-section>
    </q-card>

    <q-card v-if="chunks.length" flat bordered>
      <q-card-section class="row items-center">
        <div class="text-subtitle2">AI'a gidecek kod parçaları ({{ selected.size }}/{{ chunks.length }})</div>
        <q-space />
        <q-btn flat dense no-caps label="İlk 12" @click="selectTop" />
        <q-btn flat dense no-caps label="Hiçbiri" @click="selected = new Set()" />
      </q-card-section>
      <q-list dense separator style="max-height: 320px; overflow: auto">
        <q-item v-for="c in chunks" :key="c.id" tag="label">
          <q-item-section side><q-checkbox :model-value="selected.has(c.id)" @update:model-value="toggle(c.id)" /></q-item-section>
          <q-item-section>
            <q-item-label>{{ c.path }}:{{ c.startLine }}-{{ c.endLine }}</q-item-label>
            <q-item-label caption lines="1" class="mono">{{ firstLine(c.content) }}</q-item-label>
          </q-item-section>
          <q-item-section side class="text-caption">~{{ c.tokenEst }} tok</q-item-section>
        </q-item>
      </q-list>
      <q-card-section class="row items-center q-col-gutter-sm">
        <q-select v-model="slotKey" class="col-5" dense outlined :options="slots.map((s) => ({ label: s.label, value: s.key }))" emit-value map-options label="Model" />
        <div class="col text-caption">
          ~{{ (context.tokens / 1000).toFixed(1) }}k token · {{ costLabel }} · Onaylı Brain bilgileri de gider.
          <span :class="context.redactions ? 'text-orange-9' : 'text-grey-7'">{{ context.redactions ? `${context.redactions} gizli bilgi maskelendi.` : 'Maskelenecek bir şey yok.' }}</span>
        </div>
        <div class="col-auto">
          <q-btn v-if="!asking" unelevated color="primary" icon="send" label="Sor" :disable="!question.trim() || !slotKey || selected.size === 0" @click="ask" />
          <q-btn v-else outline color="negative" icon="stop" label="Durdur" @click="controller?.abort()" />
        </div>
      </q-card-section>
    </q-card>
    <div v-else-if="searched" class="text-grey-7">Eşleşen kod bulunamadı; başka terimler dene.</div>
    <div v-if="error" class="text-negative">{{ error }}</div>

    <AskAnswerView v-if="current" :report="current" />

    <q-card v-if="history.length" flat bordered>
      <q-card-section class="text-subtitle2">Önceki sorular</q-card-section>
      <q-list dense separator>
        <q-item v-for="h in history" :key="h.id" clickable @click="showHistory(h)">
          <q-item-section>{{ (h.finalReport as AskReport).question }}</q-item-section>
          <q-item-section side class="text-caption">{{ new Date(h.createdAt).toLocaleString() }} · ${{ h.actualCost.toFixed(4) }}</q-item-section>
        </q-item>
      </q-list>
    </q-card>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import AskAnswerView from './AskAnswerView.vue'
import { repos, type BrainFact, type ChunkWithPath, type Project, type Session } from '@/db'
import { askProject, type AskReport } from '@/domain/ask/ask'
import { buildAskContext } from '@/domain/ask/context'
import { costOf, priceLookup, type PriceLookup } from '@/domain/cost/pricing'
import { loadModelSlots, type ModelSlot } from '@/domain/providers/available'
import { createProvider } from '@/domain/providers/registry'
import { CancelledError } from '@/domain/providers/types'
import { tauriTransport } from '@/platform/tauri'

const props = defineProps<{ project: Project }>()
/** Keeps the request small: enough code to answer, not the whole project. */
const TOKEN_BUDGET = 12000

const question = ref('')
const terms = ref('')
const termsEdited = ref(false)
const chunks = ref<ChunkWithPath[]>([])
const selected = ref<Set<string>>(new Set())
const facts = ref<BrainFact[]>([])
const slots = ref<ModelSlot[]>([])
const slotKey = ref<string | null>(null)
const price = ref<PriceLookup>(() => undefined)
const finding = ref(false)
const searched = ref(false)
const asking = ref(false)
const error = ref<string | null>(null)
const current = ref<AskReport | null>(null)
const history = ref<Session[]>([])
let controller: AbortController | null = null

// Search terms follow the question until the user edits them.
watch(question, (q) => { if (!termsEdited.value) terms.value = q })
watch(terms, (t) => { if (t !== question.value) termsEdited.value = true })

const chosen = computed(() => chunks.value.filter((c) => selected.value.has(c.id)))
const context = computed(() => buildAskContext(chosen.value, facts.value))
const slot = computed(() => slots.value.find((s) => s.key === slotKey.value) ?? null)
const costLabel = computed(() => {
  if (!slot.value) return '—'
  const c = costOf(price.value(slot.value.provider, slot.value.model), { input: context.value.tokens, output: 1500, cached: 0 })
  return c === null ? 'fiyatsız' : `~$${c.toFixed(3)}`
})

const firstLine = (s: string) => s.split('\n').find((l) => l.trim()) ?? ''

function selectTop() {
  const ids = new Set<string>()
  let used = 0
  for (const c of chunks.value.slice(0, 12)) {
    if (used + c.tokenEst > TOKEN_BUDGET) break
    ids.add(c.id)
    used += c.tokenEst
  }
  selected.value = ids
}

function toggle(id: string) {
  const next = new Set(selected.value)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  selected.value = next
}

async function find() {
  finding.value = true
  error.value = null
  try {
    const r = await repos()
    const hits = await r.projectIndex.search(props.project.id, terms.value, 30)
    chunks.value = await r.projectIndex.getChunks(hits.map((h) => h.chunkId))
    searched.value = true
    selectTop()
  } catch (e) {
    error.value = String(e)
  } finally {
    finding.value = false
  }
}

function showHistory(h: Session) {
  error.value = null
  current.value = h.finalReport as AskReport
}

async function loadHistory() {
  const all = await (await repos()).sessions.list({ projectId: props.project.id, limit: 50 })
  history.value = all.filter((s) => (s.config.meta as { purpose?: string } | undefined)?.purpose === 'ask' && s.status === 'completed')
}

async function ask() {
  if (!slot.value) return
  asking.value = true
  error.value = null
  controller = new AbortController()
  try {
    const r = await repos()
    const res = await askProject(
      { provider: (id) => createProvider(id, tauriTransport), sessions: r.sessions, price: price.value },
      props.project, question.value.trim(), terms.value, context.value,
      { provider: slot.value.provider, model: slot.value.model, maxTokens: slot.value.maxTokens ?? undefined },
      { signal: controller.signal },
    )
    if (res.error) error.value = res.error
    else current.value = res.report!
    await loadHistory()
  } catch (e) {
    error.value = e instanceof CancelledError ? 'Durduruldu.' : String(e instanceof Error ? e.message : e)
  } finally {
    asking.value = false
    controller = null
  }
}

onMounted(async () => {
  const r = await repos()
  const [f, s, p] = await Promise.all([r.brainFacts.forContext(props.project.id), loadModelSlots(), r.modelPrices.list()])
  facts.value = f
  slots.value = s
  slotKey.value = s[0]?.key ?? null
  price.value = priceLookup(p)
  await loadHistory()
})
</script>

<style scoped>
.mono { font-family: ui-monospace, monospace; }
</style>
