<template>
  <div class="stack" style="max-width: 800px">
    <q-card flat bordered>
      <q-card-section class="stack">
        <q-input v-model="name" dense outlined :label="t('projects.settings.name')" />
        <q-input v-model="excludeText" outlined autogrow type="textarea" :label="t('projects.settings.exclude')"
          :hint="t('projects.settings.excludeHint')" />
        <div class="text-caption text-soft">
          {{ t('projects.settings.alwaysExcluded', { list: defaults.join('  ') }) }}
        </div>
      </q-card-section>
      <q-card-actions class="q-px-md q-pb-md">
        <q-btn unelevated color="primary" :label="t('common.save')" @click="save" />
        <span class="text-caption text-soft q-ml-md">{{ t('projects.settings.appliesNext') }}</span>
      </q-card-actions>
    </q-card>

    <q-card flat bordered>
      <q-card-section>
        <div class="text-subtitle2 text-negative">{{ t('projects.settings.removeTitle') }}</div>
        <div class="text-caption">{{ t('projects.settings.removeHint') }}</div>
      </q-card-section>
      <q-card-actions class="q-px-md q-pb-md">
        <q-btn outline color="negative" :label="t('projects.settings.remove')" @click="confirmRemove = true" />
      </q-card-actions>
    </q-card>

    <q-dialog v-model="confirmRemove">
      <q-card>
        <q-card-section>{{ t('projects.settings.removeConfirm', { name: project.name }) }}</q-card-section>
        <q-card-actions align="right">
          <q-btn v-close-popup flat :label="t('projects.shared.dismiss')" />
          <q-btn flat color="negative" :label="t('projects.settings.remove')" @click="remove" />
        </q-card-actions>
      </q-card>
    </q-dialog>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { repos, type Project } from '@/db'
import { t } from '@/i18n'
import { projectsFs } from '@/platform/tauri'

const props = defineProps<{ project: Project }>()
const emit = defineEmits<{ saved: []; removed: [] }>()

const name = ref(props.project.name)
const excludeText = ref((props.project.settings.exclude ?? []).join('\n'))
const defaults = ref<string[]>([])
const confirmRemove = ref(false)

async function save() {
  const exclude = excludeText.value.split('\n').map((l) => l.trim()).filter(Boolean)
  await (await repos()).projects.update(props.project.id, { name: name.value, settings: { ...props.project.settings, exclude } })
  emit('saved')
}

async function remove() {
  await (await repos()).projects.remove(props.project.id)
  await projectsFs.forgetRoot(props.project.rootPath).catch(() => {})
  emit('removed')
}

onMounted(async () => {
  defaults.value = await projectsFs.defaultExcludes().catch(() => [])
})
</script>
