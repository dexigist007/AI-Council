<template>
  <q-dialog :model-value="modelValue" persistent @update:model-value="$emit('update:modelValue', $event)">
    <q-card style="width: 640px; max-width: 95vw">
      <q-card-section>
        <div class="text-h6">Project Brain taslağı oluştur</div>
        <div class="text-caption text-grey-7">
          Tek bir AI çağrısı. Önerilen bilgiler "onay bekliyor" olarak gelir; sen onaylamadan Brain'in parçası olmaz.
        </div>
      </q-card-section>

      <q-card-section v-if="loading" class="text-grey-7">Gönderilecek içerik hazırlanıyor…</q-card-section>
      <template v-else>
        <q-card-section class="q-pt-none">
          <q-banner v-if="slots.length === 0" rounded class="tone-warn">
            Etkin ve modeli seçilmiş bir sağlayıcı yok (Settings).
          </q-banner>
          <q-select v-else v-model="slotKey" dense outlined :options="slots.map((s) => ({ label: s.label, value: s.key }))" emit-value map-options label="Model" />
        </q-card-section>

        <q-card-section v-if="context" class="q-pt-none">
          <div class="text-subtitle2">AI'a gidecekler</div>
          <ul class="q-my-xs q-pl-md text-caption">
            <li>Dosya ağacı (sadece yollar, {{ treeLines }} satır)</li>
            <li>Tespit edilen teknoloji yığını</li>
            <li v-for="f in context.files" :key="f"><code>{{ f }}</code></li>
          </ul>
          <div class="text-caption">
            ~{{ (context.tokens / 1000).toFixed(1) }}k token giriş · tahmini maliyet <b>{{ costLabel }}</b>
          </div>
          <div class="text-caption" :class="context.redactions ? 'text-warn' : 'text-grey-7'">
            {{ context.redactions ? `${context.redactions} olası gizli bilgi maskelendi (********).` : 'Maskelenecek gizli bilgi bulunmadı.' }}
            .env ve anahtar dosyaları hiçbir zaman okunmaz.
          </div>
        </q-card-section>
        <q-card-section v-if="error" class="q-pt-none text-negative">{{ error }}</q-card-section>
      </template>

      <q-card-actions align="right">
        <q-btn v-if="!running" v-close-popup flat label="Vazgeç" />
        <q-btn v-else flat color="negative" label="Durdur" @click="controller?.abort()" />
        <q-btn unelevated color="primary" label="Gönder ve taslak oluştur" :loading="running" :disable="!context || !slotKey" @click="send" />
      </q-card-actions>
    </q-card>
  </q-dialog>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { repos, type Project } from '@/db'
import { buildBrainContext, pickBrainFiles, type BrainContext } from '@/domain/brain/context'
import { generateBrainDraft } from '@/domain/brain/draft'
import { costOf, priceLookup, type PriceLookup } from '@/domain/cost/pricing'
import { loadModelSlots, type ModelSlot } from '@/domain/providers/available'
import { createProvider } from '@/domain/providers/registry'
import { CancelledError } from '@/domain/providers/types'
import { projectsFs, tauriTransport } from '@/platform/tauri'

const props = defineProps<{ modelValue: boolean; project: Project }>()
const emit = defineEmits<{ 'update:modelValue': [boolean]; done: [message: string] }>()

const loading = ref(false)
const running = ref(false)
const error = ref<string | null>(null)
const slots = ref<ModelSlot[]>([])
const slotKey = ref<string | null>(null)
const context = ref<BrainContext | null>(null)
const knownPaths = ref<Set<string>>(new Set())
const price = ref<PriceLookup>(() => undefined)
let controller: AbortController | null = null

const slot = computed(() => slots.value.find((s) => s.key === slotKey.value) ?? null)
const treeLines = computed(() => context.value?.tree.split('\n').length ?? 0)
const costLabel = computed(() => {
  if (!context.value || !slot.value) return '—'
  const c = costOf(price.value(slot.value.provider, slot.value.model), { input: context.value.tokens, output: 3000, cached: 0 })
  return c === null ? 'fiyatsız' : `~$${c.toFixed(3)}`
})

async function prepare() {
  loading.value = true
  error.value = null
  try {
    const r = await repos()
    const [files, s, prices] = await Promise.all([r.projectIndex.listFiles(props.project.id), loadModelSlots(), r.modelPrices.list()])
    if (files.length === 0) throw new Error('Proje henüz indekslenmedi.')
    slots.value = s
    slotKey.value = s[0]?.key ?? null
    price.value = priceLookup(prices)
    knownPaths.value = new Set(files.map((f) => f.path))
    const contents = await projectsFs.readFiles(props.project.rootPath, pickBrainFiles(files))
    context.value = buildBrainContext(files, contents)
  } catch (e) {
    error.value = String(e instanceof Error ? e.message : e)
  } finally {
    loading.value = false
  }
}

async function send() {
  if (!context.value || !slot.value) return
  running.value = true
  error.value = null
  controller = new AbortController()
  try {
    const r = await repos()
    const res = await generateBrainDraft(
      { provider: (id) => createProvider(id, tauriTransport), sessions: r.sessions, brain: r.brainFacts, price: price.value },
      props.project, context.value, await r.brainFacts.list(props.project.id, 'stack'), knownPaths.value,
      { provider: slot.value.provider, model: slot.value.model, maxTokens: slot.value.maxTokens ?? undefined },
      { signal: controller.signal },
    )
    if (res.error) {
      error.value = res.error
      return
    }
    const note = res.droppedEvidence.length ? ` Var olmayan ${res.droppedEvidence.length} dosya referansı atıldı.` : ''
    emit('done', `${res.added} bilgi önerildi, onayını bekliyor.${note}`)
    emit('update:modelValue', false)
  } catch (e) {
    error.value = e instanceof CancelledError ? 'Durduruldu.' : String(e instanceof Error ? e.message : e)
  } finally {
    running.value = false
    controller = null
  }
}

watch(() => props.modelValue, (open) => { if (open) void prepare() })
</script>
