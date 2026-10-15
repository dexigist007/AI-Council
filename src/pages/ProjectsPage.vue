<template>
  <q-page padding>
    <div class="row items-center q-mb-md">
      <div class="text-h5">Projeler</div>
      <q-space />
      <q-btn unelevated color="primary" icon="create_new_folder" label="Proje klasörü ekle" :loading="adding" @click="add" />
    </div>
    <div class="text-grey-7 q-mb-md">
      Kaynak kod bilgisayarından çıkmaz. Sadece Council'a bir soru sorduğunda, ilgili parçalar (gönderimden önce
      gösterilerek) seçtiğin AI sağlayıcısına gider.
    </div>
    <q-banner v-if="error" class="bg-negative text-white q-mb-md" rounded>{{ error }}</q-banner>
    <div v-if="projects.length === 0" class="text-grey-7">Henüz proje yok.</div>
    <q-list v-else bordered separator style="max-width: 1000px">
      <q-item v-for="p in projects" :key="p.id" clickable :to="`/projects/${p.id}`">
        <q-item-section avatar><q-icon name="folder" color="primary" /></q-item-section>
        <q-item-section>
          <q-item-label>{{ p.name }}</q-item-label>
          <q-item-label caption>{{ p.rootPath }}</q-item-label>
        </q-item-section>
        <q-item-section side>
          <q-item-label caption>{{ p.indexStats ? `${p.indexStats.indexedFiles} dosya · ${p.indexStats.chunks} parça` : 'İndekslenmedi' }}</q-item-label>
          <q-item-label v-if="p.indexedAt" caption>{{ new Date(p.indexedAt).toLocaleString() }}</q-item-label>
        </q-item-section>
      </q-item>
    </q-list>
  </q-page>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { repos, type Project } from '@/db'
import { projectsFs } from '@/platform/tauri'

const router = useRouter()
const projects = ref<Project[]>([])
const adding = ref(false)
const error = ref<string | null>(null)

async function add() {
  adding.value = true
  error.value = null
  try {
    const root = await projectsFs.pickFolder()
    if (!root) return
    const name = root.split(/[\\/]/).filter(Boolean).pop() ?? root
    const project = await (await repos()).projects.create({ name, rootPath: root })
    await router.push({ path: `/projects/${project.id}`, query: project.indexedAt ? {} : { index: '1' } })
  } catch (e) {
    error.value = String(e)
  } finally {
    adding.value = false
  }
}

onMounted(async () => {
  projects.value = await (await repos()).projects.list()
})
</script>
