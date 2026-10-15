<template>
  <q-card flat bordered>
    <q-card-section>
      <div class="text-subtitle1">Model fiyatları</div>
      <div class="text-caption text-grey-7">
        1 milyon token başına USD. Fiyatlar sık değiştiği için uygulamaya gömülü değil; sağlayıcının fiyat
        sayfasından girersin. Fiyatı olmayan modellerin maliyeti "fiyatsız" olarak gösterilir, $0 sayılmaz.
      </div>
    </q-card-section>
    <q-markup-table flat dense separator="horizontal">
      <thead>
        <tr><th class="text-left">Sağlayıcı</th><th class="text-left">Model</th><th>Giriş</th><th>Önbellek</th><th>Çıkış</th><th /></tr>
      </thead>
      <tbody>
        <tr v-for="p in prices" :key="p.provider + p.model">
          <td>{{ label(p.provider) }}</td>
          <td>{{ p.model }}</td>
          <td class="text-right">{{ p.inPerMtok }}</td>
          <td class="text-right">{{ p.cachedPerMtok ?? '—' }}</td>
          <td class="text-right">{{ p.outPerMtok }}</td>
          <td class="text-right"><q-btn flat dense round icon="delete" size="sm" @click="remove(p)" /></td>
        </tr>
        <tr>
          <td><q-select v-model="draft.provider" dense borderless :options="providerOptions" emit-value map-options /></td>
          <td><q-input v-model="draft.model" dense borderless placeholder="model id" /></td>
          <td><q-input v-model.number="draft.inPerMtok" dense borderless type="number" input-class="text-right" /></td>
          <td><q-input v-model.number="draft.cachedPerMtok" dense borderless type="number" input-class="text-right" placeholder="—" /></td>
          <td><q-input v-model.number="draft.outPerMtok" dense borderless type="number" input-class="text-right" /></td>
          <td class="text-right"><q-btn flat dense round icon="add" color="primary" :disable="!valid" @click="add" /></td>
        </tr>
      </tbody>
    </q-markup-table>
    <q-card-section v-if="error" class="text-negative">{{ error }}</q-card-section>
  </q-card>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { repos, type ModelPrice } from '@/db'
import { PROVIDERS } from '@/domain/providers/registry'
import type { ProviderId } from '@/domain/providers/types'

const prices = ref<ModelPrice[]>([])
const error = ref<string | null>(null)
const providerOptions = PROVIDERS.map((p) => ({ label: p.label, value: p.id }))
const label = (id: ProviderId) => PROVIDERS.find((p) => p.id === id)?.label ?? id

const blank = () => ({ provider: 'openai' as ProviderId, model: '', inPerMtok: null as number | null, outPerMtok: null as number | null, cachedPerMtok: null as number | null | '' })
const draft = reactive(blank())
const valid = computed(() => draft.model.trim() !== '' && (draft.inPerMtok ?? -1) >= 0 && (draft.outPerMtok ?? -1) >= 0)

async function load() {
  prices.value = await (await repos()).modelPrices.list()
}

async function add() {
  try {
    const cached = draft.cachedPerMtok === '' || draft.cachedPerMtok === null ? null : Number(draft.cachedPerMtok)
    await (await repos()).modelPrices.save({ ...draft, inPerMtok: draft.inPerMtok!, outPerMtok: draft.outPerMtok!, cachedPerMtok: cached })
    Object.assign(draft, { ...blank(), provider: draft.provider })
    await load()
  } catch (e) {
    error.value = String(e)
  }
}

async function remove(p: ModelPrice) {
  await (await repos()).modelPrices.remove(p.provider, p.model)
  await load()
}

onMounted(() => load().catch((e) => (error.value = String(e))))
</script>
