<template>
  <CouncilConfigurator
    :task="task" :roles="ROLE_PRESETS[ideaMode]" :busy="busy"
    :start-label="ideaMode === 'kill' ? t('council.setup.killStart') : t('council.configurator.start')"
    :start-icon="ideaMode === 'kill' ? 'local_fire_department' : 'play_arrow'"
    :start-color="ideaMode === 'kill' ? 'negative' : 'primary'"
    @start="(config) => emit('start', ideaMode, config)"
  >
    <template #actions>
      <q-btn-toggle
        v-model="ideaMode" no-caps unelevated toggle-color="primary"
        :options="[{ label: t('council.setup.evaluate'), value: 'evaluate' }, { label: t('council.setup.kill'), value: 'kill', icon: 'local_fire_department' }]"
      />
    </template>
  </CouncilConfigurator>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import CouncilConfigurator from './CouncilConfigurator.vue'
import { t } from '@/i18n'
import type { Idea } from '@/db'
import type { CouncilConfig } from '@/domain/council/engine'
import { buildIdeaTask, ROLE_PRESETS, type IdeaMode } from '@/domain/ideas/task'

const props = defineProps<{ idea: Idea; busy?: boolean }>()
const emit = defineEmits<{ start: [mode: IdeaMode, config: CouncilConfig] }>()

const ideaMode = ref<IdeaMode>('evaluate')
const task = computed(() => buildIdeaTask(props.idea, ideaMode.value))
</script>
