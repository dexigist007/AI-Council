<template>
  <q-card flat bordered>
    <q-card-section class="row items-center q-gutter-sm">
      <div class="text-subtitle1">{{ meta.label }}<span v-if="meta.keyless" class="text-soft"> ({{ t('shell.provider.local') }})</span></div>
      <span v-if="meta.note" class="tag tag-risk">{{ t(`shell.provider.note.${meta.note}`) }}</span>
      <q-space />
      <span v-if="meta.keyless" class="tag tag-strength"><q-icon name="computer" size="15px" class="q-mr-xs" />{{ t('shell.provider.noKeyNeeded') }}</span>
      <span v-else class="tag" :class="hasKey ? 'tag-strength' : 'tag-assumption'"><q-icon :name="hasKey ? 'key' : 'key_off'" size="15px" class="q-mr-xs" />
        {{ hasKey ? t('shell.provider.keySaved') : t('shell.provider.noKey') }}
      </span>
      <q-toggle v-model="config.enabled" :label="t('shell.provider.enabled')" :disable="!hasKey" @update:model-value="save" />
    </q-card-section>
    <q-card-section v-if="missing" class="q-py-none">
      <q-banner dense rounded class="tone-warn">{{ t('shell.provider.unusable', { reasons: missing }) }}</q-banner>
    </q-card-section>

    <q-card-section class="q-pt-none q-gutter-y-sm">
      <div v-if="meta.keyless" class="text-caption text-soft">
        {{ t('shell.provider.localHint', { url: meta.keyUrl, cmd: 'ollama pull qwen2.5:7b' }) }}
      </div>
      <div v-else class="row q-col-gutter-sm items-center">
        <q-input
          v-model="keyInput" class="col" dense outlined type="password" autocomplete="off" bottom-slots
          :label="hasKey ? t('shell.provider.newKey') : t('shell.provider.apiKey')"
        >
          <template #hint>
            {{ t('shell.provider.keyHint', { url: meta.keyUrl }) }}
          </template>
        </q-input>
        <div class="col-auto q-gutter-x-sm">
          <q-btn unelevated color="primary" :label="t('common.save')" :disable="!keyInput.trim()" :loading="busy === 'key'" @click="saveKey" />
          <q-btn v-if="hasKey" flat color="negative" :label="t('common.delete')" :loading="busy === 'delete'" @click="deleteKey" />
        </div>
      </div>

      <div class="row q-col-gutter-sm q-mt-md">
        <q-select
          v-model="config.defaultModel" class="col-12 col-md-6" dense outlined :label="t('shell.provider.defaultModel')"
          :options="models" use-input fill-input hide-selected input-debounce="0" new-value-mode="add-unique"
          @input-value="(v: string) => (config.defaultModel = v)" @update:model-value="save" @blur="save"
        >
          <template #after>
            <q-btn flat dense icon="refresh" :disable="!hasKey" :loading="busy === 'models'" @click="loadModels">
              <q-tooltip>{{ t('shell.provider.fetchModels') }}</q-tooltip>
            </q-btn>
          </template>
        </q-select>
        <q-input
          v-model.number="config.maxTokens" class="col-6 col-md-3" dense outlined type="number" label="Max tokens"
          :placeholder="t('shell.provider.defaultPlaceholder')" @change="save"
        />
        <q-input
          v-model.number="temperature" class="col-6 col-md-3" dense outlined type="number" step="0.1" min="0" max="2"
          label="Temperature" :placeholder="t('shell.provider.defaultPlaceholder')" :disable="meta.id === 'anthropic'"
          :hint="meta.id === 'anthropic' ? t('shell.provider.noTemperature') : t('shell.provider.emptyIsDefault')"
          @change="save"
        />
      </div>
    </q-card-section>

    <q-card-actions class="q-px-md q-pb-md">
      <q-btn
        outline color="primary" icon="bolt" :label="t('shell.provider.test')" :loading="busy === 'test'"
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
import { t } from '@/i18n'

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

const missing = computed(() => {
  const m: string[] = []
  if (!hasKey.value) m.push(t('shell.provider.missingKey'))
  if (!config.value.enabled) m.push(t('shell.provider.missingEnabled'))
  if (!config.value.defaultModel?.trim()) m.push(t('shell.provider.missingModel'))
  return m.join(' · ')
})

const provider = () => createProvider(props.meta.id, tauriTransport)
function fail(e: unknown) {
  const text = e instanceof ProviderError && e.kind === 'auth'
    ? t('shell.provider.invalidKey', { error: e.message })
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
  status.value = { ok: true, text: t('shell.provider.keyStored') }
})

const deleteKey = () => run('delete', async () => {
  await secrets.delete(props.meta.id)
  hasKey.value = false
  config.value.enabled = false
  await save()
  status.value = { ok: true, text: t('shell.provider.keyDeleted') }
})

const loadModels = () => run('models', async () => {
  models.value = await provider().listModels()
  status.value = { ok: true, text: t('shell.provider.modelsFound', { n: models.value.length }) }
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
    text: t('shell.provider.testOk', { text: res.text.trim().slice(0, 40), ms, input: res.usage.input, output: res.usage.output }),
  }
})

onMounted(async () => {
  hasKey.value = props.meta.keyless === true || (await secrets.exists(props.meta.id).catch(() => false))
})
</script>
