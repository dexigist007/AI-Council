<template>
  <q-card flat bordered class="tone-info">
    <q-card-section>
      <div class="text-subtitle1">{{ t('ideas.verdict.title') }}</div>
      <div class="text-caption text-soft">
        {{ t('ideas.verdict.hint') }}
      </div>
    </q-card-section>
    <q-card-section class="q-pt-none q-gutter-sm">
      <q-btn-toggle v-model="decision" unelevated no-caps toggle-color="primary" :color="$q.dark.isActive ? 'grey-9' : 'white'" :text-color="$q.dark.isActive ? 'white' : 'dark'"
        :options="DECISIONS.map((d) => ({ label: d === suggested ? t('ideas.verdict.suggested', { decision: d }) : d, value: d }))" />
      <q-input v-model="reason" dense outlined autogrow :label="t('ideas.verdict.reason')" />
      <q-input v-if="parks" v-model="revisit" dense outlined autogrow :label="t('ideas.verdict.revisit')" />
    </q-card-section>
    <q-card-actions class="q-px-md q-pb-md">
      <q-btn unelevated color="primary" icon="gavel" :label="parks ? t('ideas.verdict.confirmPark') : t('ideas.verdict.confirm')"
        :disable="!reason.trim()" :loading="saving" @click="save" />
      <span v-if="error" class="text-negative q-ml-md">{{ error }}</span>
    </q-card-actions>
  </q-card>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { repos, type Idea } from '@/db'
import { decisionToStatus } from '@/domain/ideas/labels'
import { DECISIONS, type IdeaDecision, type IdeaReport } from '@/domain/ideas/report'
import { t } from '@/i18n'

const props = defineProps<{ idea: Idea; report: IdeaReport; sessionId: string }>()
const emit = defineEmits<{ decided: [] }>()

const suggested = props.report.decision
const decision = ref<IdeaDecision>(suggested)
const reason = ref(props.report.decision_reason)
const revisit = ref(props.report.revisit_condition ?? '')
const saving = ref(false)
const error = ref<string | null>(null)
const parks = computed(() => decision.value === 'HOLD' || decision.value === 'REJECT')

async function save() {
  saving.value = true
  try {
    const r = await repos()
    await r.ideas.setVerdict(props.idea.id, {
      status: decisionToStatus(decision.value),
      sessionId: props.sessionId,
      rejectReason: parks.value ? reason.value.trim() : null,
      revisitCondition: parks.value ? revisit.value.trim() || null : null,
    })
    await r.decisions.create({
      ideaId: props.idea.id,
      sessionId: props.sessionId,
      title: `${props.idea.title}: ${decision.value}`,
      reason: reason.value.trim(),
      userApproved: true,
    })
    emit('decided')
  } catch (e) {
    error.value = String(e)
  } finally {
    saving.value = false
  }
}
</script>
