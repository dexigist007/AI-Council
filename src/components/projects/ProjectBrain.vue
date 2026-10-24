<template>
  <div class="stack">
    <div class="row items-center">
      <div class="col text-caption text-soft">
        <q-badge outline color="primary">OBSERVED</q-badge> {{ t('projects.brain.legendObserved') }} ·
        <q-badge outline color="orange-9">INFERRED</q-badge> {{ t('projects.brain.legendInferred') }} ·
        <q-badge outline color="positive">USER CONFIRMED</q-badge> {{ t('projects.brain.legendConfirmed') }}
        {{ t('projects.brain.legendNote') }}
      </div>
      <q-btn unelevated color="primary" icon="auto_awesome" :label="t('projects.brain.draftButton')" :disable="!project.indexedAt" @click="dialog = true" />
    </div>
    <q-banner v-if="message" rounded class="tone-info">{{ message }}<template #action><q-btn flat dense icon="close" @click="message = null" /></template></q-banner>
    <div v-if="pendingCount" class="text-caption text-warn">{{ t('projects.brain.pending', { n: pendingCount }) }}</div>

    <q-card v-for="section in sections" :key="section" flat bordered>
      <q-card-section class="text-subtitle2 q-pb-sm">{{ sectionLabel(section) }}</q-card-section>
      <q-list dense separator>
        <q-item v-for="f in bySection[section] ?? []" :key="f.id" :class="f.status === 'pending' ? 'tone-warn' : ''">
          <q-item-section side top><q-badge outline :color="SOURCE[f.source].color">{{ SOURCE[f.source].label }}</q-badge></q-item-section>
          <q-item-section>
            <q-input v-if="editing === f.id" v-model="editText" dense autofocus autogrow @keyup.enter="confirm(f.id, editText)" />
            <q-item-label v-else>{{ f.statement }}</q-item-label>
            <q-item-label v-if="f.evidence.length" caption>
              <q-icon name="description" size="xs" /> {{ f.evidence.map((e) => e.file).join(', ') }}
            </q-item-label>
            <q-item-label v-else-if="f.source === 'inferred'" caption class="text-warn">{{ t('projects.brain.noEvidence') }}</q-item-label>
          </q-item-section>
          <q-item-section v-if="f.source !== 'observed'" side>
            <div class="row no-wrap">
              <template v-if="editing === f.id">
                <q-btn flat dense round icon="check" color="positive" @click="confirm(f.id, editText)"><q-tooltip>{{ t('projects.brain.saveConfirm') }}</q-tooltip></q-btn>
                <q-btn flat dense round icon="close" @click="editing = null" />
              </template>
              <template v-else>
                <q-btn v-if="f.status === 'pending'" flat dense round icon="check" color="positive" @click="confirm(f.id)"><q-tooltip>{{ t('projects.brain.confirm') }}</q-tooltip></q-btn>
                <q-btn flat dense round icon="edit" @click="startEdit(f)"><q-tooltip>{{ t('projects.brain.editConfirm') }}</q-tooltip></q-btn>
                <q-btn flat dense round icon="delete_outline" color="negative" @click="reject(f.id)"><q-tooltip>{{ t('projects.brain.reject') }}</q-tooltip></q-btn>
              </template>
            </div>
          </q-item-section>
        </q-item>
        <q-item v-if="section !== 'stack'">
          <q-item-section>
            <q-input v-model="drafts[section]" dense borderless :placeholder="t('projects.brain.addPlaceholder')" @keyup.enter="add(section)" />
          </q-item-section>
        </q-item>
      </q-list>
    </q-card>

    <BrainDraftDialog v-model="dialog" :project="project" @done="onDraft" />
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import BrainDraftDialog from './BrainDraftDialog.vue'
import { repos, type BrainFact, type Project } from '@/db'
import { BRAIN_SECTIONS, sectionLabel, type BrainSection } from '@/domain/brain/sections'
import { t } from '@/i18n'

const props = defineProps<{ project: Project }>()
const emit = defineEmits<{ changed: [] }>()

const SOURCE = {
  observed: { label: 'OBSERVED', color: 'primary' },
  inferred: { label: 'INFERRED', color: 'orange-9' },
  user_confirmed: { label: 'USER CONFIRMED', color: 'positive' },
} as const

const sections: BrainSection[] = [...BRAIN_SECTIONS.slice(0, 3), 'stack', ...BRAIN_SECTIONS.slice(3)]
const facts = ref<BrainFact[]>([])
const dialog = ref(false)
const message = ref<string | null>(null)
const editing = ref<string | null>(null)
const editText = ref('')
const drafts = reactive<Record<string, string>>({})

const visible = computed(() => facts.value.filter((f) => f.status !== 'rejected'))
const bySection = computed(() => {
  const out: Record<string, BrainFact[]> = {}
  for (const f of visible.value) (out[f.section] ??= []).push(f)
  return out
})
const pendingCount = computed(() => visible.value.filter((f) => f.status === 'pending').length)

async function load() {
  facts.value = await (await repos()).brainFacts.list(props.project.id)
}

async function confirm(id: string, statement?: string) {
  await (await repos()).brainFacts.confirm(id, statement)
  editing.value = null
  await load()
}

function startEdit(f: BrainFact) {
  editing.value = f.id
  editText.value = f.statement.replace(/^\((düşük güven|low confidence)\)\s*/, '')
}

async function reject(id: string) {
  await (await repos()).brainFacts.reject(id)
  await load()
}

async function add(section: string) {
  const text = drafts[section]?.trim()
  if (!text) return
  await (await repos()).brainFacts.addManual(props.project.id, section, text)
  drafts[section] = ''
  await load()
}

async function onDraft(msg: string) {
  message.value = msg
  await load()
  emit('changed')
}

onMounted(load)
</script>
