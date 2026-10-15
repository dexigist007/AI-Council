<template>
  <q-card flat bordered>
    <q-card-section class="row items-center q-gutter-sm">
      <div class="text-subtitle1">{{ meta.label }}</div>
      <q-badge v-if="meta.note" color="orange-8" :label="meta.note" />
      <q-space />
      <q-chip dense :color="hasKey ? 'positive' : 'grey-5'" text-color="white" :icon="hasKey ? 'key' : 'key_off'">
        {{ hasKey ? 'Anahtar kayıtlı' : 'Anahtar yok' }}
      </q-chip>
      <q-toggle v-model="config.enabled" label="Etkin" :disable="!hasKey" @update:model-value="save" />
    </q-card-section>

    <q-card-section class="q-pt-none q-gutter-y-sm">
      <div class="row q-col-gutter-sm items-center">
        <q-input
          v-model="keyInput" class="col" dense outlined type="password" autocomplete="off" bottom-slots
          :label="hasKey ? 'Yeni anahtar (değiştirmek için)' : 'API anahtarı'"
        >
          <template #hint>
            Anahtar işletim sisteminin anahtar deposunda saklanır, uygulama arayüzü onu bir daha okuyamaz.
            Anahtar: {{ meta.keyUrl }}
          </template>
        </q-input>
        <div class="col-auto q-gutter-x-sm">
          <q-btn unelevated color="primary" label="Kaydet" :disable="!keyInput.trim()" :loading="busy === 'key'" @click="saveKey" />
          <q-btn v-if="hasKey" flat color="negative" label="Sil" :loading="busy === 'delete'" @click="deleteKey" />
        </div>
      </div>

      <div class="row q-col-gutter-sm q-mt-md">
        <q-select
          v-model="config.defaultModel" class="col-12 col-md-6" dense outlined label="Varsayılan model"
          :options="models" use-input fill-input hide-selected input-debounce="0" new-value-mode="add-unique"
          @input-value="(v: string) => (config.defaultModel = v)" @update:model-value="save"
        >
          <template #after>
            <q-btn flat dense icon="refresh" :disable="!hasKey" :loading="busy === 'models'" @click="loadModels">
              <q-tooltip>Modelleri sağlayıcıdan getir</q-tooltip>
            </q-btn>
          </template>
        </q-select>
        <q-input
          v-model.number="config.maxTokens" class="col-6 col-md-3" dense outlined type="number" label="Max tokens"
          placeholder="varsayılan" @change="save"
        />
        <q-input
          v-model.number="temperature" class="col-6 col-md-3" dense outlined type="number" step="0.1" min="0" max="2"
          label="Temperature" placeholder="varsayılan" :disable="meta.id === 'anthropic'"
          :hint="meta.id === 'anthropic' ? 'Güncel Claude modelleri desteklemiyor' : 'Boş = model varsayılanı'"
          @change="save"
        />
      </div>
    </q-card-section>

    <q-card-actions class="q-px-md q-pb-md">
      <q-btn
        outline color="primary" icon="bolt" label="Bağlantıyı test et" :loading="busy === 'test'"
        :disable="!hasKey || !config.defaultModel" @click="test"
      />
      <div v-if="status" class="q-ml-md" :class="status.ok ? 'text-positive' : 'text-negative'">{{ status.text }}</div>
    </q-card-actions>
  </q-card>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { repos } from '@/db'
import type { ProviderConfig } from '@/db'
import { secrets, tauriTransport } from '@/platform/tauri'
import { createProvider, type ProviderMeta } from '@/domain/providers/registry'
import { ProviderError } from '@/domain/providers/types'

const props = defineProps<{ meta: ProviderMeta; initial: ProviderConfig }>()

const config = ref<ProviderConfig>({ ...props.initial })
const hasKey = ref(false)
const keyInput = ref('')
const models = ref<string[]>([])
const busy = ref<'key' | 'delete' | 'models' | 'test' | null>(null)
const status = ref<{ ok: boolean; text: string } | null>(null)

// Empty input means "use the model default", stored as null.
const temperature = computed({
  get: () => config.value.temperature ?? '',
  set: (v: number | string) => (config.value.temperature = v === '' || Number.isNaN(Number(v)) ? null : Number(v)),
})

const provider = () => createProvider(props.meta.id, tauriTransport)
function fail(e: unknown) {
  const text = e instanceof ProviderError && e.kind === 'auth'
    ? `Anahtar geçersiz veya yetkisiz (${e.message})`
    : String(e instanceof Error ? e.message : e)
  status.value = { ok: false, text }
}

async function run(kind: NonNullable<typeof busy.value>, fn: () => Promise<void>) {
  busy.value = kind
  try {
    await fn()
  } catch (e) {
    fail(e)
  } finally {
    busy.value = null
  }
}

async function save() {
  const c = config.value
  if (typeof c.maxTokens !== 'number' || c.maxTokens <= 0) c.maxTokens = null
  await (await repos()).providerConfigs.save(c).catch(fail)
}

const saveKey = () => run('key', async () => {
  await secrets.set(props.meta.id, keyInput.value)
  keyInput.value = ''
  hasKey.value = true
  status.value = { ok: true, text: 'Anahtar kaydedildi.' }
})

const deleteKey = () => run('delete', async () => {
  await secrets.delete(props.meta.id)
  hasKey.value = false
  config.value.enabled = false
  await save()
  status.value = { ok: true, text: 'Anahtar silindi.' }
})

const loadModels = () => run('models', async () => {
  models.value = await provider().listModels()
  status.value = { ok: true, text: `${models.value.length} model bulundu.` }
})

const test = () => run('test', async () => {
  const started = performance.now()
  const res = await provider().chat({
    model: config.value.defaultModel!,
    messages: [{ role: 'user', content: 'Reply with the single word: OK' }],
    maxTokens: 512,
  })
  const ms = Math.round(performance.now() - started)
  status.value = {
    ok: true,
    text: `Yanıt: "${res.text.trim().slice(0, 40)}" · ${ms} ms · ${res.usage.input} giriş / ${res.usage.output} çıkış token`,
  }
})

onMounted(async () => {
  hasKey.value = await secrets.exists(props.meta.id).catch(() => false)
})
</script>
