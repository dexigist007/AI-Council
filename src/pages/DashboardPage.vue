<template>
  <PlaceholderPage
    title="Dashboard"
    description="Aktif projeler, açık kritik bulgular, son Council oturumları, karar bekleyen fikirler."
    phase="Faz 5+"
  >
    <q-chip class="q-mt-md q-ml-none" :color="db.color" text-color="white" :icon="db.icon">{{ db.label }}</q-chip>
  </PlaceholderPage>
</template>

<script setup lang="ts">
import { onMounted, reactive } from 'vue'
import PlaceholderPage from './PlaceholderPage.vue'
import { repos } from '@/db'

// Smoke check that the database opens and migrations ran; replaced by real widgets later.
const db = reactive({ label: 'Veritabanı kontrol ediliyor…', color: 'grey', icon: 'storage' })

onMounted(async () => {
  try {
    const { ideas } = await repos()
    const count = (await ideas.list()).length
    Object.assign(db, { label: `Veritabanı hazır · ${count} fikir`, color: 'positive', icon: 'check' })
  } catch (e) {
    Object.assign(db, { label: `Veritabanı hatası: ${String(e)}`, color: 'negative', icon: 'error' })
  }
})
</script>
