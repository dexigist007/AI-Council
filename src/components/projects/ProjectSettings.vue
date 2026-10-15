<template>
  <div class="stack" style="max-width: 800px">
    <q-card flat bordered>
      <q-card-section class="stack">
        <q-input v-model="name" dense outlined label="Proje adı" />
        <q-input v-model="excludeText" outlined autogrow type="textarea" label="Ek hariç tutma desenleri (her satıra bir tane, .gitignore sözdizimi)"
          hint="Örn: generated/  ·  *.snap  ·  android/app/release/" />
        <div class="text-caption text-grey-7">
          Her zaman hariç: {{ defaults.join('  ') }}. Ayrıca .gitignore kuralları uygulanır; .env, anahtar ve sertifika dosyaları hiç okunmaz.
        </div>
      </q-card-section>
      <q-card-actions class="q-px-md q-pb-md">
        <q-btn unelevated color="primary" label="Kaydet" @click="save" />
        <span class="text-caption text-grey-7 q-ml-md">Değişiklikler bir sonraki indekslemede uygulanır.</span>
      </q-card-actions>
    </q-card>

    <q-card flat bordered>
      <q-card-section>
        <div class="text-subtitle2 text-negative">Projeyi kaldır</div>
        <div class="text-caption">İndeks, oturumlar ve bulgular silinir. Klasör ve dosyalara dokunulmaz.</div>
      </q-card-section>
      <q-card-actions class="q-px-md q-pb-md">
        <q-btn outline color="negative" label="Kaldır" @click="confirmRemove = true" />
      </q-card-actions>
    </q-card>

    <q-dialog v-model="confirmRemove">
      <q-card>
        <q-card-section>"{{ project.name }}" uygulamadan kaldırılsın mı?</q-card-section>
        <q-card-actions align="right">
          <q-btn v-close-popup flat label="Vazgeç" />
          <q-btn flat color="negative" label="Kaldır" @click="remove" />
        </q-card-actions>
      </q-card>
    </q-dialog>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { repos, type Project } from '@/db'
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
