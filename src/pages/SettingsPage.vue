<template>
  <q-page padding>
    <div class="row items-end q-col-gutter-md q-mb-lg" style="max-width: 900px">
      <div class="col">
        <div class="text-h5 q-mb-xs">{{ t('shell.settings.providers') }}</div>
        <div class="text-soft">{{ t('shell.settings.providersHint') }}</div>
        <div class="text-caption q-mt-xs">{{ t('shell.settings.version', { id: buildId }) }}</div>
      </div>
      <div class="col-12 col-sm-4">
        <q-select
          :model-value="locale" dense outlined :label="t('shell.settings.language')" :hint="t('shell.settings.languageHint')"
          :options="LOCALES.map((l) => ({ label: l.label, value: l.id }))" emit-value map-options @update:model-value="setLocale"
        />
      </div>
    </div>
    <q-banner v-if="error" class="bg-negative text-white q-mb-md" rounded>{{ error }}</q-banner>
    <div v-if="configs" class="stack" style="max-width: 900px">
      <PrivacyCard />
      <ProviderCard v-for="meta in PROVIDERS" :key="meta.id" :meta="meta" :initial="configs[meta.id]" />
      <ModelPricesCard />
    </div>
  </q-page>
</template>

<script setup lang="ts">
const buildId = __BUILD__
import { onMounted, ref } from 'vue'
import { LOCALES, locale, t } from '@/i18n'
import { setLocale } from '@/i18n/setup'
import ModelPricesCard from '@/components/ModelPricesCard.vue'
import PrivacyCard from '@/components/PrivacyCard.vue'
import ProviderCard from '@/components/ProviderCard.vue'
import { repos, type ProviderConfig } from '@/db'
import { defaultProviderConfig } from '@/db/repositories/providerConfigs'
import { PROVIDERS } from '@/domain/providers/registry'
import type { ProviderId } from '@/domain/providers/types'

const configs = ref<Record<ProviderId, ProviderConfig> | null>(null)
const error = ref<string | null>(null)

onMounted(async () => {
  try {
    const saved = await (await repos()).providerConfigs.list()
    configs.value = Object.fromEntries(
      PROVIDERS.map((p) => [p.id, saved.find((c) => c.provider === p.id) ?? defaultProviderConfig(p.id)]),
    ) as Record<ProviderId, ProviderConfig>
  } catch (e) {
    error.value = String(e)
  }
})
</script>
