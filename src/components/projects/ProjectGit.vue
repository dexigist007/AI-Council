<template>
  <div class="stack">
    <q-banner v-if="error" rounded :class="notRepo ? 'bg-grey-3' : 'bg-red-1 text-negative'">
      {{ notRepo ? 'Bu klasör bir git deposu değil.' : error }}
    </q-banner>

    <template v-if="status">
      <q-card flat bordered>
        <q-card-section class="row items-center q-gutter-md">
          <div><q-icon name="call_split" /> <b>{{ status.branch ?? '(detached HEAD)' }}</b>
            <span v-if="status.upstream" class="text-caption text-grey-7"> → {{ status.upstream }}
              <span v-if="status.ahead">· {{ status.ahead }} ileride</span><span v-if="status.behind"> · {{ status.behind }} geride</span></span>
          </div>
          <div v-if="commits[0]" class="text-caption text-grey-8">Son commit: <code>{{ commits[0].hash.slice(0, 8) }}</code> {{ commits[0].subject }}</div>
          <q-space />
          <q-btn flat dense icon="refresh" @click="load" />
        </q-card-section>
        <q-card-section class="q-pt-none">
          <div class="text-caption text-grey-7">Commit edilmemiş dosyalar ({{ status.files.length }})</div>
          <div v-if="status.files.length === 0" class="text-grey-7">Çalışma alanı temiz.</div>
          <div v-for="f in status.files" :key="f.path" class="mono text-caption">
            <span class="code">{{ f.index }}{{ f.worktree }}</span> {{ f.path }}
          </div>
          <div v-if="status.files.some((f) => f.index === '?')" class="text-caption text-grey-7 q-mt-xs">
            "??" yeni (takip edilmeyen) dosyalar git diff'te görünmez; incelemeye girmeleri için önce <code>git add</code> edilmeleri gerekir.
          </div>
        </q-card-section>
      </q-card>

      <q-card flat bordered>
        <q-card-section class="row items-center q-col-gutter-sm">
          <q-select v-model="target" class="col-8" dense outlined emit-value map-options :options="targetOptions" label="İncelenecek değişiklik" @update:model-value="loadDiff" />
          <div class="col text-caption text-grey-7">{{ diffSummary }}</div>
        </q-card-section>
        <q-list v-if="diffFiles.length" dense separator>
          <q-expansion-item v-for="f in diffFiles" :key="f.path" dense>
            <template #header>
              <q-item-section><span class="mono">{{ f.path }}</span></q-item-section>
              <q-item-section side class="text-caption">
                <span><q-badge outline>{{ f.status }}</q-badge> <span class="text-positive">+{{ f.additions }}</span> <span class="text-negative">-{{ f.deletions }}</span></span>
              </q-item-section>
            </template>
            <div v-if="f.binary" class="q-pa-sm text-grey-7">Binary dosya.</div>
            <pre v-else class="diff"><template v-for="(h, hi) in f.hunks" :key="hi"><span class="hunk">@@ {{ h.newStart }} @@
</span><span v-for="(l, li) in h.lines" :key="li" :class="l.type === '+' ? 'add' : l.type === '-' ? 'del' : ''">{{ l.type }}{{ l.newLine === null ? '     ' : String(l.newLine).padStart(5) }} {{ l.text }}
</span></template></pre>
          </q-expansion-item>
        </q-list>
        <q-card-section v-else-if="target" class="text-grey-7">Bu seçimde değişiklik yok.</q-card-section>
      </q-card>

      <q-card v-show="runHere?.status !== 'running'" flat bordered>
        <q-card-section class="text-subtitle2">Review Changes</q-card-section>
        <q-card-section class="q-pt-none stack">
          <div class="text-caption text-grey-7">Sadece değişen satırlar ve çevrelerindeki birkaç satır gönderilir. Regresyon, hata, eksik doğrulama, güvenlik, tekrar eden mantık ve performans aranır; bulgular Findings'e kanıt doğrulamasıyla düşer.</div>
          <CouncilMembers v-model="config" :roles="REVIEW_ROLES" />
          <div v-if="review" class="text-caption">
            Gönderilecek: {{ review.files.length }} dosya · ~{{ (review.tokens / 1000).toFixed(1) }}k token (her üyeye) · tahmini toplam <b>{{ estimateLabel }}</b> ·
            <span :class="review.redactions ? 'text-orange-9' : ''">{{ review.redactions }} maskeleme</span>
            <div v-if="review.skipped.length" class="text-grey-7">Dahil edilmeyen: {{ review.skipped.map((s) => `${s.path} (${SKIP_LABEL[s.reason] ?? s.reason})`).join(', ') }}</div>
          </div>
        </q-card-section>
        <q-card-actions class="q-px-md q-pb-md">
          <q-btn unelevated color="primary" icon="rate_review" label="Değişiklikleri incele" :disable="!!disabledReason" @click="startReview" />
          <span v-if="disabledReason" class="text-caption text-grey-7 q-ml-md">{{ disabledReason }}</span>
        </q-card-actions>
      </q-card>

      <CouncilProgress v-if="runHere" :run="runHere" @cancel="store.cancel()" @dismiss="store.dismiss()" />
      <q-card v-if="runHere?.auditSaved" flat bordered>
        <q-card-section>
          <div class="text-subtitle2">İnceleme tamamlandı</div>
          <div>{{ runHere.auditSaved.added }} yeni bulgu, {{ runHere.auditSaved.updated }} güncellendi.
            <span v-if="runHere.auditSaved.unverified" class="text-negative">{{ runHere.auditSaved.unverified }} bulgunun kanıtı diff'te bulunamadı (UNVERIFIED).</span></div>
          <div v-if="runHere.auditReport" class="q-mt-sm" style="white-space: pre-wrap">{{ runHere.auditReport.judge.summary }}</div>
        </q-card-section>
        <q-card-actions><q-btn flat color="primary" label="Bulgulara git" @click="$emit('show-findings')" /></q-card-actions>
      </q-card>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import CouncilMembers from '@/components/council/CouncilMembers.vue'
