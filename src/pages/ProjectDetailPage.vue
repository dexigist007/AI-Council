<template>
  <q-page padding>
    <div v-if="!project" class="text-grey-7">{{ notFound ? t('projects.detail.notFound') : t('common.loading') }}</div>
    <div v-else style="max-width: 1200px">
      <div class="row items-center q-mb-sm">
        <div>
          <div class="text-h5">{{ project.name }}</div>
          <div class="text-caption text-grey-7">{{ project.rootPath }}</div>
        </div>
        <q-space />
        <q-btn unelevated color="primary" icon="sync" :label="t('projects.detail.reindex')" :loading="!!progress" @click="reindex" />
      </div>

      <q-banner v-if="indexError" rounded class="tone-danger q-mb-md">
        {{ indexError }}
        <template v-if="needsRepick" #action><q-btn flat :label="t('projects.detail.repick')" @click="repick" /></template>
      </q-banner>
      <q-linear-progress v-if="progress" :value="progress.total ? progress.done / progress.total : 0" :indeterminate="!progress.total" class="q-mb-md" />
      <div v-if="progress" class="text-caption q-mb-md">{{ t(`projects.detail.phase.${progress.phase}`) }} {{ progress.total ? `${progress.done}/${progress.total}` : '' }}</div>

      <q-tabs v-model="tab" dense align="left" active-color="primary" indicator-color="primary" class="q-mb-md" no-caps>
        <q-tab name="overview" :label="t('projects.detail.tabs.overview')" />
        <q-tab name="brain" :label="t('projects.detail.tabs.brain')" />
        <q-tab name="ask" :label="t('projects.detail.tabs.ask')" />
        <q-tab name="audit" :label="t('projects.detail.tabs.audit')" />
        <q-tab name="findings" :label="t('projects.detail.tabs.findings')" />
        <q-tab name="git" :label="t('projects.detail.tabs.git')" />
        <q-tab name="files" :label="t('projects.detail.tabs.files')" />
        <q-tab name="settings" icon="settings" />
      </q-tabs>

      <q-tab-panels v-model="tab" animated class="bg-transparent">
        <q-tab-panel name="overview" class="q-pa-none">
          <ProjectOverview :project="project" :facts="facts" />
        </q-tab-panel>
        <q-tab-panel name="brain" class="q-pa-none">
          <ProjectBrain :project="project" />
        </q-tab-panel>
        <q-tab-panel name="ask" class="q-pa-none">
          <ProjectAsk :project="project" />
        </q-tab-panel>
        <q-tab-panel name="audit" class="q-pa-none">
          <ProjectAudit :project="project" @show-findings="tab = 'findings'" @changed="findingsKey++" />
        </q-tab-panel>
        <q-tab-panel name="findings" class="q-pa-none">
          <FindingsList :project-id="project.id" :refresh-key="findingsKey" />
        </q-tab-panel>
        <q-tab-panel name="git" class="q-pa-none">
          <ProjectGit :project="project" @show-findings="tab = 'findings'" @changed="findingsKey++" />
        </q-tab-panel>
        <q-tab-panel name="files" class="q-pa-none">
          <ProjectFiles :project-id="project.id" :refresh-key="refreshKey" />
        </q-tab-panel>
        <q-tab-panel name="settings" class="q-pa-none">
          <ProjectSettings :project="project" @saved="load" @removed="$router.push('/projects')" />
        </q-tab-panel>
      </q-tab-panels>
    </div>
  </q-page>
</template>

<script setup lang="ts">
import { onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import FindingsList from '@/components/findings/FindingsList.vue'
import ProjectAudit from '@/components/projects/ProjectAudit.vue'
import ProjectGit from '@/components/projects/ProjectGit.vue'
import ProjectAsk from '@/components/projects/ProjectAsk.vue'
import ProjectBrain from '@/components/projects/ProjectBrain.vue'
import ProjectFiles from '@/components/projects/ProjectFiles.vue'
import ProjectOverview from '@/components/projects/ProjectOverview.vue'
import ProjectSettings from '@/components/projects/ProjectSettings.vue'
import { repos, type BrainFact, type Project } from '@/db'
import { indexProject, type IndexProgress } from '@/domain/indexing/indexer'
import { indexerDeps } from '@/domain/indexing/runtime'
import { t } from '@/i18n'
import { projectsFs } from '@/platform/tauri'

const route = useRoute()
const router = useRouter()
const project = ref<Project | null>(null)
const facts = ref<BrainFact[]>([])
const notFound = ref(false)
const tab = ref('overview')
const progress = ref<IndexProgress | null>(null)
const indexError = ref<string | null>(null)
const needsRepick = ref(false)
const refreshKey = ref(0)
const findingsKey = ref(0)

async function load() {
  const r = await repos()
  project.value = await r.projects.get(route.params.id as string)
  notFound.value = !project.value
  if (project.value) facts.value = await r.brainFacts.list(project.value.id, 'stack')
}

async function reindex() {
  if (!project.value || progress.value) return
  indexError.value = null
  needsRepick.value = false
  progress.value = { phase: 'scan', done: 0, total: 0 }
  try {
    await indexProject(await indexerDeps(), project.value, (p) => (progress.value = p))
    refreshKey.value++
  } catch (e) {
    indexError.value = String(e)
    needsRepick.value = /not a registered project|cannot open/.test(indexError.value)
  } finally {
    progress.value = null
    await load()
  }
}

/** The allowlist can be lost (new machine, deleted config); re-picking the same folder restores access. */
async function repick() {
  const root = await projectsFs.pickFolder()
  if (!root) return
  if (root !== project.value!.rootPath) {
    indexError.value = t('projects.detail.wrongFolder', { root })
    return
  }
  await reindex()
}

onMounted(async () => {
  await load()
  if (route.query.index && project.value) {
    await router.replace({ query: {} })
    await reindex()
  }
})
watch(() => route.params.id, load)
</script>
