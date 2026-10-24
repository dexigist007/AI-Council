<template>
  <q-page padding>
    <div class="row items-center q-mb-md">
      <div class="text-h5">{{ t('projects.list.title') }}</div>
      <q-space />
      <q-btn unelevated color="primary" icon="create_new_folder" :label="t('projects.list.add')" :loading="adding" @click="add" />
    </div>
    <div class="text-grey-7 q-mb-md">{{ t('projects.list.privacy') }}</div>
    <q-banner v-if="error" class="bg-negative text-white q-mb-md" rounded>{{ error }}</q-banner>
    <div v-if="projects.length === 0" class="text-grey-7">{{ t('projects.list.empty') }}</div>
    <q-list v-else bordered separator style="max-width: 1000px">
      <q-item v-for="p in projects" :key="p.id" clickable :to="`/projects/${p.id}`">
        <q-item-section avatar><q-icon name="folder" color="primary" /></q-item-section>
        <q-item-section>
          <q-item-label>{{ p.name }}</q-item-label>
          <q-item-label caption>{{ p.rootPath }}</q-item-label>
        </q-item-section>
        <q-item-section side>
          <q-item-label caption>{{ p.indexStats ? t('projects.list.stats', { files: fmtNum(p.indexStats.indexedFiles), chunks: fmtNum(p.indexStats.chunks) }) : t('projects.list.notIndexed') }}</q-item-label>
          <q-item-label v-if="p.indexedAt" caption>{{ fmtDate(p.indexedAt) }}</q-item-label>
        </q-item-section>
      </q-item>
    </q-list>
  </q-page>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { repos, type Project } from '@/db'
import { fmtDate, fmtNum, t } from '@/i18n'
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