import CouncilProgress from '@/components/council/CouncilProgress.vue'
import { repos, type BrainFact, type Project } from '@/db'
import { priceLookup, type PriceLookup } from '@/domain/cost/pricing'
import { estimateCouncil, type CouncilConfig } from '@/domain/council/engine'
import { parseDiff, parseLog, parseStatus, type DiffFile, type GitCommit, type GitStatus } from '@/domain/git/parse'
import { buildReviewContext, buildReviewTask, REVIEW_ROLES } from '@/domain/git/review'
import { gitRun } from '@/platform/tauri'
import { useCouncilRun } from '@/stores/councilRun'

const props = defineProps<{ project: Project }>()
const emit = defineEmits<{ 'show-findings': []; changed: [] }>()
const store = useCouncilRun()
const SKIP_LABEL: Record<string, string> = { binary: 'binary', deleted: 'silindi', budget: 'boyut sınırı', 'lock/generated/sensitive': 'lock/üretilmiş/hassas' }

const status = ref<GitStatus | null>(null)
const commits = ref<GitCommit[]>([])
const error = ref<string | null>(null)
const target = ref<string>('working')
const diffFiles = ref<DiffFile[]>([])
const truncated = ref(false)
const facts = ref<BrainFact[]>([])
const price = ref<PriceLookup>(() => undefined)
const config = ref<CouncilConfig | null>(null)

const notRepo = computed(() => error.value === 'not a git repository')
const runHere = computed(() => (store.active?.projectId === props.project.id ? store.active : null))
const targetOptions = computed(() => [
  { label: 'Commit edilmemiş değişiklikler (HEAD\'e göre)', value: 'working' },
  ...commits.value.map((c) => ({ label: `${c.hash.slice(0, 8)} · ${c.subject} · ${c.author} · ${new Date(c.date).toLocaleDateString()}`, value: c.hash })),
])
const targetLabel = computed(() => targetOptions.value.find((o) => o.value === target.value)?.label ?? target.value)
const review = computed(() => (diffFiles.value.length ? buildReviewContext(diffFiles.value, facts.value) : null))
const diffSummary = computed(() => {
  const add = diffFiles.value.reduce((s, f) => s + f.additions, 0)
  const del = diffFiles.value.reduce((s, f) => s + f.deletions, 0)
  return `${diffFiles.value.length} dosya · +${add} -${del}${truncated.value ? ' · (çıktı kesildi)' : ''}`
})
const estimate = computed(() => (review.value && config.value ? estimateCouncil(buildReviewTask(props.project, targetLabel.value, review.value), config.value, price.value) : null))
const estimateLabel = computed(() => (!estimate.value ? '—' : estimate.value.usd === null ? 'fiyatsız' : `~$${estimate.value.usd.toFixed(3)}`))
const disabledReason = computed(() => {
  if (store.active?.status === 'running') return 'Başka bir oturum çalışıyor.'
  if (!review.value || review.value.files.length === 0) return 'İncelenecek değişiklik yok.'
  if (!config.value) return 'En az 2 üye ve bir Judge gerekli.'
  if (estimate.value?.usd != null && config.value.budgetUsd !== undefined && estimate.value.usd > config.value.budgetUsd) return 'Tahmini maliyet bütçeyi aşıyor.'
  return ''
})

async function loadDiff() {
  try {
    const raw = await gitRun(props.project.rootPath, target.value === 'working'
      ? { op: 'diffWorking', context: 5 }
      : { op: 'diffCommit', hash: target.value, context: 5 })
    const parsed = parseDiff(raw)
    diffFiles.value = parsed.files
    truncated.value = parsed.truncated
  } catch (e) {
    // A repository without commits has no HEAD to diff against.
    diffFiles.value = []
    if (!String(e).includes('HEAD')) error.value = String(e)
  }
}

async function load() {
  error.value = null
  try {
    status.value = parseStatus(await gitRun(props.project.rootPath, { op: 'status' }))
    commits.value = await gitRun(props.project.rootPath, { op: 'log', limit: 30 }).then(parseLog).catch(() => [])
    if (target.value === 'working' && status.value.files.length === 0 && commits.value[0]) target.value = commits.value[0].hash
    await loadDiff()
  } catch (e) {
    status.value = null
    error.value = String(e)
  }
}

async function startReview() {
  if (!review.value || !config.value) return
  await store.startProjectCouncil(props.project, buildReviewTask(props.project, targetLabel.value, review.value), config.value,
    review.value.sources, { target: target.value, sentFiles: review.value.files })
  emit('changed')
}

onMounted(async () => {
  const r = await repos()
  const [p, f] = await Promise.all([r.modelPrices.list(), r.brainFacts.forContext(props.project.id)])
  price.value = priceLookup(p)
  facts.value = f
  await load()
})
</script>

<style scoped>
.mono { font-family: ui-monospace, monospace; }
.code { display: inline-block; width: 2.2em; color: #c62828; }
.diff { margin: 0; padding: 8px 12px; font-family: ui-monospace, monospace; font-size: 12px; line-height: 1.45; overflow-x: auto; background: rgba(127, 127, 127, 0.05); }
.diff .add { background: rgba(46, 160, 67, 0.18); display: block; }
.diff .del { background: rgba(248, 81, 73, 0.18); display: block; }
.diff .hunk { color: #6f42c1; display: block; }
.diff span:not(.add):not(.del):not(.hunk) { display: block; }
</style>
