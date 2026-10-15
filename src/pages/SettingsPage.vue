<template>
  <q-page padding>
    <div class="text-h5 q-mb-xs">AI sağlayıcıları</div>
    <div class="text-grey-7 q-mb-lg">
      Anahtarlar macOS Keychain / Windows Credential Manager'da tutulur. İstekler doğrudan sağlayıcıya gider,
      arada sunucu yoktur.
    </div>
    <q-banner v-if="error" class="bg-negative text-white q-mb-md" rounded>{{ error }}</q-banner>
    <div v-if="configs" class="column q-gutter-md" style="max-width: 900px">
      <ProviderCard v-for="meta in PROVIDERS" :key="meta.id" :meta="meta" :initial="configs[meta.id]" />
      <ModelPricesCard />
    </div>
  </q-page>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue'
import ModelPricesCard from '@/components/ModelPricesCard.vue'
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
